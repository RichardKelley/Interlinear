import type { InterlinearDocument, InterlinearLine, Page, PageObject, Rect } from "./schema.js";
import { deterministicTextWidth, tokenTextWidth } from "./textMetrics.js";

export type PositionedToken = {
  tokenId: string;
  rect: Rect;
  isEmpty?: boolean;
};

export type RoutedLine = {
  lineId: string;
  y: number;
  bands: Rect[];
  positionedTokens: PositionedToken[];
};

export type RoutedPage = {
  pageId: string;
  lines: RoutedLine[];
};

const MIN_BAND_WIDTH = 48;
export const TOKEN_GAP = 8;

export function sourceLineBoxHeight(settings: InterlinearDocument["pageSettings"]): number {
  return settings.fontSize + 4;
}

export function intersectsVertically(rect: Rect, y: number, height: number): boolean {
  return rect.y < y + height && rect.y + rect.height > y;
}

export function availableBands(page: Page, settings: InterlinearDocument["pageSettings"], y: number, lineHeight: number): Rect[] {
  let bands: Rect[] = [
    {
      x: settings.marginLeft,
      y,
      width: settings.width - settings.marginLeft - settings.marginRight,
      height: lineHeight
    }
  ];

  const obstacles = page.pageObjects
    .filter((object) => object.wrapMode === "rectangular")
    .map((object) => object.rect)
    .filter((rect) => intersectsVertically(rect, y, lineHeight));

  for (const obstacle of obstacles) {
    bands = bands.flatMap((band) => subtractObstacle(band, obstacle));
  }

  return bands.filter((band) => band.width >= MIN_BAND_WIDTH).sort((left, right) => left.x - right.x);
}

function subtractObstacle(band: Rect, obstacle: Rect): Rect[] {
  const obstacleLeft = Math.max(band.x, obstacle.x);
  const obstacleRight = Math.min(band.x + band.width, obstacle.x + obstacle.width);
  if (obstacleRight <= obstacleLeft) return [band];

  const result: Rect[] = [];
  const leftWidth = obstacleLeft - band.x;
  const rightX = obstacleRight;
  const rightWidth = band.x + band.width - obstacleRight;

  if (leftWidth > 0) {
    result.push({ ...band, width: leftWidth });
  }
  if (rightWidth > 0) {
    result.push({ ...band, x: rightX, width: rightWidth });
  }

  return result;
}

export function estimateTokenWidth(text: string, fontSize: number): number {
  return deterministicTextWidth(text, { fontSize });
}

export function routeLine(
  document: InterlinearDocument,
  page: Page,
  line: InterlinearLine,
  tokenGap = TOKEN_GAP
): RoutedLine {
  const lineHeight = document.pageSettings.fontSize + document.pageSettings.annotationGap * Math.max(document.layers.length, 1);
  const y = line.y + line.offset.y;
  const bands = availableBands(page, document.pageSettings, y, lineHeight);
  const positionedTokens: PositionedToken[] = [];
  const routedBands = line.direction === "rtl" ? [...bands].reverse() : bands;
  let bandIndex = 0;
  let cursor =
    line.direction === "rtl"
      ? (routedBands[0] ? routedBands[0].x + routedBands[0].width : document.pageSettings.width - document.pageSettings.marginRight)
      : routedBands[0]?.x ?? document.pageSettings.marginLeft;

  for (const tokenId of line.tokenIds) {
    const token = document.tokens[tokenId];
    if (!token) continue;
    const width = tokenTextWidth(token, document.pageSettings);
    let band = routedBands[bandIndex];
    if (line.direction === "rtl" && band && cursor - width < band.x && bandIndex < routedBands.length - 1) {
      bandIndex += 1;
      band = routedBands[bandIndex];
      cursor = band.x + band.width;
    } else if (line.direction !== "rtl" && band && cursor + width > band.x + band.width && bandIndex < routedBands.length - 1) {
      bandIndex += 1;
      band = routedBands[bandIndex];
      cursor = band.x;
    }

    const baseX = line.direction === "rtl" ? cursor - width : band?.x ?? cursor;
    const x = baseX + token.offset.x + line.offset.x;
    positionedTokens.push({
      tokenId,
      isEmpty: token.text.length === 0,
      rect: {
        x,
        y: y + token.offset.y,
        width,
        height: sourceLineBoxHeight(document.pageSettings)
      }
    });
    cursor = line.direction === "rtl" ? baseX - tokenGap : x + width + tokenGap;
  }

  return { lineId: line.id, y, bands, positionedTokens };
}

export function routeDocument(document: InterlinearDocument): RoutedPage[] {
  return document.pages.map((page) => ({
    pageId: page.id,
    lines: page.lines.map((line) => routeLine(document, page, line))
  }));
}

export function objectBlocksLine(object: PageObject, y: number, height: number): boolean {
  return object.wrapMode === "rectangular" && intersectsVertically(object.rect, y, height);
}
