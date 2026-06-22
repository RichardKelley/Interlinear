import { createId } from "./ids.js";
import {
  lineCollisionRects,
  orderedVisibleLayers,
  pageObjectCollisionRects,
  resolveLineCollisions,
  resolveWordBoxCollisions,
  WORD_BOX_EMPTY_MIN_WIDTH,
  wordBoxCollisionRectsForPositioned,
  wordBoxCollisionRectsForToken,
  wordBoxRectFromPositioned,
  WORD_BOX_COLLISION_GAP
} from "./collision.js";
import { availableBands, routeLine, sourceLineBoxHeight, TOKEN_GAP } from "./layout.js";
import type { InterlinearDocument, InterlinearLine, Page, Token } from "./schema.js";

export const LINE_SNAP_DISTANCE = 28;
const COLLISION_CONSTRAINT_EPSILON = 0.001;

export function addPageToDocument(
  document: InterlinearDocument,
  pageId: string,
  afterPageId?: string
): InterlinearDocument {
  if (document.pages.some((page) => page.id === pageId)) return document;
  const requestedIndex = afterPageId ? document.pages.findIndex((page) => page.id === afterPageId) : document.pages.length - 1;
  const insertIndex = requestedIndex >= 0 ? requestedIndex : document.pages.length - 1;
  const page = createPage(pageId, insertIndex + 2);
  const pages = [...document.pages];
  pages.splice(Math.max(0, insertIndex) + 1, 0, page);
  return { ...document, pages: renumberPages(pages) };
}

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
  const sourcePositioned = routeLine(document, found.page, found.line).positionedTokens.find((item) => item.tokenId === sourceTokenId);
  const sourceRect = sourcePositioned ? wordBoxRectFromPositioned(sourcePositioned) : null;
  const targetX =
    sourceRect && found.line.direction === "rtl"
      ? sourceRect.x - WORD_BOX_EMPTY_MIN_WIDTH - TOKEN_GAP
      : sourceRect
        ? sourceRect.x + sourceRect.width + TOKEN_GAP
        : document.pageSettings.marginLeft;
  const tokenOffsetX = offsetForTokenX(document, found.page, found.line, tokenIds, tokenId, targetX, token);
  const next = {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...token,
        offset: { x: tokenOffsetX, y: 0 }
      }
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
  const currentRects = wordBoxCollisionRectsForToken(document, found.page, found.line, tokenId);
  const proposedRects = wordBoxCollisionRectsForToken(proposed, found.page, found.line, tokenId);
  const currentRect = currentRects[0];
  const proposedRect = proposedRects[0];
  if (!currentRect || !proposedRect || currentRects.length !== proposedRects.length) return proposed;

  const dx = proposedRect.x - currentRect.x;
  if (dx === 0) return proposed;

  let constrainedDx = dx;
  const layers = orderedVisibleLayers(document);
  const stationaryRects = routeLine(document, found.page, found.line).positionedTokens
    .filter((positioned) => positioned.tokenId !== tokenId)
    .flatMap((positioned) => wordBoxCollisionRectsForPositioned(document, layers, positioned));
  stationaryRects.push(...pageObjectCollisionRects(found.page));

  for (const rect of stationaryRects) {
    currentRects.forEach((current, index) => {
      const proposed = proposedRects[index];
      if (!rectsOverlapVertically(proposed.y, proposed.height, rect.y, rect.height)) return;
      if (dx > 0 && current.x + current.width <= rect.x) {
        constrainedDx = Math.min(
          constrainedDx,
          rect.x - WORD_BOX_COLLISION_GAP - COLLISION_CONSTRAINT_EPSILON - (current.x + current.width)
        );
      } else if (dx < 0 && current.x >= rect.x + rect.width) {
        constrainedDx = Math.max(
          constrainedDx,
          rect.x + rect.width + WORD_BOX_COLLISION_GAP + COLLISION_CONSTRAINT_EPSILON - current.x
        );
      }
    });
  }

  if (constrainedDx !== dx) {
    return {
      ...document,
      tokens: {
        ...document.tokens,
        [tokenId]: {
          ...token,
          offset: { ...offset, x: offset.x + constrainedDx - dx }
        }
      }
    };
  }

  return proposed;
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

function createPage(pageId = createId("page"), number = 1): Page {
  return {
    id: pageId,
    number,
    lines: [],
    pageObjects: []
  };
}

function renumberPages(pages: Page[]): Page[] {
  return pages.map((page, index) => ({ ...page, number: index + 1 }));
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

  const target = nextLinePlacementAfter(document, found.page, found.line);
  if (!target) return fallback ?? document;

  const next = moveTokenToLine(document, found.page, found.line, target, tokenId);
  const spaced = target.lineExists ? next : resolveLineCollisions(next, target.page.id);

  return moveTokenToNextLineIfNeeded(
    resolveWordBoxCollisions(spaced, target.page.id, target.line.id),
    target.page.id,
    target.line.id,
    tokenId,
    remainingMoves - 1,
    fallback
  );
}

