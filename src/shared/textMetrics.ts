import type { InterlinearDocument, PageSettings, Token } from "./schema.js";

const MIN_TEXT_WIDTH = 1;
const METRIC_KEY_SEPARATOR = "\u001f";

export type TextMeasure = (text: string, settings: Pick<PageSettings, "fontFamily" | "fontSize">) => number;
export type TokenTextMeasurements = Record<string, Record<string, number>>;

export function tokenTextMetricKey(text: string, settings: Pick<PageSettings, "fontFamily" | "fontSize">): string {
  return [settings.fontFamily, String(settings.fontSize), text].join(METRIC_KEY_SEPARATOR);
}

export function deterministicTextWidth(text: string, settings: Pick<PageSettings, "fontSize">): number {
  const glyphs = Array.from(text);
  if (glyphs.length === 0) return MIN_TEXT_WIDTH;
  const units = glyphs.reduce((sum, glyph) => sum + glyphWidthUnit(glyph), 0);
  return roundedWidth(Math.max(MIN_TEXT_WIDTH, units * settings.fontSize));
}

export function tokenTextWidth(token: Pick<Token, "text" | "textMetrics">, settings: Pick<PageSettings, "fontFamily" | "fontSize">): number {
  const key = tokenTextMetricKey(token.text, settings);
  return token.textMetrics?.[key] ?? deterministicTextWidth(token.text, settings);
}

export function measureTextWithCanvas(
  text: string,
  settings: Pick<PageSettings, "fontFamily" | "fontSize">,
  canvas: HTMLCanvasElement
): number {
  if (typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom")) {
    return deterministicTextWidth(text, settings);
  }
  const context = canvas.getContext("2d");
  if (!context) return deterministicTextWidth(text, settings);
  context.font = `${settings.fontSize}px ${settings.fontFamily}`;
  if (text.length === 0) return MIN_TEXT_WIDTH;
  return roundedWidth(Math.max(MIN_TEXT_WIDTH, context.measureText(text).width));
}

export function measureDocumentTokenWidths(document: InterlinearDocument, measure: TextMeasure): TokenTextMeasurements {
  return Object.fromEntries(
    Object.values(document.tokens).map((token) => [
      token.id,
      {
        [tokenTextMetricKey(token.text, document.pageSettings)]: roundedWidth(
          Math.max(MIN_TEXT_WIDTH, measure(token.text, document.pageSettings))
        )
      }
    ])
  );
}

export function applyTokenTextMeasurements(
  document: InterlinearDocument,
  measurements: TokenTextMeasurements
): InterlinearDocument {
  let changed = false;
  const tokens = Object.fromEntries(
    Object.entries(document.tokens).map(([tokenId, token]) => {
      const textMetrics = measurements[tokenId] ?? {};
      if (!sameMetrics(token.textMetrics ?? {}, textMetrics)) {
        changed = true;
        return [tokenId, { ...token, textMetrics }];
      }
      return [tokenId, token];
    })
  );

  return changed ? { ...document, tokens } : document;
}

function glyphWidthUnit(glyph: string): number {
  if (/[\s]/u.test(glyph)) return 0.28;
  if (/[.,;:··'’`]/u.test(glyph)) return 0.26;
  if (/[!|]/u.test(glyph)) return 0.28;
  if (/[()[\]{}]/u.test(glyph)) return 0.34;
  if (/[ιλIftjr]/u.test(glyph)) return 0.36;
  if (/[mwMWΩωЖШЩ]/u.test(glyph)) return 0.82;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(glyph)) return 0.95;
  return 0.55;
}

function roundedWidth(width: number): number {
  return Math.round(width * 100) / 100;
}

function sameMetrics(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}
