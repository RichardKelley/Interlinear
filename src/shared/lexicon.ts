import { normalizeTerm } from "./normalization.js";
import type { InterlinearDocument, Lexicon, LexiconEntry, Token } from "./schema.js";

export type LexiconSuggestion = {
  entry: LexiconEntry;
  tokenIds: string[];
  glossText: string;
};

function entryForms(entry: LexiconEntry): string[] {
  return Array.from(new Set([entry.lemma, ...entry.normalizedForms].map(normalizeTerm).filter(Boolean)));
}

export function findTokenSuggestions(token: Token, lexicon: Lexicon | null): LexiconSuggestion[] {
  if (!lexicon) return [];
  return Object.values(lexicon.entries)
    .filter((entry) => entry.kind === "token")
    .filter((entry) => entryForms(entry).includes(token.normalized))
    .map((entry) => ({
      entry,
      tokenIds: [token.id],
      glossText: entry.glosses[0]?.text ?? entry.lemma
    }));
}

export function findLineSuggestions(
  document: InterlinearDocument,
  tokenIds: string[],
  lexicon: Lexicon | null
): LexiconSuggestion[] {
  if (!lexicon) return [];
  const suggestions: LexiconSuggestion[] = [];

  for (const entry of Object.values(lexicon.entries)) {
    const forms = entryForms(entry);
    const maxWords = Math.max(...forms.map((form) => form.split(" ").length));
    for (let start = 0; start < tokenIds.length; start += 1) {
      for (let width = 1; width <= maxWords && start + width <= tokenIds.length; width += 1) {
        const slice = tokenIds.slice(start, start + width);
        const phrase = slice.map((id) => document.tokens[id]?.text ?? "").join(" ");
        if (forms.includes(normalizeTerm(phrase))) {
          suggestions.push({
            entry,
            tokenIds: slice,
            glossText: entry.glosses[0]?.text ?? entry.lemma
          });
        }
      }
    }
  }

  return suggestions;
}
