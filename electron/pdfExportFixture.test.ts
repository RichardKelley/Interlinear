import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { documentToLatex } from "../src/shared/latex";
import { createPdfExportFixtureDocument } from "../src/shared/pdfExportFixture";
import { resolveDocumentAssetsForExport } from "./exportAssets";

const ONE_PIXEL_PNG = createOnePixelPng();

const canCompilePdf = (await commandSucceeds("latexmk", ["-version"])) && (await commandSucceeds("xelatex", ["--version"]));
const canRenderPreview = await commandSucceeds("pdftoppm", ["-v"]);

describe("PDF export fixture", () => {
  it("generates deterministic LaTeX for a Greek interlinear fixture", () => {
    const first = documentToLatex(createPdfExportFixtureDocument("assets/plate.png"));
    const second = documentToLatex(createPdfExportFixtureDocument("assets/plate.png"));

    expect(first).toBe(second);
    expect(first).toContain("what-it-was-to-be");
    expect(first).toContain("essence");
    expect(first).toContain("Side note: concept span with anchored translation.");
    expect(first).toContain("\\includegraphics[width=130.00pt,height=84.00pt,keepaspectratio]{\\detokenize{assets/plate.png}}");
  });

  const compileTest = canCompilePdf ? it : it.skip;
  compileTest(
    canCompilePdf
      ? "compiles the fixture with latexmk and writes a review artifact"
      : "skips PDF fixture compilation because latexmk or xelatex is unavailable",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "interlinear-pdf-fixture-"));
      try {
        await mkdir(join(root, "assets"), { recursive: true });
        await writeFile(join(root, "assets", "plate.png"), ONE_PIXEL_PNG);

        const documentPath = join(root, "fixture.iltdoc");
        const document = await resolveDocumentAssetsForExport(createPdfExportFixtureDocument("assets/plate.png"), documentPath);
        const texPath = join(root, "fixture.tex");
        await writeFile(texPath, documentToLatex(document), "utf8");

        await runCommand("latexmk", ["-xelatex", "-interaction=nonstopmode", "-halt-on-error", "fixture.tex"], root);
        const pdfPath = join(root, "fixture.pdf");
        const pdfStat = await stat(pdfPath);
        expect(pdfStat.size).toBeGreaterThan(100);

        const reviewPath = await createReviewArtifact(root, pdfPath, pdfStat.size);
        const reviewStat = await stat(reviewPath);
        expect(reviewStat.size).toBeGreaterThan(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000
  );
});

async function createReviewArtifact(root: string, pdfPath: string, pdfSize: number): Promise<string> {
  if (canRenderPreview) {
    await runCommand("pdftoppm", ["-png", "-singlefile", pdfPath, "fixture-page"], root);
    return join(root, "fixture-page.png");
  }

  const reviewPath = join(root, "fixture-review.txt");
  await writeFile(reviewPath, `PDF fixture compiled successfully.\nPDF bytes: ${pdfSize}\nPreview renderer: unavailable\n`, "utf8");
  return reviewPath;
}

async function commandSucceeds(command: string, args: string[], cwd?: string): Promise<boolean> {
  try {
    await runCommand(command, args, cwd);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
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

function createOnePixelPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(Buffer.from([0, 30, 90, 150, 255]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
