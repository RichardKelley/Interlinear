import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseDocumentFileContent, parseLexiconFileContent } from "../src/shared/fileValidation.js";
import {
  DocumentSchema,
  InterlinearDocument,
  Lexicon,
  LexiconSchema
} from "../src/shared/schema.js";

export async function readDocumentFile(filePath: string): Promise<InterlinearDocument> {
  return parseDocumentFileContent(await readFile(filePath, "utf8"));
}

export async function writeDocumentFile(filePath: string, document: InterlinearDocument): Promise<InterlinearDocument> {
  const parsed = DocumentSchema.parse({
    ...document,
    updatedAt: new Date().toISOString()
  });
  await writeJson(filePath, parsed);
  return parsed;
}

export async function readLexiconFile(filePath: string): Promise<Lexicon> {
  return parseLexiconFileContent(await readFile(filePath, "utf8"));
}

export async function writeLexiconFile(filePath: string, lexicon: Lexicon): Promise<Lexicon> {
  const parsed = LexiconSchema.parse({
    ...lexicon,
    updatedAt: new Date().toISOString()
  });
  await writeJson(filePath, parsed);
  return parsed;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
