export type ExportErrorInfo = {
  summary: string;
  detail: string;
};

export function describeExportError(error: unknown): ExportErrorInfo {
  const detail = error instanceof Error ? error.message : String(error || "Unknown export error.");
  const lower = detail.toLowerCase();

  if (lower.includes("missing export asset")) {
    return {
      summary: "Export failed because an image asset could not be found.",
      detail
    };
  }

  if (lower.includes("latexmk") && (lower.includes("not installed") || lower.includes("enoent") || lower.includes("not on path"))) {
    return {
      summary: "PDF export failed because latexmk is not installed or is not on PATH.",
      detail
    };
  }

  if (lower.includes("latex compilation failed")) {
    return {
      summary: "PDF export failed because LaTeX could not compile the generated file.",
      detail
    };
  }

  return {
    summary: `Export failed: ${detail.slice(0, 180)}`,
    detail
  };
}
