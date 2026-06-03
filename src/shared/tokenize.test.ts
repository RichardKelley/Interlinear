import { describe, expect, it } from "vitest";
import { createSampleDocument } from "./documentFactory";
import { mergeTokens, splitToken, tokenizeText } from "./tokenize";

describe("tokenization", () => {
  it("splits words and punctuation while preserving source text", () => {
    const tokens = tokenizeText("το τι ην ειναι, ἐστι.", "line_1");

    expect(tokens.map((token) => token.text)).toEqual(["το", "τι", "ην", "ειναι", ",", "ἐστι", "."]);
    expect(tokens.every((token) => token.lineId === "line_1")).toBe(true);
  });

  it("splits a token while migrating annotations, lexicon links, and span boundaries", () => {
    const doc = createSampleDocument();
    const line = doc.pages[0].lines[0];
    const tokenId = line.tokenIds[3];
    const layer = doc.layers[0];
    const next = splitToken(
      {
        ...doc,
        tokens: {
          ...doc.tokens,
          [tokenId]: {
            ...doc.tokens[tokenId],
            lexiconEntryId: "lex_einai"
          }
        },
        annotationCells: {
          ann_split: {
            id: "ann_split",
            tokenId,
            layerId: layer.id,
            text: "be",
            placement: "below",
            lexiconEntryId: "lex_einai",
            offset: { x: 0, y: 0 }
          }
        }
      },
      tokenId,
      ["ειν", "αι"]
    );
    const nextLineIds = next.pages[0].lines[0].tokenIds;
    const tokenIndex = nextLineIds.indexOf(tokenId);
    const insertedTokenId = nextLineIds[tokenIndex + 1];

    expect(next.tokens[tokenId]).toMatchObject({ text: "ειν", lexiconEntryId: "lex_einai" });
    expect(next.tokens[insertedTokenId]).toMatchObject({ text: "αι", lexiconEntryId: undefined });
    expect(next.annotationCells.ann_split.tokenId).toBe(tokenId);
    expect(next.layerSpans.span_aristotle_concept.endTokenId).toBe(insertedTokenId);
  });

  it("merges adjacent tokens while consolidating annotations, lexicon links, and span boundaries", () => {
    const doc = createSampleDocument();
    const [firstTokenId, secondTokenId] = doc.pages[0].lines[0].tokenIds;
    const layer = doc.layers[0];
    const next = mergeTokens(
      {
        ...doc,
        tokens: {
          ...doc.tokens,
          [secondTokenId]: {
            ...doc.tokens[secondTokenId],
            lexiconEntryId: "lex_toti"
          }
        },
        annotationCells: {
          ann_first: {
            id: "ann_first",
            tokenId: firstTokenId,
            layerId: layer.id,
            text: "the",
            placement: "below",
            offset: { x: 0, y: 0 }
          },
          ann_second: {
            id: "ann_second",
            tokenId: secondTokenId,
            layerId: layer.id,
            text: "what",
            placement: "below",
            lexiconEntryId: "lex_toti",
            offset: { x: 0, y: 0 }
          }
        },
        layerSpans: {
          span_pair: {
            id: "span_pair",
            layerId: doc.layers[1].id,
            startTokenId: firstTokenId,
            endTokenId: secondTokenId,
            text: "the-what",
            direction: "ltr",
            tags: [],
            offset: { x: 0, y: 0 }
          }
        }
      },
      [firstTokenId, secondTokenId],
      ""
    );

    expect(next.tokens[firstTokenId]).toMatchObject({ text: "τοτι", lexiconEntryId: "lex_toti" });
    expect(next.tokens[secondTokenId]).toBeUndefined();
    expect(next.annotationCells.ann_first).toMatchObject({
      tokenId: firstTokenId,
      text: "the / what",
      lexiconEntryId: "lex_toti"
    });
    expect(next.annotationCells.ann_second).toBeUndefined();
    expect(next.layerSpans.span_pair).toMatchObject({
      startTokenId: firstTokenId,
      endTokenId: firstTokenId
    });
  });

  it("does not merge non-adjacent tokens", () => {
    const doc = createSampleDocument();
    const [firstTokenId, , thirdTokenId] = doc.pages[0].lines[0].tokenIds;

    expect(mergeTokens(doc, [firstTokenId, thirdTokenId])).toBe(doc);
  });
});
