import type { InterlinearDocument, LayerSpan } from "./schema.js";

export function tokenOrder(document: InterlinearDocument): string[] {
  return document.pages.flatMap((page) => page.lines.flatMap((line) => line.tokenIds));
}

export function spanRange(document: InterlinearDocument, span: Pick<LayerSpan, "startTokenId" | "endTokenId">) {
  const order = tokenOrder(document);
  const start = order.indexOf(span.startTokenId);
  const end = order.indexOf(span.endTokenId);
  return start <= end ? { start, end } : { start: end, end: start };
}

export function canAddLayerSpan(
  document: InterlinearDocument,
  candidate: Pick<LayerSpan, "id" | "layerId" | "startTokenId" | "endTokenId" | "parentSpanId">
): boolean {
  const candidateRange = spanRange(document, candidate);
  if (candidateRange.start < 0 || candidateRange.end < 0) return false;

  return Object.values(document.layerSpans)
    .filter((span) => span.id !== candidate.id && span.layerId === candidate.layerId)
    .every((span) => {
      const range = spanRange(document, span);
      const disjoint = candidateRange.end < range.start || range.end < candidateRange.start;
      const candidateContainsSpan = candidateRange.start <= range.start && candidateRange.end >= range.end;
      const spanContainsCandidate = range.start <= candidateRange.start && range.end >= candidateRange.end;
      return disjoint || candidateContainsSpan || spanContainsCandidate;
    });
}
