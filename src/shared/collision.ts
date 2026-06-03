import { estimateTokenWidth, routeLine, sourceLineBoxHeight, type PositionedToken } from "./layout.js";
import type { AnnotationCell, InterlinearDocument, InterlinearLine, Layer, Page, PageSettings, Rect } from "./schema.js";

export const WORD_BOX_MIN_WIDTH = 22;
export const WORD_BOX_EMPTY_MIN_WIDTH = 34;
export const WORD_BOX_WIDTH_PADDING = 18;
export const WORD_BOX_COLLISION_GAP = 1;
export const ANNOTATION_CONNECTOR_LENGTH = 11;
export const ANNOTATION_STACK_GAP = 4;

export type WordBoxCollision = {
  leftTokenId: string;
  rightTokenId: string;
  leftRect: Rect;
  rightRect: Rect;
};

export type LineCollision = {
  upperLineId: string;
  lowerLineId: string;
  upperRect: Rect;
  lowerRect: Rect;
};

export type RenderedAnnotation = {
  cell: AnnotationCell;
  placementIndex: number;
};

export function wordBoxRectFromPositioned(positioned: PositionedToken): Rect {
  const minimumWidth = positioned.isEmpty ? WORD_BOX_EMPTY_MIN_WIDTH : WORD_BOX_MIN_WIDTH;
  return {
    ...positioned.rect,
    width: Math.max(minimumWidth, positioned.rect.width + WORD_BOX_WIDTH_PADDING)
  };
}

export function rectsOverlap(left: Rect, right: Rect, spacing = 0): boolean {
  return (
    left.x < right.x + right.width + spacing &&
    left.x + left.width + spacing > right.x &&
    left.y < right.y + right.height + spacing &&
    left.y + left.height + spacing > right.y
  );
}

export function lineGuideRectFromLine(document: InterlinearDocument, line: InterlinearLine): Rect {
  return {
    x: document.pageSettings.marginLeft,
    y: line.y + line.offset.y,
    width: document.pageSettings.width - document.pageSettings.marginLeft - document.pageSettings.marginRight,
    height: sourceLineBoxHeight(document.pageSettings)
  };
}

export function annotationBoxFontSize(settings: PageSettings): number {
  return Math.max(10, settings.fontSize - 6);
}

export function annotationBoxRect(
  sourceRect: Rect,
  cell: AnnotationCell,
  settings: PageSettings,
  placementIndex: number
): Rect {
  const height = sourceLineBoxHeight(settings);
  const fontSize = annotationBoxFontSize(settings);
  const width = Math.max(
    sourceRect.width,
    WORD_BOX_EMPTY_MIN_WIDTH,
    estimateTokenWidth(cell.text || "Annotation", fontSize) + WORD_BOX_WIDTH_PADDING
  );
  const stackOffset = placementIndex * (height + ANNOTATION_STACK_GAP);
  const x = sourceRect.x + sourceRect.width / 2 - width / 2 + cell.offset.x;
  const y =
    cell.placement === "above"
      ? sourceRect.y - ANNOTATION_CONNECTOR_LENGTH - height - stackOffset + cell.offset.y
      : sourceRect.y + sourceRect.height + ANNOTATION_CONNECTOR_LENGTH + stackOffset + cell.offset.y;

  return { x, y, width, height };
}

export function annotationEntriesForToken(
  document: InterlinearDocument,
  layers: Layer[],
  tokenId: string
): RenderedAnnotation[] {
  return stackAnnotationEntries(
    layers.flatMap((layer) =>
      Object.values(document.annotationCells).filter(
        (cell) => !cell.spanId && cell.tokenId === tokenId && cell.layerId === layer.id
      )
    )
  );
}

export function annotationEntriesForSpan(
  document: InterlinearDocument,
  layers: Layer[],
  spanId: string
): RenderedAnnotation[] {
  return stackAnnotationEntries(
    layers.flatMap((layer) => Object.values(document.annotationCells).filter((cell) => cell.spanId === spanId && cell.layerId === layer.id))
  );
}

export function orderedVisibleLayers(document: InterlinearDocument): Layer[] {
  return [...document.layers].filter((layer) => layer.visible).sort((left, right) => left.order - right.order);
}

export function lineCollisionRects(document: InterlinearDocument, page: Page, line: InterlinearLine): Rect[] {
  const layers = orderedVisibleLayers(document);
  const routed = routeLine(document, page, line);
  const tokenAnnotationRects = routed.positionedTokens.flatMap((positioned) => {
    const sourceRect = wordBoxRectFromPositioned(positioned);
    return annotationEntriesForToken(document, layers, positioned.tokenId).map((entry) =>
      annotationBoxRect(sourceRect, entry.cell, document.pageSettings, entry.placementIndex)
    );
  });
  const spanAnnotationRects = Object.values(document.layerSpans).flatMap((span) => {
    if (!line.tokenIds.includes(span.startTokenId)) return [];
    const start = routed.positionedTokens.find((positioned) => positioned.tokenId === span.startTokenId);
    const end = routed.positionedTokens.find((positioned) => positioned.tokenId === span.endTokenId);
    if (!start || !end) return [];
    const layer = layers.find((item) => item.id === span.layerId);
    const layerIndex = layer ? layers.indexOf(layer) : 0;
    const spanLeft = Math.min(start.rect.x, end.rect.x);
    const spanRight = Math.max(start.rect.x + start.rect.width, end.rect.x + end.rect.width);
    const sourceRect = span.rect ?? {
      x: spanLeft + span.offset.x,
      y: start.rect.y - document.pageSettings.annotationGap * (layerIndex + 1) + span.offset.y,
      width: spanRight - spanLeft,
      height: 18
    };
    return annotationEntriesForSpan(document, layers, span.id).map((entry) =>
      annotationBoxRect(sourceRect, entry.cell, document.pageSettings, entry.placementIndex)
    );
  });

  return [lineGuideRectFromLine(document, line), ...tokenAnnotationRects, ...spanAnnotationRects];
}

