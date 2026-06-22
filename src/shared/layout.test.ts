import { describe, expect, it } from "vitest";
import { createSampleDocument } from "./documentFactory";
import { availableBands, IMAGE_OBJECT_EXTERNAL_PADDING, routeLine, sourceLineBoxHeight } from "./layout";
import { tokenTextMetricKey } from "./textMetrics";

describe("layout routing", () => {
  it("subtracts rectangular page objects from line bands", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const line = page.lines[0];

    const bands = availableBands(page, doc.pageSettings, line.y, 60);

    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0].x).toBe(doc.pageSettings.marginLeft);
    expect(
      bands.every(
        (band) =>
          band.x + band.width <= page.pageObjects[0].rect.x ||
          band.x >= page.pageObjects[0].rect.x + page.pageObjects[0].rect.width
      )
    ).toBe(true);
  });

  it("subtracts image objects with external padding from line bands", () => {
    const doc = createSampleDocument();
    const line = doc.pages[0].lines[0];
    const image = {
      id: "image_obstacle",
      kind: "image" as const,
      rect: { x: 210, y: line.y - 10, width: 80, height: 80 },
      wrapMode: "rectangular" as const,
      zIndex: 1,
      assetPath: "",
      caption: "",
      metadata: {}
    };
    const page = {
      ...doc.pages[0],
      pageObjects: [image]
    };

    const bands = availableBands(page, doc.pageSettings, line.y, 60);

    expect(bands).toEqual([
      {
        x: doc.pageSettings.marginLeft,
        y: line.y,
        width: image.rect.x - IMAGE_OBJECT_EXTERNAL_PADDING - doc.pageSettings.marginLeft,
        height: 60
      },
      {
        x: image.rect.x + image.rect.width + IMAGE_OBJECT_EXTERNAL_PADDING,
        y: line.y,
        width:
          doc.pageSettings.width -
          doc.pageSettings.marginRight -
          (image.rect.x + image.rect.width + IMAGE_OBJECT_EXTERNAL_PADDING),
        height: 60
      }
    ]);
  });

  it("does not subtract image padding above the visible source line box", () => {
    const doc = createSampleDocument();
    const lineHeight = sourceLineBoxHeight(doc.pageSettings);
    const image = {
      id: "image_obstacle",
      kind: "image" as const,
      rect: { x: 210, y: 210, width: 80, height: 80 },
      wrapMode: "rectangular" as const,
      zIndex: 1,
      assetPath: "",
      caption: "",
      metadata: {}
    };
    const page = {
      ...doc.pages[0],
      pageObjects: [image]
    };
    const lineY = image.rect.y - IMAGE_OBJECT_EXTERNAL_PADDING - lineHeight - 1;

    const bands = availableBands(page, doc.pageSettings, lineY, 60);

    expect(bands).toEqual([
      {
        x: doc.pageSettings.marginLeft,
        y: lineY,
        width: doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight,
        height: 60
      }
    ]);
  });

  it("positions tokens into available routed bands", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const routed = routeLine(doc, page, page.lines[0]);

    expect(routed.positionedTokens.length).toBe(page.lines[0].tokenIds.length);
    expect(routed.positionedTokens[0].rect.x).toBe(doc.pageSettings.marginLeft);
    expect(routed.positionedTokens[0].rect.height).toBe(sourceLineBoxHeight(doc.pageSettings));
  });

  it("updates rectangular routing after a page object resize", () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    const line = page.lines[0];
    const before = availableBands(page, doc.pageSettings, line.y, 60);
    const resizedPage = {
      ...page,
      pageObjects: [
        {
          ...page.pageObjects[0],
          rect: { ...page.pageObjects[0].rect, x: 260, width: 220 }
        }
      ]
    };
    const after = availableBands(resizedPage, doc.pageSettings, line.y, 60);

    expect(after[0].width).toBeLessThan(before[0].width);
    expect(after[0].x + after[0].width).toBe(260);
  });

  it("ignores page objects with no wrap mode while routing", () => {
    const doc = createSampleDocument();
    const page = {
      ...doc.pages[0],
      pageObjects: [{ ...doc.pages[0].pageObjects[0], wrapMode: "none" as const }]
    };
    const bands = availableBands(page, doc.pageSettings, page.lines[0].y, 60);

    expect(bands).toEqual([
      {
        x: doc.pageSettings.marginLeft,
        y: page.lines[0].y,
        width: doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight,
        height: 60
      }
    ]);
  });

  it("uses measured token widths for width-sensitive routing around obstacles", () => {
    const doc = createSampleDocument();
    const line = doc.pages[0].lines[0];
    const [wideTokenId, followingTokenId] = line.tokenIds;
    const settings = { ...doc.pageSettings, width: 300, marginLeft: 20, marginRight: 20, fontFamily: "Measured Serif" };
    const page = {
      ...doc.pages[0],
      pageObjects: [
        {
          ...doc.pages[0].pageObjects[0],
          rect: { x: 110, y: line.y - 10, width: 80, height: 80 },
          wrapMode: "rectangular" as const
        }
      ]
    };
    const measuredDoc = {
      ...doc,
      pageSettings: settings,
      pages: [page],
      tokens: {
        ...doc.tokens,
        [wideTokenId]: {
          ...doc.tokens[wideTokenId],
          text: "ii",
          textMetrics: { [tokenTextMetricKey("ii", settings)]: 84 }
        },
        [followingTokenId]: {
          ...doc.tokens[followingTokenId],
          text: "b",
          textMetrics: { [tokenTextMetricKey("b", settings)]: 16 }
        }
      }
    };

    const routed = routeLine(measuredDoc, page, line);
    const following = routed.positionedTokens.find((positioned) => positioned.tokenId === followingTokenId);

    expect(following?.rect.x).toBe(190);
  });

  it("positions RTL line tokens from the right margin", () => {
    const doc = createSampleDocument();
    const page = {
      ...doc.pages[0],
      pageObjects: []
    };
    const line = { ...page.lines[0], direction: "rtl" as const };
    const rtlDoc = {
      ...doc,
      pages: [{ ...page, lines: [line] }],
      tokens: Object.fromEntries(
        Object.entries(doc.tokens).map(([id, token]) => [
          id,
          {
            ...token,
            direction: "rtl" as const,
            textMetrics: { [tokenTextMetricKey(token.text, doc.pageSettings)]: 20 }
          }
        ])
      )
    };

    const routed = routeLine(rtlDoc, rtlDoc.pages[0], line);

    expect(routed.positionedTokens[0].rect.x).toBe(doc.pageSettings.width - doc.pageSettings.marginRight - 20);
    expect(routed.positionedTokens[1].rect.x).toBeLessThan(routed.positionedTokens[0].rect.x);
  });
});
