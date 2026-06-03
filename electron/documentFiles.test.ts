import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyLexicon, createSampleDocument } from "../src/shared/documentFactory";
import { readDocumentFile, readLexiconFile, writeDocumentFile, writeLexiconFile } from "./documentFiles";

describe("document file persistence", () => {
  let root: string | null = null;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it("saves and opens a document roundtrip through temp files", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-doc-"));
    const filePath = join(root, "sample.iltdoc");
    const document = {
      ...createSampleDocument(),
      title: "Roundtrip"
    };

    const saved = await writeDocumentFile(filePath, document);
    const opened = await readDocumentFile(filePath);

    expect(opened.title).toBe("Roundtrip");
    expect(opened.id).toBe(document.id);
    expect(saved.updatedAt).toBe(opened.updatedAt);
  });

  it("saves and opens a lexicon roundtrip through temp files", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-lex-"));
    const filePath = join(root, "project.iltlex");
    const lexicon = {
      ...createEmptyLexicon(),
      name: "Roundtrip Lexicon"
    };

    await writeLexiconFile(filePath, lexicon);
    const opened = await readLexiconFile(filePath);

    expect(opened.name).toBe("Roundtrip Lexicon");
    expect(opened.entries.lex_to_ti_en_einai.lemma).toBe("το τι ην ειναι");
  });

  it("throws clear document validation errors from malformed files", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-invalid-doc-"));
    const filePath = join(root, "bad.iltdoc");
    await writeFile(filePath, JSON.stringify({ ...createSampleDocument(), title: 12 }), "utf8");

    await expect(readDocumentFile(filePath)).rejects.toThrow(/Document schema validation failed at title/);
  });

  it("throws clear lexicon validation errors from malformed files", async () => {
    root = await mkdtemp(join(tmpdir(), "interlinear-invalid-lex-"));
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

    await expect(readLexiconFile(filePath)).rejects.toThrow(/entries\.bad\.lemma/);
  });
});
