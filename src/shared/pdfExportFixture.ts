import { createSampleDocument } from "./documentFactory.js";
import { tokenTextMetricKey } from "./textMetrics.js";
import type { InterlinearDocument } from "./schema.js";

export function createPdfExportFixtureDocument(assetPath = "assets/plate.png"): InterlinearDocument {
  const doc = createSampleDocument();
  const line = doc.pages[0].lines[0];
  const [firstTokenId, secondTokenId, thirdTokenId] = line.tokenIds;
  const literalLayer = doc.layers.find((layer) => layer.kind === "literal") ?? doc.layers[0];
  const translationLayer = doc.layers.find((layer) => layer.kind === "translation") ?? doc.layers.at(-1)!;
  const conceptSpan = Object.values(doc.layerSpans)[0];
  const pageSettings = {
    ...doc.pageSettings,
    fontFamily: "Times New Roman",
    fontSize: 18,
    marginTop: 54,
    marginRight: 54,
    marginBottom: 54,
    marginLeft: 54
  };

  return {
    ...doc,
    id: "pdf_export_fixture",
    title: "PDF Export Fixture",
    pageSettings,
    tokens: {
      ...doc.tokens,
      [firstTokenId]: {
        ...doc.tokens[firstTokenId],
        textMetrics: { [tokenTextMetricKey(doc.tokens[firstTokenId].text, pageSettings)]: 18 }
      },
      [secondTokenId]: {
        ...doc.tokens[secondTokenId],
        textMetrics: { [tokenTextMetricKey(doc.tokens[secondTokenId].text, pageSettings)]: 14 }
      },
      [thirdTokenId]: {
        ...doc.tokens[thirdTokenId],
        textMetrics: { [tokenTextMetricKey(doc.tokens[thirdTokenId].text, pageSettings)]: 20 }
      }
    },
    annotationCells: {
      ann_literal_to: {
        id: "ann_literal_to",
        tokenId: firstTokenId,
        layerId: literalLayer.id,
        text: "the",
        placement: "above",
        offset: { x: 0, y: 0 }
      },
      ann_translation_concept: {
        id: "ann_translation_concept",
        tokenId: conceptSpan.startTokenId,
        spanId: conceptSpan.id,
        layerId: translationLayer.id,
        text: "essence",
        placement: "below",
        offset: { x: 0, y: 0 }
      }
    },
    pages: [
      {
        ...doc.pages[0],
        pageObjects: [
          {
            id: "fixture_image",
            kind: "image",
            rect: { x: 390, y: 82, width: 130, height: 84 },
            wrapMode: "rectangular",
            zIndex: 2,
            assetPath,
            caption: "Manuscript detail",
            metadata: {}
          },
          {
            id: "fixture_note",
            kind: "textBlock",
            rect: { x: 372, y: 190, width: 170, height: 86 },
            wrapMode: "rectangular",
            zIndex: 1,
            content: "Side note: concept span with anchored translation.",
            caption: "Note",
            metadata: {}
          }
        ]
      }
    ]
  };
}
