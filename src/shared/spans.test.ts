import { describe, expect, it } from "vitest";
import { createSampleDocument } from "./documentFactory";
import { canAddLayerSpan } from "./spans";

describe("layer span rules", () => {
  it("allows nested spans but rejects crossing same-layer spans", () => {
    const doc = createSampleDocument();
    const conceptLayer = doc.layers.find((layer) => layer.kind === "concept")!;
    const ids = doc.pages[0].lines[0].tokenIds;

    expect(
      canAddLayerSpan(doc, {
        id: "nested",
        layerId: conceptLayer.id,
        startTokenId: ids[1],
        endTokenId: ids[2]
      })
    ).toBe(true);

    expect(
      canAddLayerSpan(doc, {
        id: "crossing",
        layerId: conceptLayer.id,
        startTokenId: ids[2],
        endTokenId: ids[5]
      })
    ).toBe(false);
  });
});

