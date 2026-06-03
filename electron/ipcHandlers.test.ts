import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyLexicon, createSampleDocument } from "../src/shared/documentFactory";
import { createPdfExportFixtureDocument } from "../src/shared/pdfExportFixture";
import type { InterlinearDocument } from "../src/shared/schema";
import { registerIpcHandlers } from "./ipc";

type Handler = (_event: unknown, payload?: unknown) => unknown;

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      })
    }
  };
});

vi.mock("electron", () => ({
  dialog: electronMock.dialog,
  ipcMain: electronMock.ipcMain
}));

const canCompilePdf = (await commandSucceeds("latexmk", ["-version"])) && (await commandSucceeds("xelatex", ["--version"]));

describe("Electron IPC handlers", () => {
  let root: string | null = null;

  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.dialog.showOpenDialog.mockReset();
    electronMock.dialog.showSaveDialog.mockReset();
    electronMock.ipcMain.handle.mockClear();
    registerIpcHandlers();
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it("saves and opens documents through the document IPC handlers", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-doc-"));
    const filePath = join(root, "sample.iltdoc");
    const document = {
      ...createSampleDocument(),
      title: "IPC Document"
    };

    const saved = await callHandler("document:save", { document, filePath });
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] });
    const opened = await callHandler("document:open");

    expect(saved).toMatchObject({ filePath, document: { title: "IPC Document" } });
    expect(opened).toMatchObject({ filePath, document: { title: "IPC Document" } });
  });

  it("saves and opens lexicons through the lexicon IPC handlers", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-lex-"));
    const filePath = join(root, "project.iltlex");
    const lexicon = {
      ...createEmptyLexicon(),
      name: "IPC Lexicon"
    };

    const saved = await callHandler("lexicon:save", { lexicon, filePath });
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] });
    const opened = await callHandler("lexicon:open");

    expect(saved).toMatchObject({ filePath, lexicon: { name: "IPC Lexicon" } });
    expect(opened).toMatchObject({ filePath, lexicon: { name: "IPC Lexicon" } });
  });

  it("imports images for unsaved documents without opening a save path first", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-unsaved-image-"));
    const sourcePath = join(root, "plate.png");
    await writeFile(sourcePath, "image");
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [sourcePath] });

    const imported = await callHandler("asset:importImage", { documentPath: null });

    expect(electronMock.dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(imported).toEqual({
      assetPath: sourcePath,
      absolutePath: sourcePath
    });
  });

  it("copies absolute image assets into the sibling assets folder when saving", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-save-image-"));
    const sourcePath = join(root, "source image.png");
    const filePath = join(root, "project", "sample.iltdoc");
    await writeFile(sourcePath, "image");
    const baseDocument = createSampleDocument();
    const document = {
      ...baseDocument,
      pages: [
        {
          ...baseDocument.pages[0],
          pageObjects: [
            {
              id: "obj_image",
              kind: "image" as const,
              rect: { x: 10, y: 20, width: 80, height: 60 },
              wrapMode: "rectangular" as const,
              zIndex: 2,
              assetPath: sourcePath,
              caption: "",
              metadata: {}
            }
          ]
        }
      ]
    };

    const saved = (await callHandler("document:save", { document, filePath })) as { document: InterlinearDocument; filePath: string };
    const savedObject = saved.document.pages[0].pageObjects[0];

    expect(savedObject).toMatchObject({ kind: "image" });
    if (savedObject.kind !== "image") throw new Error("Expected image page object");
    expect(savedObject.assetPath).toMatch(/^assets\/source-image-\d+\.png$/);
    await expect(readFile(join(root, "project", savedObject.assetPath), "utf8")).resolves.toBe("image");
  });

  it("surfaces malformed document errors through the document open handler", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-invalid-doc-"));
    const filePath = join(root, "bad.iltdoc");
    await writeFile(filePath, JSON.stringify({ ...createSampleDocument(), title: 99 }), "utf8");
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] });

    await expect(callHandler("document:open")).rejects.toThrow(/Document schema validation failed at title/);
  });

  it("surfaces malformed lexicon errors through the lexicon open handler", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-invalid-lex-"));
    const filePath = join(root, "bad.iltlex");
    await writeFile(
      filePath,
      JSON.stringify({
        ...createEmptyLexicon(),
        entries: {
          bad: {
            id: "bad",
            lemma: "",
            glosses: []
          }
        }
      }),
      "utf8"
    );
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] });

    await expect(callHandler("lexicon:open")).rejects.toThrow(/entries\.bad\.lemma/);
  });

  it("exports LaTeX through the export.tex IPC handler", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-ipc-tex-"));
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "plate.png"), "asset");
    const documentPath = join(root, "fixture.iltdoc");
    const filePath = join(root, "fixture.tex");
    const document = createPdfExportFixtureDocument("assets/plate.png");

    const result = await callHandler("export:tex", { document, documentPath, filePath });
    const tex = await readFile(filePath, "utf8");

    expect(result).toEqual({ filePath });
    expect(tex).toContain("what-it-was-to-be");
    expect(tex).toContain("Side note: concept span with anchored translation.");
    expect(tex).toContain("\\includegraphics");
    expect(tex).toContain("\\detokenize");
  });

  const pdfTest = canCompilePdf ? it : it.skip;
  pdfTest(
    canCompilePdf
      ? "exports a non-empty PDF through the export.pdf IPC handler"
      : "skips export.pdf handler compilation because latexmk or xelatex is unavailable",
    async () => {
      root = await mkdtemp(join(tmpdir(), "interlinear-ipc-pdf-"));
      const filePath = join(root, "fixture.pdf");
      const documentPath = join(root, "fixture.iltdoc");
      const result = (await callHandler("export:pdf", {
        document: createAsciiExportDocument(),
        documentPath,
        filePath
      })) as { pdfPath: string; texPath: string };

      const pdfStat = await stat(result.pdfPath);
      const texStat = await stat(result.texPath);
      expect(pdfStat.size).toBeGreaterThan(100);
      expect(texStat.size).toBeGreaterThan(0);
    },
    60_000
  );
});

async function callHandler(channel: string, payload?: unknown): Promise<unknown> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler({}, payload);
}

function createAsciiExportDocument(): InterlinearDocument {
  const document = createSampleDocument();
  const tokenIds = Object.keys(document.tokens);
  const tokenTexts = ["logos", "is", "the", "term", "we", "study", "."];
  const tokens = Object.fromEntries(
    tokenIds.map((tokenId, index) => [
      tokenId,
      {
        ...document.tokens[tokenId],
        text: tokenTexts[index] ?? "term",
        normalized: tokenTexts[index] ?? "term",
        textMetrics: {}
      }
    ])
  );

  return {
    ...document,
    title: "ASCII Export Fixture",
    sourceLanguage: "English",
    pageSettings: {
      ...document.pageSettings,
      fontFamily: "Times"
    },
    tokens,
    layerSpans: {
      span_ascii_concept: {
        ...document.layerSpans.span_aristotle_concept,
        id: "span_ascii_concept",
        text: "studied term"
      }
    },
    pages: [
      {
        ...document.pages[0],
        pageObjects: [
          {
            id: "obj_ascii_note",
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
    ]
  };
}

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  try {
    await runCommand(command, args);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output || `${command} exited with code ${code}`));
      }
    });
  });
}
