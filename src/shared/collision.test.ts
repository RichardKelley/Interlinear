import { describe, expect, it } from "vitest";
import {
  findLineCollisions,
  findWordBoxCollisions,
  lineGuideRectFromLine,
  rectsOverlap,
  resolveLineCollisions,
  resolveWordBoxCollisions,
  WORD_BOX_COLLISION_GAP,
  WORD_BOX_EMPTY_MIN_WIDTH,
  WORD_BOX_WIDTH_PADDING,
  wordBoxRectFromPositioned
} from "./collision";
import { createSampleDocument } from "./documentFactory";
import { routeLine, sourceLineBoxHeight } from "./layout";

describe("word-box collision geometry", () => {
  it("sizes rendered word boxes from routed token text width", () => {
    const rect = wordBoxRectFromPositioned({
      tokenId: "tok",
      rect: { x: 10, y: 20, width: 12, height: 18 }
    });

    expect(rect).toEqual({ x: 10, y: 20, width: 12 + WORD_BOX_WIDTH_PADDING, height: 18 });
  });

  it("keeps empty word boxes large enough to click and begin typing", () => {
    const rect = wordBoxRectFromPositioned({
      tokenId: "tok",
      isEmpty: true,
      rect: { x: 10, y: 20, width: 1, height: 18 }
    });

    expect(rect).toEqual({ x: 10, y: 20, width: WORD_BOX_EMPTY_MIN_WIDTH, height: 18 });
  });

  it("detects overlap with configurable spacing", () => {
    const left = { x: 10, y: 10, width: 40, height: 20 };
    const touching = { x: 50, y: 10, width: 30, height: 20 };

    expect(rectsOverlap(left, touching)).toBe(false);
    expect(rectsOverlap(left, touching, 1)).toBe(true);
  });

  it("sizes line guide rectangles from document page settings", () => {
    const doc = createSampleDocument();
    const line = doc.pages[0].lines[0];

    expect(lineGuideRectFromLine(doc, line)).toEqual({
      x: doc.pageSettings.marginLeft,
      y: line.y,
      width: doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight,
      height: sourceLineBoxHeight(doc.pageSettings)
    });
  });

  it("detects and resolves overlapping line guides with the shared rectangle rules", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const line = page.lines[0];
    const overlapping = {
      ...doc,
      pages: [
        {
          ...page,
          lines: [
            line,
            {
              id: "line_overlap",
              tokenIds: [],
              y: line.y + 2,
              offset: { x: 0, y: 0 },
              direction: "ltr" as const
            }
          ]
        }
      ]
    };

    expect(findLineCollisions(overlapping, overlapping.pages[0])).toHaveLength(1);

    const resolved = resolveLineCollisions(overlapping, page.id);
    const resolvedLines = [...resolved.pages[0].lines].sort((left, right) => left.y - right.y);
    const gap = resolvedLines[1].y - (resolvedLines[0].y + sourceLineBoxHeight(resolved.pageSettings));

    expect(gap).toBeGreaterThanOrEqual(WORD_BOX_COLLISION_GAP);
    expect(findLineCollisions(resolved, resolved.pages[0], WORD_BOX_COLLISION_GAP)).toHaveLength(0);
  });

  it("resolves overlapping word boxes while preserving non-overlapping offsets", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const line = page.lines[0];
    const tokenIds = line.tokenIds.slice(0, 2);
    const overlapping = {
      ...doc,
      tokens: {
        ...doc.tokens,
        [tokenIds[0]]: { ...doc.tokens[tokenIds[0]], text: "", offset: { x: 20, y: 0 } },
        [tokenIds[1]]: { ...doc.tokens[tokenIds[1]], text: "", offset: { x: -10, y: 0 } }
      },
      pages: [{ ...page, lines: [{ ...line, tokenIds }] }]
    };

    expect(findWordBoxCollisions(overlapping, overlapping.pages[0], overlapping.pages[0].lines[0])).toHaveLength(1);

    const resolved = resolveWordBoxCollisions(overlapping, page.id, line.id);
    const boxes = routeLine(resolved, resolved.pages[0], resolved.pages[0].lines[0]).positionedTokens.map(wordBoxRectFromPositioned);
    const gap = boxes[1].x - (boxes[0].x + boxes[0].width);

    expect(resolved.tokens[tokenIds[0]].offset.x).toBe(20);
    expect(gap).toBeLessThanOrEqual(WORD_BOX_COLLISION_GAP);
    expect(findWordBoxCollisions(resolved, resolved.pages[0], resolved.pages[0].lines[0])).toHaveLength(0);
  });
});
