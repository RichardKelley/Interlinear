import { createId } from "./ids.js";
import { normalizeTerm } from "./normalization.js";
import type { InterlinearDocument, Lexicon } from "./schema.js";

export const LETTER_PAGE = {
  width: 612,
  height: 792,
  marginTop: 54,
  marginRight: 54,
  marginBottom: 54,
  marginLeft: 54,
  unit: "pt" as const,
  fontFamily: "Times New Roman",
  fontSize: 12,
  lineGap: 24,
  annotationGap: 16
};

export function createEmptyDocument(): InterlinearDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: createId("doc"),
    title: "Untitled Interlinear Document",
    sourceLanguage: "",
    direction: "ltr",
    pageSettings: LETTER_PAGE,
    lineGuidesVisible: true,
    marginGuidesVisible: true,
    annotationHandlesVisible: true,
    pageNumbersVisible: false,
    layers: createDefaultLayers(),
    tokens: {},
    annotationCells: {},
    layerSpans: {},
    pages: [
      {
        id: createId("page"),
        number: 1,
        lines: [],
        pageObjects: []
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

export function createSampleDocument(): InterlinearDocument {
  const now = new Date().toISOString();
  const layers = createDefaultLayers();
  const literalLayerId = layers[0].id;
  const conceptLayerId = layers[1].id;
  const lineId = createId("line");
  const tokenTexts = ["το", "τι", "ην", "ειναι", "ἐστι", "ζητούμενον", "."];
  const tokenIds = tokenTexts.map(() => createId("tok"));
  const tokens = Object.fromEntries(
    tokenTexts.map((text, index) => {
      const id = tokenIds[index];
      return [
        id,
        {
          id,
          text,
          normalized: normalizeTerm(text),
          direction: "ltr" as const,
          lineId,
          offset: { x: 0, y: 0 },
          textMetrics: {}
        }
      ];
    })
  );

  return {
    schemaVersion: 1,
    id: createId("doc"),
    title: "Untitled Interlinear Document",
    sourceLanguage: "Ancient Greek",
    direction: "ltr",
    pageSettings: LETTER_PAGE,
    lineGuidesVisible: true,
    marginGuidesVisible: false,
    annotationHandlesVisible: true,
    pageNumbersVisible: false,
    layers,
    tokens,
    annotationCells: {},
    layerSpans: {
      span_aristotle_concept: {
        id: "span_aristotle_concept",
        layerId: conceptLayerId,
        startTokenId: tokenIds[0],
        endTokenId: tokenIds[3],
        text: "what-it-was-to-be",
        direction: "ltr",
        tags: ["concept"],
        offset: { x: 0, y: -18 }
      }
    },
    pages: [
      {
        id: createId("page"),
        number: 1,
        lines: [
          {
            id: lineId,
            tokenIds,
            y: 120,
            offset: { x: 0, y: 0 },
            direction: "ltr"
          }
        ],
        pageObjects: [
          {
            id: createId("obj"),
            kind: "textBlock",
            rect: { x: 390, y: 92, width: 150, height: 96 },
            wrapMode: "rectangular",
            zIndex: 2,
            content: "Independent note block",
            caption: "Comment",
            metadata: {}
          }
        ]
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

function createDefaultLayers(): InterlinearDocument["layers"] {
  return [
    { id: "layer_literal", name: "Literal", kind: "literal", visible: true, direction: "ltr", order: 0 },
    { id: "layer_concept", name: "Concept", kind: "concept", visible: true, direction: "ltr", order: 1 },
    {
      id: "layer_translation",
      name: "Translation",
      kind: "translation",
      visible: true,
      direction: "ltr",
      order: 2
    }
  ];
}

export function createEmptyLexicon(): Lexicon {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: createId("lex"),
    name: "Project Lexicon",
    language: "",
    entries: {
      lex_to_ti_en_einai: {
        id: "lex_to_ti_en_einai",
        lemma: "το τι ην ειναι",
        normalizedForms: [normalizeTerm("το τι ην ειναι")],
        glosses: [{ id: "gloss_essence", text: "what-it-was-to-be" }],
        notes: "Aristotelian concept often rendered as essence.",
        tags: ["concept", "Aristotle"],
        kind: "concept"
      }
    },
    createdAt: now,
    updatedAt: now
  };
}
