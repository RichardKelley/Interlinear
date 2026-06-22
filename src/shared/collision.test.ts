import { describe, expect, it } from "vitest";
import {
  ANNOTATION_BOX_WIDTH_PADDING,
  annotationBoxFontSize,
  annotationBoxRect,
  findLineCollisions,
  findWordBoxObstacleCollisions,
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
import { estimateTokenWidth, IMAGE_OBJECT_EXTERNAL_PADDING, routeLine, sourceLineBoxHeight } from "./layout";
import { tokenTextMetricKey } from "./textMetrics";

describe("word-box collision geometry", () => {
  it("sizes rendered word boxes from routed token text width", () => {
    const rect = wordBoxRectFromPositioned({
      tokenId: "tok",
      rect: { x: 10, y: 20, width: 24, height: 18 }
    });

    expect(rect).toEqual({ x: 10, y: 20, width: 24 + WORD_BOX_WIDTH_PADDING, height: 18 });
  });

  it("keeps empty word boxes large enough to click and begin typing", () => {
    const rect = wordBoxRectFromPositioned({
      tokenId: "tok",
      isEmpty: true,
      rect: { x: 10, y: 20, width: 1, height: 18 }
    });

    expect(rect).toEqual({ x: 10, y: 20, width: WORD_BOX_EMPTY_MIN_WIDTH, height: 18 });
  });

  it("uses the same tight width padding for source and annotation word boxes", () => {
    const doc = createSampleDocument();
    const text = "tight annotation padding";
    const fontSize = annotationBoxFontSize(doc.pageSettings);
    const sourceRect = wordBoxRectFromPositioned({
      tokenId: "tok",
      rect: { x: 10, y: 20, width: estimateTokenWidth(text, fontSize), height: sourceLineBoxHeight(doc.pageSettings) }
    });
    const rect = annotationBoxRect(
      { x: 10, y: 20, width: 10, height: sourceLineBoxHeight(doc.pageSettings) },
      {
        id: "ann_tight",
        tokenId: "tok",
        layerId: doc.layers[0].id,
        text,
        placement: "above",
        offset: { x: 0, y: 0 }
      },
      doc.pageSettings,
      0
    );

    expect(ANNOTATION_BOX_WIDTH_PADDING).toBe(WORD_BOX_WIDTH_PADDING);
    expect(sourceRect.width).toBe(estimateTokenWidth(text, fontSize) + WORD_BOX_WIDTH_PADDING);
    expect(rect.width).toBe(estimateTokenWidth(text, fontSize) + ANNOTATION_BOX_WIDTH_PADDING);
  });

  it("does not widen short annotation boxes to the source word box width", () => {
    const doc = createSampleDocument();
    const text = "a";
    const fontSize = annotationBoxFontSize(doc.pageSettings);
    const sourceRect = { x: 10, y: 20, width: 80, height: sourceLineBoxHeight(doc.pageSettings) };
    const rect = annotationBoxRect(
      sourceRect,
      {
        id: "ann_short",
        tokenId: "tok",
        layerId: doc.layers[0].id,
        text,
        placement: "above",
        offset: { x: 0, y: 0 }
      },
      doc.pageSettings,
      0
    );

    expect(rect.width).toBe(estimateTokenWidth(text, fontSize) + ANNOTATION_BOX_WIDTH_PADDING);
    expect(rect.width).toBeLessThan(sourceRect.width);
    expect(rect.width).toBeGreaterThan(estimateTokenWidth(text, fontSize));
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
    expect(gap).toBeGreaterThanOrEqual(WORD_BOX_COLLISION_GAP);
    expect(findWordBoxCollisions(resolved, resolved.pages[0], resolved.pages[0].lines[0])).toHaveLength(0);
  });

  it("detects and resolves collisions between wider token annotation boxes", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const line = { ...page.lines[0], tokenIds: page.lines[0].tokenIds.slice(0, 2) };
    const [firstTokenId, secondTokenId] = line.tokenIds;
    const settings = { ...doc.pageSettings, width: 1200 };
    const firstKey = tokenTextMetricKey("a", settings);
    const secondKey = tokenTextMetricKey("b", settings);
    const annotated = {
      ...doc,
      pageSettings: settings,
      pages: [{ ...page, lines: [line] }],
      tokens: {
        ...doc.tokens,
        [firstTokenId]: {
          ...doc.tokens[firstTokenId],
          text: "a",
          textMetrics: { [firstKey]: 20 }
        },
        [secondTokenId]: {
          ...doc.tokens[secondTokenId],
          text: "b",
          offset: { x: 40, y: 0 },
          textMetrics: { [secondKey]: 20 }
        }
      },
      annotationCells: {
        ann_first: {
          id: "ann_first",
          tokenId: firstTokenId,
          layerId: doc.layers[0].id,
          text: "a long annotation for the first token",
          placement: "above" as const,
          offset: { x: 0, y: 0 }
        },
        ann_second: {
          id: "ann_second",
          tokenId: secondTokenId,
          layerId: doc.layers[0].id,
          text: "a long annotation for the second token",
          placement: "above" as const,
          offset: { x: 0, y: 0 }
        }
      }
    };
    const sourceRects = routeLine(annotated, annotated.pages[0], annotated.pages[0].lines[0]).positionedTokens.map(wordBoxRectFromPositioned);

    expect(rectsOverlap(sourceRects[0], sourceRects[1])).toBe(false);
    expect(findWordBoxCollisions(annotated, annotated.pages[0], annotated.pages[0].lines[0])).toHaveLength(1);

    const resolved = resolveWordBoxCollisions(annotated, annotated.pages[0].id, annotated.pages[0].lines[0].id);

    expect(findWordBoxCollisions(resolved, resolved.pages[0], resolved.pages[0].lines[0], WORD_BOX_COLLISION_GAP)).toHaveLength(0);
  });

  it("detects word boxes inside padded image collision boundaries", () => {
    const doc = createSampleDocument();
    const page = {
      ...doc.pages[0],
      pageObjects: [
        {
          id: "image_obstacle",
          kind: "image" as const,
          rect: {
            x: doc.pageSettings.marginLeft + 80 + IMAGE_OBJECT_EXTERNAL_PADDING,
            y: doc.pages[0].lines[0].y - 8,
            width: 80,
            height: 80
          },
          wrapMode: "rectangular" as const,
          zIndex: 1,
          assetPath: "",
          caption: "",
          metadata: {}
        }
      ]
    };
    const line = { ...page.lines[0], tokenIds: [page.lines[0].tokenIds[0]] };
    const imageLeft = page.pageObjects[0].rect.x;
    const colliding = {
      ...doc,
      pages: [{ ...page, lines: [line] }],
      tokens: {
        ...doc.tokens,
        [line.tokenIds[0]]: {
          ...doc.tokens[line.tokenIds[0]],
          text: "",
          offset: { x: imageLeft - IMAGE_OBJECT_EXTERNAL_PADDING - doc.pageSettings.marginLeft, y: 0 }
        }
      }
    };

    const collisions = findWordBoxObstacleCollisions(colliding, colliding.pages[0], colliding.pages[0].lines[0]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].obstacleRect.x).toBe(imageLeft - IMAGE_OBJECT_EXTERNAL_PADDING);
  });
});
