import { createId } from "./ids.js";
import {
  lineCollisionRects,
  resolveLineCollisions,
  resolveWordBoxCollisions,
  wordBoxRectFromPositioned,
  WORD_BOX_COLLISION_GAP
} from "./collision.js";
import { routeLine, sourceLineBoxHeight } from "./layout.js";
import type { InterlinearDocument, InterlinearLine, Page, Token } from "./schema.js";

export const LINE_SNAP_DISTANCE = 28;

export function addLineToDocument(
  document: InterlinearDocument,
  pageId: string,
  lineId: string,
  anchorLineId?: string
): InterlinearDocument {
  const page = document.pages.find((item) => item.id === pageId) ?? document.pages[0];
  if (!page) return document;
  const existing = page.lines.find((line) => line.id === lineId);
  if (existing) return document;

  const sortedLines = [...page.lines].sort((left, right) => left.y + left.offset.y - (right.y + right.offset.y));
  const anchorLine = sortedLines.find((line) => line.id === anchorLineId) ?? sortedLines.at(-1);
  const y = anchorLine ? anchorLine.y + anchorLine.offset.y + lineAdvance(document) : document.pageSettings.marginTop;
  const line: InterlinearLine = { ...createLineAt(document, y), id: lineId };

  const next = {
    ...document,
    pages: document.pages.map((item) =>
      item.id === page.id ? { ...item, lines: [...item.lines, line].sort((left, right) => left.y - right.y) } : item
    )
  };
  return resolveLineCollisions(next, page.id);
}

export function addLineAtDocument(
  document: InterlinearDocument,
  pageId: string,
  lineId: string,
  y: number
): InterlinearDocument {
  const page = document.pages.find((item) => item.id === pageId) ?? document.pages[0];
  if (!page) return document;
  const existing = page.lines.find((line) => line.id === lineId);
  if (existing) return document;

  const line = createLineAt(document, y);
  const next = {
    ...document,
    pages: document.pages.map((item) =>
      item.id === page.id ? { ...item, lines: [...item.lines, { ...line, id: lineId }].sort((left, right) => left.y - right.y) } : item
    )
  };
  return resolveLineCollisions(next, page.id);
}

export function addWordBoxToDocument(
  document: InterlinearDocument,
  pageId: string,
  tokenId: string,
  point?: { x: number; y: number }
): InterlinearDocument {
  const page = document.pages.find((item) => item.id === pageId) ?? document.pages[0];
  if (!page) return document;

  const targetY = point?.y ?? page.lines[0]?.y ?? document.pageSettings.marginTop;
  const targetX = point?.x ?? document.pageSettings.marginLeft;
  const existingLine = nearestLine(page.lines, targetY, LINE_SNAP_DISTANCE);
  const line = existingLine ?? createLineAt(document, targetY);
  const lineIds = existingLine ? page.lines.map((item) => item.id) : [...page.lines.map((item) => item.id), line.id];
  const orderedLineIds = lineIds
    .map((id) => (id === line.id ? line : page.lines.find((item) => item.id === id) ?? line))
    .sort((left, right) => left.y - right.y)
    .map((item) => item.id);

  const token: Token = {
    id: tokenId,
    text: "",
    normalized: "",
    direction: line.direction,
    lineId: line.id,
    offset: { x: 0, y: 0 },
    textMetrics: {}
  };

  const orderedTokenIds = orderTokenIdsByX(document, page, line, [...line.tokenIds, tokenId], tokenId, targetX);
  const tokenOffsetX = offsetForTokenX(document, page, line, orderedTokenIds, tokenId, targetX, token);

  const next = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        offset: { x: tokenOffsetX, y: 0 }
      }
    },
    pages: document.pages.map((item) =>
      item.id === page.id
        ? {
            ...item,
            lines: orderedLineIds.map((lineId) => {
              if (lineId === line.id) {
                return { ...line, tokenIds: orderedTokenIds };
              }
              return item.lines.find((candidate) => candidate.id === lineId)!;
            })
          }
        : item
      )
  };
  const spaced = existingLine ? next : resolveLineCollisions(next, page.id);
  return moveTokenToNextLineIfNeeded(resolveWordBoxCollisions(spaced, page.id, line.id), page.id, line.id, tokenId);
}

