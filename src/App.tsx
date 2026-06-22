import {
  Braces,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FilePlus,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Layers,
  Plus,
  RotateCcw,
  Save,
  SquarePen,
  Type,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  Fragment,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { applyCommand, createDocumentCommand, DocumentCommand, revertCommand } from "./shared/commands";
import {
  addLineAtDocument,
  addLineToDocument,
  addPageToDocument,
  addWordBoxToLineDocument,
  addWordBoxToDocument,
  insertWordBoxAfterToken,
  LINE_SNAP_DISTANCE,
  moveLineWithCollisionConstraints,
  moveTokenWithCollisionConstraints,
  normalizeTokenLayout,
  snapTokenToNearestLine
} from "./shared/composition";
import {
  ANNOTATION_CONNECTOR_LENGTH,
  annotationBoxFontSize,
  annotationBoxRect,
  annotationEntriesForSpan,
  annotationEntriesForToken,
  type RenderedAnnotation,
  wordBoxRectFromPositioned
} from "./shared/collision";
import { createEmptyDocument, createEmptyLexicon } from "./shared/documentFactory";
import { describeExportError } from "./shared/exportErrors";
import { describeFileOpenError, isMissingFileError } from "./shared/fileValidation";
import { createId } from "./shared/ids";
import { routeLine, sourceLineBoxHeight } from "./shared/layout";
import { findLineSuggestions, findTokenSuggestions, LexiconSuggestion } from "./shared/lexicon";
import { normalizeTerm } from "./shared/normalization";
import {
  PAGE_OBJECT_MIN_HEIGHT,
  PAGE_OBJECT_MIN_WIDTH,
  PageObjectResizeHandle,
  resizePageObjectRect,
  sanitizePageObjectRect
} from "./shared/pageObjects";
import { applyTokenTextMeasurements, measureDocumentTokenWidths, measureTextWithCanvas } from "./shared/textMetrics";
import { mergeTokens, splitToken } from "./shared/tokenize";
import type {
  AnnotationCell,
  InterlinearDocument,
  InterlinearLine,
  Layer,
  LayerSpan,
  Lexicon,
  LexiconEntry,
  Page,
  PageObject,
  PageSettings,
  Rect,
  Token
} from "./shared/schema";
import { canAddLayerSpan, tokenOrder } from "./shared/spans";

type Selection =
  | { kind: "token"; id: string }
  | { kind: "line"; id: string }
  | { kind: "span"; id: string }
  | { kind: "annotation"; id: string }
  | { kind: "pageObject"; id: string }
  | null;

type InspectorTab = "selection" | "document" | "layers" | "lexicon";
type TextPageObject = Exclude<PageObject, { kind: "image" }>;
type TextPageObjectKind = TextPageObject["kind"];
type InlineEditablePageObject = Extract<TextPageObject, { kind: "titleBlock" | "subtitleBlock" | "sectionBlock" }>;
type PlacementMode = "word" | "line" | "image" | TextPageObjectKind | "span";

type AssetUrls = Record<string, string>;

type RecentDocument = {
  filePath: string;
  openedAt: string;
};

type MarginGuideEdge = "left" | "right" | "top" | "bottom";
type AnnotationPlacement = AnnotationCell["placement"];
type LayerKind = Layer["kind"];
type DragStartKind = Exclude<DragState["kind"], "pageObjectResize">;

type SpanDraft = {
  layerId: string;
  text: string;
  notes: string;
  tags: string;
  lexiconEntryId: string;
};

type MarginDragOrigin = Pick<
  PageSettings,
  "width" | "height" | "marginTop" | "marginRight" | "marginBottom" | "marginLeft"
>;

type DragState =
  | {
      kind: "token";
      id: string;
      startX: number;
      startY: number;
      original: { x: number; y: number };
      active: boolean;
    }
  | {
      kind: "line";
      id: string;
      startX: number;
      startY: number;
      original: { x: number; y: number; lineY: number };
    }
  | {
      kind: "annotation";
      id: string;
      startX: number;
      startY: number;
      original: { x: number; y: number };
    }
  | {
      kind: "span";
      id: string;
      startX: number;
      startY: number;
      original: { x: number; y: number; rectX?: number; rectY?: number };
    }
  | {
      kind: "pageObject";
      id: string;
      startX: number;
      startY: number;
      original: { x: number; y: number };
    }
  | {
      kind: "pageObjectResize";
      id: string;
      handle: PageObjectResizeHandle;
      startX: number;
      startY: number;
      original: Rect;
    }
  | {
      kind: "marginGuide";
      id: MarginGuideEdge;
      startX: number;
      startY: number;
      original: MarginDragOrigin;
    };

const TOOLTIP_DELAY = 250;
const DRAG_START_THRESHOLD = 4;
const MIN_PAGE_DIMENSION = 144;
const MIN_CONTENT_SIZE = 72;
const LAYER_KIND_OPTIONS: LayerKind[] = ["literal", "concept", "translation", "syntax", "notes", "custom"];
const RECENT_DOCUMENTS_STORAGE_KEY = "interlinear.recentDocuments.v1";
const RECENT_DOCUMENT_LIMIT = 8;
const DEFAULT_ZOOM = 1.5;
const ZOOM_MIN = DEFAULT_ZOOM * 0.5;
const ZOOM_MAX = DEFAULT_ZOOM * 2;
const ZOOM_STEP = DEFAULT_ZOOM * 0.1;
const TEXT_PAGE_OBJECT_CONFIG: Record<
  TextPageObjectKind,
  {
    className: string;
    contentLabel: string;
    defaultContent: string;
    defaultHeight: number;
    defaultWidth: number;
    label: string;
    placementLabel: string;
    shortLabel: string;
    constrainToMargins: boolean;
  }
> = {
  textBlock: {
    className: "body-text-block",
    contentLabel: "Text",
    defaultContent: "Independent text block",
    defaultHeight: 105,
    defaultWidth: 190,
    label: "text block",
    placementLabel: "Add text block",
    shortLabel: "Text",
    constrainToMargins: false
  },
  titleBlock: {
    className: "title-block",
    contentLabel: "Title",
    defaultContent: "Title",
    defaultHeight: 52,
    defaultWidth: 420,
    label: "title block",
    placementLabel: "Add title block",
    shortLabel: "Title",
    constrainToMargins: true
  },
  subtitleBlock: {
    className: "subtitle-block",
    contentLabel: "Subtitle",
    defaultContent: "Subtitle",
    defaultHeight: 40,
    defaultWidth: 380,
    label: "subtitle block",
    placementLabel: "Add subtitle block",
    shortLabel: "Subtitle",
    constrainToMargins: true
  },
  sectionBlock: {
    className: "section-block",
    contentLabel: "Section",
    defaultContent: "Section",
    defaultHeight: 36,
    defaultWidth: 320,
    label: "section block",
    placementLabel: "Add section block",
    shortLabel: "Section",
    constrainToMargins: true
  }
};

type AppProps = {
  initialDocument?: InterlinearDocument;
  initialLexicon?: Lexicon;
};

type ZoomAnchor = {
  container: HTMLDivElement;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
};

type MiddleButtonZoomState = {
  startY: number;
  startZoom: number;
  anchor: ZoomAnchor | null;
};

type TokenInputFocusRestore = {
  tokenId: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

export function App({ initialDocument, initialLexicon }: AppProps = {}) {
  const [doc, setDoc] = useState<InterlinearDocument>(() => initialDocument ?? createEmptyDocument());
  const [lexicon, setLexicon] = useState<Lexicon>(() => initialLexicon ?? createEmptyLexicon());
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [lexiconPath, setLexiconPath] = useState<string | null>(null);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>(() => loadRecentDocuments());
  const [selection, setSelection] = useState<Selection>(() => {
    const initialTokenId = Object.keys(initialDocument?.tokens ?? {})[0];
    return initialTokenId ? { kind: "token", id: initialTokenId } : null;
  });
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>(() => {
    const initialTokenId = Object.keys(initialDocument?.tokens ?? {})[0];
    return initialTokenId ? [initialTokenId] : [];
  });
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingPageObjectId, setEditingPageObjectId] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState<PlacementMode | null>(null);
  const [placementSticky, setPlacementSticky] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("selection");
  const [focusTokenId, setFocusTokenId] = useState<string | null>(null);
  const [focusAnnotationId, setFocusAnnotationId] = useState<string | null>(null);
  const [focusPageObjectId, setFocusPageObjectId] = useState<string | null>(null);
  const [focusPageId, setFocusPageId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [exportErrorDetail, setExportErrorDetail] = useState("");
  const [fileErrorDetail, setFileErrorDetail] = useState("");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [assetUrls, setAssetUrls] = useState<AssetUrls>({});
  const [splitDraft, setSplitDraft] = useState("");
  const [mergeJoiner, setMergeJoiner] = useState("");
  const [tokenOperationError, setTokenOperationError] = useState("");
  const [newLayerName, setNewLayerName] = useState("New Layer");
  const [newLayerKind, setNewLayerKind] = useState<LayerKind>("custom");
  const [newLayerDirection, setNewLayerDirection] = useState<Layer["direction"]>("ltr");
  const [layerFormError, setLayerFormError] = useState("");
  const [lexiconSearch, setLexiconSearch] = useState("");
  const [selectedLexiconEntryId, setSelectedLexiconEntryId] = useState("lex_to_ti_en_einai");
  const [lexiconFormError, setLexiconFormError] = useState("");
  const [spanDraft, setSpanDraft] = useState<SpanDraft>({
    layerId: "",
    text: "",
    notes: "",
    tags: "",
    lexiconEntryId: ""
  });
  const [spanFormError, setSpanFormError] = useState("");
  const [undoStack, setUndoStack] = useState<DocumentCommand[]>([]);
  const [redoStack, setRedoStack] = useState<DocumentCommand[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const dragCommandStartRef = useRef<InterlinearDocument | null>(null);
  const measurementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const middleButtonZoomRef = useRef<MiddleButtonZoomState | null>(null);
  const tokenInputFocusRestoreRef = useRef<TokenInputFocusRestore | null>(null);

  const selectedToken = selection?.kind === "token" ? doc.tokens[selection.id] : null;
  const selectedSpan = selection?.kind === "span" ? doc.layerSpans[selection.id] : null;
  const selectedAnnotation = selection?.kind === "annotation" ? doc.annotationCells[selection.id] : null;
  const selectedPageObject =
    selection?.kind === "pageObject"
      ? doc.pages.flatMap((page) => page.pageObjects).find((object) => object.id === selection.id) ?? null
      : null;

  const visibleLayers = useMemo(
    () => [...doc.layers].filter((layer) => layer.visible).sort((left, right) => left.order - right.order),
    [doc.layers]
  );

  const orderedTokens = useMemo(() => tokenOrder(doc), [doc]);

  const selectedLine =
    selection?.kind === "line"
      ? doc.pages.flatMap((page) => page.lines).find((line) => line.id === selection.id) ?? null
      : selectedToken
        ? doc.pages.flatMap((page) => page.lines).find((line) => line.id === selectedToken.lineId) ?? null
        : null;

  const tokenSuggestions = selectedToken ? findTokenSuggestions(selectedToken, lexicon) : [];
  const lineSuggestions = selectedLine ? findLineSuggestions(doc, selectedLine.tokenIds, lexicon) : [];
  const suggestions = dedupeSuggestions([...tokenSuggestions, ...lineSuggestions]);
  const snapTargetLineId =
    dragRef.current?.kind === "token" && dragRef.current.active ? getTokenSnapTargetLineId(doc, dragRef.current.id) : null;

  useLayoutEffect(() => {
    const restore = tokenInputFocusRestoreRef.current;
    if (!restore) return;
    if (editingTokenId !== restore.tokenId) {
      tokenInputFocusRestoreRef.current = null;
      return;
    }

    const input = document.querySelector<HTMLInputElement>(`[data-token-input="${restore.tokenId}"]`);
    if (!input) return;

    input.focus();
    if (restore.selectionStart !== null && restore.selectionEnd !== null) {
      const length = input.value.length;
      input.setSelectionRange(Math.min(restore.selectionStart, length), Math.min(restore.selectionEnd, length));
    }
    tokenInputFocusRestoreRef.current = null;
  }, [doc, editingTokenId]);

  useEffect(() => {
    if (!focusTokenId) return;
    const input = document.querySelector<HTMLInputElement>(`[data-token-input="${focusTokenId}"]`);
    if (!input) return;
    input.focus();
    input.select();
    setFocusTokenId(null);
  }, [doc, focusTokenId]);

  useEffect(() => {
    if (!focusAnnotationId) return;
    const input = document.querySelector<HTMLInputElement>(`[data-annotation-input="${focusAnnotationId}"]`);
    if (!input) return;
    input.focus();
    input.select();
    setFocusAnnotationId(null);
  }, [doc, focusAnnotationId]);

  useEffect(() => {
    if (!focusPageObjectId) return;
    const input = document.querySelector<HTMLInputElement>(`[data-page-object-input="${focusPageObjectId}"]`);
    if (!input) return;
    input.focus();
    input.select();
    setFocusPageObjectId(null);
  }, [doc, focusPageObjectId]);

  useEffect(() => {
    if (!focusPageId) return;
    const page = document.querySelector<HTMLElement>(`[data-page-id="${focusPageId}"]`);
    if (!page) return;
    if (typeof page.scrollIntoView === "function") {
      page.scrollIntoView({ block: "start", inline: "nearest" });
    }
    setFocusPageId(null);
  }, [doc.pages, focusPageId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDoc((current) => {
      if (!measurementCanvasRef.current) {
        measurementCanvasRef.current = window.document.createElement("canvas");
      }
      const measurements = measureDocumentTokenWidths(current, (text, settings) =>
        measureTextWithCanvas(text, settings, measurementCanvasRef.current!)
      );
      return applyTokenTextMeasurements(current, measurements);
    });
  }, [doc.tokens, doc.pageSettings.fontFamily, doc.pageSettings.fontSize]);

  useEffect(() => {
    setSplitDraft(selectedToken?.text ?? "");
    setTokenOperationError("");
  }, [selectedToken?.id, selectedToken?.text]);

  useEffect(() => {
    if (selectedLexiconEntryId && lexicon.entries[selectedLexiconEntryId]) return;
    setSelectedLexiconEntryId(Object.keys(lexicon.entries)[0] ?? "");
  }, [lexicon.entries, selectedLexiconEntryId]);

  useEffect(() => {
    const conceptLayer = doc.layers.find((layer) => layer.kind === "concept") ?? doc.layers[0];
    const orderedSelection = orderSelectedTokenIds(doc, selectedTokenIds);
    setSpanDraft((current) => ({
      ...current,
      layerId: current.layerId && doc.layers.some((layer) => layer.id === current.layerId) ? current.layerId : conceptLayer?.id ?? "",
      text: orderedSelection.length > 0 ? orderedSelection.map((id) => doc.tokens[id]?.text ?? "").join(" ") : current.text
    }));
    setSpanFormError("");
  }, [doc.layers, selectedTokenIds, doc.tokens]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoDocumentCommand();
        } else {
          undoDocumentCommand();
        }
        return;
      }

      if (
        isDeleteSelectionShortcut(event) &&
        !editingTokenId &&
        !editingAnnotationId &&
        !editingPageObjectId &&
        !isWritableTextTarget(event.target) &&
        deleteSelectedNode()
      ) {
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [doc, editingAnnotationId, editingPageObjectId, editingTokenId, selectedTokenIds, selection]);

  function updateDocument(updater: (current: InterlinearDocument) => InterlinearDocument, label?: string) {
    setDoc((current) => {
      const next = {
        ...updater(current),
        updatedAt: new Date().toISOString()
      };
      if (label && !recordDocumentCommand(label, current, next)) return current;
      return next;
    });
  }

  function recordDocumentCommand(label: string, before: InterlinearDocument, after: InterlinearDocument): boolean {
    const command = createDocumentCommand(createId("cmd"), label, before, after);
    if (!command) return false;
    setUndoStack((current) => [...current, command]);
    setRedoStack([]);
    return true;
  }

  function undoDocumentCommand() {
    setUndoStack((current) => {
      const command = current.at(-1);
      if (!command) return current;
      const nextDoc = revertCommand(command);
      setDoc(nextDoc);
      void refreshAssetUrls(nextDoc, documentPath);
      setRedoStack((redo) => [...redo, command]);
      setStatus(`Undid ${command.label}.`);
      return current.slice(0, -1);
    });
  }

  function redoDocumentCommand() {
    setRedoStack((current) => {
      const command = current.at(-1);
      if (!command) return current;
      const nextDoc = applyCommand(command);
      setDoc(nextDoc);
      void refreshAssetUrls(nextDoc, documentPath);
      setUndoStack((undo) => [...undo, command]);
      setStatus(`Redid ${command.label}.`);
      return current.slice(0, -1);
    });
  }

  async function openDocument(filePath?: string | null) {
    if (!window.interlinear) {
      setStatus("File operations require Electron.");
      return;
    }
    try {
      const result = await window.interlinear.openDocument(filePath);
      if (!result) return;
      setDoc(result.document);
      setDocumentPath(result.filePath);
      rememberRecentDocument(result.filePath);
      setSelection(null);
      setSelectedTokenIds([]);
      setEditingTokenId(null);
      setEditingAnnotationId(null);
      setEditingPageObjectId(null);
      setFocusAnnotationId(null);
      setFocusPageObjectId(null);
      setFocusPageId(null);
      setPlacementMode(null);
      setPlacementSticky(false);
      setUndoStack([]);
      setRedoStack([]);
      setExportErrorDetail("");
      setFileErrorDetail("");
      await refreshAssetUrls(result.document, result.filePath);
      setStatus(`Opened ${fileName(result.filePath)}`);
    } catch (error) {
      const openError = describeFileOpenError(error, "document");
      if (filePath && isMissingFileError(error)) {
        forgetRecentDocument(filePath);
      }
      setStatus(openError.summary);
      setFileErrorDetail(openError.detail);
    }
  }

  async function saveDocument(saveAs = false): Promise<string | null> {
    if (!window.interlinear) {
      setStatus("File operations require Electron.");
      return null;
    }
    const targetPath = saveAs ? null : documentPath;
    try {
      const result = await window.interlinear.saveDocument(doc, targetPath);
      if (!result) return null;
      setDoc(result.document);
      setDocumentPath(result.filePath);
      rememberRecentDocument(result.filePath);
      setExportErrorDetail("");
      setFileErrorDetail("");
      await refreshAssetUrls(result.document, result.filePath);
      setStatus(`Saved ${fileName(result.filePath)}`);
      return result.filePath;
    } catch (error) {
      setStatus("Could not save document.");
      setFileErrorDetail(messageFromError(error));
      return null;
    }
  }

  async function openLexicon() {
    if (!window.interlinear) {
      setStatus("File operations require Electron.");
      return;
    }
    try {
      const result = await window.interlinear.openLexicon();
      if (!result) return;
      setLexicon(result.lexicon);
      setLexiconPath(result.filePath);
      setFileErrorDetail("");
      setStatus(`Opened lexicon ${fileName(result.filePath)}`);
    } catch (error) {
      const openError = describeFileOpenError(error, "lexicon");
      setStatus(openError.summary);
      setFileErrorDetail(openError.detail);
    }
  }

  async function saveLexicon() {
    if (!window.interlinear) {
      setStatus("File operations require Electron.");
      return;
    }
    try {
      const result = await window.interlinear.saveLexicon(lexicon, lexiconPath);
      if (!result) return;
      setLexicon(result.lexicon);
      setLexiconPath(result.filePath);
      setFileErrorDetail("");
      setStatus(`Saved lexicon ${fileName(result.filePath)}`);
    } catch (error) {
      setStatus("Could not save lexicon.");
      setFileErrorDetail(messageFromError(error));
    }
  }

  function rememberRecentDocument(filePath: string) {
    setRecentDocuments((current) => {
      const next = [
        { filePath, openedAt: new Date().toISOString() },
        ...current.filter((item) => item.filePath !== filePath)
      ].slice(0, RECENT_DOCUMENT_LIMIT);
      persistRecentDocuments(next);
      return next;
    });
  }

  function forgetRecentDocument(filePath: string) {
    setRecentDocuments((current) => {
      const next = current.filter((item) => item.filePath !== filePath);
      persistRecentDocuments(next);
      return next;
    });
  }

  function createLexiconEntry() {
    const id = createId("lex");
    const lemma = "new entry";
    const now = new Date().toISOString();
    setLexicon((current) => ({
      ...current,
      updatedAt: now,
      entries: {
        ...current.entries,
        [id]: {
          id,
          lemma,
          normalizedForms: [normalizeTerm(lemma)],
          glosses: [{ id: createId("gloss"), text: "" }],
          notes: "",
          tags: [],
          kind: "token"
        }
      }
    }));
    setSelectedLexiconEntryId(id);
    setInspectorTab("lexicon");
    setLexiconFormError("");
    setStatus("Created lexicon entry.");
  }

  function updateLexiconEntry(entryId: string, patch: Partial<LexiconEntry>) {
    setLexicon((current) => {
      const entry = current.entries[entryId];
      if (!entry) return current;
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        entries: {
          ...current.entries,
          [entryId]: { ...entry, ...patch }
        }
      };
    });
    if (patch.lemma !== undefined && !patch.lemma.trim()) {
      setLexiconFormError("Lemma is required.");
    } else {
      setLexiconFormError("");
    }
  }

  function deleteLexiconEntry(entryId: string) {
    setLexicon((current) => {
      if (!current.entries[entryId]) return current;
      const entries = { ...current.entries };
      delete entries[entryId];
      return { ...current, updatedAt: new Date().toISOString(), entries };
    });
    setSelectedLexiconEntryId("");
    setLexiconFormError("");
    setStatus("Deleted lexicon entry.");
  }

  async function exportTex() {
    if (!window.interlinear) {
      setStatus("Export requires Electron.");
      return;
    }
    try {
      const result = await window.interlinear.exportTex(doc, null, documentPath);
      if (result) {
        setExportErrorDetail("");
        setFileErrorDetail("");
        setStatus(`Exported ${fileName(result.filePath)}`);
      }
    } catch (error) {
      const exportError = describeExportError(error);
      setStatus(exportError.summary);
      setExportErrorDetail(exportError.detail);
    }
  }

  async function exportPdf() {
    if (!window.interlinear) {
      setStatus("Export requires Electron.");
      return;
    }
    try {
      const result = await window.interlinear.exportPdf(doc, null, documentPath);
      if (result) {
        setExportErrorDetail("");
        setFileErrorDetail("");
        setStatus(`Exported ${fileName(result.pdfPath)}`);
      }
    } catch (error) {
      const exportError = describeExportError(error);
      setStatus(exportError.summary);
      setExportErrorDetail(exportError.detail);
    }
  }

  async function refreshAssetUrls(nextDoc: InterlinearDocument, nextDocumentPath: string | null) {
    if (!window.interlinear) return;
    const entries = await Promise.all(
      nextDoc.pages
        .flatMap((page) => page.pageObjects)
        .filter((object): object is Extract<PageObject, { kind: "image" }> => object.kind === "image" && Boolean(object.assetPath.trim()))
        .map(async (object) => {
          const assetUrl = await resolveImageAssetUrl(object.assetPath, nextDocumentPath);
          return assetUrl ? ([object.id, assetUrl] as const) : null;
        })
    );
    setAssetUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
  }

  function createWordBox(pageId?: string, point?: { x: number; y: number }) {
    const targetPageId = pageId ?? doc.pages[0]?.id;
    if (!targetPageId) return;
    const tokenId = createId("tok");
    updateDocument((current) => addWordBoxToDocument(current, targetPageId, tokenId, point), "Add word box");
    setSelection({ kind: "token", id: tokenId });
    setSelectedTokenIds([tokenId]);
    setEditingTokenId(tokenId);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setInspectorTab("selection");
    setFocusTokenId(tokenId);
    setStatus("Created word box.");
  }

  function createWordBoxAfterToken(tokenId: string) {
    if (!doc.tokens[tokenId]) return;
    const nextTokenId = createId("tok");
    updateDocument((current) => insertWordBoxAfterToken(current, tokenId, nextTokenId), "Add word box");
    setSelection({ kind: "token", id: nextTokenId });
    setSelectedTokenIds([nextTokenId]);
    setEditingTokenId(nextTokenId);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setInspectorTab("selection");
    setFocusTokenId(nextTokenId);
    setStatus("Created next word box.");
  }

  function createWordBoxOnLine(pageId: string, lineId: string, x: number) {
    const tokenId = createId("tok");
    updateDocument((current) => addWordBoxToLineDocument(current, pageId, lineId, tokenId, x), "Add word box");
    setSelection({ kind: "token", id: tokenId });
    setSelectedTokenIds([tokenId]);
    setEditingTokenId(tokenId);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setInspectorTab("selection");
    setFocusTokenId(tokenId);
    setStatus("Created word box.");
  }

  function createLine(pageId?: string, point?: { x: number; y: number }) {
    const targetPageId = pageId ?? doc.pages[0]?.id;
    if (!targetPageId) return;
    const anchorLineId =
      selection?.kind === "line"
        ? selection.id
        : selection?.kind === "token"
          ? doc.tokens[selection.id]?.lineId
          : doc.pages[0]?.lines.at(-1)?.id;
    const lineId = createId("line");
    updateDocument(
      (current) =>
        point ? addLineAtDocument(current, targetPageId, lineId, point.y) : addLineToDocument(current, targetPageId, lineId, anchorLineId),
      "Add line"
    );
    setSelection({ kind: "line", id: lineId });
    setSelectedTokenIds([]);
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setStatus("Created line.");
  }

  function createPage() {
    const pageId = createId("page");
    const afterPageId = pageIdForSelection(doc, selection) ?? doc.pages.at(-1)?.id;
    updateDocument((current) => addPageToDocument(current, pageId, afterPageId), "Add page");
    setSelection(null);
    setSelectedTokenIds([]);
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setFocusTokenId(null);
    setFocusAnnotationId(null);
    setFocusPageObjectId(null);
    setFocusPageId(pageId);
    setInspectorTab("document");
    setStatus("Created page.");
  }

  function deleteSelectedNode(): boolean {
    if (!selection || dragRef.current) return false;
    const tokenIds =
      selection.kind === "token"
        ? selectedTokenIds.some((id) => doc.tokens[id])
          ? selectedTokenIds.filter((id) => doc.tokens[id])
          : [selection.id].filter((id) => doc.tokens[id])
        : [];
    if (!selectionExistsForDeletion(doc, selection, tokenIds)) return false;

    updateDocument((current) => deleteSelectionFromDocument(current, selection, tokenIds), deleteSelectionCommandLabel(selection, tokenIds));
    if (selection.kind === "pageObject") {
      setAssetUrls((current) => {
        if (!current[selection.id]) return current;
        const next = { ...current };
        delete next[selection.id];
        return next;
      });
    }
    setSelection(null);
    setSelectedTokenIds([]);
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setFocusTokenId(null);
    setFocusAnnotationId(null);
    setFocusPageObjectId(null);
    setTokenOperationError("");
    setSpanFormError("");
    setStatus(deleteSelectionStatus(selection, tokenIds));
    return true;
  }

  function togglePlacementMode(mode: PlacementMode) {
    const next = placementMode === mode ? null : mode;
    setPlacementMode(next);
    setPlacementSticky(false);
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
  }

  function keepPlacementMode(mode: Extract<PlacementMode, "word" | "line">) {
    setPlacementMode(mode);
    setPlacementSticky(true);
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
  }

  function completePlacement(mode: PlacementMode) {
    if ((mode === "word" || mode === "line" || mode === "image" || isTextPageObjectKind(mode)) && !placementSticky) {
      setPlacementMode(null);
      setPlacementSticky(false);
    }
  }

  function placeOnPage(pageId: string, point: { x: number; y: number }) {
    if (placementMode === "word") {
      createWordBox(pageId, point);
    } else if (placementMode === "line") {
      createLine(pageId, point);
    } else if (placementMode === "image") {
      addImage(pageId, point);
    } else if (isTextPageObjectKind(placementMode)) {
      addTextObject(placementMode, pageId, point);
    }
    if (placementMode) completePlacement(placementMode);
  }

  function placeWordOnLine(pageId: string, lineId: string, x: number) {
    createWordBoxOnLine(pageId, lineId, x);
    completePlacement("word");
  }

  function setZoomTo(nextZoom: number, anchor?: ZoomAnchor | null) {
    const boundedZoom = roundZoom(clamp(nextZoom, ZOOM_MIN, ZOOM_MAX));
    setZoom((current) => {
      if (current === boundedZoom) return current;
      if (anchor) scheduleZoomAnchorRestore(anchor, boundedZoom);
      return boundedZoom;
    });
  }

  function adjustZoom(delta: number, anchor?: ZoomAnchor | null) {
    setZoom((current) => {
      const nextZoom = roundZoom(clamp(current + delta, ZOOM_MIN, ZOOM_MAX));
      if (current === nextZoom) return current;
      if (anchor) scheduleZoomAnchorRestore(anchor, nextZoom);
      return nextZoom;
    });
  }

  function resetZoom(anchor?: ZoomAnchor | null) {
    setZoomTo(DEFAULT_ZOOM, anchor);
  }

  function captureZoomAnchor(clientX: number, clientY: number): ZoomAnchor | null {
    const container = pageScrollRef.current;
    const page = container?.querySelector<HTMLElement>(".page");
    if (!container || !page) return null;
    const rect = page.getBoundingClientRect();
    return {
      container,
      clientX,
      clientY,
      pageX: (clientX - rect.left) / zoom,
      pageY: (clientY - rect.top) / zoom
    };
  }

  function handleZoomWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const isPinchZoom = event.ctrlKey || event.metaKey;
    const isMiddleButtonWheel = event.buttons === 4;
    if ((!isPinchZoom && !isMiddleButtonWheel) || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY < 0 ? 1 : -1;
    const magnitude = DEFAULT_ZOOM * Math.min(0.08, Math.max(0.01, Math.abs(event.deltaY) / 600));
    adjustZoom(direction * magnitude, captureZoomAnchor(event.clientX, event.clientY));
  }

  function startMiddleButtonZoom(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 1 && event.buttons !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerClientPoint(event);
    middleButtonZoomRef.current = {
      startY: point.y,
      startZoom: zoom,
      anchor: captureZoomAnchor(point.x, point.y)
    };
    window.addEventListener("pointermove", handleMiddleButtonZoomMove);
    window.addEventListener("pointerup", stopMiddleButtonZoom, { once: true });
  }

  function handleMiddleButtonZoomMove(event: PointerEvent) {
    const state = middleButtonZoomRef.current;
    if (!state) return;
    event.preventDefault();
    const point = pointerClientPoint(event);
    const zoomDelta = ((state.startY - point.y) / 300) * DEFAULT_ZOOM;
    setZoomTo(state.startZoom + zoomDelta, state.anchor);
  }

  function stopMiddleButtonZoom() {
    middleButtonZoomRef.current = null;
    window.removeEventListener("pointermove", handleMiddleButtonZoomMove);
  }

  function addLayer() {
    setInspectorTab("layers");
    setLayerFormError("");
    setStatus("Use the Layers panel to create or edit layers.");
  }

  function createLayerFromDraft() {
    const name = newLayerName.trim();
    if (!name) {
      setLayerFormError("Layer name is required.");
      return;
    }
    if (doc.layers.some((layer) => layer.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setLayerFormError("Layer names must be unique.");
      return;
    }

    const id = createId("layer");
    updateDocument(
      (current) => ({
        ...current,
        layers: [
          ...current.layers,
          {
            id,
            name,
            kind: newLayerKind,
            visible: true,
            direction: newLayerDirection,
            order: current.layers.length
          }
        ]
      }),
      "Create layer"
    );
    setNewLayerName("New Layer");
    setNewLayerKind("custom");
    setNewLayerDirection(doc.direction);
    setLayerFormError("");
    setStatus(`Added layer ${name}.`);
  }

  function addTextObject(kind: TextPageObjectKind, pageId?: string, point?: { x: number; y: number }) {
    const targetPageId = pageId ?? doc.pages[0]?.id;
    if (!targetPageId) return;
    const id = createId("obj");
    const config = TEXT_PAGE_OBJECT_CONFIG[kind];
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) =>
          page.id === targetPageId
            ? {
                ...page,
                pageObjects: [
                  ...page.pageObjects,
                  {
                    id,
                    kind,
                    rect: sanitizePageObjectRect(
                      {
                        x: point?.x ?? current.pageSettings.marginLeft,
                        y: point?.y ?? current.pageSettings.marginTop,
                        width: config.defaultWidth,
                        height: config.defaultHeight
                      },
                      current.pageSettings,
                      config.constrainToMargins
                    ),
                    wrapMode: "rectangular",
                    zIndex: 2,
                    content: config.defaultContent,
                    caption: "",
                    metadata: {}
                  }
                ]
              }
            : page
        )
      }),
      `Add ${config.label}`
    );
    setSelection({ kind: "pageObject", id });
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setInspectorTab("selection");
    setStatus(`Added ${config.label}.`);
  }

  function addImage(pageId?: string, point?: { x: number; y: number }) {
    const targetPageId = pageId ?? doc.pages[0]?.id;
    if (!targetPageId) return;
    const id = createId("obj");
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) =>
          page.id === targetPageId
            ? {
                ...page,
                pageObjects: [
                  ...page.pageObjects,
                  {
                    id,
                    kind: "image",
                    rect: sanitizePageObjectRect(
                      {
                        x: point?.x ?? current.pageSettings.marginLeft,
                        y: point?.y ?? current.pageSettings.marginTop,
                        width: 170,
                        height: 120
                      },
                      current.pageSettings,
                      true
                    ),
                    wrapMode: "rectangular",
                    zIndex: 2,
                    assetPath: "",
                    caption: "",
                    metadata: {}
                  }
                ]
              }
            : page
        )
      }),
      "Add image"
    );
    setSelection({ kind: "pageObject", id });
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setInspectorTab("selection");
    setStatus("Added image box.");
  }

  async function chooseImageForObject(objectId: string) {
    if (!window.interlinear) {
      setStatus("Image selection requires Electron.");
      return;
    }
    const imported = await window.interlinear.importImage(documentPath);
    if (!imported) return;
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          pageObjects: page.pageObjects.map((object) =>
            object.id === objectId && object.kind === "image" ? ({ ...object, assetPath: imported.assetPath } as PageObject) : object
          )
        }))
      }),
      "Choose image"
    );
    const url = await window.interlinear.fileToAssetUrl(imported.absolutePath);
    setAssetUrls((current) => ({ ...current, [objectId]: url }));
    setSelection({ kind: "pageObject", id: objectId });
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setInspectorTab("selection");
    setStatus(`Selected ${fileName(imported.assetPath)}.`);
  }

  function addConceptSpanFromSelection() {
    if (selectedTokenIds.length === 0) {
      setSpanFormError("Select at least one token before creating a span.");
      setInspectorTab("selection");
      return;
    }
    createLayerSpanFromDraft();
  }

  function createLayerSpan(
    layerId: string,
    tokenIds: string[],
    text: string,
    lexiconEntryId?: string,
    notes?: string,
    tags: string[] = []
  ) {
    const sorted = tokenIds
      .filter((id) => orderedTokens.includes(id))
      .sort((left, right) => orderedTokens.indexOf(left) - orderedTokens.indexOf(right));
    if (!sorted.length) return;
    const span: LayerSpan = {
      id: createId("span"),
      layerId,
      startTokenId: sorted[0],
      endTokenId: sorted[sorted.length - 1],
      text,
      direction: doc.direction,
      lexiconEntryId: lexiconEntryId || undefined,
      notes: notes || undefined,
      tags,
      offset: { x: 0, y: -18 }
    };
    if (!canAddLayerSpan(doc, span)) {
      return false;
    }
    updateDocument(
      (current) => ({
        ...current,
        layerSpans: { ...current.layerSpans, [span.id]: span }
      }),
      "Create span"
    );
    setSelection({ kind: "span", id: span.id });
    setPlacementMode((current) => (current === "span" ? null : current));
    setStatus("Added layer span.");
    return true;
  }

  function createLayerSpanFromDraft() {
    const text = spanDraft.text.trim();
    if (!text) {
      setSpanFormError("Span text is required.");
      setInspectorTab("selection");
      return;
    }
    if (!doc.layers.some((layer) => layer.id === spanDraft.layerId)) {
      setSpanFormError("Choose a target layer.");
      setInspectorTab("selection");
      return;
    }

    const orderedSelection = orderSelectedTokenIds(doc, selectedTokenIds);
    if (orderedSelection.length === 0) {
      setSpanFormError("Select at least one token before creating a span.");
      setInspectorTab("selection");
      return;
    }

    const created = createLayerSpan(
      spanDraft.layerId,
      orderedSelection,
      text,
      spanDraft.lexiconEntryId.trim() || undefined,
      spanDraft.notes.trim() || undefined,
      spanDraft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    );
    if (!created) {
      setSpanFormError("That span would cross another span on the same layer.");
      setInspectorTab("selection");
      return;
    }
    setSpanFormError("");
  }

  function applySuggestion(suggestion: LexiconSuggestion) {
    const layer =
      suggestion.entry.kind === "concept" || suggestion.tokenIds.length > 1
        ? doc.layers.find((item) => item.kind === "concept")
        : doc.layers.find((item) => item.kind === "literal");
    if (!layer) return;

    if (suggestion.entry.kind === "concept" || suggestion.tokenIds.length > 1) {
      const existingSpan = Object.values(doc.layerSpans).find(
        (span) =>
          span.layerId === layer.id &&
          span.startTokenId === suggestion.tokenIds[0] &&
          span.endTokenId === suggestion.tokenIds[suggestion.tokenIds.length - 1]
      );
      if (existingSpan) {
        updateSpan(existingSpan.id, { lexiconEntryId: suggestion.entry.id });
        setStatus(`Linked ${suggestion.entry.lemma}.`);
      } else {
        createLayerSpan(layer.id, suggestion.tokenIds, suggestion.glossText, suggestion.entry.id);
      }
      return;
    }

    const existingAnnotation = Object.values(doc.annotationCells).find(
      (cell) => !cell.spanId && cell.tokenId === suggestion.tokenIds[0] && cell.layerId === layer.id
    );
    setAnnotation(suggestion.tokenIds[0], layer.id, existingAnnotation?.text || suggestion.glossText, suggestion.entry.id);
    setStatus(`Applied ${suggestion.entry.lemma}.`);
  }

  function setAnnotation(
    tokenId: string,
    layerId: string,
    text: string,
    lexiconEntryId?: string,
    placement: AnnotationPlacement = "below"
  ) {
    updateDocument(
      (current) => {
        const existing = Object.values(current.annotationCells).find(
          (cell) => !cell.spanId && cell.tokenId === tokenId && cell.layerId === layerId
        );
        if (!text.trim() && existing) {
          const annotationCells = { ...current.annotationCells };
          delete annotationCells[existing.id];
          return { ...current, annotationCells };
        }
        const id = existing?.id ?? createId("ann");
        const nextCell: AnnotationCell = {
          id,
          tokenId,
          layerId,
          text,
          placement: existing?.placement ?? placement,
          lexiconEntryId: lexiconEntryId ?? existing?.lexiconEntryId,
          offset: existing?.offset ?? { x: 0, y: 0 }
        };
        return normalizeTokenLayout({ ...current, annotationCells: { ...current.annotationCells, [id]: nextCell } }, tokenId);
      },
      "Edit annotation"
    );
    if (!text.trim()) {
      setEditingAnnotationId(null);
      setFocusAnnotationId(null);
    }
  }

  function updateAnnotationText(annotationId: string, text: string) {
    updateDocument(
      (current) => {
        const existing = current.annotationCells[annotationId];
        if (!existing) return current;
        if (!text.trim()) {
          const annotationCells = { ...current.annotationCells };
          delete annotationCells[annotationId];
          return existing.spanId ? { ...current, annotationCells } : normalizeTokenLayout({ ...current, annotationCells }, existing.tokenId);
        }
        const next = {
          ...current,
          annotationCells: {
            ...current.annotationCells,
            [annotationId]: { ...existing, text }
          }
        };
        return existing.spanId ? next : normalizeTokenLayout(next, existing.tokenId);
      },
      "Edit annotation"
    );
  }

  function createTokenAnnotationFromHandle(tokenId: string, placement: AnnotationPlacement) {
    const layer = annotationLayerForPlacement(doc, placement);
    if (!layer) {
      setStatus("Add an annotation layer before creating annotations.");
      return;
    }
    const existing = Object.values(doc.annotationCells).find(
      (cell) => !cell.spanId && cell.tokenId === tokenId && cell.layerId === layer.id && cell.placement === placement
    );

    if (existing) {
      setSelection({ kind: "annotation", id: existing.id });
      setEditingTokenId(null);
      setEditingAnnotationId(existing.id);
      setEditingPageObjectId(null);
      setFocusAnnotationId(existing.id);
      setInspectorTab("selection");
      setStatus("Focused existing annotation.");
      return;
    }

    const id = createId("ann");
    updateDocument(
      (current) => {
        const token = current.tokens[tokenId];
        const currentLayer = annotationLayerForPlacement(current, placement);
        if (!token || !currentLayer) return current;
        const duplicate = Object.values(current.annotationCells).find(
          (cell) => !cell.spanId && cell.tokenId === tokenId && cell.layerId === currentLayer.id && cell.placement === placement
        );
        if (duplicate) return current;
        const nextCell: AnnotationCell = {
          id,
          tokenId,
          layerId: currentLayer.id,
          text: "",
          placement,
          offset: { x: 0, y: 0 }
        };
        return { ...current, annotationCells: { ...current.annotationCells, [id]: nextCell } };
      },
      "Create annotation"
    );
    setSelection({ kind: "annotation", id });
    setEditingTokenId(null);
    setEditingAnnotationId(id);
    setEditingPageObjectId(null);
    setFocusAnnotationId(id);
    setInspectorTab("selection");
    setStatus(`Added ${placement} annotation.`);
  }

  function createSpanAnnotationFromHandle(spanId: string, placement: AnnotationPlacement) {
    const span = doc.layerSpans[spanId];
    const layer = annotationLayerForPlacement(doc, placement);
    if (!span || !layer) {
      setStatus("Add an annotation layer before creating span annotations.");
      return;
    }
    const existing = Object.values(doc.annotationCells).find(
      (cell) => cell.spanId === spanId && cell.layerId === layer.id && cell.placement === placement
    );

    if (existing) {
      setSelection({ kind: "annotation", id: existing.id });
      setEditingTokenId(null);
      setEditingAnnotationId(existing.id);
      setEditingPageObjectId(null);
      setFocusAnnotationId(existing.id);
      setInspectorTab("selection");
      setStatus("Focused existing span annotation.");
      return;
    }

    const id = createId("ann");
    updateDocument(
      (current) => {
        const currentSpan = current.layerSpans[spanId];
        const currentLayer = annotationLayerForPlacement(current, placement);
        if (!currentSpan || !currentLayer) return current;
        const duplicate = Object.values(current.annotationCells).find(
          (cell) => cell.spanId === spanId && cell.layerId === currentLayer.id && cell.placement === placement
        );
        if (duplicate) return current;
        const nextCell: AnnotationCell = {
          id,
          tokenId: currentSpan.startTokenId,
          spanId,
          layerId: currentLayer.id,
          text: "",
          placement,
          offset: { x: 0, y: 0 }
        };
        return { ...current, annotationCells: { ...current.annotationCells, [id]: nextCell } };
      },
      "Create annotation"
    );
    setSelection({ kind: "annotation", id });
    setEditingTokenId(null);
    setEditingAnnotationId(id);
    setEditingPageObjectId(null);
    setFocusAnnotationId(id);
    setInspectorTab("selection");
    setStatus(`Added ${placement} span annotation.`);
  }

  function updateToken(tokenId: string, patch: Partial<Token>, focusRestore?: TokenInputFocusRestore) {
    if (focusRestore) tokenInputFocusRestoreRef.current = focusRestore;
    updateDocument(
      (current) => {
        const token = current.tokens[tokenId];
        if (!token) return current;
        const nextText = patch.text ?? token.text;
        const next = {
          ...current,
          tokens: {
            ...current.tokens,
            [tokenId]: {
              ...token,
              ...patch,
              normalized: patch.normalized ?? normalizeTerm(nextText),
              textMetrics: patch.text !== undefined ? {} : patch.textMetrics ?? token.textMetrics
            }
          }
        };
        if (patch.text !== undefined) return normalizeTokenLayout(next, tokenId);
        return patch.offset ? moveTokenWithCollisionConstraints(current, tokenId, patch.offset) : next;
      },
      patch.offset ? undefined : "Edit token"
    );
  }

  function updateSpan(spanId: string, patch: Partial<LayerSpan>) {
    updateDocument(
      (current) => {
        const span = current.layerSpans[spanId];
        if (!span) return current;
        return {
          ...current,
          layerSpans: {
            ...current.layerSpans,
            [spanId]: { ...span, ...patch }
          }
        };
      },
      patch.offset || patch.rect ? undefined : "Edit span"
    );
  }

  function updateLine(lineId: string, patch: Partial<InterlinearLine>) {
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          lines: page.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line))
        }))
      }),
      "Edit line"
    );
  }

  function splitSelectedToken() {
    if (!selectedToken) return;
    const parts = splitDraft.split(/\s+/).map((part) => part.trim());
    if (parts.filter(Boolean).length < 2 || parts.some((part) => part.length === 0)) {
      setTokenOperationError("Enter at least two non-empty token parts.");
      return;
    }

    updateDocument((current) => normalizeTokenLayout(splitToken(current, selectedToken.id, parts), selectedToken.id), "Split token");
    setSelection({ kind: "token", id: selectedToken.id });
    setSelectedTokenIds([selectedToken.id]);
    setEditingTokenId(selectedToken.id);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setFocusTokenId(selectedToken.id);
    setTokenOperationError("");
    setStatus("Split token.");
  }

  function mergeSelectedTokens() {
    const orderedSelection = orderSelectedTokenIds(doc, selectedTokenIds);
    if (orderedSelection.length < 2) {
      setTokenOperationError("Select at least two adjacent tokens to merge.");
      return;
    }
    if (!selectedTokensAreAdjacent(doc, orderedSelection)) {
      setTokenOperationError("Select adjacent tokens on the same line to merge.");
      return;
    }

    const mergedTokenId = orderedSelection[0];
    updateDocument((current) => normalizeTokenLayout(mergeTokens(current, orderedSelection, mergeJoiner), mergedTokenId), "Merge tokens");
    setSelection({ kind: "token", id: mergedTokenId });
    setSelectedTokenIds([mergedTokenId]);
    setEditingTokenId(mergedTokenId);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setFocusTokenId(mergedTokenId);
    setTokenOperationError("");
    setStatus("Merged tokens.");
  }

  function updatePageObject(objectId: string, patch: Partial<PageObject>) {
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          pageObjects: page.pageObjects.map((object) => {
            if (object.id !== objectId) return object;
            const nextObject = { ...object, ...patch } as PageObject;
            return {
              ...nextObject,
              rect: patch.rect ? sanitizeRectForPageObject(nextObject, patch.rect, current.pageSettings) : nextObject.rect
            } as PageObject;
          })
        }))
      }),
      patch.rect ? "Edit page object" : "Edit page object"
    );
  }

  function updatePageObjectText(objectId: string, content: string) {
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          pageObjects: page.pageObjects.map((object) =>
            object.id === objectId && isTextPageObject(object) ? { ...object, content } : object
          )
        }))
      }),
      "Edit page object"
    );
  }

  function updatePageObjectRect(objectId: string, rect: Rect, recordCommand = true) {
    updateDocument(
      (current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          pageObjects: page.pageObjects.map((object) =>
            object.id === objectId ? ({ ...object, rect: sanitizeRectForPageObject(object, rect, current.pageSettings) } as PageObject) : object
          )
        }))
      }),
      recordCommand ? "Resize page object" : undefined
    );
  }

  function updatePageSettings(patch: Partial<InterlinearDocument["pageSettings"]>, recordCommand = true) {
    updateDocument(
      (current) => ({
        ...current,
        pageSettings: sanitizePageSettings({ ...current.pageSettings, ...patch })
      }),
      recordCommand ? "Edit page settings" : undefined
    );
  }

  function toggleLayerVisibility(layerId: string) {
    updateDocument(
      (current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer))
      }),
      "Toggle layer"
    );
  }

  function updateLayer(layerId: string, patch: Partial<Layer>) {
    updateDocument(
      (current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer))
      }),
      "Edit layer"
    );
  }

  function toggleLineGuides() {
    updateDocument(
      (current) => ({
        ...current,
        lineGuidesVisible: !current.lineGuidesVisible
      }),
      "Toggle line guides"
    );
  }

  function startDrag(kind: DragStartKind, id: string, event: ReactPointerEvent<HTMLElement>) {
    const point = pointerClientPoint(event);
    event.stopPropagation();

    if (kind === "token") {
      const token = doc.tokens[id];
      if (!token) return;
      if (event.shiftKey) {
        setSelectedTokenIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
      } else {
        setSelectedTokenIds([id]);
      }
      setEditingTokenId((current) => (current === id ? current : null));
      setEditingAnnotationId(null);
      setEditingPageObjectId(null);
      setSelection({ kind, id });
      dragRef.current = {
        kind,
        id,
        startX: point.x,
        startY: point.y,
        original: token.offset,
        active: false
      };
    } else if (kind === "line") {
      event.preventDefault();
      const line = doc.pages.flatMap((page) => page.lines).find((item) => item.id === id);
      if (!line) return;
      setEditingTokenId(null);
      setEditingAnnotationId(null);
      setEditingPageObjectId(null);
      setSelection({ kind, id });
      dragRef.current = {
        kind,
        id,
        startX: point.x,
        startY: point.y,
        original: { x: line.offset.x, y: line.offset.y, lineY: line.y }
      };
    } else if (kind === "annotation") {
      event.preventDefault();
      const cell = doc.annotationCells[id];
      if (!cell) return;
      setEditingTokenId(null);
      setEditingAnnotationId((current) => (current === id ? current : null));
      setEditingPageObjectId(null);
      setSelection({ kind, id });
      dragRef.current = {
        kind,
        id,
        startX: point.x,
        startY: point.y,
        original: cell.offset
      };
    } else if (kind === "span") {
      event.preventDefault();
      const span = doc.layerSpans[id];
      if (!span) return;
      setEditingTokenId(null);
      setEditingAnnotationId(null);
      setEditingPageObjectId(null);
      setSelection({ kind, id });
      dragRef.current = {
        kind,
        id,
        startX: point.x,
        startY: point.y,
        original: {
          x: span.offset.x,
          y: span.offset.y,
          rectX: span.rect?.x,
          rectY: span.rect?.y
        }
      };
    } else if (kind === "pageObject") {
      event.preventDefault();
      const object = doc.pages.flatMap((page) => page.pageObjects).find((item) => item.id === id);
      if (!object) return;
      setEditingTokenId(null);
      setEditingAnnotationId(null);
      setEditingPageObjectId((current) => (current === id ? current : null));
      setSelection({ kind, id });
      dragRef.current = {
        kind,
        id,
        startX: point.x,
        startY: point.y,
        original: { x: object.rect.x, y: object.rect.y }
      };
    } else if (kind === "marginGuide") {
      event.preventDefault();
      const edge = marginGuideEdge(id);
      if (!edge) return;
      setEditingTokenId(null);
      setEditingAnnotationId(null);
      setEditingPageObjectId(null);
      dragRef.current = {
        kind,
        id: edge,
        startX: point.x,
        startY: point.y,
        original: {
          width: doc.pageSettings.width,
          height: doc.pageSettings.height,
          marginTop: doc.pageSettings.marginTop,
          marginRight: doc.pageSettings.marginRight,
          marginBottom: doc.pageSettings.marginBottom,
          marginLeft: doc.pageSettings.marginLeft
        }
      };
    }

    if (dragRef.current) {
      dragCommandStartRef.current = doc;
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
  }

  function startPageObjectResize(
    objectId: string,
    handle: PageObjectResizeHandle,
    event: ReactPointerEvent<HTMLElement>
  ) {
    const point = pointerClientPoint(event);
    event.preventDefault();
    event.stopPropagation();
    const object = doc.pages.flatMap((page) => page.pageObjects).find((item) => item.id === objectId);
    if (!object) return;
    setEditingTokenId(null);
    setEditingAnnotationId(null);
    setEditingPageObjectId(null);
    setSelection({ kind: "pageObject", id: objectId });
    dragRef.current = {
      kind: "pageObjectResize",
      id: objectId,
      handle,
      startX: point.x,
      startY: point.y,
      original: object.rect
    };
    dragCommandStartRef.current = doc;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
  }

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointerClientPoint(event);
    const dx = (point.x - drag.startX) / zoom;
    const dy = (point.y - drag.startY) / zoom;

    if (drag.kind === "token") {
      if (!drag.active) {
        const rawDx = point.x - drag.startX;
        const rawDy = point.y - drag.startY;
        if (Math.hypot(rawDx, rawDy) < DRAG_START_THRESHOLD) return;
        drag.active = true;
      }
      event.preventDefault();
      updateToken(drag.id, { offset: { x: drag.original.x + dx, y: drag.original.y + dy } });
    } else if (drag.kind === "line") {
      event.preventDefault();
      updateDocument((current) => {
        const visualY = drag.original.lineY + drag.original.y + dy;
        return moveLineWithCollisionConstraints(current, drag.id, visualY);
      });
    } else if (drag.kind === "annotation") {
      updateDocument((current) => {
        const cell = current.annotationCells[drag.id];
        if (!cell) return current;
        return {
          ...current,
          annotationCells: {
            ...current.annotationCells,
            [drag.id]: { ...cell, offset: { x: drag.original.x + dx, y: drag.original.y + dy } }
          }
        };
      });
    } else if (drag.kind === "span") {
      const span = doc.layerSpans[drag.id];
      if (!span) return;
      updateSpan(
        drag.id,
        span.rect && drag.original.rectX !== undefined && drag.original.rectY !== undefined
          ? { rect: { ...span.rect, x: drag.original.rectX + dx, y: drag.original.rectY + dy } }
          : { offset: { x: drag.original.x + dx, y: drag.original.y + dy } }
      );
    } else if (drag.kind === "pageObject") {
      updateDocument((current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          pageObjects: page.pageObjects.map((object) =>
            object.id === drag.id
              ? ({
                  ...object,
                  rect: sanitizeRectForPageObject(
                    object,
                    { ...object.rect, x: drag.original.x + dx, y: drag.original.y + dy },
                    current.pageSettings
                  )
                } as PageObject)
              : object
          )
        }))
      }));
    } else if (drag.kind === "pageObjectResize") {
      event.preventDefault();
      const object = doc.pages.flatMap((page) => page.pageObjects).find((item) => item.id === drag.id);
      updatePageObjectRect(
        drag.id,
        resizePageObjectRect(drag.original, drag.handle, dx, dy, doc.pageSettings, object ? pageObjectConstrainedToMargins(object) : false),
        false
      );
    } else if (drag.kind === "marginGuide") {
      event.preventDefault();
      updatePageSettings(marginPatchForDrag(drag.id, drag.original, dx, dy), false);
    }
  }

  function stopDrag() {
    const drag = dragRef.current;
    const before = dragCommandStartRef.current;
    if (drag?.kind === "token") {
      setDoc((current) => {
        const next = snapTokenToNearestLine(current, drag.id);
        const timestamped = { ...next, updatedAt: new Date().toISOString() };
        return before && recordDocumentCommand(labelForDragCommand(drag.kind), before, timestamped) ? timestamped : next;
      });
    } else if (drag && before) {
      setDoc((current) => {
        const timestamped = { ...current, updatedAt: new Date().toISOString() };
        return recordDocumentCommand(labelForDragCommand(drag.kind), before, timestamped) ? timestamped : current;
      });
    }
    dragRef.current = null;
    dragCommandStartRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
  }

  function stopInlineEditOnOutsidePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!editingTokenId && !editingAnnotationId && !editingPageObjectId) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (editingTokenId) {
      const wordBox = target?.closest<HTMLElement>(".word-box");
      if (wordBox?.dataset.tokenId === editingTokenId) return;
      setEditingTokenId(null);
    }
    if (editingAnnotationId) {
      const annotationBox = target?.closest<HTMLElement>(".annotation-word-box");
      if (annotationBox?.dataset.annotationId === editingAnnotationId) return;
      setEditingAnnotationId(null);
    }
    if (editingPageObjectId) {
      const pageObject = target?.closest<HTMLElement>(".page-object");
      if (pageObject?.dataset.pageObjectId === editingPageObjectId) return;
      setEditingPageObjectId(null);
    }
  }

  function stopTokenEditAfterBlur(tokenId: string, relatedTarget: EventTarget | null) {
    const relatedElement = relatedTarget instanceof HTMLElement ? relatedTarget : null;
    const relatedWordBox = relatedElement?.closest<HTMLElement>(".word-box");
    if (relatedWordBox?.dataset.tokenId === tokenId) return;

    const schedule =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? (callback: FrameRequestCallback) => window.requestAnimationFrame(callback)
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
    schedule(() => {
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeWordBox = activeElement?.closest<HTMLElement>(".word-box");
      if (activeWordBox?.dataset.tokenId === tokenId) return;
      setEditingTokenId((current) => (current === tokenId ? null : current));
    });
  }

  const wordPlacementTooltip =
    placementMode === "word"
      ? placementSticky
        ? "Click to stop repeated word placement."
        : "Click to cancel one-word placement."
      : "Click once to place one word; double-click to keep placing words.";
  const linePlacementTooltip =
    placementMode === "line"
      ? placementSticky
        ? "Click to stop repeated line placement."
        : "Click to cancel one-line placement."
      : "Click once to place one line; double-click to keep placing lines.";

  return (
    <div className="app" onPointerDownCapture={stopInlineEditOnOutsidePointerDown}>
      <main className="workspace">
        <header className="ribbon">
          <RibbonGroup label="Document">
            <IconButton
              label="Undo"
              shortLabel="Undo"
              tooltip="Undo the last document change."
              onClick={undoDocumentCommand}
              icon={<Undo2 size={18} />}
              disabled={undoStack.length === 0}
            />
            <IconButton
              label="Redo"
              shortLabel="Redo"
              tooltip="Redo the last undone document change."
              onClick={redoDocumentCommand}
              icon={<Redo2 size={18} />}
              disabled={redoStack.length === 0}
            />
            <IconButton
              label="Open document"
              shortLabel="Open"
              tooltip="Open an interlinear document file."
              onClick={() => void openDocument()}
              icon={<FolderOpen size={18} />}
            />
            <IconButton
              label="Save document"
              shortLabel="Save"
              tooltip="Save the current document."
              onClick={() => void saveDocument(false)}
              icon={<Save size={18} />}
            />
            <IconButton
              label="Save As document"
              shortLabel="Save As"
              tooltip="Choose a new file path for this document."
              onClick={() => void saveDocument(true)}
              icon={<Save size={18} />}
            />
            <IconButton
              label="Export LaTeX"
              shortLabel="TeX"
              tooltip="Create a LaTeX source file."
              onClick={exportTex}
              icon={<FileDown size={18} />}
            />
            <IconButton
              label="Export PDF"
              shortLabel="PDF"
              tooltip="Create a PDF from the document."
              onClick={exportPdf}
              icon={<Download size={18} />}
            />
          </RibbonGroup>
          <RibbonGroup label="Page Tools">
            <IconButton
              label="Add word box"
              shortLabel="Word"
              tooltip={wordPlacementTooltip}
              onClick={(event) => {
                if (event.detail > 1) return;
                togglePlacementMode("word");
              }}
              onDoubleClick={() => keepPlacementMode("word")}
              icon={<Plus size={18} />}
              pressed={placementMode === "word"}
              sticky={placementMode === "word" && placementSticky}
            />
            <IconButton
              label="Add line"
              shortLabel="Line"
              tooltip={linePlacementTooltip}
              onClick={(event) => {
                if (event.detail > 1) return;
                togglePlacementMode("line");
              }}
              onDoubleClick={() => keepPlacementMode("line")}
              icon={<Plus size={18} />}
              pressed={placementMode === "line"}
              sticky={placementMode === "line" && placementSticky}
            />
            <IconButton
              label="Add page"
              shortLabel="Page"
              tooltip="Create a new page after the current page."
              onClick={createPage}
              icon={<FilePlus size={18} />}
            />
            <IconButton
              label={doc.lineGuidesVisible ? "Hide line guides" : "Show line guides"}
              shortLabel="Guides"
              tooltip={doc.lineGuidesVisible ? "Hide page guide lines." : "Show page guide lines."}
              onClick={toggleLineGuides}
              icon={doc.lineGuidesVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              pressed={doc.lineGuidesVisible}
            />
            <IconButton
              label="Add concept span"
              shortLabel="Span"
              tooltip={placementMode === "span" ? "Turn off span selection mode." : "Turn on span selection mode, then click words."}
              onClick={() => togglePlacementMode("span")}
              icon={<SquarePen size={18} />}
              pressed={placementMode === "span"}
            />
            <IconButton
              label="Add image"
              shortLabel="Image"
              tooltip={
                placementMode === "image" ? "Turn off image placement mode." : "Turn on image placement mode, then click the page."
              }
              onClick={() => togglePlacementMode("image")}
              icon={<ImagePlus size={18} />}
              pressed={placementMode === "image"}
            />
            <IconButton
              label="Add title block"
              shortLabel="Title"
              tooltip={
                placementMode === "titleBlock"
                  ? "Turn off title block placement mode."
                  : "Turn on title block placement mode, then click the page."
              }
              onClick={() => togglePlacementMode("titleBlock")}
              icon={<Heading1 size={18} />}
              pressed={placementMode === "titleBlock"}
            />
            <IconButton
              label="Add subtitle block"
              shortLabel="Subtitle"
              tooltip={
                placementMode === "subtitleBlock"
                  ? "Turn off subtitle block placement mode."
                  : "Turn on subtitle block placement mode, then click the page."
              }
              onClick={() => togglePlacementMode("subtitleBlock")}
              icon={<Heading2 size={18} />}
              pressed={placementMode === "subtitleBlock"}
            />
            <IconButton
              label="Add section block"
              shortLabel="Section"
              tooltip={
                placementMode === "sectionBlock"
                  ? "Turn off section block placement mode."
                  : "Turn on section block placement mode, then click the page."
              }
              onClick={() => togglePlacementMode("sectionBlock")}
              icon={<Heading3 size={18} />}
              pressed={placementMode === "sectionBlock"}
            />
            <IconButton
              label="Add text block"
              shortLabel="Text"
              tooltip={
                placementMode === "textBlock"
                  ? "Turn off text block placement mode."
                  : "Turn on text block placement mode, then click the page."
              }
              onClick={() => togglePlacementMode("textBlock")}
              icon={<Type size={18} />}
              pressed={placementMode === "textBlock"}
            />
          </RibbonGroup>
          <RibbonGroup label="Font">
            <label className="ribbon-field ribbon-field-number">
              <span>Size</span>
              <input
                aria-label="Font size"
                type="number"
                min={1}
                value={doc.pageSettings.fontSize}
                onChange={(event) => {
                  const fontSize = Number(event.target.value);
                  if (Number.isFinite(fontSize) && fontSize > 0) {
                    updatePageSettings({ fontSize });
                  }
                }}
              />
            </label>
          </RibbonGroup>
          <RibbonGroup label="Lexicon">
            <IconButton
              label="Open lexicon"
              shortLabel="Open"
              tooltip="Open a separate lexicon file."
              onClick={openLexicon}
              icon={<Braces size={18} />}
            />
            <IconButton
              label="Save lexicon"
              shortLabel="Save"
              tooltip="Save the current lexicon."
              onClick={saveLexicon}
              icon={<Save size={18} />}
            />
          </RibbonGroup>
          <RibbonGroup label="Layer Tools">
            <IconButton
              label="Add layer"
              shortLabel="Layer"
              tooltip="Add an annotation layer."
              onClick={addLayer}
              icon={<Layers size={18} />}
            />
            <div className="layer-toggles" aria-label="Layer visibility">
              {doc.layers.map((layer) => (
                <LayerToggle key={layer.id} layer={layer} onToggle={() => toggleLayerVisibility(layer.id)} />
              ))}
            </div>
          </RibbonGroup>
          <div className="zoom-control">
            <IconButton
              label="Zoom out"
              shortLabel="Out"
              tooltip="Shrink the page view."
              onClick={() => adjustZoom(-ZOOM_STEP)}
              icon={<ZoomOut size={18} />}
              disabled={zoom <= ZOOM_MIN}
            />
            <span className="zoom-value" aria-label="Zoom level">
              {formatZoomPercent(zoom)}%
            </span>
            <IconButton
              label="Reset zoom"
              shortLabel="Reset"
              tooltip="Return the page view to 100%."
              onClick={() => resetZoom()}
              icon={<RotateCcw size={18} />}
              disabled={zoom === DEFAULT_ZOOM}
            />
            <IconButton
              label="Zoom in"
              shortLabel="In"
              tooltip="Expand the page view."
              onClick={() => adjustZoom(ZOOM_STEP)}
              icon={<ZoomIn size={18} />}
              disabled={zoom >= ZOOM_MAX}
            />
          </div>
          <div className="status-panel">
            <div className="status">{status}</div>
            {exportErrorDetail ? (
              <details className="export-error">
                <summary>Export details</summary>
                <pre>{exportErrorDetail}</pre>
              </details>
            ) : null}
            {fileErrorDetail ? (
              <details className="file-error">
                <summary>File details</summary>
                <pre>{fileErrorDetail}</pre>
              </details>
            ) : null}
          </div>
        </header>

        <div className="editor-shell">
          <div
            className="page-scroll"
            ref={pageScrollRef}
            onPointerDownCapture={startMiddleButtonZoom}
            onWheel={handleZoomWheel}
          >
            {doc.pages.map((page) => (
              <PageView
                key={page.id}
                page={page}
                doc={doc}
                layers={visibleLayers}
                selectedTokenIds={selectedTokenIds}
                editingTokenId={editingTokenId}
                editingAnnotationId={editingAnnotationId}
                editingPageObjectId={editingPageObjectId}
                placementMode={placementMode}
                selection={selection}
                snapTargetLineId={snapTargetLineId}
                zoom={zoom}
                assetUrls={assetUrls}
                onStartDrag={startDrag}
                onStartPageObjectResize={startPageObjectResize}
                onTokenChange={updateToken}
                onAnnotationTextChange={updateAnnotationText}
                onPageObjectTextChange={updatePageObjectText}
                onCreateWordAfterToken={createWordBoxAfterToken}
                onPlaceOnPage={placeOnPage}
                onPlaceWordOnLine={placeWordOnLine}
                onCreateTokenAnnotation={createTokenAnnotationFromHandle}
                onCreateSpanAnnotation={createSpanAnnotationFromHandle}
                onSelectToken={(tokenId, additive) => {
                  setEditingTokenId((current) => (current === tokenId ? current : null));
                  setEditingAnnotationId(null);
                  setEditingPageObjectId(null);
                  setSelection({ kind: "token", id: tokenId });
                  setSelectedTokenIds((current) =>
                    additive ? (current.includes(tokenId) ? current.filter((id) => id !== tokenId) : [...current, tokenId]) : [tokenId]
                  );
                  setInspectorTab("selection");
                }}
                onEditToken={(tokenId) => {
                  setSelection({ kind: "token", id: tokenId });
                  setSelectedTokenIds([tokenId]);
                  setEditingTokenId(tokenId);
                  setEditingAnnotationId(null);
                  setEditingPageObjectId(null);
                  setInspectorTab("selection");
                  setFocusTokenId(tokenId);
                }}
                onTokenInputBlur={stopTokenEditAfterBlur}
                onStopTokenEdit={() => setEditingTokenId(null)}
                onSelectAnnotation={(annotationId) => {
                  setEditingTokenId(null);
                  setEditingAnnotationId((current) => (current === annotationId ? current : null));
                  setEditingPageObjectId(null);
                  setSelection({ kind: "annotation", id: annotationId });
                  setInspectorTab("selection");
                }}
                onEditAnnotation={(annotationId) => {
                  setEditingTokenId(null);
                  setEditingPageObjectId(null);
                  setSelection({ kind: "annotation", id: annotationId });
                  setEditingAnnotationId(annotationId);
                  setInspectorTab("selection");
                  setFocusAnnotationId(annotationId);
                }}
                onStopAnnotationEdit={() => setEditingAnnotationId(null)}
                onEditPageObject={(objectId) => {
                  setEditingTokenId(null);
                  setEditingAnnotationId(null);
                  setSelection({ kind: "pageObject", id: objectId });
                  setEditingPageObjectId(objectId);
                  setInspectorTab("selection");
                  setFocusPageObjectId(objectId);
                }}
                onStopPageObjectEdit={() => setEditingPageObjectId(null)}
                onSelect={(nextSelection) => {
                  setEditingTokenId(null);
                  setEditingAnnotationId(null);
                  setEditingPageObjectId(null);
                  setSelection(nextSelection);
                }}
              />
            ))}
          </div>
          <Inspector
            doc={doc}
            lexicon={lexicon}
            layers={visibleLayers}
            token={selectedToken}
            line={selectedLine}
            span={selectedSpan}
            annotation={selectedAnnotation}
            pageObject={selectedPageObject}
            suggestions={suggestions}
            selectedTokenIds={selectedTokenIds}
            splitDraft={splitDraft}
            mergeJoiner={mergeJoiner}
            tokenOperationError={tokenOperationError}
            newLayerName={newLayerName}
            newLayerKind={newLayerKind}
            newLayerDirection={newLayerDirection}
            layerFormError={layerFormError}
            lexiconSearch={lexiconSearch}
            selectedLexiconEntryId={selectedLexiconEntryId}
            lexiconFormError={lexiconFormError}
            recentDocuments={recentDocuments}
            spanDraft={spanDraft}
            spanFormError={spanFormError}
            tab={inspectorTab}
            onApplySuggestion={applySuggestion}
            onTabChange={setInspectorTab}
            onTokenChange={updateToken}
            onLineChange={updateLine}
            onAnnotationChange={setAnnotation}
            onAnnotationTextChange={updateAnnotationText}
            onSpanChange={updateSpan}
            onLayerChange={updateLayer}
            onLexiconSearchChange={setLexiconSearch}
            onLexiconEntrySelect={setSelectedLexiconEntryId}
            onLexiconEntryCreate={createLexiconEntry}
            onLexiconEntryChange={updateLexiconEntry}
            onLexiconEntryDelete={deleteLexiconEntry}
            onOpenRecentDocument={(filePath) => void openDocument(filePath)}
            onRemoveRecentDocument={forgetRecentDocument}
            onChooseImage={chooseImageForObject}
            onPageObjectChange={updatePageObject}
            onPageObjectRectChange={updatePageObjectRect}
            onDocumentChange={(patch) => updateDocument((current) => ({ ...current, ...patch }), "Edit document")}
            onPageSettingsChange={updatePageSettings}
            onAddConceptSpan={addConceptSpanFromSelection}
            onSplitDraftChange={setSplitDraft}
            onMergeJoinerChange={setMergeJoiner}
            onSplitSelectedToken={splitSelectedToken}
            onMergeSelectedTokens={mergeSelectedTokens}
            onNewLayerNameChange={setNewLayerName}
            onNewLayerKindChange={setNewLayerKind}
            onNewLayerDirectionChange={setNewLayerDirection}
            onCreateLayer={createLayerFromDraft}
            onSpanDraftChange={(patch) => setSpanDraft((current) => ({ ...current, ...patch }))}
            onCreateSpan={createLayerSpanFromDraft}
          />
        </div>
      </main>
    </div>
  );
}

