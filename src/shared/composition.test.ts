import { describe, expect, it } from "vitest";
import {
  addPageToDocument,
  addLineAtDocument,
  addLineToDocument,
  addWordBoxToLineDocument,
  addWordBoxToDocument,
  insertWordBoxAfterToken,
  moveLineWithCollisionConstraints,
  moveTokenWithCollisionConstraints,
  normalizeTokenLayout,
  snapTokenToNearestLine
} from "./composition";
import {
  ANNOTATION_CONNECTOR_LENGTH,
  findLineCollisions,
  findWordBoxCollisions,
  findWordBoxObstacleCollisions,
  wordBoxRectFromPositioned,
  WORD_BOX_COLLISION_GAP
} from "./collision";
import { createEmptyDocument, createSampleDocument } from "./documentFactory";
import { IMAGE_OBJECT_EXTERNAL_PADDING, routeLine, sourceLineBoxHeight, TOKEN_GAP } from "./layout";
import { tokenTextMetricKey } from "./textMetrics";

describe("page composition", () => {
  it("adds a new page after the requested page and renumbers pages", () => {
    const doc = createSampleDocument();

    const next = addPageToDocument(doc, "page_second", doc.pages[0].id);

    expect(next.pages).toHaveLength(2);
    expect(next.pages.map((page) => page.number)).toEqual([1, 2]);
    expect(next.pages[1]).toMatchObject({ id: "page_second", lines: [], pageObjects: [] });
  });

  it("adds an explicit guide line after the selected anchor line", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const line = page.lines[0];

    const next = addLineToDocument(doc, page.id, "line_new", line.id);

    expect(next.pages[0].lines).toHaveLength(page.lines.length + 1);
    expect(next.pages[0].lines[1]).toMatchObject({ id: "line_new", tokenIds: [] });
    expect(next.pages[0].lines[1].y).toBeGreaterThan(line.y);
  });

  it("adds a guide line at a requested page location within the page margins", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];

    const above = addLineAtDocument(doc, page.id, "line_above", -100);
    const below = addLineAtDocument(doc, page.id, "line_below", 9999);

    expect(above.pages[0].lines.find((line) => line.id === "line_above")?.y).toBe(doc.pageSettings.marginTop);
    expect(below.pages[0].lines.find((line) => line.id === "line_below")?.y).toBe(
      doc.pageSettings.height - doc.pageSettings.marginBottom - sourceLineBoxHeight(doc.pageSettings)
    );
  });

  it("places requested guide lines without overlapping existing guides", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const line = page.lines[0];

    const next = addLineAtDocument(doc, page.id, "line_new", line.y + 2);
    const nextPage = next.pages[0];
    const lines = [...nextPage.lines].sort((left, right) => left.y - right.y);
    const gap = lines[1].y - (lines[0].y + sourceLineBoxHeight(next.pageSettings));

    expect(nextPage.lines).toHaveLength(page.lines.length + 1);
    expect(gap).toBeGreaterThanOrEqual(WORD_BOX_COLLISION_GAP);
    expect(findLineCollisions(next, nextPage, WORD_BOX_COLLISION_GAP)).toHaveLength(0);
  });

  it("creates an empty word box as a structured token on the nearest line", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = page.lines[0];

    const next = addWordBoxToDocument(roomyDoc, page.id, "tok_new", { x: 220, y: line.y + 4 });

    expect(next.tokens.tok_new).toMatchObject({ text: "", lineId: line.id });
    expect(next.pages[0].lines[0].tokenIds).toContain("tok_new");
  });

  it("creates an empty word box on a specific line guide", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = page.lines[0];

    const next = addWordBoxToLineDocument(roomyDoc, page.id, line.id, "tok_on_line", 220);
    const nextLine = next.pages[0].lines.find((item) => item.id === line.id)!;

    expect(next.tokens.tok_on_line).toMatchObject({ text: "", lineId: line.id });
    expect(nextLine.tokenIds).toContain("tok_on_line");
    expect(next.pages[0].lines).toHaveLength(roomyDoc.pages[0].lines.length);
  });

  it("adds a second empty word box to a newly created guide line without creating another line", () => {
    const doc = createEmptyDocument();
    const page = doc.pages[0];
    const withLine = addWordBoxToDocument(doc, page.id, "tok_first", { x: 90, y: 120 });
    const line = withLine.pages[0].lines[0];

    const next = addWordBoxToLineDocument(withLine, page.id, line.id, "tok_second", 220);

    expect(next.pages[0].lines).toHaveLength(1);
    expect(next.tokens.tok_second).toMatchObject({ text: "", lineId: line.id });
    expect(next.pages[0].lines[0].tokenIds).toEqual(["tok_first", "tok_second"]);
  });

  it("inserts an empty word box immediately after a source token", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = page.lines[0];
    const sourceTokenId = line.tokenIds[1];

    const next = insertWordBoxAfterToken(roomyDoc, sourceTokenId, "tok_after");
    const nextLine = next.pages[0].lines.find((item) => item.id === line.id)!;

    expect(next.tokens.tok_after).toMatchObject({ text: "", lineId: line.id, direction: roomyDoc.tokens[sourceTokenId].direction });
    expect(nextLine.tokenIds.slice(1, 3)).toEqual([sourceTokenId, "tok_after"]);
    expect(findWordBoxCollisions(next, next.pages[0], nextLine)).toHaveLength(0);
  });

  it("places a space-created word box after the current rendered word box", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = page.lines[0];
    const sourceTokenId = line.tokenIds[1];
    const shifted = {
      ...roomyDoc,
      tokens: {
        ...roomyDoc.tokens,
        [sourceTokenId]: {
          ...roomyDoc.tokens[sourceTokenId],
          offset: { x: 140, y: 0 }
        }
      }
    };

    const next = insertWordBoxAfterToken(shifted, sourceTokenId, "tok_after");
    const nextLine = next.pages[0].lines.find((item) => item.id === line.id)!;
    const routed = routeLine(next, next.pages[0], nextLine);
    const sourceRect = wordBoxRectFromPositioned(routed.positionedTokens.find((item) => item.tokenId === sourceTokenId)!);
    const insertedRect = wordBoxRectFromPositioned(routed.positionedTokens.find((item) => item.tokenId === "tok_after")!);

    expect(insertedRect.x).toBeGreaterThanOrEqual(sourceRect.x + sourceRect.width + TOKEN_GAP);
    expect(nextLine.tokenIds.slice(1, 3)).toEqual([sourceTokenId, "tok_after"]);
    expect(findWordBoxCollisions(next, next.pages[0], nextLine)).toHaveLength(0);
  });

  it("creates a new line when a word box is placed away from existing guides", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];

    const next = addWordBoxToDocument(doc, page.id, "tok_new_line", { x: 90, y: 420 });

    expect(next.pages[0].lines.length).toBe(doc.pages[0].lines.length + 1);
    expect(next.tokens.tok_new_line.lineId).not.toBe(doc.pages[0].lines[0].id);
  });

  it("places repeated new word boxes without overlapping existing boxes", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = page.lines[0];

    const withFirst = addWordBoxToDocument(roomyDoc, page.id, "tok_new_1", { x: doc.pageSettings.marginLeft, y: line.y });
    const withSecond = addWordBoxToDocument(withFirst, page.id, "tok_new_2", { x: doc.pageSettings.marginLeft, y: line.y });
    const nextPage = withSecond.pages[0];
    const nextLine = nextPage.lines.find((item) => item.id === line.id)!;

    expect(nextLine.tokenIds).toEqual(expect.arrayContaining(["tok_new_1", "tok_new_2"]));
    expect(findWordBoxCollisions(withSecond, nextPage, nextLine)).toHaveLength(0);
  });

  it("moves a new word box to the next suitable line when the target line is full", () => {
    const doc = createSampleDocument();
    const sourcePage = doc.pages[0];
    const line = sourcePage.lines[0];
    const page = {
      ...sourcePage,
      pageObjects: [
        {
          ...sourcePage.pageObjects[0],
          rect: {
            x: doc.pageSettings.marginLeft + 20,
            y: line.y - 10,
            width: doc.pageSettings.width,
            height: 50
          },
          wrapMode: "rectangular" as const
        }
      ]
    };
    const blockedDoc = { ...doc, pages: [page] };

    const next = addWordBoxToDocument(blockedDoc, page.id, "tok_overflow", { x: doc.pageSettings.marginLeft, y: line.y });
    const targetLine = next.pages[0].lines.find((item) => item.id === next.tokens.tok_overflow.lineId)!;

    expect(next.tokens.tok_overflow.lineId).not.toBe(line.id);
    expect(next.pages[0].lines.length).toBeGreaterThan(page.lines.length);
    expect(targetLine.tokenIds).toContain("tok_overflow");
    expect(findWordBoxCollisions(next, next.pages[0], targetLine)).toHaveLength(0);
  });

  it("moves an overflowing new word box to an existing next page instead of clamping at the page bottom", () => {
    const doc = createEmptyDocument();
    const maxLineY = doc.pageSettings.height - doc.pageSettings.marginBottom - sourceLineBoxHeight(doc.pageSettings);
    const line = {
      id: "line_bottom",
      tokenIds: [],
      y: maxLineY,
      offset: { x: 0, y: 0 },
      direction: "ltr" as const
    };
    const firstPage = {
      ...doc.pages[0],
      lines: [line],
      pageObjects: [
        {
          id: "full_width_obstacle",
          kind: "textBlock" as const,
          rect: {
            x: doc.pageSettings.marginLeft,
            y: maxLineY - 4,
            width: doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight,
            height: sourceLineBoxHeight(doc.pageSettings) + 8
          },
          wrapMode: "rectangular" as const,
          zIndex: 1,
          content: "",
          caption: "",
          metadata: {}
        }
      ]
    };
    const secondPage = { id: "page_second", number: 2, lines: [], pageObjects: [] };
    const blockedDoc = { ...doc, pages: [firstPage, secondPage] };

    const next = addWordBoxToDocument(blockedDoc, firstPage.id, "tok_overflow", {
      x: doc.pageSettings.marginLeft,
      y: maxLineY
    });

    expect(next.pages).toHaveLength(2);
    expect(next.pages[0].lines[0].tokenIds).not.toContain("tok_overflow");
    expect(next.pages[1].lines).toHaveLength(1);
    expect(next.pages[1].lines[0]).toMatchObject({ y: doc.pageSettings.marginTop, tokenIds: ["tok_overflow"] });
    expect(next.tokens.tok_overflow.lineId).toBe(next.pages[1].lines[0].id);
  });

  it("chooses an available line position on the next page when top content is blocked", () => {
    const doc = createEmptyDocument();
    const maxLineY = doc.pageSettings.height - doc.pageSettings.marginBottom - sourceLineBoxHeight(doc.pageSettings);
    const contentWidth = doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight;
    const firstPage = {
      ...doc.pages[0],
      lines: [
        {
          id: "line_bottom",
          tokenIds: [],
          y: maxLineY,
          offset: { x: 0, y: 0 },
          direction: "ltr" as const
        }
      ],
      pageObjects: [
        {
          id: "bottom_obstacle",
          kind: "textBlock" as const,
          rect: {
            x: doc.pageSettings.marginLeft,
            y: maxLineY - 4,
            width: contentWidth,
            height: sourceLineBoxHeight(doc.pageSettings) + 8
          },
          wrapMode: "rectangular" as const,
          zIndex: 1,
          content: "",
          caption: "",
          metadata: {}
        }
      ]
    };
    const secondPage = {
      id: "page_second",
      number: 2,
      lines: [],
      pageObjects: [
        {
          id: "top_obstacle",
          kind: "textBlock" as const,
          rect: {
            x: doc.pageSettings.marginLeft,
            y: doc.pageSettings.marginTop,
            width: contentWidth,
            height: 80
          },
          wrapMode: "rectangular" as const,
          zIndex: 1,
          content: "",
          caption: "",
          metadata: {}
        }
      ]
    };
    const blockedDoc = { ...doc, pages: [firstPage, secondPage] };

    const next = addWordBoxToDocument(blockedDoc, firstPage.id, "tok_overflow", {
      x: doc.pageSettings.marginLeft,
      y: maxLineY
    });

    const targetLine = next.pages[1].lines.find((line) => line.tokenIds.includes("tok_overflow"));

    expect(targetLine?.y).toBeGreaterThan(doc.pageSettings.marginTop);
    expect(targetLine?.tokenIds).toEqual(["tok_overflow"]);
  });

  it("snaps a dragged token onto a nearby line and preserves annotation anchors", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const firstLine = page.lines[0];
    const secondLine = {
      id: "line_second",
      tokenIds: [],
      y: firstLine.y + 72,
      offset: { x: 0, y: 0 },
      direction: "ltr" as const
    };
    const tokenId = firstLine.tokenIds[0];
    const annotationId = "ann_anchor";
    const withSecondLine = {
      ...doc,
      annotationCells: {
        ...doc.annotationCells,
        [annotationId]: {
          id: annotationId,
          tokenId,
          layerId: doc.layers[0].id,
          text: "the",
          offset: { x: 0, y: 0 }
        }
      },
      tokens: {
        ...doc.tokens,
        [tokenId]: {
          ...doc.tokens[tokenId],
          offset: { x: 0, y: 72 }
        }
      },
      pages: [
        {
          ...page,
          lines: [firstLine, secondLine]
        }
      ]
    };

    const next = snapTokenToNearestLine(withSecondLine, tokenId);

    expect(next.tokens[tokenId].lineId).toBe(secondLine.id);
    expect(next.pages[0].lines[0].tokenIds).not.toContain(tokenId);
    expect(next.pages[0].lines[1].tokenIds).toContain(tokenId);
    expect(next.annotationCells[annotationId].tokenId).toBe(tokenId);
  });

  it("snaps a dragged token onto an occupied line without creating collisions", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const firstLine = page.lines[0];
    const movingTokenId = firstLine.tokenIds[0];
    const occupiedTokenId = firstLine.tokenIds[1];
    const secondLine = {
      id: "line_second",
      tokenIds: [occupiedTokenId],
      y: firstLine.y + 72,
      offset: { x: 0, y: 0 },
      direction: "ltr" as const
    };
    const withOccupiedLine = {
      ...doc,
      tokens: {
        ...doc.tokens,
        [movingTokenId]: {
          ...doc.tokens[movingTokenId],
          offset: { x: 0, y: 72 }
        },
        [occupiedTokenId]: {
          ...doc.tokens[occupiedTokenId],
          lineId: secondLine.id,
          offset: { x: -40, y: 0 }
        }
      },
      pages: [
        {
          ...page,
          lines: [{ ...firstLine, tokenIds: firstLine.tokenIds.filter((id) => id !== occupiedTokenId) }, secondLine]
        }
      ]
    };

    const next = snapTokenToNearestLine(withOccupiedLine, movingTokenId);
    const targetLine = next.pages[0].lines[1];

    expect(next.tokens[movingTokenId].lineId).toBe(secondLine.id);
    expect(targetLine.tokenIds).toContain(movingTokenId);
    expect(findWordBoxCollisions(next, next.pages[0], targetLine)).toHaveLength(0);
  });

  it("computes insertion order from right to left on RTL lines", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const line = { ...page.lines[0], direction: "rtl" as const };
    const movingTokenId = line.tokenIds[0];
    const rtlDoc = {
      ...doc,
      pageSettings: { ...doc.pageSettings, width: 2400 },
      pages: [{ ...page, lines: [line] }],
      tokens: Object.fromEntries(
        Object.entries(doc.tokens).map(([id, token]) => [
          id,
          {
            ...token,
            direction: "rtl" as const,
            offset: id === movingTokenId ? { x: -220, y: 0 } : token.offset,
            textMetrics: { [tokenTextMetricKey(token.text, doc.pageSettings)]: 24 }
          }
        ])
      )
    };

    const next = snapTokenToNearestLine(rtlDoc, movingTokenId);
    const targetLine = next.pages[0].lines.find((candidate) => candidate.tokenIds.includes(movingTokenId));
    const routed = targetLine ? routeLine(next, next.pages[0], targetLine) : null;
    const visualXs = targetLine?.tokenIds.map((id) => routed?.positionedTokens.find((positioned) => positioned.tokenId === id)?.rect.x ?? 0);

    expect(visualXs).toEqual([...(visualXs ?? [])].sort((left, right) => right - left));
  });

  it("reverts an impossible cross-line drop to the source line without duplicating the token", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const firstLine = page.lines[0];
    const movingTokenId = firstLine.tokenIds[0];
    const secondLine = {
      id: "line_second",
      tokenIds: [],
      y: firstLine.y + 72,
      offset: { x: 0, y: 0 },
      direction: "ltr" as const
    };
    const impossibleDoc = {
      ...doc,
      pageSettings: {
        ...doc.pageSettings,
        width: doc.pageSettings.marginLeft + doc.pageSettings.marginRight + 20
      },
      tokens: {
        ...doc.tokens,
        [movingTokenId]: {
          ...doc.tokens[movingTokenId],
          offset: { x: 0, y: 72 }
        }
      },
      pages: [{ ...page, lines: [firstLine, secondLine] }]
    };

    const next = snapTokenToNearestLine(impossibleDoc, movingTokenId);
    const containingLines = next.pages[0].lines.filter((line) => line.tokenIds.includes(movingTokenId));

    expect(next.tokens[movingTokenId].lineId).toBe(firstLine.id);
    expect(next.tokens[movingTokenId].offset).toEqual({ x: 0, y: 0 });
    expect(containingLines).toHaveLength(1);
    expect(containingLines[0].id).toBe(firstLine.id);
  });

  it("reorders tokens within a line from dragged x position", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = roomyDoc.pages[0].lines[0];
    const tokenId = line.tokenIds[0];
    const moved = {
      ...roomyDoc,
      tokens: {
        ...roomyDoc.tokens,
        [tokenId]: {
          ...roomyDoc.tokens[tokenId],
          offset: { x: 240, y: 0 }
        }
      }
    };

    const next = snapTokenToNearestLine(moved, tokenId);

    expect(next.pages[0].lines[0].tokenIds.indexOf(tokenId)).toBeGreaterThan(0);
    expect(findWordBoxCollisions(next, next.pages[0], next.pages[0].lines[0])).toHaveLength(0);
  });

  it("preserves the free horizontal drag position when snapping back to the same line", () => {
    const doc = createEmptyDocument();
    const page = doc.pages[0];
    const withFirst = addWordBoxToDocument(doc, page.id, "tok_first", { x: 100, y: 120 });
    const line = withFirst.pages[0].lines[0];
    const withSecond = addWordBoxToLineDocument(withFirst, page.id, line.id, "tok_second", 300);
    const sourceLine = withSecond.pages[0].lines[0];
    const dragged = {
      ...withSecond,
      tokens: {
        ...withSecond.tokens,
        tok_second: {
          ...withSecond.tokens.tok_second,
          offset: { x: withSecond.tokens.tok_second.offset.x + 37, y: 0 }
        }
      }
    };
    const draggedX = routeLine(dragged, dragged.pages[0], sourceLine).positionedTokens.find(
      (positioned) => positioned.tokenId === "tok_second"
    )!.rect.x;

    const next = snapTokenToNearestLine(dragged, "tok_second");
    const finalX = routeLine(next, next.pages[0], next.pages[0].lines[0]).positionedTokens.find(
      (positioned) => positioned.tokenId === "tok_second"
    )!.rect.x;

    expect(finalX).toBeCloseTo(draggedX);
    expect(findWordBoxCollisions(next, next.pages[0], next.pages[0].lines[0])).toHaveLength(0);
  });

  it("constrains free horizontal token movement at neighboring word-box collisions", () => {
    const doc = createEmptyDocument();
    const page = doc.pages[0];
    const withFirst = addWordBoxToDocument(doc, page.id, "tok_first", { x: 100, y: 120 });
    const line = withFirst.pages[0].lines[0];
    const withSecond = addWordBoxToLineDocument(withFirst, page.id, line.id, "tok_second", 220);
    const moved = moveTokenWithCollisionConstraints(withSecond, "tok_second", {
      ...withSecond.tokens.tok_second.offset,
      x: withSecond.tokens.tok_second.offset.x - 100
    });

    expect(findWordBoxCollisions(moved, moved.pages[0], moved.pages[0].lines[0])).toHaveLength(0);
    expect(routeLine(moved, moved.pages[0], moved.pages[0].lines[0]).positionedTokens[1].rect.x).toBeGreaterThan(
      routeLine(moved, moved.pages[0], moved.pages[0].lines[0]).positionedTokens[0].rect.x
    );
  });

  it("constrains free horizontal token movement at neighboring annotation collisions", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const line = { ...page.lines[0], tokenIds: page.lines[0].tokenIds.slice(0, 2) };
    const [firstTokenId, secondTokenId] = line.tokenIds;
    const settings = { ...doc.pageSettings, width: 1200 };
    const annotated = {
      ...doc,
      pageSettings: settings,
      pages: [{ ...page, lines: [line] }],
      tokens: {
        ...doc.tokens,
        [firstTokenId]: {
          ...doc.tokens[firstTokenId],
          text: "a",
          textMetrics: { [tokenTextMetricKey("a", settings)]: 20 }
        },
        [secondTokenId]: {
          ...doc.tokens[secondTokenId],
          text: "b",
          offset: { x: 260, y: 0 },
          textMetrics: { [tokenTextMetricKey("b", settings)]: 20 }
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

    expect(findWordBoxCollisions(annotated, annotated.pages[0], annotated.pages[0].lines[0], WORD_BOX_COLLISION_GAP)).toHaveLength(0);

    const moved = moveTokenWithCollisionConstraints(annotated, secondTokenId, {
      ...annotated.tokens[secondTokenId].offset,
      x: annotated.tokens[secondTokenId].offset.x - 220
    });

    expect(findWordBoxCollisions(moved, moved.pages[0], moved.pages[0].lines[0], WORD_BOX_COLLISION_GAP)).toHaveLength(0);
    expect(moved.tokens[secondTokenId].offset.x).toBeGreaterThan(annotated.tokens[secondTokenId].offset.x - 220);
  });

  it("constrains free horizontal token movement at padded image boundaries", () => {
    const doc = createEmptyDocument();
    const page = doc.pages[0];
    const withWord = addWordBoxToDocument(doc, page.id, "tok_first", { x: 100, y: 120 });
    const line = withWord.pages[0].lines[0];
    const withImage = {
      ...withWord,
      pages: [
        {
          ...withWord.pages[0],
          pageObjects: [
            {
              id: "image_obstacle",
              kind: "image" as const,
              rect: { x: 180, y: line.y - 12, width: 80, height: 80 },
              wrapMode: "rectangular" as const,
              zIndex: 1,
              assetPath: "",
              caption: "",
              metadata: {}
            }
          ]
        }
      ]
    };

    const moved = moveTokenWithCollisionConstraints(withImage, "tok_first", {
      ...withImage.tokens.tok_first.offset,
      x: withImage.tokens.tok_first.offset.x + 160
    });
    const movedLine = moved.pages[0].lines[0];
    const movedRect = wordBoxRectFromPositioned(
      routeLine(moved, moved.pages[0], movedLine).positionedTokens.find((item) => item.tokenId === "tok_first")!
    );

    expect(findWordBoxObstacleCollisions(moved, moved.pages[0], movedLine)).toHaveLength(0);
    expect(movedRect.x + movedRect.width + WORD_BOX_COLLISION_GAP).toBeLessThanOrEqual(180 - IMAGE_OBJECT_EXTERNAL_PADDING);
  });

  it("constrains free vertical line movement at neighboring guide collisions", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const firstLine = page.lines[0];
    const secondLine = {
      id: "line_second",
      tokenIds: [],
      y: firstLine.y + sourceLineBoxHeight(doc.pageSettings) + 36,
      offset: { x: 0, y: 0 },
      direction: "ltr" as const
    };
    const withSecondLine = {
      ...doc,
      pages: [{ ...page, lines: [firstLine, secondLine] }]
    };

    const moved = moveLineWithCollisionConstraints(withSecondLine, firstLine.id, secondLine.y);
    const movedFirstLine = moved.pages[0].lines.find((line) => line.id === firstLine.id)!;

    expect(movedFirstLine.y).toBe(secondLine.y - sourceLineBoxHeight(doc.pageSettings) - WORD_BOX_COLLISION_GAP);
    expect(findLineCollisions(moved, moved.pages[0], WORD_BOX_COLLISION_GAP)).toHaveLength(0);
  });

  it("constrains line movement before attached annotation boxes collide", () => {
    const doc = createEmptyDocument();
    const page = doc.pages[0];
    const withFirst = addWordBoxToDocument(doc, page.id, "tok_first", { x: 100, y: 120 });
    const withSecond = addWordBoxToDocument(withFirst, page.id, "tok_second", { x: 100, y: 210 });
    const firstLine = withSecond.pages[0].lines.find((line) => line.tokenIds.includes("tok_first"))!;
    const secondLine = withSecond.pages[0].lines.find((line) => line.tokenIds.includes("tok_second"))!;
    const lineHeight = sourceLineBoxHeight(withSecond.pageSettings);
    const annotated = {
      ...withSecond,
      annotationCells: {
        ann_below: {
          id: "ann_below",
          tokenId: "tok_first",
          layerId: withSecond.layers[0].id,
          text: "below",
          placement: "below" as const,
          offset: { x: 0, y: 0 }
        },
        ann_above: {
          id: "ann_above",
          tokenId: "tok_second",
          layerId: withSecond.layers[0].id,
          text: "above",
          placement: "above" as const,
          offset: { x: 0, y: 0 }
        }
      }
    };

    const moved = moveLineWithCollisionConstraints(annotated, secondLine.id, firstLine.y);
    const movedSecondLine = moved.pages[0].lines.find((line) => line.id === secondLine.id)!;

    expect(movedSecondLine.y).toBe(
      firstLine.y + lineHeight * 3 + ANNOTATION_CONNECTOR_LENGTH * 2 + WORD_BOX_COLLISION_GAP
    );
  });

  it("normalizes collisions after edited token text changes width", () => {
    const doc = createSampleDocument();
    const page = { ...doc.pages[0], pageObjects: [] };
    const roomyDoc = { ...doc, pageSettings: { ...doc.pageSettings, width: 1000 }, pages: [page] };
    const line = roomyDoc.pages[0].lines[0];
    const tokenId = line.tokenIds[0];
    const edited = {
      ...roomyDoc,
      tokens: {
        ...roomyDoc.tokens,
        [tokenId]: {
          ...roomyDoc.tokens[tokenId],
          text: "μακροτατος"
        }
      }
    };

    const next = normalizeTokenLayout(edited, tokenId);

    expect(findWordBoxCollisions(next, next.pages[0], next.pages[0].lines[0])).toHaveLength(0);
  });
});
