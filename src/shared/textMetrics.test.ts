import { describe, expect, it } from "vitest";
import { createSampleDocument } from "./documentFactory";
import {
  applyTokenTextMeasurements,
  deterministicTextWidth,
  measureDocumentTokenWidths,
  tokenTextMetricKey,
  tokenTextWidth
} from "./textMetrics";

describe("text metrics", () => {
  it("keys measurements by text, font family, and size", () => {
    const settings = { fontFamily: "Times New Roman", fontSize: 18 };

    expect(tokenTextMetricKey("το", settings)).not.toBe(tokenTextMetricKey("το", { ...settings, fontSize: 20 }));
    expect(tokenTextMetricKey("το", settings)).not.toBe(tokenTextMetricKey("τι", settings));
  });

  it("uses measured token widths when the current font key matches", () => {
    const settings = { fontFamily: "Measured Serif", fontSize: 18 };
    const token = {
      text: "iiii",
      textMetrics: {
        [tokenTextMetricKey("iiii", settings)]: 80
      }
    };

    expect(tokenTextWidth(token, settings)).toBe(80);
    expect(tokenTextWidth(token, { ...settings, fontFamily: "Other Serif" })).toBe(deterministicTextWidth("iiii", settings));
    expect(tokenTextWidth(token, { ...settings, fontSize: 20 })).toBe(deterministicTextWidth("iiii", { fontSize: 20 }));
  });

  it("does not inflate narrow non-empty words to the empty-box width", () => {
    const settings = { fontFamily: "Measured Serif", fontSize: 12 };

    expect(deterministicTextWidth("", settings)).toBe(1);
    expect(deterministicTextWidth("i", settings)).toBeLessThan(12);
    expect(deterministicTextWidth("interlinear", settings)).toBeGreaterThan(deterministicTextWidth("i", settings));
  });

  it("applies current measurements and prunes stale token metrics", () => {
    const doc = createSampleDocument();
    const tokenId = doc.pages[0].lines[0].tokenIds[0];
    const measured = measureDocumentTokenWidths(doc, (text, settings) => text.length * settings.fontSize);
    const next = applyTokenTextMeasurements(
      {
        ...doc,
        tokens: {
          ...doc.tokens,
          [tokenId]: {
            ...doc.tokens[tokenId],
            textMetrics: { stale: 999 }
          }
        }
      },
      measured
    );

    expect(next.tokens[tokenId].textMetrics).toEqual(measured[tokenId]);
    expect(next.tokens[tokenId].textMetrics.stale).toBeUndefined();
  });
});
