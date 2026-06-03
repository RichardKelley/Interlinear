import { dialog, ipcMain } from "electron";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, extname, join, basename, resolve, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  DOCUMENT_EXTENSION,
  DocumentSchema,
  ImportedImage,
  InterlinearDocument,
  LEXICON_EXTENSION,
  Lexicon,
  SavedDocument,
  SavedLexicon
} from "../src/shared/schema.js";
import { documentToLatex } from "../src/shared/latex.js";
import { resolveDocumentAssetsForExport } from "./exportAssets.js";
import { readDocumentFile, readLexiconFile, writeDocumentFile, writeLexiconFile } from "./documentFiles.js";

export function registerIpcHandlers(): void {
  ipcMain.handle("dialog:pickPath", async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("document:open", async (_event, payload?: { filePath?: string | null }): Promise<SavedDocument | null> => {
    const filePath =
      payload?.filePath ??
      (await chooseOpenPath("Open Interlinear Document", "Interlinear Documents", DOCUMENT_EXTENSION));
    if (!filePath) return null;
    return { document: await readDocumentFile(filePath), filePath };
  });

  ipcMain.handle(
    "document:save",
    async (_event, payload: { document: InterlinearDocument; filePath?: string | null }): Promise<SavedDocument | null> => {
      const filePath = payload.filePath ?? (await chooseSavePath("Save Interlinear Document", DOCUMENT_EXTENSION));
      if (!filePath) return null;
      const document = await materializeDocumentAssetsForSave(payload.document, filePath);
      return { document: await writeDocumentFile(filePath, document), filePath };
    }
  );

  ipcMain.handle("lexicon:open", async (): Promise<SavedLexicon | null> => {
    const filePath = await chooseOpenPath("Open Lexicon", "Interlinear Lexicons", LEXICON_EXTENSION);
    if (!filePath) return null;
    return { lexicon: await readLexiconFile(filePath), filePath };
  });

  ipcMain.handle("lexicon:save", async (_event, payload: { lexicon: Lexicon; filePath?: string | null }) => {
    const filePath = payload.filePath ?? (await chooseSavePath("Save Lexicon", LEXICON_EXTENSION));
    if (!filePath) return null;
    return { lexicon: await writeLexiconFile(filePath, payload.lexicon), filePath };
  });

  ipcMain.handle(
    "asset:importImage",
    async (_event, payload: { documentPath?: string | null }): Promise<ImportedImage | null> => {
      const result = await dialog.showOpenDialog({
        title: "Import Image",
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf"] }]
      });
      if (result.canceled || !result.filePaths[0]) return null;

      const sourcePath = result.filePaths[0];
      if (!payload.documentPath) {
        return {
          assetPath: sourcePath,
          absolutePath: sourcePath
        };
      }
      const baseDir = dirname(payload.documentPath);
      const assetsDir = join(baseDir, "assets");
      await mkdir(assetsDir, { recursive: true });
      const destination = join(assetsDir, uniqueAssetName(sourcePath));
      await copyFile(sourcePath, destination);
      return {
        assetPath: `assets/${basename(destination)}`,
        absolutePath: destination
      };
    }
  );

  ipcMain.handle(
    "export:tex",
    async (_event, payload: { document: InterlinearDocument; documentPath?: string | null; filePath?: string | null }) => {
      const document = DocumentSchema.parse(payload.document);
      const filePath = payload.filePath ?? (await chooseSavePath("Export LaTeX", "tex"));
      if (!filePath) return null;
      await writeFile(filePath, documentToLatex(await resolveDocumentAssetsForExport(document, payload.documentPath)), "utf8");
      return { filePath };
    }
  );

  ipcMain.handle(
    "export:pdf",
    async (_event, payload: { document: InterlinearDocument; documentPath?: string | null; filePath?: string | null }) => {
      const document = DocumentSchema.parse(payload.document);
      const pdfPath = payload.filePath ?? (await chooseSavePath("Export PDF", "pdf"));
      if (!pdfPath) return null;
      const texPath = pdfPath.replace(/\.pdf$/i, ".tex");
      await writeFile(texPath, documentToLatex(await resolveDocumentAssetsForExport(document, payload.documentPath)), "utf8");
      const output = await runLatexmk(texPath);
      return {
        texPath,
        pdfPath,
        output
      };
    }
  );

  ipcMain.handle("file:toAssetUrl", (_event, filePath: string) => pathToFileURL(filePath).toString());
  ipcMain.handle("file:resolveAssetUrl", (_event, payload: { documentPath: string; assetPath: string }) => {
    return pathToFileURL(resolve(dirname(payload.documentPath), payload.assetPath)).toString();
  });
}

async function materializeDocumentAssetsForSave(
  document: InterlinearDocument,
  filePath: string
): Promise<InterlinearDocument> {
  const assetsDir = join(dirname(filePath), "assets");
  let changed = false;
  const pages = await Promise.all(
    document.pages.map(async (page) => ({
      ...page,
      pageObjects: await Promise.all(
        page.pageObjects.map(async (object) => {
          if (object.kind !== "image" || !isAbsolute(object.assetPath)) return object;
          await mkdir(assetsDir, { recursive: true });
          const destination = join(assetsDir, uniqueAssetName(object.assetPath));
          await copyFile(object.assetPath, destination);
          changed = true;
          return {
            ...object,
            assetPath: `assets/${basename(destination)}`
          };
        })
      )
    }))
  );

  return changed ? { ...document, pages } : document;
}

async function chooseOpenPath(title: string, name: string, extension: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openFile"],
    filters: [{ name, extensions: [extension] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

async function chooseSavePath(title: string, extension: string): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath.endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`;
}

function uniqueAssetName(filePath: string): string {
  const extension = extname(filePath);
  const stem = basename(filePath, extension).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
  return `${stem || "asset"}-${Date.now()}${extension}`;
}

function runLatexmk(texPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("latexmk", ["-xelatex", "-interaction=nonstopmode", "-halt-on-error", texPath], {
      cwd: dirname(texPath)
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("latexmk is not installed or is not on PATH. Install a TeX distribution such as MacTeX and try again."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`LaTeX compilation failed for ${basename(texPath)} with exit code ${code}.\n\n${output}`));
      }
    });
  });
}
