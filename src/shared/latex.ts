import { routeLine } from "./layout.js";
import type { InterlinearDocument, PageObject } from "./schema.js";

type TextPageObject = Exclude<PageObject, { kind: "image" }>;
type TextPageObjectKind = TextPageObject["kind"];

const TEXT_PAGE_OBJECT_EXPORT_STYLES: Record<TextPageObjectKind, { fontSize: number; leading: number; prefix: string }> = {
  textBlock: { fontSize: 10, leading: 12, prefix: "" },
  titleBlock: { fontSize: 22, leading: 26, prefix: "\\bfseries " },
  subtitleBlock: { fontSize: 15, leading: 19, prefix: "\\itshape " },
  sectionBlock: { fontSize: 14, leading: 17, prefix: "\\bfseries " }
};

export function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}#$%&_])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

export function detokenizeLatex(value: string): string {
  return `\\detokenize{${value.replace(/[{}]/g, "")}}`;
}

function pt(value: number): string {
  return `${value.toFixed(2)}pt`;
}

function coord(value: number): string {
  return value.toFixed(2);
}

function textNode(x: number, y: number, content: string, fontSize: number, direction: "ltr" | "rtl" = "ltr"): string {
  return `\\put(${coord(x)},${coord(-y)}){\\fontsize{${fontSize}}{${fontSize * 1.2}}\\selectfont ${directionalLatex(
    content,
    direction
  )}}`;
}

function directionalLatex(content: string, direction: "ltr" | "rtl"): string {
  const escaped = escapeLatex(content);
  return direction === "rtl" ? `\\beginR ${escaped}\\endR` : escaped;
}

function pageNumberNode(pageNumber: number, document: InterlinearDocument): string {
  const x = document.pageSettings.width / 2;
  const y = document.pageSettings.height - Math.max(18, document.pageSettings.marginBottom / 2);
  return `\\put(${coord(x)},${coord(-y)}){\\makebox[0pt][c]{\\fontsize{10}{12}\\selectfont ${pageNumber}}}`;
}

function pageObjectToLatex(object: PageObject): string {
  if (object.kind === "image") {
    if (!object.assetPath.trim()) return "";
    return [
      `\\put(${coord(object.rect.x)},${coord(-object.rect.y)}){\\includegraphics[width=${pt(object.rect.width)},height=${pt(
        object.rect.height
      )},keepaspectratio]{${detokenizeLatex(object.assetPath)}}}`
    ].join("\n");
  }

  const style = TEXT_PAGE_OBJECT_EXPORT_STYLES[object.kind];
  return [
    `\\put(${coord(object.rect.x)},${coord(-object.rect.y)}){\\begin{minipage}[t][${pt(object.rect.height)}][t]{${pt(
      object.rect.width
    )}}`,
    `\\fontsize{${style.fontSize}}{${style.leading}}\\selectfont ${style.prefix}${escapeLatex(object.content)}`,
    "\\end{minipage}}"
  ].join("\n");
}

export function documentToLatex(document: InterlinearDocument): string {
  const { pageSettings } = document;
  const layers = [...document.layers].filter((layer) => layer.visible).sort((left, right) => left.order - right.order);

  const pages = document.pages
    .map((page, pageIndex) => {
      const objects = [...page.pageObjects].sort((left, right) => left.zIndex - right.zIndex).map(pageObjectToLatex);
      const lineNodes = page.lines.flatMap((line) => {
        const routed = routeLine(document, page, line);
        return routed.positionedTokens.flatMap((positioned) => {
          const token = document.tokens[positioned.tokenId];
          if (!token) return [];
          const cells = layers.flatMap((layer, layerIndex) => {
            const cell = Object.values(document.annotationCells).find(
              (item) => !item.spanId && item.tokenId === token.id && item.layerId === layer.id
            );
            if (!cell) return [];
            return [
              textNode(
                positioned.rect.x + cell.offset.x,
                (cell.placement === "above"
                  ? positioned.rect.y - pageSettings.annotationGap * (layerIndex + 1)
                  : positioned.rect.y + pageSettings.annotationGap * (layerIndex + 1)) + cell.offset.y,
                cell.text,
                Math.max(8, pageSettings.fontSize - 5),
                line.direction
              )
            ];
          });
          return [textNode(positioned.rect.x, positioned.rect.y, token.text, pageSettings.fontSize, token.direction), ...cells];
        });
      });

      const spanNodes = Object.values(document.layerSpans).flatMap((span) => {
        const startLine = page.lines.find((line) => line.tokenIds.includes(span.startTokenId));
        if (!startLine) return [];
        const routed = routeLine(document, page, startLine);
        const start = routed.positionedTokens.find((item) => item.tokenId === span.startTokenId);
        const end = routed.positionedTokens.find((item) => item.tokenId === span.endTokenId);
        if (!start || !end) return [];
        const layer = layers.find((item) => item.id === span.layerId);
        const layerOffset = layer ? layers.indexOf(layer) + 1 : 1;
        const spanLeft = Math.min(start.rect.x, end.rect.x);
        const spanRight = Math.max(start.rect.x + start.rect.width, end.rect.x + end.rect.width);
        const x = span.rect?.x ?? spanLeft + span.offset.x;
        const y = span.rect?.y ?? start.rect.y - pageSettings.annotationGap * layerOffset + span.offset.y;
        const width = span.rect?.width ?? spanRight - spanLeft;
        const annotationNodes = layers.flatMap((annotationLayer, annotationLayerIndex) => {
          const cell = Object.values(document.annotationCells).find(
            (item) => item.spanId === span.id && item.layerId === annotationLayer.id
          );
          if (!cell) return [];
          return [
            textNode(
              x + cell.offset.x,
              (cell.placement === "above"
                ? y - pageSettings.annotationGap * (annotationLayerIndex + 1)
                : y + pageSettings.annotationGap * (annotationLayerIndex + 1)) + cell.offset.y,
              cell.text,
              Math.max(8, pageSettings.fontSize - 5),
              span.direction
            )
          ];
        });
        return [
          `\\put(${coord(x)},${coord(-y)}){\\makebox[${pt(width)}][c]{\\fontsize{${Math.max(
            8,
            pageSettings.fontSize - 6
          )}}{${Math.max(10, pageSettings.fontSize)}}\\selectfont ${directionalLatex(span.text, span.direction)}}}`,
          ...annotationNodes
        ];
      });

      return [
        pageIndex > 0 ? "\\newpage" : "",
        "\\setlength{\\unitlength}{1pt}",
        "\\begin{picture}(0,0)",
        document.pageNumbersVisible ? pageNumberNode(page.number, document) : "",
        ...lineNodes,
        ...spanNodes,
        ...objects,
        "\\end{picture}"
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    "\\documentclass{article}",
    "\\usepackage{fontspec}",
    "\\usepackage{graphicx}",
    "\\usepackage[absolute,overlay]{textpos}",
    "\\usepackage[paperwidth=" +
      pt(pageSettings.width) +
      ",paperheight=" +
      pt(pageSettings.height) +
      ",margin=0pt]{geometry}",
    "\\pagestyle{empty}",
    "\\TeXXeTstate=1",
    `\\setmainfont{${escapeLatex(pageSettings.fontFamily)}}`,
    "\\begin{document}",
    pages,
    "\\end{document}"
  ].join("\n");
}
