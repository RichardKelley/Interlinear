import { contextBridge, ipcRenderer } from "electron";
import type { ImportedImage, InterlinearDocument, Lexicon, SavedDocument, SavedLexicon } from "../src/shared/schema.js";

const api = {
  pickPath: (options: Electron.OpenDialogOptions): Promise<string | null> => ipcRenderer.invoke("dialog:pickPath", options),
  openDocument: (filePath?: string | null): Promise<SavedDocument | null> => ipcRenderer.invoke("document:open", { filePath }),
  saveDocument: (document: InterlinearDocument, filePath?: string | null): Promise<SavedDocument | null> =>
    ipcRenderer.invoke("document:save", { document, filePath }),
  openLexicon: (): Promise<SavedLexicon | null> => ipcRenderer.invoke("lexicon:open"),
  saveLexicon: (lexicon: Lexicon, filePath?: string | null): Promise<SavedLexicon | null> =>
    ipcRenderer.invoke("lexicon:save", { lexicon, filePath }),
  importImage: (documentPath?: string | null): Promise<ImportedImage | null> =>
    ipcRenderer.invoke("asset:importImage", { documentPath }),
  exportTex: (
    document: InterlinearDocument,
    filePath?: string | null,
    documentPath?: string | null
  ): Promise<{ filePath: string } | null> => ipcRenderer.invoke("export:tex", { document, filePath, documentPath }),
  exportPdf: (
    document: InterlinearDocument,
    filePath?: string | null,
    documentPath?: string | null
  ): Promise<{ texPath: string; pdfPath: string; output: string } | null> =>
    ipcRenderer.invoke("export:pdf", { document, filePath, documentPath }),
  fileToAssetUrl: (filePath: string): Promise<string> => ipcRenderer.invoke("file:toAssetUrl", filePath),
  resolveAssetUrl: (documentPath: string, assetPath: string): Promise<string> =>
    ipcRenderer.invoke("file:resolveAssetUrl", { documentPath, assetPath })
};

contextBridge.exposeInMainWorld("interlinear", api);

export type InterlinearApi = typeof api;
