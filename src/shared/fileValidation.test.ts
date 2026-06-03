import { describe, expect, it } from "vitest";
import { createEmptyLexicon, createSampleDocument } from "./documentFactory";
import { describeFileOpenError, parseDocumentFileContent, parseLexiconFileContent } from "./fileValidation";

describe("file validation", () => {
  it("reports document schema errors with the failing path", () => {
    const document = {
      ...createSampleDocument(),
      title: 42
    };

    expect(() => parseDocumentFileContent(JSON.stringify(document))).toThrow(/Document schema validation failed at title/);
  });

  it("reports lexicon schema errors with the failing path", () => {
    const lexicon = {
      ...createEmptyLexicon(),
      entries: {
        bad: {
          id: "bad",
          lemma: "",
          glosses: []
        }
      }
    };

    expect(() => parseLexiconFileContent(JSON.stringify(lexicon))).toThrow(/entries\.bad\.lemma/);
  });

  it("rejects unsupported future document versions distinctly", () => {
    const document = {
      ...createSampleDocument(),
      schemaVersion: 99
    };

    expect(() => parseDocumentFileContent(JSON.stringify(document))).toThrow(/newer schema version 99/);
  });

  it("migrates known legacy documents before validation", () => {
    const document = createSampleDocument();
    const {
      schemaVersion: _schemaVersion,
      pageNumbersVisible: _pageNumbersVisible,
      marginGuidesVisible: _marginGuidesVisible,
      annotationHandlesVisible: _annotationHandlesVisible,
      ...legacyDocument
    } = document;

    const parsed = parseDocumentFileContent(JSON.stringify(legacyDocument));

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.pageNumbersVisible).toBe(false);
    expect(parsed.marginGuidesVisible).toBe(false);
    expect(parsed.annotationHandlesVisible).toBe(true);
  });

  it("migrates known legacy lexicons before validation", () => {
    const lexicon = {
      ...createEmptyLexicon(),
      schemaVersion: 0
    };

    const parsed = parseLexiconFileContent(JSON.stringify(lexicon));

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.entries.lex_to_ti_en_einai.kind).toBe("concept");
  });

  it("describes common open errors for the UI", () => {
    expect(describeFileOpenError(new Error("Document uses newer schema version 2"), "document").summary).toBe(
      "Cannot open document: unsupported file version."
    );
    expect(describeFileOpenError(new Error("ENOENT: no such file"), "document").summary).toBe(
      "Cannot open document: file was not found."
    );
    expect(describeFileOpenError(new Error("Lexicon schema validation failed at entries.bad.lemma"), "lexicon").summary).toBe(
      "Cannot open lexicon: file validation failed."
    );
  });
});