export function addWordBoxToLineDocument(
  document: InterlinearDocument,
  pageId: string,
  lineId: string,
  tokenId: string,
  x: number
): InterlinearDocument {
  const page = document.pages.find((item) => item.id === pageId) ?? document.pages[0];
  const line = page?.lines.find((item) => item.id === lineId);
  if (!page || !line) return document;
  const existing = document.tokens[tokenId];
  if (existing) return document;

  const token: Token = {
    id: tokenId,
    text: "",
    normalized: "",
    direction: line.direction,
    lineId: line.id,
    offset: { x: 0, y: 0 },
    textMetrics: {}
  };
  const orderedTokenIds = orderTokenIdsByX(document, page, line, [...line.tokenIds, tokenId], tokenId, x);
  const tokenOffsetX = offsetForTokenX(document, page, line, orderedTokenIds, tokenId, x, token);
  const next = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        offset: { x: tokenOffsetX, y: 0 }
      }
    },
    pages: document.pages.map((item) =>
      item.id === page.id
        ? {
            ...item,
            lines: item.lines.map((candidate) => (candidate.id === line.id ? { ...candidate, tokenIds: orderedTokenIds } : candidate))
          }
        : item
    )
  };

  return resolveWordBoxCollisions(next, page.id, line.id);
}

export function insertWordBoxAfterToken(
  document: InterlinearDocument,
  sourceTokenId: string,
  tokenId: string
): InterlinearDocument {
  const sourceToken = document.tokens[sourceTokenId];
  if (!sourceToken) return document;
  const found = findLineForToken(document, sourceTokenId);
  if (!found) return document;
  const sourceIndex = found.line.tokenIds.indexOf(sourceTokenId);
  if (sourceIndex < 0) return document;

  const token: Token = {
    id: tokenId,
    text: "",
    normalized: "",
    direction: sourceToken.direction,
    lineId: found.line.id,
    offset: { x: 0, y: 0 },
    textMetrics: {}
  };

  const tokenIds = [
    ...found.line.tokenIds.slice(0, sourceIndex + 1),
    tokenId,
    ...found.line.tokenIds.slice(sourceIndex + 1)
  ];
  const next = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: token
    },
    pages: document.pages.map((page) =>
      page.id === found.page.id
        ? {
            ...page,
            lines: page.lines.map((line) => (line.id === found.line.id ? { ...line, tokenIds } : line))
          }
        : page
    )
  };

  return moveTokenToNextLineIfNeeded(resolveWordBoxCollisions(next, found.page.id, found.line.id), found.page.id, found.line.id, tokenId);
}

