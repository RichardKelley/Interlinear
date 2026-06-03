import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSampleDocument } from "../src/shared/documentFactory";
import { resolveDocumentAssetsForExport, resolveExportAssetPath } from "./exportAssets";

describe("export asset resolution", () => {
  it("resolves relative assets from the document directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "interlinear-export-"));
    const documentPath = join(root, "sample.iltdoc");
    const assetPath = "assets/image one.png";
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, assetPath), "image");
    const doc = withImageAsset(assetPath);

    const resolved = await resolveDocumentAssetsForExport(doc, documentPath);

    expect(resolved.pages[0].pageObjects[0]).toMatchObject({
      kind: "image",
      assetPath: join(root, assetPath)
    });
  });

  it("preserves absolute asset paths", () => {
    expect(resolveExportAssetPath("/tmp/interlinear-image.png", "/elsewhere/doc.iltdoc")).toBe("/tmp/interlinear-image.png");
  });

  it("reports missing assets with resolved paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "interlinear-export-missing-"));

    await expect(resolveDocumentAssetsForExport(withImageAsset("assets/missing.png"), join(root, "sample.iltdoc"))).rejects.toThrow(
      /Missing export asset: assets\/missing\.png/
    );
  });
});

function withImageAsset(assetPath: string) {
  const doc = createSampleDocument();
  return {
    ...doc,
    pages: [
      {
        ...doc.pages[0],
        pageObjects: [
          {
            id: "image_object",
            kind: "image" as const,
            rect: { x: 120, y: 90, width: 160, height: 100 },
            wrapMode: "rectangular" as const,
            zIndex: 1,
            assetPath,
            caption: "Plate #1",
            metadata: {}
          }
        ]
      }
    ]
  };
}
