import { z, ZodError } from "zod";
import {
  APP_SCHEMA_VERSION,
  DocumentSchema,
  InterlinearDocument,
  Lexicon,
  LexiconSchema
} from "./schema.js";

type FileKind = "document" | "lexicon";

export type FileValidationCode = "invalid-json" | "invalid-shape" | "unsupported-version" | "validation";

export class InterlinearFileValidationError extends Error {
  readonly code: FileValidationCode;
  readonly kind: FileKind;

  constructor(kind: FileKind, code: FileValidationCode, message: string) {
    super(message);
    this.name = "InterlinearFileValidationError";
    this.kind = kind;
    this.code = code;
  }
}

export function parseDocumentFileContent(content: string): InterlinearDocument {
  return parseFileContent(content, "document", DocumentSchema);
}

export function parseLexiconFileContent(content: string): Lexicon {
  return parseFileContent(content, "lexicon", LexiconSchema);
}

export function describeFileOpenError(error: unknown, kind: FileKind): { summary: string; detail: string } {
  const detail = messageFromError(error);
  const normalized = stripIpcErrorPrefix(detail);
  const noun = kind === "document" ? "document" : "lexicon";

  if (isMissingFileError(normalized)) {
    return {
      summary: `Cannot open ${noun}: file was not found.`,
      detail: normalized
    };
  }

  if (normalized.includes("unsupported schema version") || normalized.includes("newer schema version")) {
    return {
      summary: `Cannot open ${noun}: unsupported file version.`,
      detail: normalized
    };
  }

  if (normalized.includes("schema validation failed") || normalized.includes("must contain a JSON object")) {
    return {
      summary: `Cannot open ${noun}: file validation failed.`,
      detail: normalized
    };
  }

  if (normalized.includes("valid JSON")) {
    return {
      summary: `Cannot open ${noun}: file is not valid JSON.`,
      detail: normalized
    };
  }

  return {
    summary: `Cannot open ${noun}.`,
    detail: normalized
  };
}

export function isMissingFileError(error: unknown): boolean {
  return /ENOENT|no such file|not found/i.test(messageFromError(error));
}

function parseFileContent<TSchema extends z.ZodTypeAny>(content: string, kind: FileKind, schema: TSchema): z.infer<TSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new InterlinearFileValidationError(kind, "invalid-json", `${labelForKind(kind)} file is not valid JSON: ${messageFromError(error)}`);
  }

  const migrated = migrateKnownFileVersion(raw, kind);
  try {
    return schema.parse(migrated);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new InterlinearFileValidationError(
        kind,
        "validation",
        `${labelForKind(kind)} schema validation failed at ${formatZodIssues(error)}`
      );
    }
    throw error;
  }
}

function migrateKnownFileVersion(value: unknown, kind: FileKind): unknown {
  if (!isRecord(value)) {
    throw new InterlinearFileValidationError(kind, "invalid-shape", `${labelForKind(kind)} file must contain a JSON object.`);
  }

  const rawVersion = value.schemaVersion;
  if (rawVersion === APP_SCHEMA_VERSION) return value;

  if (rawVersion === undefined || rawVersion === 0) {
    return {
      ...value,
      schemaVersion: APP_SCHEMA_VERSION
    };
  }

  if (typeof rawVersion === "number" && rawVersion > APP_SCHEMA_VERSION) {
    throw new InterlinearFileValidationError(
      kind,
      "unsupported-version",
      `${labelForKind(kind)} uses newer schema version ${rawVersion}; this app supports version ${APP_SCHEMA_VERSION}.`
    );
  }

  throw new InterlinearFileValidationError(
    kind,
    "unsupported-version",
    `${labelForKind(kind)} has unsupported schema version ${String(rawVersion)}.`
  );
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function labelForKind(kind: FileKind): string {
  return kind === "document" ? "Document" : "Lexicon";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function stripIpcErrorPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/u, "");
}
