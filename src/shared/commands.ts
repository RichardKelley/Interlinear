import type { InterlinearDocument } from "./schema.js";

export type DocumentCommand = {
  id: string;
  label: string;
  before: InterlinearDocument;
  after: InterlinearDocument;
};

export function createDocumentCommand(
  id: string,
  label: string,
  before: InterlinearDocument,
  after: InterlinearDocument
): DocumentCommand | null {
  if (documentsEqual(before, after)) return null;
  return { id, label, before, after };
}

export function applyCommand(command: DocumentCommand): InterlinearDocument {
  return command.after;
}

export function revertCommand(command: DocumentCommand): InterlinearDocument {
  return command.before;
}

function documentsEqual(left: InterlinearDocument, right: InterlinearDocument): boolean {
  const { updatedAt: _leftUpdatedAt, ...leftRest } = left;
  const { updatedAt: _rightUpdatedAt, ...rightRest } = right;
  return JSON.stringify(leftRest) === JSON.stringify(rightRest);
}
