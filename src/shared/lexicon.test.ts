import { describe, expect, it } from "vitest";
import { createEmptyLexicon, createSampleDocument } from "./documentFactory";
import { findLineSuggestions, findTokenSuggestions } from "./lexicon";

describe("lexicon suggestions", () => {
  it("matches single-token entries", () => {
    const doc = createSampleDocument();
    const token = Object.values(doc.tokens)[0];
    const suggestions = findTokenSuggestions(
      token,
      {
        ...createEmptyLexicon(),
        entries: {
          lex_to: {
            id: "lex_to",
            lemma: token.text,
            normalizedForms: [token.normalized],
            glosses: [{ id: "gloss_to", text: "the" }],
            tags: [],
            kind: "token"
          }
        }
      }
    );

    expect(suggestions[0]).toMatchObject({ glossText: "the", tokenIds: [token.id] });
  });

  it("matches multi-token concept entries", () => {
    const doc = createSampleDocument();
    const line = doc.pages[0].lines[0];
    const suggestions = findLineSuggestions(doc, line.tokenIds, createEmptyLexicon());

    expect(suggestions.some((suggestion) => suggestion.entry.kind === "concept" && suggestion.tokenIds.length === 4)).toBe(true);
  });
});
