import { describe, expect, it } from "vitest";
import { applyCommand, createDocumentCommand, revertCommand } from "./commands";
import { createSampleDocument } from "./documentFactory";

describe("document commands", () => {
  it("captures enough state to apply and revert document mutations", () => {
    const before = createSampleDocument();
    const after = { ...before, title: "Changed title" };
    const command = createDocumentCommand("cmd_1", "Rename document", before, after);

    expect(command).not.toBeNull();
    expect(applyCommand(command!)).toBe(after);
    expect(revertCommand(command!)).toBe(before);
  });

  it("skips commands that do not change the document", () => {
    const document = createSampleDocument();

    expect(createDocumentCommand("cmd_1", "No change", document, document)).toBeNull();
  });

  it("ignores updatedAt-only changes", () => {
    const before = createSampleDocument();
    const after = { ...before, updatedAt: "later" };

    expect(createDocumentCommand("cmd_1", "Timestamp only", before, after)).toBeNull();
  });
});