export function snapTokenToNearestLine(document: InterlinearDocument, tokenId: string): InterlinearDocument {
  const token = document.tokens[tokenId];
  if (!token) return document;

  const source = findLineForToken(document, tokenId);
  if (!source) return document;

  const routed = routeLine(document, source.page, source.line);
  const positioned = routed.positionedTokens.find((item) => item.tokenId === tokenId);
  const visualX = positioned?.rect.x ?? document.pageSettings.marginLeft + token.offset.x;
  const visualY = positioned?.rect.y ?? source.line.y + token.offset.y;
  const targetLine = nearestLine(source.page.lines, visualY, LINE_SNAP_DISTANCE);
  if (!targetLine) return document;

  const sameLine = targetLine.id === source.line.id;
  const targetIdsWithoutMoved = targetLine.tokenIds.filter((id) => id !== tokenId);
  const orderedTokenIds = orderTokenIdsByX(document, source.page, targetLine, [...targetIdsWithoutMoved, tokenId], tokenId, visualX);
  const tokenOffsetX = offsetForTokenX(document, source.page, targetLine, orderedTokenIds, tokenId, visualX, token);

  const next = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        lineId: targetLine.id,
        offset: { x: tokenOffsetX, y: 0 }
      }
    },
    pages: document.pages.map((page) =>
      page.id === source.page.id
        ? {
            ...page,
            lines: page.lines.map((line) => {
              if (line.id === targetLine.id) {
                return { ...line, tokenIds: orderedTokenIds };
              }
              if (!sameLine && line.id === source.line.id) {
                return { ...line, tokenIds: line.tokenIds.filter((id) => id !== tokenId) };
              }
              return line;
            })
          }
        : page
      )
  };
  const fallback = resolveWordBoxCollisions(
    {
      ...document,
      tokens: {
        ...document.tokens,
        [tokenId]: {
          ...token,
          lineId: source.line.id,
          offset: { x: 0, y: 0 }
        }
      }
    },
    source.page.id,
    source.line.id
  );
  return moveTokenToNextLineIfNeeded(
    resolveWordBoxCollisions(next, source.page.id, targetLine.id),
    source.page.id,
    targetLine.id,
    tokenId,
    6,
    fallback
  );
}

export function normalizeTokenLayout(document: InterlinearDocument, tokenId: string): InterlinearDocument {
  const found = findLineForToken(document, tokenId);
  if (!found) return document;
  return moveTokenToNextLineIfNeeded(
    resolveWordBoxCollisions(document, found.page.id, found.line.id),
    found.page.id,
    found.line.id,
    tokenId
  );
}

export function moveTokenWithCollisionConstraints(
  document: InterlinearDocument,
  tokenId: string,
  offset: Token["offset"]
): InterlinearDocument {
  const token = document.tokens[tokenId];
  if (!token) return document;
  const found = findLineForToken(document, tokenId);
  if (!found) return document;

  const proposed = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        offset
      }
    }
  };
  const currentRect = tokenWordBoxRect(document, found.page, found.line, tokenId);
  const proposedRect = tokenWordBoxRect(proposed, found.page, found.line, tokenId);
  if (!currentRect || !proposedRect) return proposed;

  const dx = proposedRect.x - currentRect.x;
  if (dx === 0) return proposed;

  let constrainedX = proposedRect.x;
  const stationaryRects = routeLine(document, found.page, found.line).positionedTokens
    .filter((positioned) => positioned.tokenId !== tokenId)
    .map((positioned) => wordBoxRectFromPositioned(positioned));

  for (const rect of stationaryRects) {
    if (!rectsOverlapVertically(proposedRect.y, proposedRect.height, rect.y, rect.height)) continue;
    if (dx > 0 && currentRect.x + currentRect.width <= rect.x) {
      constrainedX = Math.min(constrainedX, rect.x - proposedRect.width - WORD_BOX_COLLISION_GAP);
    } else if (dx < 0 && currentRect.x >= rect.x + rect.width) {
      constrainedX = Math.max(constrainedX, rect.x + rect.width + WORD_BOX_COLLISION_GAP);
    }
  }

  if (constrainedX === proposedRect.x) return proposed;
  return {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        offset: { ...offset, x: offset.x + constrainedX - proposedRect.x }
      }
    }
  };
}

