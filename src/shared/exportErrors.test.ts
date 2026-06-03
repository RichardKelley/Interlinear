import { describe, expect, it } from "vitest";
import { describeExportError } from "./exportErrors";

describe("export error mapping", () => {
  it("distinguishes missing image assets", () => {
    expect(describeExportError(new Error("Missing export asset: assets/a.png")).summary).toBe(
      "Export failed because an image asset could not be found."
    );
  });

  it("distinguishes missing latexmk", () => {
    expect(describeExportError(new Error("spawn latexmk ENOENT")).summary).toBe(
      "PDF export failed because latexmk is not installed or is not on PATH."
    );
  });

  it("distinguishes LaTeX compilation failures", () => {
    expect(describeExportError(new Error("LaTeX compilation failed for sample.tex with exit code 12.")).summary).toBe(
      "PDF export failed because LaTeX could not compile the generated file."
    );
  });
});
