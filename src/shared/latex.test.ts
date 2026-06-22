import { describe, expect, it } from "vitest";
import { addPageToDocument } from "./composition";
import { createSampleDocument } from "./documentFactory";
import { detokenizeLatex, documentToLatex, escapeLatex } from "./latex";
import { tokenTextMetricKey } from "./textMetrics";

describe("LaTeX export", () => {
  it("escapes reserved characters", () => {
    expect(escapeLatex("a_b & 50%")).toBe("a\\_b \\& 50\\%");
    expect(detokenizeLatex("/tmp/a b_#1.png")).toBe("\\detokenize{/tmp/a b_#1.png}");
  });

  it("exports positioned tokens, spans, and text blocks", () => {
    const tex = documentToLatex(createSampleDocument());

    expect(tex).toContain("\\setmainfont");
    expect(tex).toContain("\\begin{picture}");
    expect(tex).toContain("what-it-was-to-be");
    expect(tex).toContain("Independent note block");
    expect(tex).toContain("\\put(");
  });

  it("exports multiple pages in page order", () => {
    const base = createSampleDocument();
    const withSecondPage = addPageToDocument(base, "page_second", base.pages[0].id);
    const doc = {
      ...withSecondPage,
      pages: withSecondPage.pages.map((page) =>
        page.id === "page_second"
          ? {
              ...page,
              pageObjects: [
                {
                  id: "second_page_note",
                  kind: "textBlock" as const,
                  rect: { x: 54, y: 54, width: 180, height: 48 },
                  wrapMode: "rectangular" as const,
                  zIndex: 1,
                  content: "Second page note",
                  caption: "",
                  metadata: {}
                }
              ]
            }
          : page
      )
    };

    const tex = documentToLatex(doc);

    expect(tex.indexOf("Independent note block")).toBeLessThan(tex.indexOf("\\newpage"));
    expect(tex.indexOf("\\newpage")).toBeLessThan(tex.indexOf("Second page note"));
  });

  it("escapes font names and LaTeX-sensitive interlinear text", () => {
    const doc = createSampleDocument();
    const tokenId = doc.pages[0].lines[0].tokenIds[0];
    const span = Object.values(doc.layerSpans)[0];
    const tex = documentToLatex({
      ...doc,
      pageSettings: { ...doc.pageSettings, fontFamily: "Test & Serif_#1" },
      tokens: {
        ...doc.tokens,
        [tokenId]: { ...doc.tokens[tokenId], text: "a_b & 50%" }
      },
      layerSpans: {
        ...doc.layerSpans,
        [span.id]: { ...span, text: "form_{x} & meaning" }
      },
      annotationCells: {
        ann_sensitive: {
          id: "ann_sensitive",
          tokenId,
          layerId: doc.layers[0].id,
          text: "gloss_#1%",
          placement: "below",
          offset: { x: 0, y: 0 }
        }
      }
    });

    expect(tex).toContain("\\setmainfont{Test \\& Serif\\_\\#1}");
    expect(tex).toContain("a\\_b \\& 50\\%");
    expect(tex).toContain("form\\_\\{x\\} \\& meaning");
    expect(tex).toContain("gloss\\_\\#1\\%");
  });

  it("exports image bounds with safe asset path arguments", () => {
    const doc = createSampleDocument();
    const tex = documentToLatex({
      ...doc,
      pages: [
        {
          ...doc.pages[0],
          pageObjects: [
            {
              id: "image_object",
              kind: "image",
              rect: { x: 77, y: 88, width: 123, height: 45 },
              wrapMode: "rectangular",
              zIndex: 3,
              assetPath: "/tmp/interlinear assets/plate_#1.png",
              caption: "Plate",
              metadata: {}
            },
            ...doc.pages[0].pageObjects
          ]
        }
      ]
    });

    expect(tex).toContain("\\put(77.00,-88.00){\\includegraphics[width=123.00pt,height=45.00pt,keepaspectratio]");
    expect(tex).toContain("{\\detokenize{/tmp/interlinear assets/plate_#1.png}}}");
  });

  it("omits image placeholders without source assets", () => {
    const doc = createSampleDocument();
    const tex = documentToLatex({
      ...doc,
      pages: [
        {
          ...doc.pages[0],
          pageObjects: [
            {
              id: "placeholder_image",
              kind: "image",
              rect: { x: 77, y: 88, width: 123, height: 45 },
              wrapMode: "rectangular",
              zIndex: 3,
              assetPath: "",
              caption: "",
              metadata: {}
            },
            ...doc.pages[0].pageObjects
          ]
        }
      ]
    });

    expect(tex).not.toContain("\\includegraphics");
  });

  it("exports title, subtitle, and section blocks with semantic text styles", () => {
    const doc = createSampleDocument();
    const tex = documentToLatex({
      ...doc,
      pages: [
        {
          ...doc.pages[0],
          pageObjects: [
            {
              id: "title_block",
              kind: "titleBlock",
              rect: { x: 54, y: 54, width: 420, height: 52 },
              wrapMode: "rectangular",
              zIndex: 3,
              content: "Main Title",
              caption: "",
              metadata: {}
            },
            {
              id: "subtitle_block",
              kind: "subtitleBlock",
              rect: { x: 54, y: 112, width: 380, height: 40 },
              wrapMode: "rectangular",
              zIndex: 3,
              content: "A Subtitle",
              caption: "",
              metadata: {}
            },
            {
              id: "section_block",
              kind: "sectionBlock",
              rect: { x: 54, y: 170, width: 320, height: 34 },
              wrapMode: "rectangular",
              zIndex: 3,
              content: "Section 1",
              caption: "",
              metadata: {}
            }
          ]
        }
      ]
    });

    expect(tex).toContain("\\fontsize{22}{26}\\selectfont \\bfseries Main Title");
    expect(tex).toContain("\\fontsize{15}{19}\\selectfont \\itshape A Subtitle");
    expect(tex).toContain("\\fontsize{14}{17}\\selectfont \\bfseries Section 1");
  });

  it("omits page numbers by default and exports them when enabled", () => {
    const doc = createSampleDocument();
    const withoutPageNumbers = documentToLatex(doc);
    const withPageNumbers = documentToLatex({ ...doc, pageNumbersVisible: true });

    expect(withoutPageNumbers).not.toContain("\\makebox[0pt][c]{\\fontsize{10}{12}\\selectfont 1}");
    expect(withPageNumbers).toContain("\\makebox[0pt][c]{\\fontsize{10}{12}\\selectfont 1}");
  });

  it("exports above-source annotation placement", () => {
    const doc = createSampleDocument();
    const token = Object.values(doc.tokens)[0];
    const layer = doc.layers[0];
    const tex = documentToLatex({
      ...doc,
      annotationCells: {
        ann_above: {
          id: "ann_above",
          tokenId: token.id,
          layerId: layer.id,
          text: "the",
          placement: "above",
          offset: { x: 0, y: 0 }
        }
      }
    });

    expect(tex).toContain("the");
    expect(tex).toContain("\\put(54.00,-104.00)");
  });

  it("exports span-anchored annotations", () => {
    const doc = createSampleDocument();
    const span = Object.values(doc.layerSpans)[0];
    const tex = documentToLatex({
      ...doc,
      annotationCells: {
        ann_span: {
          id: "ann_span",
          tokenId: span.startTokenId,
          spanId: span.id,
          layerId: doc.layers[0].id,
          text: "essence",
          placement: "above",
          offset: { x: 0, y: 0 }
        }
      }
    });

    expect(tex).toContain("essence");
    expect(tex).toContain("\\put(54.00,-54.00)");
  });

  it("uses measured token widths for exported positions", () => {
    const doc = createSampleDocument();
    const line = doc.pages[0].lines[0];
    const [wideTokenId, followingTokenId] = line.tokenIds;
    const settings = { ...doc.pageSettings, width: 300, marginLeft: 20, marginRight: 20, fontFamily: "Measured Serif" };
    const page = {
      ...doc.pages[0],
      pageObjects: [
        {
          ...doc.pages[0].pageObjects[0],
          rect: { x: 110, y: line.y - 10, width: 80, height: 80 },
          wrapMode: "rectangular" as const
        }
      ]
    };
    const tex = documentToLatex({
      ...doc,
      pageSettings: settings,
      pages: [page],
      tokens: {
        ...doc.tokens,
        [wideTokenId]: {
          ...doc.tokens[wideTokenId],
          text: "ii",
          textMetrics: { [tokenTextMetricKey("ii", settings)]: 84 }
        },
        [followingTokenId]: {
          ...doc.tokens[followingTokenId],
          text: "b",
          textMetrics: { [tokenTextMetricKey("b", settings)]: 16 }
        }
      }
    });

    expect(tex).toContain("\\put(190.00,-120.00){\\fontsize{12}{14.399999999999999}\\selectfont b}");
  });

  it("exports RTL token order with directional text wrappers", () => {
    const doc = createSampleDocument();
    const line = { ...doc.pages[0].lines[0], direction: "rtl" as const };
    const firstTokenId = line.tokenIds[0];
    const tex = documentToLatex({
      ...doc,
      pages: [{ ...doc.pages[0], pageObjects: [], lines: [line] }],
      tokens: {
        ...doc.tokens,
        [firstTokenId]: {
          ...doc.tokens[firstTokenId],
          text: "שלום",
          direction: "rtl",
          textMetrics: { [tokenTextMetricKey("שלום", doc.pageSettings)]: 36 }
        }
      }
    });

    expect(tex).toContain("\\TeXXeTstate=1");
    expect(tex).toContain("\\put(522.00,-120.00){\\fontsize{12}{14.399999999999999}\\selectfont \\beginR שלום\\endR}");
  });
});