export function moveLineWithCollisionConstraints(
  document: InterlinearDocument,
  lineId: string,
  visualY: number
): InterlinearDocument {
  const found = findLineForId(document, lineId);
  if (!found) return document;

  const constrainedVisualY = constrainLineY(document, visualY);
  const currentY = found.line.y + found.line.offset.y;
  const dy = constrainedVisualY - currentY;
  let finalDelta = dy;

  if (dy !== 0) {
    const currentRects = lineCollisionRects(document, found.page, found.line);
    const stationaryRects = found.page.lines
      .filter((line) => line.id !== lineId)
      .flatMap((line) => lineCollisionRects(document, found.page, line));

    for (const currentRect of currentRects) {
      const proposedRect = { ...currentRect, y: currentRect.y + dy };
      for (const stationaryRect of stationaryRects) {
        if (!rectsOverlapHorizontally(proposedRect.x, proposedRect.width, stationaryRect.x, stationaryRect.width)) continue;
        if (dy > 0 && currentRect.y + currentRect.height <= stationaryRect.y) {
          finalDelta = Math.min(
            finalDelta,
            stationaryRect.y - currentRect.height - WORD_BOX_COLLISION_GAP - currentRect.y
          );
        } else if (dy < 0 && currentRect.y >= stationaryRect.y + stationaryRect.height) {
          finalDelta = Math.max(finalDelta, stationaryRect.y + stationaryRect.height + WORD_BOX_COLLISION_GAP - currentRect.y);
        }
      }
    }
  }

  const finalY = constrainLineY(document, currentY + finalDelta);
  if (finalY === currentY) return document;

  return {
    ...document,
    pages: document.pages.map((page) =>
      page.id === found.page.id
        ? {
            ...page,
            lines: page.lines.map((line) => (line.id === lineId ? { ...line, y: finalY - line.offset.y } : line))
          }
        : page
    )
  };
}

function createLineAt(document: InterlinearDocument, y: number): InterlinearLine {
  return {
    id: createId("line"),
    tokenIds: [],
    y: constrainLineY(document, y),
    offset: { x: 0, y: 0 },
    direction: document.direction
  };
}

function constrainLineY(document: InterlinearDocument, y: number): number {
  return clamp(
    y,
    document.pageSettings.marginTop,
    document.pageSettings.height - document.pageSettings.marginBottom - sourceLineBoxHeight(document.pageSettings)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  const safeMaximum = Math.max(minimum, maximum);
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), safeMaximum);
}

function lineAdvance(document: InterlinearDocument): number {
  return (
    document.pageSettings.fontSize +
    document.pageSettings.annotationGap * Math.max(document.layers.length, 1) +
    document.pageSettings.lineGap
  );
}

function nearestLine(lines: InterlinearLine[], y: number, maxDistance: number): InterlinearLine | null {
  let best: { line: InterlinearLine; distance: number } | null = null;
  for (const line of lines) {
    const distance = Math.abs(line.y + line.offset.y - y);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { line, distance };
    }
  }
  return best?.line ?? null;
}

function findLineForToken(
  document: InterlinearDocument,
  tokenId: string
): { page: Page; line: InterlinearLine } | null {
  for (const page of document.pages) {
    const line = page.lines.find((candidate) => candidate.tokenIds.includes(tokenId));
    if (line) return { page, line };
  }
  return null;
}

function tokenWordBoxRect(document: InterlinearDocument, page: Page, line: InterlinearLine, tokenId: string) {
  const positioned = routeLine(document, page, line).positionedTokens.find((item) => item.tokenId === tokenId);
  return positioned ? wordBoxRectFromPositioned(positioned) : null;
}

function rectsOverlapVertically(top: number, height: number, otherTop: number, otherHeight: number): boolean {
  return top < otherTop + otherHeight && top + height > otherTop;
}

function rectsOverlapHorizontally(left: number, width: number, otherLeft: number, otherWidth: number): boolean {
  return left < otherLeft + otherWidth && left + width > otherLeft;
}

function orderTokenIdsByX(
  document: InterlinearDocument,
  page: Page,
  line: InterlinearLine,
  tokenIds: string[],
  activeTokenId: string,
  activeX: number
): string[] {
  const routed = routeLine(document, page, line);
  const positions = new Map(routed.positionedTokens.map((positioned) => [positioned.tokenId, positioned.rect.x]));
  return [...tokenIds].sort((left, right) => {
    const leftX = left === activeTokenId ? activeX : positions.get(left) ?? document.pageSettings.marginLeft;
    const rightX = right === activeTokenId ? activeX : positions.get(right) ?? document.pageSettings.marginLeft;
    return line.direction === "rtl" ? rightX - leftX : leftX - rightX;
  });
}

