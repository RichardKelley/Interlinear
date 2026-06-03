import { z } from "zod";

export const APP_SCHEMA_VERSION = 1;
export const DOCUMENT_EXTENSION = "iltdoc";
export const LEXICON_EXTENSION = "iltlex";

export const DirectionSchema = z.enum(["ltr", "rtl"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
});
export type Rect = z.infer<typeof RectSchema>;

export const OffsetSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0)
});
export type Offset = z.infer<typeof OffsetSchema>;

export const PageSettingsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  marginTop: z.number().min(0),
  marginRight: z.number().min(0),
  marginBottom: z.number().min(0),
  marginLeft: z.number().min(0),
  unit: z.literal("pt").default("pt"),
  fontFamily: z.string().min(1).default("Times New Roman"),
  fontSize: z.number().positive().default(12),
  lineGap: z.number().min(0).default(18),
  annotationGap: z.number().min(0).default(17)
});
export type PageSettings = z.infer<typeof PageSettingsSchema>;

export const TokenSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  normalized: z.string(),
  direction: DirectionSchema.default("ltr"),
  lineId: z.string().min(1),
  offset: OffsetSchema.default({ x: 0, y: 0 }),
  textMetrics: z.record(z.number().positive()).default({}),
  lexiconEntryId: z.string().optional()
});
export type Token = z.infer<typeof TokenSchema>;

export const AnnotationCellSchema = z.object({
  id: z.string().min(1),
  tokenId: z.string().min(1),
  spanId: z.string().min(1).optional(),
  layerId: z.string().min(1),
  text: z.string(),
  placement: z.enum(["above", "below"]).default("below"),
  lexiconEntryId: z.string().optional(),
  offset: OffsetSchema.default({ x: 0, y: 0 })
});
export type AnnotationCell = z.infer<typeof AnnotationCellSchema>;

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["literal", "concept", "translation", "syntax", "notes", "custom"]),
  visible: z.boolean().default(true),
  direction: DirectionSchema.default("ltr"),
  order: z.number().int().nonnegative()
});
export type Layer = z.infer<typeof LayerSchema>;

export const LayerSpanSchema = z.object({
  id: z.string().min(1),
  layerId: z.string().min(1),
  startTokenId: z.string().min(1),
  endTokenId: z.string().min(1),
  text: z.string(),
  direction: DirectionSchema.default("ltr"),
  lexiconEntryId: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  parentSpanId: z.string().optional(),
  rect: RectSchema.optional(),
  offset: OffsetSchema.default({ x: 0, y: 0 })
});
export type LayerSpan = z.infer<typeof LayerSpanSchema>;

export const InterlinearLineSchema = z.object({
  id: z.string().min(1),
  tokenIds: z.array(z.string()).default([]),
  y: z.number(),
  offset: OffsetSchema.default({ x: 0, y: 0 }),
  direction: DirectionSchema.default("ltr")
});
export type InterlinearLine = z.infer<typeof InterlinearLineSchema>;

export const PageObjectSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("image"),
    rect: RectSchema,
    wrapMode: z.enum(["rectangular", "none"]).default("rectangular"),
    zIndex: z.number().int().default(1),
    assetPath: z.string().min(1),
    caption: z.string().optional(),
    metadata: z.record(z.string()).default({})
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("textBlock"),
    rect: RectSchema,
    wrapMode: z.enum(["rectangular", "none"]).default("rectangular"),
    zIndex: z.number().int().default(1),
    content: z.string().default(""),
    caption: z.string().optional(),
    metadata: z.record(z.string()).default({})
  })
]);
export type PageObject = z.infer<typeof PageObjectSchema>;

export const PageSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  lines: z.array(InterlinearLineSchema).default([]),
  pageObjects: z.array(PageObjectSchema).default([])
});
export type Page = z.infer<typeof PageSchema>;

export const DocumentSchema = z.object({
  schemaVersion: z.literal(APP_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  sourceLanguage: z.string().default(""),
  direction: DirectionSchema.default("ltr"),
  pageSettings: PageSettingsSchema,
  lineGuidesVisible: z.boolean().default(true),
  marginGuidesVisible: z.boolean().default(false),
  annotationHandlesVisible: z.boolean().default(true),
  pageNumbersVisible: z.boolean().default(false),
  layers: z.array(LayerSchema).default([]),
  tokens: z.record(TokenSchema).default({}),
  annotationCells: z.record(AnnotationCellSchema).default({}),
  layerSpans: z.record(LayerSpanSchema).default({}),
  pages: z.array(PageSchema).default([]),
  linkedLexiconPath: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type InterlinearDocument = z.infer<typeof DocumentSchema>;

export const GlossSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  note: z.string().optional()
});
export type Gloss = z.infer<typeof GlossSchema>;

export const LexiconEntrySchema = z.object({
  id: z.string().min(1),
  lemma: z.string().min(1),
  normalizedForms: z.array(z.string()).default([]),
  glosses: z.array(GlossSchema).default([]),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  kind: z.enum(["token", "concept"]).default("token")
});
export type LexiconEntry = z.infer<typeof LexiconEntrySchema>;

export const LexiconSchema = z.object({
  schemaVersion: z.literal(APP_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  language: z.string().default(""),
  entries: z.record(LexiconEntrySchema).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Lexicon = z.infer<typeof LexiconSchema>;

export type ImportedImage = {
  assetPath: string;
  absolutePath: string;
};

export type SavedDocument = {
  document: InterlinearDocument;
  filePath: string;
};

export type SavedLexicon = {
  lexicon: Lexicon;
  filePath: string;
};
