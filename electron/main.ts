import { app, BrowserWindow, shell } from "electron";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import isDev from "electron-is-dev";
import { registerIpcHandlers } from "./ipc.js";
import { readDocumentFile, readLexiconFile, writeDocumentFile, writeLexiconFile } from "./documentFiles.js";
import { createEmptyLexicon, createSampleDocument } from "../src/shared/documentFactory.js";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    title: "Interlinear",
    backgroundColor: "#f4f3ef",
    webPreferences: {
      preload: join(app.getAppPath(), "dist-electron/electron/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(join(app.getAppPath(), "dist/index.html"));
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  const packagedSmoke = await runPackagedSmokeIfRequested();
  await createWindow();

  if (packagedSmoke) {
    console.log(
      JSON.stringify({
        ...packagedSmoke,
        rendererLoaded: true,
        rendererUrl: mainWindow?.webContents.getURL() ?? ""
      })
    );
    setTimeout(() => app.quit(), 100);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

async function runPackagedSmokeIfRequested(): Promise<Record<string, unknown> | null> {
  if (process.env.INTERLINEAR_PACKAGED_SMOKE !== "1") return null;

  const root = await mkdtemp(join(tmpdir(), "interlinear-packaged-smoke-"));
  try {
    const documentPath = join(root, "smoke.iltdoc");
    const lexiconPath = join(root, "smoke.iltlex");
    const document = { ...createSampleDocument(), title: "Packaged Smoke Document" };
    const lexicon = { ...createEmptyLexicon(), name: "Packaged Smoke Lexicon" };

    await writeDocumentFile(documentPath, document);
    await writeLexiconFile(lexiconPath, lexicon);

    const reopenedDocument = await readDocumentFile(documentPath);
    const reopenedLexicon = await readLexiconFile(lexiconPath);

    return {
      packagedSmoke: true,
      documentRoundtrip: reopenedDocument.title === "Packaged Smoke Document",
      lexiconRoundtrip: reopenedLexicon.name === "Packaged Smoke Lexicon",
      documentTitle: reopenedDocument.title,
      lexiconName: reopenedLexicon.name
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
