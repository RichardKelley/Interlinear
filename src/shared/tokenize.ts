import { createId } from "./ids.js";
import { normalizeTerm } from "./normalization.js";
import type { AnnotationCell, Direction, InterlinearDocument, LayerSpan, Token } from "./schema.js";

const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}'’\-]+|[^\s\p{L}\p{N}\p{M}]/gu;

export function tokenizeText(text: string, lineId: string, direction: Direction = "ltr"): Token[] {
  const matches = text.match(TOKEN_PATTERN) ?? [];
  return matches
    .filter((part) => part.trim().length > 0)
    .map((part) => ({
      id: createId("tok"),
      text: part,
      normalized: normalizeTerm(part),
      direction,
      lineId,
      offset: { x: 0, y: 0 },
      textMetrics: {}
    }));
}

export function splitToken(document: InterlinearDocument, tokenId: string, parts: string[]): InterlinearDocument {
  const existing = document.tokens[tokenId];
  if (!existing) return document;

  const cleanParts = parts.map((part) => part.trim()).filter(Boolean);
  if (cleanParts.length < 2) return document;

  const replacementTokens = cleanParts.map((text, index) => ({
    ...existing,
    id: index === 0 ? existing.id : createId("tok"),
    text,
    normalized: normalizeTerm(text),
    lexiconEntryId: index === 0 ? existing.lexiconEntryId : undefined,
    offset: index === 0 ? existing.offset : { x: 0, y: 0 },
    textMetrics: {}
  }));
  const lastReplacementTokenId = replacementTokens.at(-1)!.id;

  const tokens = { ...document.tokens };
  for (const token of replacementTokens) {
    tokens[token.id] = token;
  }

  return {
    ...document,
    tokens,
    layerSpans: Object.fromEntries(
      Object.entries(document.layerSpans).map(([id, span]) => [
        id,
        migrateSplitSpan(span, tokenId, replacementTokens[0].id, lastReplacementTokenId)
      ])
    ),
    pages: document.pages.map((page) => ({
      ...page,
      lines: page.lines.map((line) =>
        line.id === existing.lineId
          ? {
              ...line,
              tokenIds: line.tokenIds.flatMap((id) =>
                id === tokenId ? replacementTokens.map((token) => token.id) : [id]
              )
            }
          : line
      )
    }))
  };
}

export function mergeTokens(document: InterlinearDocument, tokenIds: string[], joiner = ""): InterlinearDocument {
  const orderedTokenIds = orderedUniqueIds(tokenIds);
  if (orderedTokenIds.length < 2) return document;
  const tokensToMerge = orderedTokenIds.map((id) => document.tokens[id]).filter(Boolean);
  if (tokensToMerge.length !== orderedTokenIds.length) return document;

  const [first] = tokensToMerge;
  const lineId = first.lineId;
  if (!tokensToMerge.every((token) => token.lineId === lineId)) return document;
  const line = document.pages.flatMap((page) => page.lines).find((candidate) => candidate.id === lineId);
  if (!line || !areAdjacent(line.tokenIds, orderedTokenIds)) return document;

  const mergedText = tokensToMerge.map((token) => token.text).join(joiner);
  const mergedToken = {
    ...first,
    id: first.id,
    text: mergedText,
    normalized: normalizeTerm(mergedText),
    lexiconEntryId: tokensToMerge.find((token) => token.lexiconEntryId)?.lexiconEntryId,
    offset: first.offset,
    textMetrics: {}
  };

  const tokens = { ...document.tokens, [mergedToken.id]: mergedToken };
  for (const id of orderedTokenIds.slice(1)) {
    delete tokens[id];
  }

  const idSet = new Set(orderedTokenIds);
  const annotationCells = consolidateMergedAnnotations(document.annotationCells, idSet, mergedToken.id);
  return {
    ...document,
    tokens,
    annotationCells,
    layerSpans: Object.fromEntries(
      Object.entries(document.layerSpans).map(([id, span]) => [id, migrateMergedSpan(span, idSet, mergedToken.id)])
    ),
    pages: document.pages.map((page) => ({
      ...page,
      lines: page.lines.map((line) => {
        if (line.id !== lineId) return line;
        const nextIds: string[] = [];
        for (const id of line.tokenIds) {
          if (id === first.id) {
            nextIds.push(mergedToken.id);
          } else if (!idSet.has(id)) {
            nextIds.push(id);
          }
        }
        return { ...line, tokenIds: nextIds };
      })
    }))
  };
}

function migrateSplitSpan(span: LayerSpan, tokenId: string, firstTokenId: string, lastTokenId: string): LayerSpan {
  return {
    ...span,
    startTokenId: span.startTokenId === tokenId ? firstTokenId : span.startTokenId,
    endTokenId: span.endTokenId === tokenId ? lastTokenId : span.endTokenId
  };
}

function migrateMergedSpan(span: LayerSpan, mergedTokenIds: Set<string>, mergedTokenId: string): LayerSpan {
  return {
    ...span,
    startTokenId: mergedTokenIds.has(span.startTokenId) ? mergedTokenId : span.startTokenId,
    endTokenId: mergedTokenIds.has(span.endTokenId) ? mergedTokenId : span.endTokenId
  };
}

function consolidateMergedAnnotations(
  annotationCells: InterlinearDocument["annotationCells"],
  mergedTokenIds: Set<string>,
  mergedTokenId: string
): InterlinearDocument["annotationCells"] {
  const next: InterlinearDocument["annotationCells"] = {};
  const seenTokenAnchors = new Map<string, AnnotationCell>();

  for (const cell of Object.values(annotationCells)) {
    if (!mergedTokenIds.has(cell.tokenId)) {
      next[cell.id] = cell;
      continue;
    }

    const migrated = { ...cell, tokenId: mergedTokenId };
    if (cell.spanId) {
      next[cell.id] = migrated;
      continue;
    }

    const key = `${migrated.layerId}:${migrated.placement}`;
    const existing = seenTokenAnchors.get(key);
    if (!existing) {
      seenTokenAnchors.set(key, migrated);
      next[migrated.id] = migrated;
      continue;
    }

    const joinedText = [existing.text, migrated.text].filter((text) => text.trim().length > 0).join(" / ");
    next[existing.id] = {
      ...existing,
      text: joinedText,
      lexiconEntryId: existing.lexiconEntryId ?? migrated.lexiconEntryId
    };
  }

  return next;
}

function orderedUniqueIds(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

function areAdjacent(lineTokenIds: string[], selectedIds: string[]): boolean {
  const selected = new Set(selectedIds);
  const selectedIndexes = lineTokenIds
    .map((id, index) => (selected.has(id) ? index : -1))
    .filter((index) => index >= 0);

  if (selectedIndexes.length !== selectedIds.length) return false;
  return selectedIndexes.every((index, offset) => offset === 0 || index === selectedIndexes[offset - 1] + 1);
}