function PageView({
  page,
  doc,
  layers,
  selectedTokenIds,
  editingTokenId,
  editingAnnotationId,
  editingPageObjectId,
  placementMode,
  selection,
  snapTargetLineId,
  zoom,
  assetUrls,
  onStartDrag,
  onStartPageObjectResize,
  onTokenChange,
  onAnnotationTextChange,
  onPageObjectTextChange,
  onCreateWordAfterToken,
  onPlaceOnPage,
  onPlaceWordOnLine,
  onCreateTokenAnnotation,
  onCreateSpanAnnotation,
  onSelectToken,
  onEditToken,
  onTokenInputBlur,
  onStopTokenEdit,
  onSelectAnnotation,
  onEditAnnotation,
  onStopAnnotationEdit,
  onEditPageObject,
  onStopPageObjectEdit,
  onSelect
}: {
  page: Page;
  doc: InterlinearDocument;
  layers: Layer[];
  selectedTokenIds: string[];
  editingTokenId: string | null;
  editingAnnotationId: string | null;
  editingPageObjectId: string | null;
  placementMode: PlacementMode | null;
  selection: Selection;
  snapTargetLineId: string | null;
  zoom: number;
  assetUrls: AssetUrls;
  onStartDrag: (kind: DragStartKind, id: string, event: ReactPointerEvent<HTMLElement>) => void;
  onStartPageObjectResize: (
    objectId: string,
    handle: PageObjectResizeHandle,
    event: ReactPointerEvent<HTMLElement>
  ) => void;
  onTokenChange: (tokenId: string, patch: Partial<Token>, focusRestore?: TokenInputFocusRestore) => void;
  onAnnotationTextChange: (annotationId: string, text: string) => void;
  onPageObjectTextChange: (objectId: string, content: string) => void;
  onCreateWordAfterToken: (tokenId: string) => void;
  onPlaceOnPage: (pageId: string, point: { x: number; y: number }) => void;
  onPlaceWordOnLine: (pageId: string, lineId: string, x: number) => void;
  onCreateTokenAnnotation: (tokenId: string, placement: AnnotationPlacement) => void;
  onCreateSpanAnnotation: (spanId: string, placement: AnnotationPlacement) => void;
  onSelectToken: (tokenId: string, additive: boolean) => void;
  onEditToken: (tokenId: string) => void;
  onTokenInputBlur: (tokenId: string, relatedTarget: EventTarget | null) => void;
  onStopTokenEdit: () => void;
  onSelectAnnotation: (annotationId: string) => void;
  onEditAnnotation: (annotationId: string) => void;
  onStopAnnotationEdit: () => void;
  onEditPageObject: (objectId: string) => void;
  onStopPageObjectEdit: () => void;
  onSelect: (selection: Selection) => void;
}) {
  function handlePageClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!placementMode || event.target !== event.currentTarget) return;
    onPlaceOnPage(page.id, pagePointFromEvent(event, zoom, doc.pageSettings));
  }

  return (
    <div
      className="page-frame"
      data-page-id={page.id}
      aria-label={`Page ${page.number}`}
      style={{
        width: doc.pageSettings.width * zoom,
        height: doc.pageSettings.height * zoom
      }}
    >
      <div
        className={pageClassName(placementMode, doc.lineGuidesVisible)}
        style={{
          width: doc.pageSettings.width,
          height: doc.pageSettings.height,
          transform: `scale(${zoom})`,
          fontFamily: doc.pageSettings.fontFamily
        }}
        onClick={handlePageClick}
      >
        {doc.pageNumbersVisible ? <div className="page-number">{page.number}</div> : null}
        {doc.marginGuidesVisible ? <MarginGuides doc={doc} onStartDrag={onStartDrag} /> : null}
        {page.pageObjects
          .slice()
          .sort((left, right) => left.zIndex - right.zIndex)
          .map((object) => (
            <PageObjectView
              key={object.id}
              object={object}
              assetUrl={object.kind === "image" ? assetUrls[object.id] : undefined}
              guidesVisible={doc.lineGuidesVisible}
              selected={selection?.kind === "pageObject" && selection.id === object.id}
              editing={editingPageObjectId === object.id}
              onStartDrag={onStartDrag}
              onStartResize={onStartPageObjectResize}
              onEdit={onEditPageObject}
              onStopEdit={onStopPageObjectEdit}
              onTextChange={onPageObjectTextChange}
              onSelect={onSelect}
            />
          ))}
        {page.lines.map((line) => {
          const routed = routeLine(doc, page, line);
          const lineBoxHeight = sourceLineBoxHeight(doc.pageSettings);
          const selected = selection?.kind === "line" && selection.id === line.id;
          const snapTarget = snapTargetLineId === line.id;
          return (
            <div key={line.id} className={lineLayerClassName({ selected, snapTarget })}>
              {doc.lineGuidesVisible ? (
                <button
                  className={lineGuideClassName({
                    selected,
                    snapTarget
                  })}
                  style={{
                    left: doc.pageSettings.marginLeft,
                    top: routed.y,
                    width: doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight,
                    height: lineBoxHeight
                  }}
                  onPointerDown={(event) => {
                    if (placementMode) {
                      event.preventDefault();
                      event.stopPropagation();
                      const point = pagePointFromDescendantEvent(event, zoom, doc.pageSettings);
                      if (placementMode === "word") {
                        onPlaceWordOnLine(page.id, line.id, point.x);
                      } else {
                        onPlaceOnPage(page.id, point);
                      }
                      return;
                    }
                    onStartDrag("line", line.id, event);
                  }}
                  title={placementMode ? "Place on line" : "Move line guide"}
                  aria-label={`Line guide ${line.id}`}
                />
              ) : null}
              {doc.lineGuidesVisible
                ? routed.bands.map((band, index) => (
                    <div
                      className="routing-band"
                      key={`${line.id}-${index}`}
                      style={{ left: band.x, top: band.y, width: band.width, height: lineBoxHeight }}
                    />
                  ))
                : null}
              {routed.positionedTokens.map((positioned) => {
                const token = doc.tokens[positioned.tokenId];
                if (!token) return null;
                const wordBoxRect = wordBoxRectFromPositioned(positioned);
                const isSelected = selectedTokenIds.includes(token.id);
                const isEditing = editingTokenId === token.id;
                return (
                  <div
                    key={token.id}
                    data-token-id={token.id}
                    className={`word-box${isSelected ? " selected" : ""}${isEditing ? " editing" : ""}`}
                    style={{
                      left: wordBoxRect.x,
                      top: wordBoxRect.y,
                      width: wordBoxRect.width,
                      height: wordBoxRect.height,
                      minHeight: wordBoxRect.height,
                      fontSize: doc.pageSettings.fontSize
                    }}
                    onPointerDown={(event) => {
                      if (placementMode === "span") {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                      }
                      onStartDrag("token", token.id, event);
                    }}
                    onClick={(event) => onSelectToken(token.id, placementMode === "span" || event.shiftKey)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onEditToken(token.id);
                    }}
                  >
                    <input
                      className="word-input"
                      aria-label={`Word box ${token.text || "empty"}`}
                      data-token-input={token.id}
                      value={token.text}
                      placeholder="word"
                      readOnly={!isEditing}
                      onPointerDown={(event) => {
                        if (isEditing) {
                          event.stopPropagation();
                        } else {
                          event.preventDefault();
                        }
                      }}
                      onFocus={() => onSelectToken(token.id, false)}
                      onBlur={(event) => {
                        if (isEditing) onTokenInputBlur(token.id, event.relatedTarget);
                      }}
                      onChange={(event) => {
                        if (isEditing) {
                          onTokenChange(
                            token.id,
                            { text: event.currentTarget.value },
                            {
                              tokenId: token.id,
                              selectionStart: event.currentTarget.selectionStart,
                              selectionEnd: event.currentTarget.selectionEnd
                            }
                          );
                        }
                      }}
                      onKeyDown={(event) => {
                        if (!isEditing || event.nativeEvent.isComposing) return;
                        const isPlainKey =
                          !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
                        if (
                          event.key === " " &&
                          isPlainKey
                        ) {
                          event.preventDefault();
                          onCreateWordAfterToken(token.id);
                        } else if (event.key === "Enter" && isPlainKey) {
                          event.preventDefault();
                          onStopTokenEdit();
                          event.currentTarget.blur();
                        }
                      }}
                      title={isEditing ? token.normalized : "Double-click to edit; drag to move. Use Span mode to select multiple words."}
                    />
                  </div>
                );
              })}
              {doc.lineGuidesVisible
                ? routed.positionedTokens.map((positioned) => {
                    const token = doc.tokens[positioned.tokenId];
                    if (!token) return null;
                    const wordBoxRect = wordBoxRectFromPositioned(positioned);
                    const annotations = annotationEntriesForToken(doc, layers, token.id);
                    return (
                      <AnnotationHandlePair
                        key={`${token.id}-annotation-handles`}
                        rect={wordBoxRect}
                        label={token.text || "empty word"}
                        occupiedPlacements={occupiedAnnotationPlacements(annotations)}
                        onCreate={(placement) => onCreateTokenAnnotation(token.id, placement)}
                      />
                    );
                  })
                : null}
              {routed.positionedTokens.flatMap((positioned) => {
                const token = doc.tokens[positioned.tokenId];
                if (!token) return [];
                const wordBoxRect = wordBoxRectFromPositioned(positioned);
                return annotationEntriesForToken(doc, layers, token.id).map((entry) => (
                  <AnnotationWordBox
                    key={entry.cell.id}
                    entry={entry}
                    sourceRect={wordBoxRect}
                    sourceLabel={token.text || "empty word"}
                    doc={doc}
                    selected={selection?.kind === "annotation" && selection.id === entry.cell.id}
                    editing={editingAnnotationId === entry.cell.id}
                    onStartDrag={onStartDrag}
                    onSelect={onSelectAnnotation}
                    onEdit={onEditAnnotation}
                    onStopEdit={onStopAnnotationEdit}
                    onTextChange={onAnnotationTextChange}
                  />
                ));
              })}
            </div>
          );
        })}
        {Object.values(doc.layerSpans).map((span) => {
          const startLine = page.lines.find((line) => line.tokenIds.includes(span.startTokenId));
          if (!startLine) return null;
          const routed = routeLine(doc, page, startLine);
          const start = routed.positionedTokens.find((positioned) => positioned.tokenId === span.startTokenId);
          const end = routed.positionedTokens.find((positioned) => positioned.tokenId === span.endTokenId);
          if (!start || !end) return null;
          const layer = layers.find((item) => item.id === span.layerId);
          const layerIndex = layer ? layers.indexOf(layer) : 0;
          const spanLeft = Math.min(start.rect.x, end.rect.x);
          const spanRight = Math.max(start.rect.x + start.rect.width, end.rect.x + end.rect.width);
          const rect = span.rect ?? {
            x: spanLeft + span.offset.x,
            y: start.rect.y - doc.pageSettings.annotationGap * (layerIndex + 1) + span.offset.y,
            width: spanRight - spanLeft,
            height: 18
          };
          const annotations = annotationEntriesForSpan(doc, layers, span.id);
          return (
            <Fragment key={span.id}>
              <button
                className={selection?.kind === "span" && selection.id === span.id ? "span-label selected" : "span-label"}
                style={{ left: rect.x, top: rect.y, width: rect.width, minHeight: rect.height }}
                onPointerDown={(event) => onStartDrag("span", span.id, event)}
                title={layer?.name ?? "Layer span"}
              >
                {span.text}
              </button>
              {doc.lineGuidesVisible ? (
                <AnnotationHandlePair
                  rect={rect}
                  label={span.text || "concept span"}
                  occupiedPlacements={occupiedAnnotationPlacements(annotations)}
                  onCreate={(placement) => onCreateSpanAnnotation(span.id, placement)}
                />
              ) : null}
              {annotations.map((entry) => (
                <AnnotationWordBox
                  key={entry.cell.id}
                  entry={entry}
                  sourceRect={rect}
                  sourceLabel={span.text || "concept span"}
                  doc={doc}
                  selected={selection?.kind === "annotation" && selection.id === entry.cell.id}
                  editing={editingAnnotationId === entry.cell.id}
                  onStartDrag={onStartDrag}
                  onSelect={onSelectAnnotation}
                  onEdit={onEditAnnotation}
                  onStopEdit={onStopAnnotationEdit}
                  onTextChange={onAnnotationTextChange}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function MarginGuides({
  doc,
  onStartDrag
}: {
  doc: InterlinearDocument;
  onStartDrag: (kind: DragStartKind, id: string, event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const { width, height, marginTop, marginRight, marginBottom, marginLeft } = doc.pageSettings;
  const contentWidth = Math.max(0, width - marginLeft - marginRight);
  const contentHeight = Math.max(0, height - marginTop - marginBottom);
  const rightX = width - marginRight;
  const bottomY = height - marginBottom;

  return (
    <>
      <button
        className="margin-guide margin-guide-vertical margin-guide-left"
        style={{ left: marginLeft, top: marginTop, height: contentHeight }}
        onPointerDown={(event) => onStartDrag("marginGuide", "left", event)}
        title="Drag left margin"
        aria-label="Left margin guide"
      />
      <button
        className="margin-guide margin-guide-vertical margin-guide-right"
        style={{ left: rightX, top: marginTop, height: contentHeight }}
        onPointerDown={(event) => onStartDrag("marginGuide", "right", event)}
        title="Drag right margin"
        aria-label="Right margin guide"
      />
      <button
        className="margin-guide margin-guide-horizontal margin-guide-top"
        style={{ left: marginLeft, top: marginTop, width: contentWidth }}
        onPointerDown={(event) => onStartDrag("marginGuide", "top", event)}
        title="Drag top margin"
        aria-label="Top margin guide"
      />
      <button
        className="margin-guide margin-guide-horizontal margin-guide-bottom"
        style={{ left: marginLeft, top: bottomY, width: contentWidth }}
        onPointerDown={(event) => onStartDrag("marginGuide", "bottom", event)}
        title="Drag bottom margin"
        aria-label="Bottom margin guide"
      />
    </>
  );
}

function AnnotationHandlePair({
  rect,
  label,
  occupiedPlacements,
  onCreate
}: {
  rect: Rect;
  label: string;
  occupiedPlacements?: Partial<Record<AnnotationPlacement, boolean>>;
  onCreate: (placement: AnnotationPlacement) => void;
}) {
  const centerX = rect.x + rect.width / 2;
  const connectorLength = ANNOTATION_CONNECTOR_LENGTH;
  const handleSize = 6.6;

  function createFromHandle(placement: AnnotationPlacement, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onCreate(placement);
  }

  function stopPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <>
      <div
        className="annotation-connector annotation-connector-above"
        style={{ left: centerX, top: rect.y - connectorLength, height: connectorLength }}
        aria-hidden="true"
      />
      {occupiedPlacements?.above ? null : (
        <button
          className="annotation-handle annotation-handle-above"
          style={{ left: centerX - handleSize / 2, top: rect.y - connectorLength - handleSize / 2 }}
          onPointerDown={stopPointer}
          onClick={(event) => createFromHandle("above", event)}
          aria-label={`Add above annotation for ${label}`}
          title="Add above annotation"
        />
      )}
      <div
        className="annotation-connector annotation-connector-below"
        style={{ left: centerX, top: rect.y + rect.height, height: connectorLength }}
        aria-hidden="true"
      />
      {occupiedPlacements?.below ? null : (
        <button
          className="annotation-handle annotation-handle-below"
          style={{ left: centerX - handleSize / 2, top: rect.y + rect.height + connectorLength - handleSize / 2 }}
          onPointerDown={stopPointer}
          onClick={(event) => createFromHandle("below", event)}
          aria-label={`Add below annotation for ${label}`}
          title="Add below annotation"
        />
      )}
    </>
  );
}

function AnnotationWordBox({
  entry,
  sourceRect,
  sourceLabel,
  doc,
  selected,
  editing,
  onStartDrag,
  onSelect,
  onEdit,
  onStopEdit,
  onTextChange
}: {
  entry: RenderedAnnotation;
  sourceRect: Rect;
  sourceLabel: string;
  doc: InterlinearDocument;
  selected: boolean;
  editing: boolean;
  onStartDrag: (kind: DragStartKind, id: string, event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: (annotationId: string) => void;
  onEdit: (annotationId: string) => void;
  onStopEdit: () => void;
  onTextChange: (annotationId: string, text: string) => void;
}) {
  const rect = annotationBoxRect(sourceRect, entry.cell, doc.pageSettings, entry.placementIndex);
  const fontSize = annotationBoxFontSize(doc.pageSettings);
  return (
    <div
      role="button"
      tabIndex={0}
      data-annotation-id={entry.cell.id}
      className={`annotation annotation-word-box${selected ? " selected" : ""}${editing ? " editing" : ""}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        minHeight: rect.height,
        fontSize
      }}
      aria-label={`${entry.cell.placement} annotation for ${sourceLabel}`}
      onPointerDown={(event) => {
        if (!editing) onStartDrag("annotation", entry.cell.id, event);
      }}
      onClick={() => onSelect(entry.cell.id)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onEdit(entry.cell.id);
      }}
    >
      <input
        className="word-input annotation-input"
        aria-label={`Annotation ${entry.cell.placement} for ${sourceLabel}`}
        data-annotation-input={entry.cell.id}
        value={entry.cell.text}
        placeholder="Annotation"
        readOnly={!editing}
        onPointerDown={(event) => {
          if (editing) {
            event.stopPropagation();
          } else {
            event.preventDefault();
          }
        }}
        onFocus={() => onSelect(entry.cell.id)}
        onBlur={() => {
          if (editing) onStopEdit();
        }}
        onChange={(event) => {
          if (editing) onTextChange(entry.cell.id, event.target.value);
        }}
        onKeyDown={(event) => {
          if (!editing || event.nativeEvent.isComposing) return;
          const isPlainEnter = event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
          if (isPlainEnter) {
            event.preventDefault();
            onStopEdit();
            event.currentTarget.blur();
          }
        }}
        title={editing ? "Edit annotation" : "Double-click to edit; drag to move."}
      />
    </div>
  );
}

function PageObjectView({
  object,
  assetUrl,
  guidesVisible,
  selected,
  editing,
  onStartDrag,
  onStartResize,
  onEdit,
  onStopEdit,
  onTextChange,
  onSelect
}: {
  object: PageObject;
  assetUrl?: string;
  guidesVisible: boolean;
  selected: boolean;
  editing: boolean;
  onStartDrag: (kind: DragStartKind, id: string, event: ReactPointerEvent<HTMLElement>) => void;
  onStartResize: (objectId: string, handle: PageObjectResizeHandle, event: ReactPointerEvent<HTMLElement>) => void;
  onEdit: (objectId: string) => void;
  onStopEdit: () => void;
  onTextChange: (objectId: string, content: string) => void;
  onSelect: (selection: Selection) => void;
}) {
  const resizeHandles: PageObjectResizeHandle[] = ["nw", "ne", "sw", "se"];
  const editingInlineText = editing && isInlineEditablePageObject(object);
  const showResizeHandles = selected && !editingInlineText && (guidesVisible || !isTextPageObject(object));

  function editPageObjectText(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isInlineEditablePageObject(object)) return;
    event.preventDefault();
    event.stopPropagation();
    onEdit(object.id);
  }

  return (
    <div
      data-page-object-id={object.id}
      className={pageObjectClassName(object, selected, editingInlineText)}
      style={{
        left: object.rect.x,
        top: object.rect.y,
        width: object.rect.width,
        height: object.rect.height,
        zIndex: object.zIndex
      }}
      onPointerDown={(event) => onStartDrag("pageObject", object.id, event)}
      onClick={() => onSelect({ kind: "pageObject", id: object.id })}
      onDoubleClick={editPageObjectText}
    >
      {object.kind === "image" ? (
        assetUrl ? (
          <img src={assetUrl} alt={object.caption || "Page image"} />
        ) : (
          <div className="asset-missing">Image</div>
        )
      ) : editingInlineText ? (
        <input
          className={`${textPageObjectClassName(object.kind)} page-object-text-input`}
          aria-label={`${TEXT_PAGE_OBJECT_CONFIG[object.kind].contentLabel} block text`}
          data-page-object-input={object.id}
          value={object.content}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={onStopEdit}
          onChange={(event) => onTextChange(object.id, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            const isPlainEnter = event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
            if (isPlainEnter) {
              event.preventDefault();
              onStopEdit();
              event.currentTarget.blur();
            }
          }}
          title="Edit page object text"
        />
      ) : (
        <div className={textPageObjectClassName(object.kind)}>{object.content}</div>
      )}
      {object.caption ? <div className="object-caption">{object.caption}</div> : null}
      {showResizeHandles
        ? resizeHandles.map((handle) => (
            <button
              key={handle}
              className={`page-object-resize-handle page-object-resize-${handle}`}
              onPointerDown={(event) => onStartResize(object.id, handle, event)}
              aria-label={`Resize page object ${resizeHandleLabel(handle)}`}
              title={`Resize ${resizeHandleLabel(handle)}`}
            />
          ))
        : null}
    </div>
  );
}

function Inspector({
  doc,
  lexicon,
  layers,
  tab,
  token,
  line,
  span,
  annotation,
  pageObject,
  suggestions,
  selectedTokenIds,
  splitDraft,
  mergeJoiner,
  tokenOperationError,
  newLayerName,
  newLayerKind,
  newLayerDirection,
  layerFormError,
  lexiconSearch,
  selectedLexiconEntryId,
  lexiconFormError,
  recentDocuments,
  spanDraft,
  spanFormError,
  onApplySuggestion,
  onTabChange,
  onTokenChange,
  onLineChange,
  onAnnotationChange,
  onAnnotationTextChange,
  onSpanChange,
  onLayerChange,
  onLexiconSearchChange,
  onLexiconEntrySelect,
  onLexiconEntryCreate,
  onLexiconEntryChange,
  onLexiconEntryDelete,
  onOpenRecentDocument,
  onRemoveRecentDocument,
  onChooseImage,
  onPageObjectChange,
  onPageObjectRectChange,
  onDocumentChange,
  onPageSettingsChange,
  onAddConceptSpan,
  onSplitDraftChange,
  onMergeJoinerChange,
  onSplitSelectedToken,
  onMergeSelectedTokens,
  onNewLayerNameChange,
  onNewLayerKindChange,
  onNewLayerDirectionChange,
  onCreateLayer,
  onSpanDraftChange,
  onCreateSpan
}: {
  doc: InterlinearDocument;
  lexicon: Lexicon;
  layers: Layer[];
  tab: InspectorTab;
  token: Token | null;
  line: InterlinearLine | null;
  span: LayerSpan | null;
  annotation: AnnotationCell | null;
  pageObject: PageObject | null;
  suggestions: LexiconSuggestion[];
  selectedTokenIds: string[];
  splitDraft: string;
  mergeJoiner: string;
  tokenOperationError: string;
  newLayerName: string;
  newLayerKind: LayerKind;
  newLayerDirection: Layer["direction"];
  layerFormError: string;
  lexiconSearch: string;
  selectedLexiconEntryId: string;
  lexiconFormError: string;
  recentDocuments: RecentDocument[];
  spanDraft: SpanDraft;
  spanFormError: string;
  onApplySuggestion: (suggestion: LexiconSuggestion) => void;
  onTabChange: (tab: InspectorTab) => void;
  onTokenChange: (tokenId: string, patch: Partial<Token>) => void;
  onLineChange: (lineId: string, patch: Partial<InterlinearLine>) => void;
  onAnnotationChange: (tokenId: string, layerId: string, text: string, lexiconEntryId?: string) => void;
  onAnnotationTextChange: (annotationId: string, text: string) => void;
  onSpanChange: (spanId: string, patch: Partial<LayerSpan>) => void;
  onLayerChange: (layerId: string, patch: Partial<Layer>) => void;
  onLexiconSearchChange: (value: string) => void;
  onLexiconEntrySelect: (entryId: string) => void;
  onLexiconEntryCreate: () => void;
  onLexiconEntryChange: (entryId: string, patch: Partial<LexiconEntry>) => void;
  onLexiconEntryDelete: (entryId: string) => void;
  onOpenRecentDocument: (filePath: string) => void;
  onRemoveRecentDocument: (filePath: string) => void;
  onChooseImage: (objectId: string) => void | Promise<void>;
  onPageObjectChange: (objectId: string, patch: Partial<PageObject>) => void;
  onPageObjectRectChange: (objectId: string, rect: Rect) => void;
  onDocumentChange: (patch: Partial<InterlinearDocument>) => void;
  onPageSettingsChange: (patch: Partial<InterlinearDocument["pageSettings"]>) => void;
  onAddConceptSpan: () => void;
  onSplitDraftChange: (value: string) => void;
  onMergeJoinerChange: (value: string) => void;
  onSplitSelectedToken: () => void;
  onMergeSelectedTokens: () => void;
  onNewLayerNameChange: (value: string) => void;
  onNewLayerKindChange: (value: LayerKind) => void;
  onNewLayerDirectionChange: (value: Layer["direction"]) => void;
  onCreateLayer: () => void;
  onSpanDraftChange: (patch: Partial<SpanDraft>) => void;
  onCreateSpan: () => void;
}) {
  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">
        <button className={tab === "selection" ? "tab active" : "tab"} onClick={() => onTabChange("selection")}>
          Selection
        </button>
        <button className={tab === "document" ? "tab active" : "tab"} onClick={() => onTabChange("document")}>
          Document
        </button>
        <button className={tab === "layers" ? "tab active" : "tab"} onClick={() => onTabChange("layers")}>
          Layers
        </button>
        <button className={tab === "lexicon" ? "tab active" : "tab"} onClick={() => onTabChange("lexicon")}>
          Lexicon
        </button>
      </div>

      {tab === "selection" && token ? (
        <div className="inspector-section">
          <label>
            Token
            <input value={token.text} onChange={(event) => onTokenChange(token.id, { text: event.target.value })} />
          </label>
          <label>
            Normalized
            <input
              value={token.normalized}
              onChange={(event) => onTokenChange(token.id, { normalized: event.target.value })}
            />
          </label>
          <label>
            Direction
            <DirectionSelect value={token.direction} onChange={(direction) => onTokenChange(token.id, { direction })} />
          </label>
          {layers.map((layer) => {
            const cell = Object.values(doc.annotationCells).find(
              (annotationCell) => !annotationCell.spanId && annotationCell.tokenId === token.id && annotationCell.layerId === layer.id
            );
            return (
              <label key={layer.id}>
                {layer.name}
                <input value={cell?.text ?? ""} onChange={(event) => onAnnotationChange(token.id, layer.id, event.target.value)} />
              </label>
            );
          })}
          <SpanCreationPanel
            layers={doc.layers}
            selectedTokenIds={selectedTokenIds}
            selectedText={orderSelectedTokenIds(doc, selectedTokenIds)
              .map((id) => doc.tokens[id]?.text ?? "")
              .join(" ")}
            draft={spanDraft}
            error={spanFormError}
            onDraftChange={onSpanDraftChange}
            onCreate={onCreateSpan}
          />
          <div className="token-operations" aria-label="Token operations">
            <div className="subhead">Token Operations</div>
            <label>
              Split parts
              <input
                value={splitDraft}
                onChange={(event) => onSplitDraftChange(event.target.value)}
                placeholder="Separate parts with spaces"
              />
            </label>
            <button className="command" onClick={onSplitSelectedToken}>
              Split token
            </button>
            <label>
              Merge join text
              <input
                value={mergeJoiner}
                onChange={(event) => onMergeJoinerChange(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <button className="command" onClick={onMergeSelectedTokens} disabled={selectedTokenIds.length < 2}>
              Merge selected tokens
            </button>
            {tokenOperationError ? (
              <div className="field-error" role="alert">
                {tokenOperationError}
              </div>
            ) : null}
          </div>
          <SuggestionList suggestions={suggestions} onApply={onApplySuggestion} />
        </div>
      ) : null}

      {tab === "selection" && line && !token ? (
        <div className="inspector-section">
          <div className="panel-title">Line</div>
          <label>
            Direction
            <DirectionSelect value={line.direction} onChange={(direction) => onLineChange(line.id, { direction })} />
          </label>
        </div>
      ) : null}

      {tab === "selection" && span ? (
        <div className="inspector-section">
          <label>
            Span text
            <input value={span.text} onChange={(event) => onSpanChange(span.id, { text: event.target.value })} />
          </label>
          <label>
            Direction
            <DirectionSelect value={span.direction} onChange={(direction) => onSpanChange(span.id, { direction })} />
          </label>
          <label>
            Notes
            <textarea value={span.notes ?? ""} onChange={(event) => onSpanChange(span.id, { notes: event.target.value })} />
          </label>
        </div>
      ) : null}

      {tab === "selection" && annotation ? (
        <div className="inspector-section">
          <label>
            Annotation
            <input
              value={annotation.text}
              onChange={(event) => onAnnotationTextChange(annotation.id, event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {tab === "selection" && pageObject ? (
        <div className="inspector-section">
          <div className="grid-2">
            <NumberInput
              label="X"
              value={pageObject.rect.x}
              onChange={(x) => onPageObjectRectChange(pageObject.id, { ...pageObject.rect, x })}
            />
            <NumberInput
              label="Y"
              value={pageObject.rect.y}
              onChange={(y) => onPageObjectRectChange(pageObject.id, { ...pageObject.rect, y })}
            />
            <NumberInput
              label="W"
              value={pageObject.rect.width}
              min={PAGE_OBJECT_MIN_WIDTH}
              onChange={(width) => onPageObjectRectChange(pageObject.id, { ...pageObject.rect, width })}
            />
            <NumberInput
              label="H"
              value={pageObject.rect.height}
              min={PAGE_OBJECT_MIN_HEIGHT}
              onChange={(height) => onPageObjectRectChange(pageObject.id, { ...pageObject.rect, height })}
            />
          </div>
          <label>
            Wrap
            <select
              value={pageObject.wrapMode}
              onChange={(event) => onPageObjectChange(pageObject.id, { wrapMode: event.target.value as PageObject["wrapMode"] })}
            >
              <option value="rectangular">Rectangular</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            Caption
            <input
              value={pageObject.caption ?? ""}
              onChange={(event) => onPageObjectChange(pageObject.id, { caption: event.target.value })}
            />
          </label>
          {isTextPageObject(pageObject) ? (
            <label>
              {TEXT_PAGE_OBJECT_CONFIG[pageObject.kind].contentLabel}
              <textarea
                value={pageObject.content}
                onChange={(event) => onPageObjectChange(pageObject.id, { content: event.target.value })}
                rows={6}
              />
            </label>
          ) : null}
          {pageObject.kind === "image" ? (
            <div className="image-source-controls">
              <button className="command" onClick={() => void onChooseImage(pageObject.id)}>
                Choose image file
              </button>
              <div className="asset-path">{pageObject.assetPath ? fileName(pageObject.assetPath) : "No image selected"}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "document" ? (
        <>
          <div className="inspector-section">
            <div className="panel-title">Document Metadata</div>
            <label>
              Title
              <input value={doc.title} onChange={(event) => onDocumentChange({ title: event.target.value })} />
            </label>
            <label>
              Language
              <input value={doc.sourceLanguage} onChange={(event) => onDocumentChange({ sourceLanguage: event.target.value })} />
            </label>
            <label>
              Direction
              <DirectionSelect value={doc.direction} onChange={(direction) => onDocumentChange({ direction })} />
            </label>
          </div>
          <RecentDocumentsPanel
            recentDocuments={recentDocuments}
            onOpen={onOpenRecentDocument}
            onRemove={onRemoveRecentDocument}
          />
          <div className="inspector-section" aria-label="Document layout">
            <div className="panel-title">Document Layout</div>
            <div className="grid-2">
              <NumberInput
                label="Page W"
                value={doc.pageSettings.width}
                min={MIN_PAGE_DIMENSION}
                onChange={(width) => onPageSettingsChange({ width })}
              />
              <NumberInput
                label="Page H"
                value={doc.pageSettings.height}
                min={MIN_PAGE_DIMENSION}
                onChange={(height) => onPageSettingsChange({ height })}
              />
              <NumberInput
                label="Top margin"
                value={doc.pageSettings.marginTop}
                min={0}
                onChange={(marginTop) => onPageSettingsChange({ marginTop })}
              />
              <NumberInput
                label="Right margin"
                value={doc.pageSettings.marginRight}
                min={0}
                onChange={(marginRight) => onPageSettingsChange({ marginRight })}
              />
              <NumberInput
                label="Bottom margin"
                value={doc.pageSettings.marginBottom}
                min={0}
                onChange={(marginBottom) => onPageSettingsChange({ marginBottom })}
              />
              <NumberInput
                label="Left margin"
                value={doc.pageSettings.marginLeft}
                min={0}
                onChange={(marginLeft) => onPageSettingsChange({ marginLeft })}
              />
              <NumberInput
                label="Line gap"
                value={doc.pageSettings.lineGap}
                min={0}
                onChange={(lineGap) => onPageSettingsChange({ lineGap })}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={doc.pageNumbersVisible}
                onChange={(event) => onDocumentChange({ pageNumbersVisible: event.target.checked })}
              />
              Page numbers
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={doc.lineGuidesVisible}
                onChange={(event) => onDocumentChange({ lineGuidesVisible: event.target.checked })}
              />
              Line guides
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={doc.marginGuidesVisible}
                onChange={(event) => onDocumentChange({ marginGuidesVisible: event.target.checked })}
              />
              Margin guides
            </label>
          </div>
        </>
      ) : null}

      {tab === "layers" ? (
        <div className="inspector-section">
          <div className="panel-title">Create Layer</div>
          <label>
            New layer name
            <input value={newLayerName} onChange={(event) => onNewLayerNameChange(event.target.value)} />
          </label>
          <div className="grid-2">
            <label>
              Kind
              <select value={newLayerKind} onChange={(event) => onNewLayerKindChange(event.target.value as LayerKind)}>
                {LAYER_KIND_OPTIONS.map((kind) => (
                  <option value={kind} key={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select
                value={newLayerDirection}
                onChange={(event) => onNewLayerDirectionChange(event.target.value as Layer["direction"])}
              >
                <option value="ltr">LTR</option>
                <option value="rtl">RTL</option>
              </select>
            </label>
          </div>
          <button className="command" onClick={onCreateLayer}>
            <Layers size={16} /> Create layer
          </button>
          {layerFormError ? (
            <div className="field-error" role="alert">
              {layerFormError}
            </div>
          ) : null}
          <div className="panel-title">Layers</div>
          {doc.layers.map((layer) => (
            <LayerEditor key={layer.id} layer={layer} layers={doc.layers} onLayerChange={onLayerChange} />
          ))}
          <SpanCreationPanel
            layers={doc.layers}
            selectedTokenIds={selectedTokenIds}
            selectedText={orderSelectedTokenIds(doc, selectedTokenIds)
              .map((id) => doc.tokens[id]?.text ?? "")
              .join(" ")}
            draft={spanDraft}
            error={spanFormError}
            onDraftChange={onSpanDraftChange}
            onCreate={onCreateSpan}
          />
        </div>
      ) : null}

      {tab === "lexicon" ? (
        <LexiconManager
          lexicon={lexicon}
          search={lexiconSearch}
          selectedEntryId={selectedLexiconEntryId}
          error={lexiconFormError}
          onSearchChange={onLexiconSearchChange}
          onSelect={onLexiconEntrySelect}
          onCreate={onLexiconEntryCreate}
          onChange={onLexiconEntryChange}
          onDelete={onLexiconEntryDelete}
        />
      ) : null}

      {tab === "selection" && !token && !span && !annotation && !pageObject ? <p className="muted">No selection</p> : null}
    </aside>
  );
}

function LexiconManager({
  lexicon,
  search,
  selectedEntryId,
  error,
  onSearchChange,
  onSelect,
  onCreate,
  onChange,
  onDelete
}: {
  lexicon: Lexicon;
  search: string;
  selectedEntryId: string;
  error: string;
  onSearchChange: (value: string) => void;
  onSelect: (entryId: string) => void;
  onCreate: () => void;
  onChange: (entryId: string, patch: Partial<LexiconEntry>) => void;
  onDelete: (entryId: string) => void;
}) {
  const entries = Object.values(lexicon.entries).sort((left, right) => left.lemma.localeCompare(right.lemma));
  const filtered = entries.filter((entry) => lexiconEntryMatches(entry, search));
  const selectedEntry = lexicon.entries[selectedEntryId] ?? filtered[0] ?? null;

  return (
    <div className="inspector-section lexicon-manager">
      <div className="panel-title">Lexicon Entries</div>
      <label>
        Search
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="lemma, gloss, tag" />
      </label>
      <button className="command" onClick={onCreate}>
        <Plus size={16} /> New entry
      </button>
      <div className="lexicon-entry-list" aria-label="Lexicon entries">
        {filtered.length === 0 ? <p className="muted">No lexicon entries</p> : null}
        {filtered.map((entry) => (
          <button
            key={entry.id}
            className={selectedEntry?.id === entry.id ? "lexicon-entry-row active" : "lexicon-entry-row"}
            onClick={() => onSelect(entry.id)}
            aria-label={`Edit ${entry.lemma}`}
          >
            <span>{entry.lemma}</span>
            <small>
              {entry.kind} · {entry.glosses[0]?.text || "no gloss"}
            </small>
          </button>
        ))}
      </div>
      {selectedEntry ? (
        <LexiconEntryForm entry={selectedEntry} error={error} onChange={onChange} onDelete={() => onDelete(selectedEntry.id)} />
      ) : (
        <p className="muted">Create an entry to start editing this lexicon.</p>
      )}
    </div>
  );
}

function RecentDocumentsPanel({
  recentDocuments,
  onOpen,
  onRemove
}: {
  recentDocuments: RecentDocument[];
  onOpen: (filePath: string) => void;
  onRemove: (filePath: string) => void;
}) {
  return (
    <div className="inspector-section recent-documents" aria-label="Recent documents">
      <div className="panel-title">Recent Documents</div>
      {recentDocuments.length === 0 ? <p className="muted">No recent documents</p> : null}
      {recentDocuments.map((item) => (
        <div className="recent-document-row" key={item.filePath} title={item.filePath}>
          <button className="recent-document-open" onClick={() => onOpen(item.filePath)} aria-label={`Open ${fileName(item.filePath)}`}>
            <span>{fileName(item.filePath)}</span>
            {folderName(item.filePath) ? <small>{folderName(item.filePath)}</small> : null}
          </button>
          <button
            className="recent-document-remove"
            onClick={() => onRemove(item.filePath)}
            aria-label={`Remove ${fileName(item.filePath)} from recent documents`}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function LexiconEntryForm({
  entry,
  error,
  onChange,
  onDelete
}: {
  entry: LexiconEntry;
  error: string;
  onChange: (entryId: string, patch: Partial<LexiconEntry>) => void;
  onDelete: () => void;
}) {
  const normalizationPreview = normalizeTerm(entry.lemma);

  return (
    <div className="lexicon-entry-form">
      <div className="subhead">Entry</div>
      <label>
        Lemma
        <input
          value={entry.lemma}
          onChange={(event) =>
            onChange(entry.id, {
              lemma: event.target.value,
              normalizedForms: entry.normalizedForms.length === 0 ? [normalizeTerm(event.target.value)] : entry.normalizedForms
            })
          }
        />
      </label>
      <div className="selection-preview" aria-label="Normalization preview">
        {normalizationPreview || "No normalized form"}
      </div>
      <label>
        Kind
        <select value={entry.kind} onChange={(event) => onChange(entry.id, { kind: event.target.value as LexiconEntry["kind"] })}>
          <option value="token">token</option>
          <option value="concept">concept</option>
        </select>
      </label>
      <label>
        Normalized forms
        <textarea
          value={entry.normalizedForms.join("\n")}
          onChange={(event) =>
            onChange(entry.id, { normalizedForms: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean) })
          }
          rows={3}
        />
      </label>
      <label>
        Glosses
        <textarea
          value={entry.glosses.map((gloss) => gloss.text).join("\n")}
          onChange={(event) => onChange(entry.id, { glosses: glossesFromText(event.target.value) })}
          rows={3}
        />
      </label>
      <label>
        Notes
        <textarea value={entry.notes ?? ""} onChange={(event) => onChange(entry.id, { notes: event.target.value })} rows={3} />
      </label>
      <label>
        Tags
        <input
          value={entry.tags.join(", ")}
          onChange={(event) =>
            onChange(entry.id, {
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }
        />
      </label>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
      <button className="command secondary" onClick={onDelete}>
        Delete entry
      </button>
    </div>
  );
}

function SpanCreationPanel({
  layers,
  selectedTokenIds,
  selectedText,
  draft,
  error,
  onDraftChange,
  onCreate
}: {
  layers: Layer[];
  selectedTokenIds: string[];
  selectedText: string;
  draft: SpanDraft;
  error: string;
  onDraftChange: (patch: Partial<SpanDraft>) => void;
  onCreate: () => void;
}) {
  return (
    <div className="span-creation" aria-label="Span creation">
      <div className="subhead">Span From Selection</div>
      <div className="selection-preview" aria-label="Selected span tokens">
        {selectedText || "No tokens selected"}
      </div>
      <label>
        Span layer
        <select value={draft.layerId} onChange={(event) => onDraftChange({ layerId: event.target.value })}>
          {layers.map((layer) => (
            <option value={layer.id} key={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Span text
        <input value={draft.text} onChange={(event) => onDraftChange({ text: event.target.value })} />
      </label>
      <label>
        Span notes
        <textarea value={draft.notes} onChange={(event) => onDraftChange({ notes: event.target.value })} rows={3} />
      </label>
      <div className="grid-2">
        <label>
          Tags
          <input value={draft.tags} onChange={(event) => onDraftChange({ tags: event.target.value })} placeholder="comma-separated" />
        </label>
        <label>
          Lexicon ID
          <input value={draft.lexiconEntryId} onChange={(event) => onDraftChange({ lexiconEntryId: event.target.value })} />
        </label>
      </div>
      <button className="command" onClick={onCreate} disabled={selectedTokenIds.length === 0}>
        <SquarePen size={16} /> Create span
      </button>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function LayerEditor({
  layer,
  layers,
  onLayerChange
}: {
  layer: Layer;
  layers: Layer[];
  onLayerChange: (layerId: string, patch: Partial<Layer>) => void;
}) {
  const [nameDraft, setNameDraft] = useState(layer.name);
  const [error, setError] = useState("");

  useEffect(() => {
    setNameDraft(layer.name);
    setError("");
  }, [layer.id, layer.name]);

  function handleNameChange(value: string) {
    setNameDraft(value);
    const name = value.trim();
    if (!name) {
      setError("Layer name is required.");
      return;
    }
    if (layers.some((item) => item.id !== layer.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError("Layer names must be unique.");
      return;
    }
    setError("");
    onLayerChange(layer.id, { name });
  }

  return (
    <div className="layer-editor">
      <label>
        Layer name
        <input aria-label={`Layer name ${layer.name}`} value={nameDraft} onChange={(event) => handleNameChange(event.target.value)} />
      </label>
      <div className="grid-2">
        <label>
          Kind
          <select value={layer.kind} onChange={(event) => onLayerChange(layer.id, { kind: event.target.value as LayerKind })}>
            {LAYER_KIND_OPTIONS.map((kind) => (
              <option value={kind} key={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select
            value={layer.direction}
            onChange={(event) => onLayerChange(layer.id, { direction: event.target.value as Layer["direction"] })}
          >
            <option value="ltr">LTR</option>
            <option value="rtl">RTL</option>
          </select>
        </label>
        <NumberInput label={`Order ${layer.name}`} value={layer.order} min={0} onChange={(order) => onLayerChange(layer.id, { order })} />
        <label className="check-row">
          <input type="checkbox" checked={layer.visible} onChange={(event) => onLayerChange(layer.id, { visible: event.target.checked })} />
          Visible
        </label>
      </div>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SuggestionList({
  suggestions,
  onApply
}: {
  suggestions: LexiconSuggestion[];
  onApply: (suggestion: LexiconSuggestion) => void;
}) {
  if (suggestions.length === 0) {
    return <p className="muted">No lexicon suggestions</p>;
  }

  return (
    <div className="suggestions">
      <div className="subhead">Lexicon</div>
      {suggestions.map((suggestion) => (
        <button className="suggestion" key={`${suggestion.entry.id}-${suggestion.tokenIds.join("-")}`} onClick={() => onApply(suggestion)}>
          <span>{suggestion.entry.lemma}</span>
          <strong>{suggestion.glossText}</strong>
        </button>
      ))}
    </div>
  );
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="ribbon-group" aria-label={label}>
      <span className="ribbon-label">{label}</span>
      <div className="ribbon-controls">{children}</div>
    </section>
  );
}

function IconButton({
  label,
  shortLabel,
  tooltip,
  icon,
  onClick,
  onDoubleClick,
  pressed,
  sticky,
  disabled = false
}: {
  label: string;
  shortLabel: string;
  tooltip: string;
  icon: React.ReactNode;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  sticky?: boolean;
  disabled?: boolean;
}) {
  const tooltipId = tooltipIdFor(label);
  return (
    <button
      className={sticky ? "icon-button sticky" : "icon-button"}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-label={label}
      aria-describedby={tooltipId}
      aria-pressed={pressed}
      data-sticky={sticky ? "true" : undefined}
      disabled={disabled}
      title={tooltip}
      style={{ transitionDelay: `${TOOLTIP_DELAY}ms` }}
    >
      {icon}
      <span className="icon-button-label">{shortLabel}</span>
      <span className="ribbon-tooltip" role="tooltip" id={tooltipId}>
        {tooltip}
      </span>
    </button>
  );
}

function LayerToggle({ layer, onToggle }: { layer: Layer; onToggle: () => void }) {
  const tooltipId = tooltipIdFor(`${layer.id}-visibility`);
  return (
    <button
      className={layer.visible ? "layer-toggle active" : "layer-toggle"}
      onClick={onToggle}
      aria-label={layer.visible ? `Hide ${layer.name} layer` : `Show ${layer.name} layer`}
      aria-pressed={layer.visible}
      aria-describedby={tooltipId}
      title={layer.visible ? `Hide the ${layer.name} layer.` : `Show the ${layer.name} layer.`}
    >
      {layer.name}
      <span className="ribbon-tooltip" role="tooltip" id={tooltipId}>
        {layer.visible ? `Hide the ${layer.name} layer.` : `Show the ${layer.name} layer.`}
      </span>
    </button>
  );
}

function DirectionSelect({ value, onChange }: { value: Token["direction"]; onChange: (value: Token["direction"]) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Token["direction"])}>
      <option value="ltr">LTR</option>
      <option value="rtl">RTL</option>
    </select>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(round(value)));
  const invalid = isInvalidNumberDraft(draft, min, max);
  const inputId = `${tooltipIdFor(label)}-input`;
  const validationId = `${tooltipIdFor(label)}-error`;

  useEffect(() => {
    setDraft(String(round(value)));
  }, [value]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextDraft = event.target.value;
    setDraft(nextDraft);
    if (!isInvalidNumberDraft(nextDraft, min, max)) {
      onChange(Number(nextDraft));
    }
  }

  return (
    <div className="number-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={handleChange}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? validationId : undefined}
      />
      {invalid ? (
        <span className="field-error" id={validationId}>
          {numberValidationMessage(min, max)}
        </span>
      ) : null}
    </div>
  );
}

function dedupeSuggestions(suggestions: LexiconSuggestion[]): LexiconSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.entry.id}:${suggestion.tokenIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderSelectedTokenIds(doc: InterlinearDocument, tokenIds: string[]): string[] {
  const selected = new Set(tokenIds);
  return tokenOrder(doc).filter((tokenId) => selected.has(tokenId));
}

function selectedTokensAreAdjacent(doc: InterlinearDocument, tokenIds: string[]): boolean {
  if (tokenIds.length < 2) return false;
  const first = doc.tokens[tokenIds[0]];
  if (!first) return false;
  if (!tokenIds.every((tokenId) => doc.tokens[tokenId]?.lineId === first.lineId)) return false;
  const line = doc.pages.flatMap((page) => page.lines).find((candidate) => candidate.id === first.lineId);
  if (!line) return false;
  const indexes = tokenIds.map((tokenId) => line.tokenIds.indexOf(tokenId));
  return indexes.every((index) => index >= 0) && indexes.every((index, offset) => offset === 0 || index === indexes[offset - 1] + 1);
}

function selectionExistsForDeletion(doc: InterlinearDocument, selection: NonNullable<Selection>, tokenIds: string[]): boolean {
  if (selection.kind === "token") return tokenIds.some((id) => Boolean(doc.tokens[id]));
  if (selection.kind === "line") return doc.pages.some((page) => page.lines.some((line) => line.id === selection.id));
  if (selection.kind === "span") return Boolean(doc.layerSpans[selection.id]);
  if (selection.kind === "annotation") return Boolean(doc.annotationCells[selection.id]);
  return doc.pages.some((page) => page.pageObjects.some((object) => object.id === selection.id));
}

function deleteSelectionFromDocument(
  doc: InterlinearDocument,
  selection: NonNullable<Selection>,
  tokenIds: string[]
): InterlinearDocument {
  if (selection.kind === "token") return deleteTokensFromDocument(doc, tokenIds);
  if (selection.kind === "line") {
    const line = doc.pages.flatMap((page) => page.lines).find((candidate) => candidate.id === selection.id);
    const withoutTokens = deleteTokensFromDocument(doc, line?.tokenIds ?? []);
    return {
      ...withoutTokens,
      pages: withoutTokens.pages.map((page) => ({
        ...page,
        lines: page.lines.filter((candidate) => candidate.id !== selection.id)
      }))
    };
  }
  if (selection.kind === "span") return deleteSpansFromDocument(doc, new Set([selection.id]));
  if (selection.kind === "annotation") {
    if (!doc.annotationCells[selection.id]) return doc;
    const annotationCells = { ...doc.annotationCells };
    delete annotationCells[selection.id];
    return { ...doc, annotationCells };
  }
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      pageObjects: page.pageObjects.filter((object) => object.id !== selection.id)
    }))
  };
}

function deleteTokensFromDocument(doc: InterlinearDocument, tokenIds: string[]): InterlinearDocument {
  const deletedTokenIds = new Set(tokenIds.filter((id) => Boolean(doc.tokens[id])));
  if (deletedTokenIds.size === 0) return doc;

  const deletedSpanIds = spanIdsTouchingTokens(doc, deletedTokenIds);
  const tokens = { ...doc.tokens };
  for (const tokenId of deletedTokenIds) {
    delete tokens[tokenId];
  }
  const withoutSpans = deleteSpansFromDocument(
    {
      ...doc,
      tokens,
      pages: doc.pages.map((page) => ({
        ...page,
        lines: page.lines.map((line) => ({
          ...line,
          tokenIds: line.tokenIds.filter((tokenId) => !deletedTokenIds.has(tokenId))
        }))
      }))
    },
    deletedSpanIds
  );
  return {
    ...withoutSpans,
    annotationCells: Object.fromEntries(
      Object.entries(withoutSpans.annotationCells).filter(([, cell]) => !deletedTokenIds.has(cell.tokenId))
    )
  };
}

function deleteSpansFromDocument(doc: InterlinearDocument, spanIds: Set<string>): InterlinearDocument {
  if (spanIds.size === 0) return doc;
  return {
    ...doc,
    layerSpans: Object.fromEntries(Object.entries(doc.layerSpans).filter(([id]) => !spanIds.has(id))),
    annotationCells: Object.fromEntries(
      Object.entries(doc.annotationCells).filter(([, cell]) => !cell.spanId || !spanIds.has(cell.spanId))
    )
  };
}

function spanIdsTouchingTokens(doc: InterlinearDocument, deletedTokenIds: Set<string>): Set<string> {
  const orderedTokens = tokenOrder(doc);
  const deletedIndexes = new Set([...deletedTokenIds].map((id) => orderedTokens.indexOf(id)).filter((index) => index >= 0));
  const spanIds = new Set<string>();
  for (const span of Object.values(doc.layerSpans)) {
    const startIndex = orderedTokens.indexOf(span.startTokenId);
    const endIndex = orderedTokens.indexOf(span.endTokenId);
    if (startIndex < 0 || endIndex < 0) continue;
    const left = Math.min(startIndex, endIndex);
    const right = Math.max(startIndex, endIndex);
    if ([...deletedIndexes].some((index) => index >= left && index <= right)) {
      spanIds.add(span.id);
    }
  }
  return spanIds;
}

function deleteSelectionCommandLabel(selection: NonNullable<Selection>, tokenIds: string[]): string {
  if (selection.kind === "token") return tokenIds.length > 1 ? "Delete word boxes" : "Delete word box";
  if (selection.kind === "line") return "Delete line";
  if (selection.kind === "span") return "Delete span";
  if (selection.kind === "annotation") return "Delete annotation";
  return "Delete page object";
}

function deleteSelectionStatus(selection: NonNullable<Selection>, tokenIds: string[]): string {
  if (selection.kind === "token") return tokenIds.length > 1 ? `Deleted ${tokenIds.length} word boxes.` : "Deleted word box.";
  if (selection.kind === "line") return "Deleted line.";
  if (selection.kind === "span") return "Deleted span.";
  if (selection.kind === "annotation") return "Deleted annotation.";
  return "Deleted page object.";
}

function isTextPageObjectKind(kind: PageObject["kind"] | PlacementMode | null): kind is TextPageObjectKind {
  return kind === "textBlock" || kind === "titleBlock" || kind === "subtitleBlock" || kind === "sectionBlock";
}

function isTextPageObject(object: PageObject): object is TextPageObject {
  return isTextPageObjectKind(object.kind);
}

function isInlineEditablePageObject(object: PageObject): object is InlineEditablePageObject {
  return object.kind === "titleBlock" || object.kind === "subtitleBlock" || object.kind === "sectionBlock";
}

function pageObjectConstrainedToMargins(object: PageObject): boolean {
  return object.kind === "image" || (isTextPageObject(object) && TEXT_PAGE_OBJECT_CONFIG[object.kind].constrainToMargins);
}

function sanitizeRectForPageObject(object: PageObject, rect: Rect, settings: PageSettings): Rect {
  return sanitizePageObjectRect(rect, settings, pageObjectConstrainedToMargins(object));
}

function pageObjectClassName(object: PageObject, selected: boolean, editing = false): string {
  return ["page-object", `page-object-${object.kind}`, selected ? "selected" : "", editing ? "editing" : ""].filter(Boolean).join(" ");
}

function textPageObjectClassName(kind: TextPageObjectKind): string {
  return ["text-block", TEXT_PAGE_OBJECT_CONFIG[kind].className].join(" ");
}

function isDeleteSelectionShortcut(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  return event.key === "Delete" || event.key.toLowerCase() === "x";
}

function isWritableTextTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  const editable = element?.closest<HTMLElement>("input, textarea, select, [contenteditable]");
  if (!editable) return false;
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    return !editable.readOnly && !editable.disabled;
  }
  if (editable instanceof HTMLSelectElement) return !editable.disabled;
  return editable.isContentEditable;
}

function lexiconEntryMatches(entry: LexiconEntry, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [entry.lemma, entry.kind, entry.notes ?? "", ...entry.normalizedForms, ...entry.glosses.map((gloss) => gloss.text), ...entry.tags]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function glossesFromText(value: string): LexiconEntry["glosses"] {
  return value
    .split(/\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ id: `gloss_${index + 1}`, text }));
}

function labelForDragCommand(kind: DragState["kind"]): string {
  if (kind === "token") return "Move word box";
  if (kind === "line") return "Move line";
  if (kind === "annotation") return "Move annotation";
  if (kind === "span") return "Move span";
  if (kind === "pageObject") return "Move page object";
  if (kind === "pageObjectResize") return "Resize page object";
  return "Move margin guide";
}

function resizeHandleLabel(handle: PageObjectResizeHandle): string {
  if (handle === "nw") return "northwest";
  if (handle === "ne") return "northeast";
  if (handle === "sw") return "southwest";
  return "southeast";
}

function annotationLayerForPlacement(doc: InterlinearDocument, placement: AnnotationPlacement): Layer | null {
  const orderedLayers = [...doc.layers]
    .filter((layer) => layer.visible)
    .sort((left, right) => left.order - right.order);
  const fallbackLayers = orderedLayers.length > 0 ? orderedLayers : [...doc.layers].sort((left, right) => left.order - right.order);
  if (placement === "above") {
    return fallbackLayers.find((layer) => layer.kind === "literal") ?? fallbackLayers[0] ?? null;
  }
  return fallbackLayers.find((layer) => layer.kind === "translation") ?? fallbackLayers.at(-1) ?? null;
}

function occupiedAnnotationPlacements(entries: RenderedAnnotation[]): Partial<Record<AnnotationPlacement, boolean>> {
  return {
    above: entries.some((entry) => entry.cell.placement === "above"),
    below: entries.some((entry) => entry.cell.placement === "below")
  };
}

function getTokenSnapTargetLineId(doc: InterlinearDocument, tokenId: string): string | null {
  const located = findTokenLine(doc, tokenId);
  if (!located) return null;
  const routed = routeLine(doc, located.page, located.line);
  const positioned = routed.positionedTokens.find((item) => item.tokenId === tokenId);
  const token = doc.tokens[tokenId];
  const visualY = positioned?.rect.y ?? located.line.y + (token?.offset.y ?? 0);
  let best: { lineId: string; distance: number } | null = null;
  for (const line of located.page.lines) {
    const distance = Math.abs(line.y + line.offset.y - visualY);
    if (distance <= LINE_SNAP_DISTANCE && (!best || distance < best.distance)) {
      best = { lineId: line.id, distance };
    }
  }
  return best?.lineId ?? null;
}

function lineGuideClassName({ selected, snapTarget }: { selected: boolean; snapTarget: boolean }): string {
  return ["line-guide", selected ? "selected" : "", snapTarget ? "snap-target" : ""].filter(Boolean).join(" ");
}

function lineLayerClassName({ selected, snapTarget }: { selected: boolean; snapTarget: boolean }): string {
  return ["line-layer", selected ? "selected" : "", snapTarget ? "snap-target" : ""].filter(Boolean).join(" ");
}

function pageClassName(placementMode: PlacementMode | null, guidesVisible: boolean): string {
  return ["page", placementMode ? `placement-mode-${placementMode}` : "", guidesVisible ? "" : "guides-hidden"]
    .filter(Boolean)
    .join(" ");
}

function pageIdForSelection(doc: InterlinearDocument, selection: Selection): string | undefined {
  if (!selection) return undefined;
  if (selection.kind === "token") return findTokenLine(doc, selection.id)?.page.id;
  if (selection.kind === "line") return doc.pages.find((page) => page.lines.some((line) => line.id === selection.id))?.id;
  if (selection.kind === "pageObject") {
    return doc.pages.find((page) => page.pageObjects.some((object) => object.id === selection.id))?.id;
  }
  if (selection.kind === "span") {
    const span = doc.layerSpans[selection.id];
    return span ? findTokenLine(doc, span.startTokenId)?.page.id : undefined;
  }
  const annotation = doc.annotationCells[selection.id];
  if (!annotation) return undefined;
  if (annotation.spanId) {
    const span = doc.layerSpans[annotation.spanId];
    if (span) return findTokenLine(doc, span.startTokenId)?.page.id;
  }
  return findTokenLine(doc, annotation.tokenId)?.page.id;
}

function findTokenLine(
  doc: InterlinearDocument,
  tokenId: string
): { page: Page; line: InterlinearLine } | null {
  for (const page of doc.pages) {
    const line = page.lines.find((candidate) => candidate.tokenIds.includes(tokenId));
    if (line) return { page, line };
  }
  return null;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

async function resolveImageAssetUrl(assetPath: string, documentPath: string | null): Promise<string | null> {
  if (!window.interlinear || !assetPath.trim()) return null;
  if (documentPath) return window.interlinear.resolveAssetUrl(documentPath, assetPath);
  if (isLikelyAbsolutePath(assetPath)) return window.interlinear.fileToAssetUrl(assetPath);
  return null;
}

function isLikelyAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

function loadRecentDocuments(): RecentDocument[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeRecentDocuments(JSON.parse(window.localStorage.getItem(RECENT_DOCUMENTS_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function persistRecentDocuments(documents: RecentDocument[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_DOCUMENTS_STORAGE_KEY, JSON.stringify(documents));
  } catch {
    // Local storage can be unavailable in restricted environments; recent files are noncritical.
  }
}

function normalizeRecentDocuments(value: unknown): RecentDocument[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const documents: RecentDocument[] = [];
  for (const item of value) {
    const filePath =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { filePath?: unknown }).filePath === "string"
          ? (item as { filePath: string }).filePath
          : "";
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    documents.push({
      filePath,
      openedAt:
        item && typeof item === "object" && typeof (item as { openedAt?: unknown }).openedAt === "string"
          ? (item as { openedAt: string }).openedAt
          : ""
    });
  }
  return documents.slice(0, RECENT_DOCUMENT_LIMIT);
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function tooltipIdFor(label: string): string {
  return `tooltip-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function sanitizePageSettings(settings: PageSettings): PageSettings {
  const width = finiteAtLeast(settings.width, MIN_PAGE_DIMENSION);
  const height = finiteAtLeast(settings.height, MIN_PAGE_DIMENSION);
  const horizontalMargins = fitOpposingMargins(settings.marginLeft, settings.marginRight, width, MIN_CONTENT_SIZE);
  const verticalMargins = fitOpposingMargins(settings.marginTop, settings.marginBottom, height, MIN_CONTENT_SIZE);

  return {
    ...settings,
    width,
    height,
    marginTop: verticalMargins.leading,
    marginRight: horizontalMargins.trailing,
    marginBottom: verticalMargins.trailing,
    marginLeft: horizontalMargins.leading,
    fontSize: finiteAtLeast(settings.fontSize, 1),
    lineGap: finiteAtLeast(settings.lineGap, 0),
    annotationGap: finiteAtLeast(settings.annotationGap, 0),
    fontFamily: settings.fontFamily.trim() || "Times New Roman"
  };
}

function fitOpposingMargins(leading: number, trailing: number, total: number, minimumContent: number) {
  const safeLeading = finiteAtLeast(leading, 0);
  const safeTrailing = finiteAtLeast(trailing, 0);
  const maxCombined = Math.max(0, total - minimumContent);
  const combined = safeLeading + safeTrailing;

  if (combined <= maxCombined) {
    return { leading: safeLeading, trailing: safeTrailing };
  }
  if (combined === 0) {
    return { leading: 0, trailing: 0 };
  }

  const scale = maxCombined / combined;
  return {
    leading: safeLeading * scale,
    trailing: safeTrailing * scale
  };
}

function marginPatchForDrag(
  edge: MarginGuideEdge,
  original: MarginDragOrigin,
  dx: number,
  dy: number
): Partial<PageSettings> {
  if (edge === "left") {
    return {
      marginLeft: clamp(round(original.marginLeft + dx), 0, original.width - original.marginRight - MIN_CONTENT_SIZE)
    };
  }
  if (edge === "right") {
    return {
      marginRight: clamp(round(original.marginRight - dx), 0, original.width - original.marginLeft - MIN_CONTENT_SIZE)
    };
  }
  if (edge === "top") {
    return {
      marginTop: clamp(round(original.marginTop + dy), 0, original.height - original.marginBottom - MIN_CONTENT_SIZE)
    };
  }

  return {
    marginBottom: clamp(round(original.marginBottom - dy), 0, original.height - original.marginTop - MIN_CONTENT_SIZE)
  };
}

function marginGuideEdge(id: string): MarginGuideEdge | null {
  return id === "left" || id === "right" || id === "top" || id === "bottom" ? id : null;
}

function isInvalidNumberDraft(draft: string, min?: number, max?: number): boolean {
  const value = Number(draft);
  return draft.trim() === "" || !Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max);
}

function numberValidationMessage(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `Enter a number from ${min} to ${max}.`;
  if (min !== undefined) return `Enter ${min} or greater.`;
  if (max !== undefined) return `Enter ${max} or less.`;
  return "Enter a valid number.";
}

function finiteAtLeast(value: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(value, minimum) : minimum;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const safeMaximum = Math.max(minimum, maximum);
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), safeMaximum);
}

function pointerClientPoint(event: Pick<PointerEvent | ReactPointerEvent<HTMLElement>, "clientX" | "clientY">): {
  x: number;
  y: number;
} {
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : 0,
    y: Number.isFinite(event.clientY) ? event.clientY : 0
  };
}

function pagePointFromEvent(
  event: ReactMouseEvent<HTMLDivElement>,
  zoom: number,
  settings: PageSettings
): { x: number; y: number } {
  return pagePointFromElement(event.clientX, event.clientY, event.currentTarget, zoom, settings);
}

function pagePointFromDescendantEvent(
  event: ReactPointerEvent<HTMLElement>,
  zoom: number,
  settings: PageSettings
): { x: number; y: number } {
  const page = event.currentTarget.closest<HTMLElement>(".page");
  return pagePointFromElement(event.clientX, event.clientY, page ?? event.currentTarget, zoom, settings);
}

function pagePointFromElement(
  clientX: number,
  clientY: number,
  element: HTMLElement,
  zoom: number,
  settings: PageSettings
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left) / zoom, 0, settings.width),
    y: clamp((clientY - rect.top) / zoom, 0, settings.height)
  };
}

function scheduleZoomAnchorRestore(anchor: ZoomAnchor, nextZoom: number) {
  const schedule =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? (callback: FrameRequestCallback) => window.requestAnimationFrame(callback)
      : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
  schedule(() => restoreZoomAnchor(anchor, nextZoom));
}

function restoreZoomAnchor(anchor: ZoomAnchor, nextZoom: number) {
  const page = anchor.container.querySelector<HTMLElement>(".page");
  if (!page) return;
  const rect = page.getBoundingClientRect();
  const nextClientX = rect.left + anchor.pageX * nextZoom;
  const nextClientY = rect.top + anchor.pageY * nextZoom;
  anchor.container.scrollLeft += nextClientX - anchor.clientX;
  anchor.container.scrollTop += nextClientY - anchor.clientY;
}

function roundZoom(value: number): number {
  return Number(value.toFixed(2));
}

function formatZoomPercent(zoom: number): number {
  return Math.round((zoom / DEFAULT_ZOOM) * 100);
}

function round(value: number): number {
  return Number(value.toFixed(1));
}
