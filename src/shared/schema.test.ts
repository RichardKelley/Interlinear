import { describe, expect, it } from "vitest";
import { createEmptyLexicon, createSampleDocument } from "./documentFactory";
import { DocumentSchema, LexiconSchema } from "./schema";

describe("schemas", () => {
  it("validates document and lexicon files", () => {
    expect(DocumentSchema.parse(createSampleDocument()).schemaVersion).toBe(1);
    expect(LexiconSchema.parse(createEmptyLexicon()).schemaVersion).toBe(1);
  });

  it("validates token and concept lexicon entries", () => {
    const lexicon = createEmptyLexicon();
    const parsed = LexiconSchema.parse({
      ...lexicon,
      entries: {
        token_logos: {
          id: "token_logos",
          lemma: "λόγος",
          normalizedForms: ["λογος"],
          glosses: [{ id: "gloss_word", text: "word" }],
          tags: ["noun"],
          kind: "token"
        },
        concept_essence: lexicon.entries.lex_to_ti_en_einai
      }
    });

    expect(parsed.entries.token_logos.kind).toBe("token");
    expect(parsed.entries.concept_essence.kind).toBe("concept");
  });

  it("rejects invalid lexicon entries", () => {
    expect(() =>
      LexiconSchema.parse({
        ...createEmptyLexicon(),
        entries: {
          invalid: {
            id: "invalid",
            lemma: "",
            glosses: [{ id: "gloss", text: "bad" }]
          }
        }
      })
    ).toThrow();
  });

  it("defaults optional layout visibility settings for older documents", () => {
    const document = createSampleDocument();
    const {
      annotationHandlesVisible: _annotationHandlesVisible,
      marginGuidesVisible: _marginGuidesVisible,
      pageNumbersVisible: _pageNumbersVisible,
      ...legacyDocument
    } = document;

    expect(DocumentSchema.parse(legacyDocument).pageNumbersVisible).toBe(false);
    expect(DocumentSchema.parse(legacyDocument).marginGuidesVisible).toBe(false);
    expect(DocumentSchema.parse(legacyDocument).annotationHandlesVisible).toBe(true);
  });

  it("defaults older annotation cells to below-source placement", () => {
    const document = createSampleDocument();
    const token = Object.values(document.tokens)[0];
    const layer = document.layers[0];
    const parsed = DocumentSchema.parse({
      ...document,
      annotationCells: {
        ann_legacy: {
          id: "ann_legacy",
          tokenId: token.id,
          layerId: layer.id,
          text: "legacy"
        }
      }
    });

    expect(parsed.annotationCells.ann_legacy.placement).toBe("below");
  });

  it("defaults older tokens to empty text metrics", () => {
    const document = createSampleDocument();
    const [tokenId, token] = Object.entries(document.tokens)[0];
    const parsed = DocumentSchema.parse({
      ...document,
      tokens: {
        ...document.tokens,
        [tokenId]: {
          ...token,
          textMetrics: undefined
        }
      }
    });

    expect(parsed.tokens[tokenId].textMetrics).toEqual({});
  });

  it("defaults image objects to an empty source path", () => {
    const document = createSampleDocument();
    const parsed = DocumentSchema.parse({
      ...document,
      pages: [
        {
          ...document.pages[0],
          pageObjects: [
            {
              id: "placeholder_image",
              kind: "image",
              rect: { x: 120, y: 90, width: 160, height: 100 },
              wrapMode: "rectangular",
              zIndex: 1,
              caption: "",
              metadata: {}
            }
          ]
        }
      ]
    });

    expect(parsed.pages[0].pageObjects[0]).toMatchObject({ kind: "image", assetPath: "" });
  });

  it("parses semantic text page object blocks", () => {
    const document = createSampleDocument();
    const parsed = DocumentSchema.parse({
      ...document,
      pages: [
        {
          ...document.pages[0],
          pageObjects: [
            {
              id: "title_block",
              kind: "titleBlock",
              rect: { x: 54, y: 54, width: 420, height: 52 },
              content: "A Title"
            },
            {
              id: "subtitle_block",
              kind: "subtitleBlock",
              rect: { x: 54, y: 112, width: 380, height: 40 },
              content: "A Subtitle"
            },
            {
              id: "section_block",
              kind: "sectionBlock",
              rect: { x: 54, y: 170, width: 320, height: 34 },
              content: "A Section"
            }
          ]
        }
      ]
    });

    expect(parsed.pages[0].pageObjects.map((object) => object.kind)).toEqual(["titleBlock", "subtitleBlock", "sectionBlock"]);
    expect(parsed.pages[0].pageObjects[0]).toMatchObject({ wrapMode: "rectangular", zIndex: 1, metadata: {} });
  });

  it("preserves span anchors on annotation cells", () => {
    const document = createSampleDocument();
    const span = Object.values(document.layerSpans)[0];
    const parsed = DocumentSchema.parse({
      ...document,
      annotationCells: {
        ann_span: {
          id: "ann_span",
          tokenId: span.startTokenId,
          spanId: span.id,
          layerId: document.layers[0].id,
          text: "essence",
          placement: "above"
        }
      }
    });

    expect(parsed.annotationCells.ann_span.spanId).toBe(span.id);
    expect(parsed.annotationCells.ann_span.placement).toBe("above");
  });
});