function moveTokenToLine(
  document: InterlinearDocument,
  sourcePage: Page,
  sourceLine: InterlinearLine,
  target: LinePlacement,
  tokenId: string
): InterlinearDocument {
  const targetPageExists = document.pages.some((page) => page.id === target.page.id);
  const sourceAndTargetSamePage = sourcePage.id === target.page.id;
  const pages = document.pages.map((page) => {
    if (page.id !== sourcePage.id && page.id !== target.page.id) return page;
    const baseLines = page.lines.map((line) => {
      if (line.id === sourceLine.id) {
        return { ...line, tokenIds: line.tokenIds.filter((id) => id !== tokenId) };
      }
      if (line.id === target.line.id) {
        return { ...line, tokenIds: [...line.tokenIds.filter((id) => id !== tokenId), tokenId] };
      }
      return line;
    });
    const shouldAddTargetLine = page.id === target.page.id && !target.lineExists;
    return {
      ...page,
      lines: [
        ...baseLines,
        ...(shouldAddTargetLine ? [{ ...target.line, tokenIds: [tokenId] }] : [])
      ].sort((left, right) => left.y - right.y)
    };
  });

  const insertedPages = targetPageExists
    ? pages
    : insertPageAfter(
        pages,
        target.afterPageId ?? (sourceAndTargetSamePage ? target.page.id : sourcePage.id),
        { ...target.page, lines: [{ ...target.line, tokenIds: [tokenId] }] }
      );

  return {
    ...document,
    tokens: {
      ...document.tokens,
      [tokenId]: {
        ...document.tokens[tokenId],
        lineId: target.line.id,
        offset: { x: 0, y: 0 }
      }
    },
    pages: renumberPages(insertedPages)
  };
}

function insertPageAfter(pages: Page[], afterPageId: string, page: Page): Page[] {
  const insertIndex = pages.findIndex((candidate) => candidate.id === afterPageId);
  const next = [...pages];
  next.splice(insertIndex >= 0 ? insertIndex + 1 : next.length, 0, page);
  return next;
}

function tokenFitsLine(document: InterlinearDocument, page: Page, line: InterlinearLine, tokenId: string): boolean {
  const routed = routeLine(document, page, line);
  const positioned = routed.positionedTokens.find((item) => item.tokenId === tokenId);
  if (!positioned) return true;
  const rect = wordBoxRectFromPositioned(positioned);
  return routed.bands.some((band) => rect.x >= band.x && rect.x + rect.width <= band.x + band.width);
}

type LinePlacement = {
  page: Page;
  line: InterlinearLine;
  lineExists: boolean;
  afterPageId?: string;
};

function nextLinePlacementAfter(document: InterlinearDocument, page: Page, line: InterlinearLine): LinePlacement | null {
  const lineY = line.y + line.offset.y;
  const targetY = lineY + lineAdvance(document);
  const samePagePlacement = linePlacementOnPage(document, page, targetY, line.id);
  if (samePagePlacement) return samePagePlacement;

  const pageIndex = document.pages.findIndex((candidate) => candidate.id === page.id);
  for (const candidate of document.pages.slice(pageIndex + 1)) {
    const placement = firstLinePlacementOnPage(document, candidate);
    if (placement) return placement;
  }

  const nextPage = createPage(createId("page"), document.pages.length + 1);
  const y = firstAvailableLineY(document, nextPage, document.pageSettings.marginTop);
  return y === null
    ? null
    : {
        page: nextPage,
        line: createLineAt(document, y),
        lineExists: false,
        afterPageId: document.pages.at(-1)?.id ?? page.id
      };
}

function linePlacementOnPage(
  document: InterlinearDocument,
  page: Page,
  targetY: number,
  excludedLineId?: string
): LinePlacement | null {
  if (!lineFitsPage(document, targetY)) return null;
  const existing = nearestLine(
    page.lines.filter((candidate) => candidate.id !== excludedLineId && candidate.y + candidate.offset.y >= targetY - LINE_SNAP_DISTANCE),
    targetY,
    LINE_SNAP_DISTANCE
  );
  if (existing) return { page, line: existing, lineExists: true };
  const y = firstAvailableLineY(document, page, targetY);
  return y !== null && lineFitsPage(document, y) ? { page, line: createLineAt(document, y), lineExists: false } : null;
}

function firstLinePlacementOnPage(document: InterlinearDocument, page: Page): LinePlacement | null {
  const sortedLines = [...page.lines].sort((left, right) => left.y + left.offset.y - (right.y + right.offset.y));
  const targetY = sortedLines.length
    ? sortedLines[sortedLines.length - 1].y + sortedLines[sortedLines.length - 1].offset.y + lineAdvance(document)
    : document.pageSettings.marginTop;
  return linePlacementOnPage(document, page, targetY);
}

function firstAvailableLineY(document: InterlinearDocument, page: Page, startY: number): number | null {
  const minimumY = document.pageSettings.marginTop;
  const maximumY = maximumLineY(document);
  const lineHeight = document.pageSettings.fontSize + document.pageSettings.annotationGap * Math.max(document.layers.length, 1);
  const step = Math.max(1, Math.floor(sourceLineBoxHeight(document.pageSettings) / 2));
  const firstY = clamp(startY, minimumY, maximumY);

  for (let y = firstY; y <= maximumY; y += step) {
    if (availableBands(page, document.pageSettings, y, lineHeight).length > 0) return y;
  }

  return null;
}

function lineFitsPage(document: InterlinearDocument, y: number): boolean {
  return y >= document.pageSettings.marginTop && y <= maximumLineY(document);
}

function maximumLineY(document: InterlinearDocument): number {
  return document.pageSettings.height - document.pageSettings.marginBottom - sourceLineBoxHeight(document.pageSettings);
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
