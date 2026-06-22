import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { InterlinearDocument, PageObject } from "../src/shared/schema.js";

export function resolveExportAssetPath(assetPath: string, documentPath?: string | null): string {
  if (isAbsolute(assetPath)) return assetPath;
  if (documentPath) return resolve(dirname(documentPath), assetPath);
  return resolve(assetPath);
}

export async function resolveDocumentAssetsForExport(
  document: InterlinearDocument,
  documentPath?: string | null
): Promise<InterlinearDocument> {
  const pages = await Promise.all(
    document.pages.map(async (page) => ({
      ...page,
      pageObjects: await Promise.all(
        page.pageObjects.map(async (object): Promise<PageObject> => {
          if (object.kind !== "image") return object;
          if (!object.assetPath.trim()) return object;
          const assetPath = resolveExportAssetPath(object.assetPath, documentPath);
          await assertAssetExists(object.assetPath, assetPath);
          return { ...object, assetPath };
        })
      )
    }))
  );

  return { ...document, pages };
}

async function assertAssetExists(displayPath: string, resolvedPath: string): Promise<void> {
  try {
    await access(resolvedPath);
  } catch {
    throw new Error(`Missing export asset: ${displayPath}\nResolved path: ${resolvedPath}`);
  }
}