export function findWordBoxCollisions(
  document: InterlinearDocument,
  page: Page,
  line: InterlinearLine,
  spacing = 0
): WordBoxCollision[] {
  const routed = routeLine(document, page, line);
  const boxes = routed.positionedTokens.map((positioned) => ({
    tokenId: positioned.tokenId,
    rect: wordBoxRectFromPositioned(positioned)
  }));
  const collisions: WordBoxCollision[] = [];

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      if (rectsOverlap(left.rect, right.rect, spacing)) {
        collisions.push({
          leftTokenId: left.tokenId,
          rightTokenId: right.tokenId,
          leftRect: left.rect,
          rightRect: right.rect
        });
      }
    }
  }

  return collisions;
}

export function findLineCollisions(document: InterlinearDocument, page: Page, spacing = 0): LineCollision[] {
  const guides = page.lines
    .map((line) => ({
      lineId: line.id,
      rect: lineGuideRectFromLine(document, line)
    }))
    .sort((left, right) => left.rect.y - right.rect.y);
  const collisions: LineCollision[] = [];

  for (let upperIndex = 0; upperIndex < guides.length; upperIndex += 1) {
    for (let lowerIndex = upperIndex + 1; lowerIndex < guides.length; lowerIndex += 1) {
      const upper = guides[upperIndex];
      const lower = guides[lowerIndex];
      if (rectsOverlap(upper.rect, lower.rect, spacing)) {
        collisions.push({
          upperLineId: upper.lineId,
          lowerLineId: lower.lineId,
          upperRect: upper.rect,
          lowerRect: lower.rect
        });
      }
    }
  }

  return collisions;
}

export function resolveWordBoxCollisions(
  document: InterlinearDocument,
  pageId: string,
  lineId: string,
  spacing = WORD_BOX_COLLISION_GAP
): InterlinearDocument {
  let next = document;
  const maxPasses = Math.max(1, findLine(next, pageId, lineId)?.line.tokenIds.length ?? 1);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const found = findLine(next, pageId, lineId);
    if (!found) return next;

    const routed = routeLine(next, found.page, found.line);
    let minimumX = Number.NEGATIVE_INFINITY;
    let changed = false;
    const tokens = { ...next.tokens };

    for (const positioned of routed.positionedTokens) {
      const token = tokens[positioned.tokenId];
      if (!token) continue;
      const rect = wordBoxRectFromPositioned(positioned);
      if (rect.x < minimumX) {
        const shift = minimumX - rect.x;
        tokens[token.id] = {
          ...token,
          offset: { x: token.offset.x + shift, y: token.offset.y }
        };
        changed = true;
        minimumX += rect.width + spacing;
      } else {
        minimumX = rect.x + rect.width + spacing;
      }
    }

    if (!changed) return next;
    next = { ...next, tokens };
  }

  return next;
}

export function resolveLineCollisions(
  document: InterlinearDocument,
  pageId: string,
  spacing = WORD_BOX_COLLISION_GAP
): InterlinearDocument {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page || page.lines.length < 2) return document;

  const lineHeight = sourceLineBoxHeight(document.pageSettings);
  const minY = document.pageSettings.marginTop;
  const maxY = Math.max(minY, document.pageSettings.height - document.pageSettings.marginBottom - lineHeight);
  const ordered = page.lines
    .map((line, index) => ({ line, index, visualY: line.y + line.offset.y }))
    .sort((left, right) => left.visualY - right.visualY || left.index - right.index);

  let nextY = minY;
  let packed = ordered.map((item) => {
    const desiredY = clamp(item.visualY, minY, maxY);
    const y = Math.max(desiredY, nextY);
    nextY = y + lineHeight + spacing;
    return { ...item, y };
  });

  const bottom = packed.at(-1)?.y ?? minY;
  const overflow = bottom - maxY;
  if (overflow > 0) {
    packed = packed.map((item) => ({ ...item, y: item.y - overflow }));
    if ((packed[0]?.y ?? minY) < minY) {
      nextY = minY;
      packed = ordered.map((item) => {
        const y = nextY;
        nextY = y + lineHeight + spacing;
        return { ...item, y };
      });
    }
  }

  const resolvedY = new Map(packed.map((item) => [item.line.id, item.y]));
  let changed = false;
  const lines = page.lines.map((line) => {
    const visualY = resolvedY.get(line.id);
    if (visualY === undefined || visualY === line.y + line.offset.y) return line;
    changed = true;
    return { ...line, y: visualY - line.offset.y };
  });

  if (!changed) return document;
  return {
    ...document,
    pages: document.pages.map((candidate) => (candidate.id === page.id ? { ...candidate, lines } : candidate))
  };
}

function stackAnnotationEntries(cells: AnnotationCell[]): RenderedAnnotation[] {
  const placementCounts: Record<AnnotationCell["placement"], number> = { above: 0, below: 0 };
  return cells.map((cell) => {
    const placementIndex = placementCounts[cell.placement];
    placementCounts[cell.placement] += 1;
    return { cell, placementIndex };
  });
}

function findLine(
  document: InterlinearDocument,
  pageId: string,
  lineId: string
): { page: Page; line: InterlinearLine } | null {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  const line = page?.lines.find((candidate) => candidate.id === lineId);
  return page && line ? { page, line } : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const safeMaximum = Math.max(minimum, maximum);
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), safeMaximum);
}