function offsetForTokenX(
  document: InterlinearDocument,
  page: Page,
  line: InterlinearLine,
  tokenIds: string[],
  tokenId: string,
  visualX: number,
  tokenOverride?: Token
): number {
  const token = tokenOverride ?? document.tokens[tokenId];
  if (!token) return 0;
  const targetLine = { ...line, tokenIds };
  const targetDocument = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        lineId: line.id,
        offset: { x: 0, y: 0 }
      }
    }
  };
  const positioned = routeLine(targetDocument, page, targetLine).positionedTokens.find((item) => item.tokenId === tokenId);
  const baseX = positioned?.rect.x ?? document.pageSettings.marginLeft + line.offset.x;
  return visualX - baseX;
}

function moveTokenToNextLineIfNeeded(
  document: InterlinearDocument,
  pageId: string,
  lineId: string,
  tokenId: string,
  remainingMoves = 6,
  fallback?: InterlinearDocument
): InterlinearDocument {
  if (remainingMoves <= 0) return fallback ?? document;
  const found = findLineById(document, pageId, lineId);
  if (!found || tokenFitsLine(document, found.page, found.line, tokenId)) return document;

  const targetLine = nextLineAfter(document, found.page, found.line);
  const targetExists = found.page.lines.some((line) => line.id === targetLine.id);
  const next = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...document.tokens[tokenId],
        lineId: targetLine.id,
        offset: { x: 0, y: 0 }
      }
    },
    pages: document.pages.map((page) =>
      page.id === found.page.id
        ? {
            ...page,
            lines: [
              ...page.lines.map((line) => {
                if (line.id === found.line.id) {
                  return { ...line, tokenIds: line.tokenIds.filter((id) => id !== tokenId) };
                }
                if (line.id === targetLine.id) {
                  return { ...line, tokenIds: [...line.tokenIds.filter((id) => id !== tokenId), tokenId] };
                }
                return line;
              }),
              ...(targetExists ? [] : [{ ...targetLine, tokenIds: [tokenId] }])
            ].sort((left, right) => left.y - right.y)
          }
        : page
      )
  };
  const spaced = targetExists ? next : resolveLineCollisions(next, found.page.id);

  return moveTokenToNextLineIfNeeded(
    resolveWordBoxCollisions(spaced, found.page.id, targetLine.id),
    found.page.id,
    targetLine.id,
    tokenId,
    remainingMoves - 1,
    fallback
  );
}

function tokenFitsLine(document: InterlinearDocument, page: Page, line: InterlinearLine, tokenId: string): boolean {
  const routed = routeLine(document, page, line);
  const positioned = routed.positionedTokens.find((item) => item.tokenId === tokenId);
  if (!positioned) return true;
  const rect = wordBoxRectFromPositioned(positioned);
  return routed.bands.some((band) => rect.x >= band.x && rect.x + rect.width <= band.x + band.width);
}

function nextLineAfter(document: InterlinearDocument, page: Page, line: InterlinearLine): InterlinearLine {
  const lineY = line.y + line.offset.y;
  const targetY = lineY + lineAdvance(document);
  const existing = nearestLine(
    page.lines.filter((candidate) => candidate.id !== line.id && candidate.y + candidate.offset.y > lineY),
    targetY,
    LINE_SNAP_DISTANCE
  );
  return existing ?? createLineAt(document, targetY);
}

function findLineById(
  document: InterlinearDocument,
  pageId: string,
  lineId: string
): { page: Page; line: InterlinearLine } | null {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  const line = page?.lines.find((candidate) => candidate.id === lineId);
  return page && line ? { page, line } : null;
}

function findLineForId(document: InterlinearDocument, lineId: string): { page: Page; line: InterlinearLine } | null {
  for (const page of document.pages) {
    const line = page.lines.find((candidate) => candidate.id === lineId);
    if (line) return { page, line };
  }
  return null;
}
