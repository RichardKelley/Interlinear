import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createEmptyDocument, createSampleDocument } from "./shared/documentFactory";
import { sourceLineBoxHeight } from "./shared/layout";
import type { InterlinearDocument } from "./shared/schema";

function render(element: ReactElement) {
  if (element.type === App) {
    const props = element.props as ComponentProps<typeof App>;
    return rtlRender(<App {...props} initialDocument={props.initialDocument ?? createSampleDocument()} />);
  }
  return rtlRender(element);
}

function editWordBox(label: string, value: string) {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  const wordBox = input.closest(".word-box") as HTMLElement;
  fireEvent.doubleClick(wordBox);
  fireEvent.change(input, { target: { value } });
}

const DEFAULT_ZOOM = 1.5;

function clickPageAt(container: HTMLElement, x: number, y: number) {
  fireEvent.click(container.querySelector(".page") as HTMLElement, { clientX: x * DEFAULT_ZOOM, clientY: y * DEFAULT_ZOOM });
}

function activatePlacementMode(
  label:
    | "Add word box"
    | "Add line"
    | "Add image"
    | "Add title block"
    | "Add subtitle block"
    | "Add section block"
    | "Add text block"
    | "Add concept span"
) {
  const button = screen.getByRole("button", { name: label });
  if (button.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(button);
  }
  return button;
}

function activateStickyPlacementMode(label: "Add word box" | "Add line") {
  const button = screen.getByRole("button", { name: label });
  fireEvent.doubleClick(button);
  return button;
}

function placeWordBoxAt(container: HTMLElement, x = 90, y = 120) {
  activatePlacementMode("Add word box");
  clickPageAt(container, x, y);
}

function placeLineAt(container: HTMLElement, x = 90, y = 180) {
  activatePlacementMode("Add line");
  clickPageAt(container, x, y);
}

describe("App editor", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: undefined
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: undefined
    });
    vi.restoreAllMocks();
  });

  it("renders the sample document with a multi-token lexicon suggestion", () => {
    render(<App />);

    expect(screen.getByRole("region", { name: "Document" })).toBeInTheDocument();
    expect(screen.getAllByText("what-it-was-to-be").length).toBeGreaterThan(0);
    expect(screen.getByText("το τι ην ειναι")).toBeInTheDocument();
  });

  it("starts new documents with an empty canvas", () => {
    const { container } = rtlRender(<App />);

    expect(container.querySelector(".page")).toBeInTheDocument();
    expect(container.querySelectorAll(".word-box")).toHaveLength(0);
    expect(container.querySelectorAll(".line-guide")).toHaveLength(0);
    expect(container.querySelectorAll(".margin-guide")).toHaveLength(4);
    expect(container.querySelectorAll(".page-object")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Add word box" }));
    expect(container.querySelectorAll(".word-box")).toHaveLength(0);

    clickPageAt(container, 90, 120);

    expect(container.querySelectorAll(".word-box")).toHaveLength(1);
    expect(container.querySelectorAll(".line-guide")).toHaveLength(1);
    expect((container.querySelector(".word-box") as HTMLElement).style.width).toBe("34px");
    expect(screen.getByRole("button", { name: "Add word box" })).toHaveAttribute("aria-pressed", "false");
  });

  it("sizes word boxes close to the current word text", () => {
    const { container } = render(<App />);
    const shortBox = screen.getByLabelText("Word box το").closest(".word-box") as HTMLElement;
    const longBox = screen.getByLabelText("Word box ειναι").closest(".word-box") as HTMLElement;

    expect(Number.parseFloat(longBox.style.width)).toBeGreaterThan(Number.parseFloat(shortBox.style.width));
    expect(Number.parseFloat(shortBox.style.width)).toBeLessThan(40);
  });

  it("uses 100 percent as the default zoom with button controls", () => {
    render(<App />);

    expect(screen.queryByRole("slider", { name: "Zoom" })).not.toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset zoom" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("zooms from pinch-style wheel gestures without hijacking ordinary scrolling", () => {
    const { container } = render(<App />);
    const pageScroll = container.querySelector(".page-scroll") as HTMLElement;

    fireEvent.wheel(pageScroll, { clientX: 300, clientY: 300, deltaY: -100 });
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.wheel(pageScroll, { clientX: 300, clientY: 300, ctrlKey: true, deltaY: -100 });
    expect(screen.getByText("108%")).toBeInTheDocument();

    fireEvent.wheel(pageScroll, { clientX: 300, clientY: 300, ctrlKey: true, deltaY: 100 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("zooms with a middle-button drag on the page surface", () => {
    const { container } = render(<App />);
    const pageScroll = container.querySelector(".page-scroll") as HTMLElement;

    fireEvent(pageScroll, pointerEvent("pointerdown", 300, 300, { button: 1, buttons: 4 }));
    fireEvent(window, pointerEvent("pointermove", 300, 240));
    expect(screen.getByText("120%")).toBeInTheDocument();

    fireEvent.pointerUp(window);
  });

  it("keeps undo and redo disabled until command history changes", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    editWordBox("Word box το", "logos");

    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("creates a new page manually and supports undo and redo", () => {
    const { container } = render(<App />);

    expect(container.querySelectorAll("[data-page-id]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    expect(screen.getByText("Created page.")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-page-id]")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(container.querySelectorAll("[data-page-id]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(container.querySelectorAll("[data-page-id]")).toHaveLength(2);
  });

  it("keeps typing focus when a new word overflows to the next page", async () => {
    const { container } = rtlRender(<App initialDocument={createBottomOverflowDocument()} />);
    const input = screen.getByLabelText<HTMLInputElement>("Word box seed");

    fireEvent.doubleClick(input.closest(".word-box") as HTMLElement);
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));

    fireEvent.keyDown(input, { key: " " });

    await waitFor(() => expect(container.querySelectorAll("[data-page-id]")).toHaveLength(2));
    const nextInput = screen.getByLabelText<HTMLInputElement>("Word box empty");
    await waitFor(() => expect(document.activeElement).toBe(nextInput));
    expect(nextInput.closest<HTMLElement>("[data-page-id]")?.getAttribute("aria-label")).toBe("Page 2");
  });

  it("undoes and redoes token edits from controls", () => {
    render(<App />);

    editWordBox("Word box το", "logos");
    expect(screen.getByLabelText("Word box logos")).toHaveValue("logos");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Word box το")).toHaveValue("το");
    expect(screen.getByRole("button", { name: "Redo" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Word box logos")).toHaveValue("logos");
  });

  it("supports keyboard undo and redo shortcuts", () => {
    render(<App />);

    editWordBox("Word box το", "logos");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Word box το")).toHaveValue("το");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText("Word box logos")).toHaveValue("logos");
  });

  it("clears redo after a new command following undo", () => {
    render(<App />);

    editWordBox("Word box το", "logos");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Redo" })).not.toBeDisabled();

    editWordBox("Word box το", "term");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("hides page numbers by default and toggles them from document layout controls", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".page-number")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(screen.getByText("Document Layout")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Page numbers" }));

    expect(container.querySelector(".page-number")).toHaveTextContent("1");
  });

  it("keeps document font size in the ribbon without exposing font family", () => {
    const { container } = render(<App />);
    const size = screen.getByLabelText<HTMLInputElement>("Font size");

    expect(size.closest(".ribbon")).toBeInTheDocument();
    expect(size.value).toBe("12");
    expect(screen.queryByLabelText("Font family")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(screen.getAllByLabelText("Font size")).toHaveLength(1);
    expect(screen.queryByLabelText("Font family")).not.toBeInTheDocument();

    fireEvent.change(size, { target: { value: "16" } });

    expect((container.querySelector(".word-box") as HTMLElement).style.fontSize).toBe("16px");
  });

  it("shows actionable export error details", async () => {
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        exportPdf: () => Promise.reject(new Error("spawn latexmk ENOENT")),
        exportTex: () => Promise.resolve(null)
      }
    });

    try {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

      expect(await screen.findByText("PDF export failed because latexmk is not installed or is not on PATH.")).toBeInTheDocument();
      expect(screen.getByText("Export details")).toBeInTheDocument();
      expect(screen.getByText("spawn latexmk ENOENT")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "interlinear", {
        configurable: true,
        value: undefined
      });
    }
  });

  it("saves document edits and records the current file path", async () => {
    const saveDocument = vi.fn(async (document, filePath) => ({
      document,
      filePath: filePath ?? "/tmp/interlinear/sample.iltdoc"
    }));
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: { saveDocument }
    });

    render(<App />);

    editWordBox("Word box το", "logos");

    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    await screen.findByText("Saved sample.iltdoc");
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ title: "Untitled Interlinear Document" }), null);
    expect(screen.getAllByText(/sample\.iltdoc/).length).toBeGreaterThan(0);
  });

  it("opens documents through Electron and records the current file path", async () => {
    const openedDocument = { ...createSampleDocument(), title: "Opened document" };
    const openDocument = vi.fn(async () => ({
      document: openedDocument,
      filePath: "/tmp/interlinear/opened.iltdoc"
    }));
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        openDocument,
        resolveAssetUrl: vi.fn()
      }
    });

    render(<App />);
    editWordBox("Word box το", "logos");

    fireEvent.click(screen.getByRole("button", { name: "Open document" }));

    await screen.findByText("Opened opened.iltdoc");
    expect(openDocument).toHaveBeenCalledWith(undefined);
    expect(screen.getAllByText(/opened\.iltdoc/).length).toBeGreaterThan(0);
  });

  it("keeps Save As distinct from saving to the current document path", async () => {
    let callIndex = 0;
    const saveDocument = vi.fn(async (document, filePath) => {
      const filePathResult = callIndex === 0 ? "/tmp/interlinear/original.iltdoc" : "/tmp/interlinear/copy.iltdoc";
      callIndex += 1;
      return { document, filePath: filePathResult };
    });
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: { saveDocument }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));
    await screen.findByText("Saved original.iltdoc");

    editWordBox("Word box το", "logos");
    fireEvent.click(screen.getByRole("button", { name: "Save As document" }));
    await screen.findByText("Saved copy.iltdoc");

    expect(saveDocument.mock.calls[0][1]).toBeNull();
    expect(saveDocument.mock.calls[1][1]).toBeNull();
    expect(screen.getAllByText(/copy\.iltdoc/).length).toBeGreaterThan(0);
  });

  it("preserves the current path after save failure", async () => {
    let shouldFail = false;
    const saveDocument = vi.fn(async (document, filePath) => {
      if (shouldFail) throw new Error("disk full");
      return {
        document,
        filePath: filePath ?? "/tmp/interlinear/original.iltdoc"
      };
    });
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: { saveDocument }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));
    await screen.findByText("Saved original.iltdoc");

    editWordBox("Word box το", "logos");
    shouldFail = true;
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    expect(await screen.findByText("Could not save document.")).toBeInTheDocument();
    expect(saveDocument.mock.calls[1][1]).toBe("/tmp/interlinear/original.iltdoc");
    expect(screen.getByText("File details")).toBeInTheDocument();
  });

  it("places an empty image box without opening a file picker", () => {
    const importImage = vi.fn();
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        importImage,
        fileToAssetUrl: vi.fn()
      }
    });

    const { container } = render(<App />);
    const initialObjectCount = container.querySelectorAll(".page-object").length;

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));

    expect(screen.getByRole("button", { name: "Add image" })).toHaveAttribute("aria-pressed", "true");
    expect(importImage).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".page-object")).toHaveLength(initialObjectCount);

    clickPageAt(container, 240, 310);

    expect(screen.getByText("Added image box.")).toBeInTheDocument();
    expect(importImage).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".page-object")).toHaveLength(initialObjectCount + 1);
    expect(Number.parseFloat((container.querySelectorAll(".page-object")[initialObjectCount] as HTMLElement).style.left)).toBeCloseTo(
      240
    );
    expect(Number.parseFloat((container.querySelectorAll(".page-object")[initialObjectCount] as HTMLElement).style.top)).toBeCloseTo(
      310
    );
    expect(screen.getByRole("button", { name: "Add image" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Choose image file" })).toBeInTheDocument();
    expect(screen.getByText("No image selected")).toBeInTheDocument();
  });

  it("keeps image boxes inside margins and routes lines around their padded boundary", () => {
    const { container } = render(<App />);
    const initialObjectCount = container.querySelectorAll(".page-object").length;

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    clickPageAt(container, 600, 10);

    const imageObject = container.querySelectorAll<HTMLElement>(".page-object")[initialObjectCount];
    expect(Number.parseFloat(imageObject.style.left)).toBeCloseTo(388);
    expect(Number.parseFloat(imageObject.style.top)).toBeCloseTo(54);
    expect(Number.parseFloat((container.querySelector(".routing-band") as HTMLElement).style.width)).toBeCloseTo(322);

    fireEvent.pointerDown(imageObject, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", -999 * DEFAULT_ZOOM, 999 * DEFAULT_ZOOM));

    const draggedImageObject = container.querySelectorAll<HTMLElement>(".page-object")[initialObjectCount];
    expect(Number.parseFloat(draggedImageObject.style.left)).toBeCloseTo(54);
    expect(Number.parseFloat(draggedImageObject.style.top)).toBeCloseTo(618);
    fireEvent.pointerUp(window);
  });

  it("chooses an image file for the selected image box without saving first", async () => {
    const saveDocument = vi.fn();
    const importImage = vi.fn(async () => ({
      assetPath: "/tmp/interlinear/plate.png",
      absolutePath: "/tmp/interlinear/plate.png"
    }));
    const fileToAssetUrl = vi.fn(async () => "file:///tmp/interlinear/plate.png");
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        saveDocument,
        importImage,
        fileToAssetUrl
      }
    });

    const { container } = render(<App />);
    const initialObjectCount = container.querySelectorAll(".page-object").length;

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    clickPageAt(container, 240, 310);
    fireEvent.click(screen.getByRole("button", { name: "Choose image file" }));

    expect(await screen.findByText("Selected plate.png.")).toBeInTheDocument();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(importImage).toHaveBeenCalledWith(null);
    expect(fileToAssetUrl).toHaveBeenCalledWith("/tmp/interlinear/plate.png");
    expect(container.querySelectorAll(".page-object")).toHaveLength(initialObjectCount + 1);
    expect(screen.getByText("plate.png")).toBeInTheDocument();
    expect(screen.getByAltText("Page image")).toHaveAttribute("src", "file:///tmp/interlinear/plate.png");
  });

  it("shows clear document and lexicon open validation errors", async () => {
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        openDocument: vi.fn(async () => {
          throw new Error("Document schema validation failed at title: Expected string, received number");
        }),
        openLexicon: vi.fn(async () => {
          throw new Error("Lexicon schema validation failed at entries.bad.lemma: String must contain at least 1 character(s)");
        })
      }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));

    expect(await screen.findByText("Cannot open document: file validation failed.")).toBeInTheDocument();
    expect(screen.getByText("File details")).toBeInTheDocument();
    expect(screen.getByText("Document schema validation failed at title: Expected string, received number")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open lexicon" }));

    expect(await screen.findByText("Cannot open lexicon: file validation failed.")).toBeInTheDocument();
    expect(screen.getByText(/entries\.bad\.lemma/)).toBeInTheDocument();
  });

  it("persists recent documents and opens them without duplicates", async () => {
    window.localStorage.setItem(
      "interlinear.recentDocuments.v1",
      JSON.stringify([{ filePath: "/tmp/interlinear/recent.iltdoc", openedAt: "2026-05-29T00:00:00.000Z" }])
    );
    const openDocument = vi.fn(async (filePath: string) => ({
      document: createSampleDocument(),
      filePath
    }));
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        openDocument,
        resolveAssetUrl: vi.fn()
      }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("button", { name: "Open recent.iltdoc" }));

    await waitFor(() => expect(openDocument).toHaveBeenCalledWith("/tmp/interlinear/recent.iltdoc"));
    const recent = JSON.parse(window.localStorage.getItem("interlinear.recentDocuments.v1") ?? "[]") as Array<{
      filePath: string;
    }>;
    expect(recent.map((item) => item.filePath)).toEqual(["/tmp/interlinear/recent.iltdoc"]);
  });

  it("removes missing recent documents after a failed recent open", async () => {
    window.localStorage.setItem(
      "interlinear.recentDocuments.v1",
      JSON.stringify([{ filePath: "/tmp/interlinear/missing.iltdoc", openedAt: "2026-05-29T00:00:00.000Z" }])
    );
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: {
        openDocument: vi.fn(async () => {
          throw new Error("ENOENT: no such file or directory, open '/tmp/interlinear/missing.iltdoc'");
        })
      }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("button", { name: "Open missing.iltdoc" }));

    expect(await screen.findByText("Cannot open document: file was not found.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open missing.iltdoc" })).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("interlinear.recentDocuments.v1") ?? "[]")).toEqual([]);
  });

  it("hides margin guides by default and toggles dotted page margin guides from document layout controls", () => {
    const { container } = render(<App />);

    expect(container.querySelectorAll(".margin-guide")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Margin guides" }));

    expect(container.querySelectorAll(".margin-guide")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Left margin guide" })).toHaveClass("margin-guide-vertical");
    expect(screen.getByRole("button", { name: "Top margin guide" })).toHaveClass("margin-guide-horizontal");
    expect((screen.getByRole("button", { name: "Left margin guide" }) as HTMLElement).style.left).toBe("54px");
  });

  it("updates margin-based line guide dimensions from document layout controls", () => {
    const { container } = render(<App />);
    const initialGuide = container.querySelector(".line-guide") as HTMLElement;

    expect(initialGuide.style.left).toBe("54px");

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.change(screen.getByLabelText("Left margin"), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText("Right margin"), { target: { value: "90" } });

    const updatedGuide = container.querySelector(".line-guide") as HTMLElement;
    expect(updatedGuide.style.left).toBe("72px");
    expect(updatedGuide.style.width).toBe("450px");
  });

  it("exposes document, token, and line direction controls", () => {
    const { container } = render(<App />);

    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "rtl" } });
    expect(screen.getByLabelText<HTMLSelectElement>("Direction").value).toBe("rtl");

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "rtl" } });
    expect(screen.getByLabelText<HTMLSelectElement>("Direction").value).toBe("rtl");

    fireEvent.click(screen.getByRole("button", { name: "Selection" }));
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    fireEvent.pointerDown(lineGuide, pointerInit(0, 0));
    fireEvent.pointerUp(window);
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "rtl" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Direction").value).toBe("rtl");

    const conceptSpan = screen.getByRole("button", { name: "what-it-was-to-be", exact: true });
    fireEvent.pointerDown(conceptSpan, pointerInit(0, 0));
    fireEvent.pointerUp(window);
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "rtl" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Direction").value).toBe("rtl");
  });

  it("syncs dragged margin guides with textual controls and line guide geometry", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Margin guides" }));

    const leftGuide = screen.getByRole("button", { name: "Left margin guide" });
    fireEvent.pointerDown(leftGuide, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 18 * DEFAULT_ZOOM, 0));
    fireEvent.pointerUp(window);

    expect(screen.getByLabelText<HTMLInputElement>("Left margin").value).toBe("72");
    expect((screen.getByRole("button", { name: "Left margin guide" }) as HTMLElement).style.left).toBe("72px");
    expect((container.querySelector(".line-guide") as HTMLElement).style.left).toBe("72px");
    expect((container.querySelector(".line-guide") as HTMLElement).style.width).toBe("486px");
  });

  it("clamps dragged margins to a usable content area", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Margin guides" }));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Left margin guide" }), pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 999, 0));
    fireEvent.pointerUp(window);

    expect(screen.getByLabelText<HTMLInputElement>("Left margin").value).toBe("486");
    expect((container.querySelector(".line-guide") as HTMLElement).style.width).toBe("72px");
  });

  it("shows inline validation for invalid layout numbers without changing document geometry", () => {
    const { container } = render(<App />);
    const guide = container.querySelector(".line-guide") as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.change(screen.getByLabelText("Left margin"), { target: { value: "" } });

    expect(screen.getByLabelText("Left margin")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter 0 or greater.")).toBeInTheDocument();
    expect(guide.style.left).toBe("54px");
  });

  it("creates and edits a word box directly on the page", () => {
    const { container } = render(<App />);

    placeWordBoxAt(container, 180, 220);
    const newWordBox = screen
      .getAllByPlaceholderText("word")
      .find((input) => (input as HTMLInputElement).value === "") as HTMLInputElement;
    fireEvent.change(newWordBox, { target: { value: "λόγος" } });

    expect(newWordBox.value).toBe("λόγος");
  });

  it("splits the selected token from inspector controls", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Split parts"), { target: { value: "τ ο" } });
    fireEvent.click(screen.getByRole("button", { name: "Split token" }));

    expect(screen.getByLabelText("Word box τ")).toBeInTheDocument();
    expect(screen.getByLabelText("Word box ο")).toBeInTheDocument();
    expect(screen.queryByLabelText("Word box το")).not.toBeInTheDocument();
  });

  it("rejects invalid token split input with inline validation", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Split parts"), { target: { value: "το" } });
    fireEvent.click(screen.getByRole("button", { name: "Split token" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter at least two non-empty token parts.");
    expect(screen.getByLabelText("Word box το")).toBeInTheDocument();
  });

  it("merges adjacent selected tokens with configurable join text", () => {
    render(<App />);
    const secondWord = screen.getByLabelText("Word box τι").closest(".word-box") as HTMLElement;

    fireEvent.click(secondWord, { shiftKey: true });
    fireEvent.change(screen.getByLabelText("Merge join text"), { target: { value: "-" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge selected tokens" }));

    expect(screen.getByLabelText("Word box το-τι")).toBeInTheDocument();
    expect(screen.queryByLabelText("Word box το")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Word box τι")).not.toBeInTheDocument();
  });

  it("rejects non-adjacent selected token merges with inline validation", () => {
    render(<App />);
    const thirdWord = screen.getByLabelText("Word box ην").closest(".word-box") as HTMLElement;

    fireEvent.click(thirdWord, { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Merge selected tokens" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Select adjacent tokens on the same line to merge.");
    expect(screen.getByLabelText("Word box το")).toBeInTheDocument();
    expect(screen.getByLabelText("Word box ην")).toBeInTheDocument();
  });

  it("creates and edits layers without prompt-based input", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Layers", exact: true }));
    fireEvent.change(screen.getByLabelText("New layer name"), { target: { value: "Syntax" } });
    fireEvent.change(screen.getAllByLabelText("Kind")[0], { target: { value: "syntax" } });
    fireEvent.click(screen.getByRole("button", { name: "Create layer" }));

    expect(screen.getByRole("button", { name: "Hide Syntax layer" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Layer name Literal"), { target: { value: "Literal Text" } });
    expect(screen.getByRole("button", { name: "Hide Literal Text layer" })).toBeInTheDocument();
  });

  it("creates, searches, edits, and deletes lexicon entries", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Lexicon" }));
    expect(screen.getByRole("button", { name: "Edit το τι ην ειναι" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Aristotle" } });
    expect(screen.getByRole("button", { name: "Edit το τι ην ειναι" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    fireEvent.change(screen.getByLabelText("Lemma"), { target: { value: "λόγος" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "token" } });
    fireEvent.change(screen.getByLabelText("Normalized forms"), { target: { value: "λογος" } });
    fireEvent.change(screen.getByLabelText("Glosses"), { target: { value: "account\nword" } });
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "noun, philosophy" } });

    expect(screen.getByLabelText("Normalization preview")).toHaveTextContent("λόγος");
    expect(screen.getByRole("button", { name: "Edit λόγος" })).toHaveTextContent("account");

    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(screen.queryByRole("button", { name: "Edit λόγος" })).not.toBeInTheDocument();
  });

  it("applies lexicon suggestions without overwriting annotation overrides", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Lexicon" }));
    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    fireEvent.change(screen.getByLabelText("Lemma"), { target: { value: "το" } });
    fireEvent.change(screen.getByLabelText("Normalized forms"), { target: { value: "το" } });
    fireEvent.change(screen.getByLabelText("Glosses"), { target: { value: "the" } });

    fireEvent.click(screen.getByRole("button", { name: "Add above annotation for το" }));
    fireEvent.change(screen.getByLabelText("Annotation"), { target: { value: "custom article" } });
    fireEvent.click(screen.getByLabelText("Word box το").closest(".word-box") as HTMLElement);

    const suggestion = screen.getByText("the").closest("button") as HTMLElement;
    fireEvent.click(suggestion);

    expect(screen.getByLabelText("Annotation above for το")).toHaveValue("custom article");
  });

  it("rejects duplicate layer names with inline validation", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Layers", exact: true }));
    fireEvent.change(screen.getByLabelText("New layer name"), { target: { value: "Literal" } });
    fireEvent.click(screen.getByRole("button", { name: "Create layer" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Layer names must be unique.");
  });

  it("creates spans through controlled inspector fields", () => {
    render(<App />);

    expect(screen.getByLabelText("Selected span tokens")).toHaveTextContent("το");
    fireEvent.change(screen.getByLabelText("Span text"), { target: { value: "article concept" } });
    fireEvent.change(screen.getByLabelText("Span notes"), { target: { value: "test note" } });
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "grammar, article" } });
    fireEvent.click(screen.getByRole("button", { name: "Create span" }));

    expect(screen.getByRole("button", { name: "article concept" })).toBeInTheDocument();
  });

  it("selects multiple words for a span from explicit span selection mode", () => {
    render(<App />);
    const secondWord = screen.getByLabelText("Word box τι").closest(".word-box") as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "Add concept span" }));
    expect(screen.getByRole("button", { name: "Add concept span" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(secondWord);

    expect(screen.getByLabelText("Selected span tokens")).toHaveTextContent("το τι");
    expect(secondWord).toHaveClass("selected");
    fireEvent.change(screen.getByLabelText("Span text"), { target: { value: "article pair" } });
    fireEvent.click(screen.getByRole("button", { name: "Create span" }));

    expect(screen.getByRole("button", { name: "article pair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add concept span" })).toHaveAttribute("aria-pressed", "false");
  });

  it("undoes span creation", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Span text"), { target: { value: "article concept" } });
    fireEvent.click(screen.getByRole("button", { name: "Create span" }));
    expect(screen.getByRole("button", { name: "article concept" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "article concept" })).not.toBeInTheDocument();
  });

  it("rejects crossing spans with inline validation", () => {
    render(<App />);
    const secondWord = screen.getByLabelText("Word box τι").closest(".word-box") as HTMLElement;
    const fifthWord = screen.getByLabelText("Word box ἐστι").closest(".word-box") as HTMLElement;

    fireEvent.click(secondWord);
    fireEvent.click(fifthWord, { shiftKey: true });
    fireEvent.change(screen.getByLabelText("Span text"), { target: { value: "crossing concept" } });
    fireEvent.click(screen.getByRole("button", { name: "Create span" }));

    expect(screen.getByRole("alert")).toHaveTextContent("That span would cross another span on the same layer.");
    expect(screen.queryByRole("button", { name: "crossing concept" })).not.toBeInTheDocument();
  });

  it("toggles minimal line guide visibility from the ribbon", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Add below annotation for το" }));
    const lowerAnnotationBox = screen.getByRole("button", { name: "below annotation for το" }) as HTMLElement;

    expect(container.querySelectorAll(".line-guide").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".annotation-connector").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".annotation-handle").length).toBeGreaterThan(0);
    expect(container.querySelector(".page")).not.toHaveClass("guides-hidden");
    expect(container.querySelector(".line-handle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide line guides" }));

    expect(container.querySelectorAll(".line-guide")).toHaveLength(0);
    expect(container.querySelectorAll(".routing-band")).toHaveLength(0);
    expect(container.querySelectorAll(".annotation-connector")).toHaveLength(0);
    expect(container.querySelectorAll(".annotation-handle")).toHaveLength(0);
    expect(container.querySelector(".page")).toHaveClass("guides-hidden");
    expect(container.querySelectorAll(".word-box").length).toBeGreaterThan(0);
    expect(getComputedStyle(lowerAnnotationBox).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(["", "none"]).toContain(getComputedStyle(lowerAnnotationBox).borderTopStyle);
    expect(["", "none"]).toContain(getComputedStyle(lowerAnnotationBox).boxShadow);
    expect(screen.getByLabelText("Annotation below for το")).toBeInTheDocument();
  });

  it("labels ribbon groups and exposes action tooltips", () => {
    render(<App />);
    const pageTools = screen.getByRole("region", { name: "Page Tools" });
    const addWord = screen.getByRole("button", { name: "Add word box" });
    const tooltipId = addWord.getAttribute("aria-describedby");

    expect(pageTools).toBeInTheDocument();
    expect(addWord).toHaveTextContent("Word");
    expect(addWord).toHaveAttribute("title", "Click once to place one word; double-click to keep placing words.");
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId!)).toHaveAttribute("role", "tooltip");
    expect(document.getElementById(tooltipId!)).toHaveTextContent("Click once to place one word; double-click to keep placing words.");
  });

  it("exposes pressed state for ribbon visibility toggles", () => {
    render(<App />);
    const lineGuides = screen.getByRole("button", { name: "Hide line guides" });
    const literalLayer = screen.getByRole("button", { name: "Hide Literal layer" });

    expect(lineGuides).toHaveAttribute("aria-pressed", "true");
    expect(lineGuides).toHaveTextContent("Guides");
    expect(literalLayer).toHaveAttribute("aria-pressed", "true");
    expect(literalLayer).toHaveAttribute("aria-describedby");

    fireEvent.click(literalLayer);

    expect(screen.getByRole("button", { name: "Show Literal layer" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows annotation handles with guides and does not expose a separate handle toggle", () => {
    const legacyDocument = { ...createSampleDocument(), annotationHandlesVisible: false };
    const { container } = render(<App initialDocument={legacyDocument} />);

    expect(screen.queryByRole("button", { name: "Hide annotation handles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show annotation handles" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".annotation-handle").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add above annotation for το" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add below annotation for το" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide line guides" }));

    expect(container.querySelectorAll(".annotation-handle")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Show line guides" }));

    expect(container.querySelectorAll(".annotation-handle").length).toBeGreaterThan(0);
  });

  it("creates and focuses token-anchored annotations from handles", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add above annotation for το" }));

    const inlineAnnotationInput = screen.getByLabelText("Annotation above for το") as HTMLInputElement;
    expect(inlineAnnotationInput).toHaveAttribute("placeholder", "Annotation");
    expect(inlineAnnotationInput).not.toHaveAttribute("readonly");
    expect(inlineAnnotationInput).toHaveValue("");
    expect(screen.getByRole("button", { name: "above annotation for το" })).toHaveClass("annotation-word-box");
    expect(screen.queryByRole("button", { name: "Add above annotation for το" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".annotation")).toHaveLength(1);
    fireEvent.change(inlineAnnotationInput, { target: { value: "the" } });

    expect(screen.getByLabelText("Annotation above for το")).toHaveValue("the");

    fireEvent.click(screen.getByRole("button", { name: "above annotation for το" }));
    expect(container.querySelectorAll(".annotation")).toHaveLength(1);
    expect((screen.getByLabelText("Annotation") as HTMLInputElement).value).toBe("the");

    fireEvent.click(screen.getByRole("button", { name: "Add below annotation for το" }));
    expect(container.querySelectorAll(".annotation")).toHaveLength(2);
    expect(screen.getByLabelText("Annotation below for το")).toHaveAttribute("placeholder", "Annotation");
  });

  it("undoes annotation edits", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add above annotation for το" }));
    fireEvent.change(screen.getByLabelText("Annotation"), { target: { value: "the" } });
    expect(screen.getByLabelText("Annotation above for το")).toHaveValue("the");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Annotation above for το")).toHaveValue("");
  });

  it("creates and focuses span-anchored annotations from concept handles", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add above annotation for what-it-was-to-be" }));

    expect(screen.getByLabelText("Annotation above for what-it-was-to-be")).toHaveAttribute("placeholder", "Annotation");
    expect(screen.getByLabelText("Annotation above for what-it-was-to-be")).toHaveValue("");
    expect(screen.getByRole("button", { name: "above annotation for what-it-was-to-be" })).toHaveClass("annotation-word-box");
    expect(screen.queryByRole("button", { name: "Add above annotation for what-it-was-to-be" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".annotation")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Annotation"), { target: { value: "essence" } });
    expect(screen.getByLabelText("Annotation above for what-it-was-to-be")).toHaveValue("essence");

    fireEvent.click(screen.getByRole("button", { name: "above annotation for what-it-was-to-be" }));
    expect(container.querySelectorAll(".annotation")).toHaveLength(1);
    expect((screen.getByLabelText("Annotation") as HTMLInputElement).value).toBe("essence");
  });

  it("deletes selected word boxes with Delete and removes dependent annotations and spans", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add above annotation for το" }));
    fireEvent.change(screen.getByLabelText("Annotation"), { target: { value: "the" } });
    fireEvent.click(screen.getByLabelText("Word box το").closest(".word-box") as HTMLElement);
    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.queryByLabelText("Word box το")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "what-it-was-to-be", exact: true })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".annotation")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Word box το")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "what-it-was-to-be", exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Annotation above for το")).toHaveValue("the");
  });

  it("deletes selected line guides with x outside typing mode", () => {
    const { container } = render(<App />);
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;

    fireEvent.pointerDown(lineGuide, pointerInit(0, 0));
    fireEvent.pointerUp(window);
    fireEvent.keyDown(window, { key: "x" });

    expect(container.querySelectorAll(".line-guide")).toHaveLength(0);
    expect(container.querySelectorAll(".word-box")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "what-it-was-to-be", exact: true })).not.toBeInTheDocument();
  });

  it("does not delete nodes while a word box is in typing mode", () => {
    render(<App />);
    const wordBox = screen.getByLabelText("Word box το").closest(".word-box") as HTMLElement;

    fireEvent.doubleClick(wordBox);
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.getByLabelText("Word box το")).toBeInTheDocument();
  });

  it("deletes selected page objects with Delete", () => {
    const { container } = render(<App />);
    const pageObject = container.querySelector(".page-object") as HTMLElement;

    fireEvent.click(pageObject);
    fireEvent.keyDown(window, { key: "Delete" });

    expect(container.querySelectorAll(".page-object")).toHaveLength(0);
  });

  it("keeps token-anchored annotations attached while dragging the source word", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add above annotation for το" }));
    const annotation = screen.getByRole("button", { name: "above annotation for το" }) as HTMLElement;
    const sourceWord = container.querySelector(".word-box") as HTMLElement;
    const initialLeft = Number.parseFloat(annotation.style.left);

    fireEvent.pointerDown(sourceWord, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 120, 0));

    const movedAnnotation = screen.getByRole("button", { name: "above annotation for το" }) as HTMLElement;
    expect(Number.parseFloat(movedAnnotation.style.left)).toBeGreaterThan(initialLeft);
    fireEvent.pointerUp(window);
    expect(container.querySelectorAll(".annotation")).toHaveLength(1);
  });

  it("bolds the line guide that will receive a snapped word box", () => {
    const { container } = render(<App />);
    placeLineAt(container, 90, 240);
    const wordBox = screen.getByLabelText("Word box το").closest(".word-box") as HTMLElement;

    fireEvent.pointerDown(wordBox, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 0, 120 * DEFAULT_ZOOM));

    const snapTargets = container.querySelectorAll(".line-guide.snap-target");
    expect(snapTargets).toHaveLength(1);
    expect((snapTargets[0] as HTMLElement).style.top).toBe("240px");
    fireEvent.pointerUp(window);

    expect(container.querySelectorAll(".line-guide.snap-target")).toHaveLength(0);
  });

  it("keeps span-anchored annotations attached while dragging the concept span", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add below annotation for what-it-was-to-be" }));
    const annotation = screen.getByRole("button", { name: "below annotation for what-it-was-to-be" }) as HTMLElement;
    const conceptSpan = screen.getByRole("button", { name: "what-it-was-to-be", exact: true }) as HTMLElement;
    const initialTop = Number.parseFloat(annotation.style.top);

    fireEvent.pointerDown(conceptSpan, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 0, 45));
    fireEvent.pointerUp(window);

    const movedAnnotation = screen.getByRole("button", { name: "below annotation for what-it-was-to-be" }) as HTMLElement;
    expect(Number.parseFloat(movedAnnotation.style.top)).toBeGreaterThan(initialTop);
  });

  it("renders line guides from margin to margin with a clean hit target", () => {
    const { container } = render(<App />);
    const page = container.querySelector(".page") as HTMLElement;
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    const routingBand = container.querySelector(".routing-band") as HTMLElement;
    const wordBox = container.querySelector(".word-box") as HTMLElement;

    expect(lineGuide.style.left).toBe("54px");
    expect(lineGuide.style.width).toBe(`${Number.parseFloat(page.style.width) - 108}px`);
    expect(lineGuide.style.height).toBe(wordBox.style.height);
    expect(lineGuide.style.height).toBe(wordBox.style.minHeight);
    expect(routingBand.style.height).toBe(lineGuide.style.height);
    expect(getComputedStyle(lineGuide).height).toBe("16px");
    expect(container.querySelector(".line-handle")).not.toBeInTheDocument();
  });

  it("selects a line guide without blocking nearby word-box selection", () => {
    const { container } = render(<App />);
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    const wordBox = container.querySelector(".word-box") as HTMLElement;

    fireEvent.pointerDown(lineGuide, pointerInit(0, 0));
    expect(lineGuide).toHaveClass("selected");

    fireEvent.click(wordBox);
    expect(lineGuide).not.toHaveClass("selected");
    expect(wordBox).toHaveClass("selected");
  });

  it("undoes line guide movement", () => {
    const { container } = render(<App />);
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    const initialTop = Number.parseFloat(lineGuide.style.top);

    fireEvent.pointerDown(lineGuide, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 0, 50));
    fireEvent.pointerUp(window);
    expect(Number.parseFloat((container.querySelector(".line-guide") as HTMLElement).style.top)).toBeGreaterThan(initialTop);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(Number.parseFloat((container.querySelector(".line-guide") as HTMLElement).style.top)).toBe(initialTop);
  });

  it("does not move word boxes when dragging a line guide horizontally", () => {
    const { container } = render(<App />);
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    const wordBox = container.querySelector(".word-box") as HTMLElement;
    const initialLeft = Number.parseFloat(wordBox.style.left);

    fireEvent.pointerDown(lineGuide, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 150, 0));
    fireEvent.pointerUp(window);

    expect(Number.parseFloat((container.querySelector(".word-box") as HTMLElement).style.left)).toBe(initialLeft);
  });

  it("keeps dragged line guides inside the vertical page margins", () => {
    const { container } = render(<App />);
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    const lineHeight = Number.parseFloat(lineGuide.style.height);

    fireEvent.pointerDown(lineGuide, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 0, -999 * DEFAULT_ZOOM));
    fireEvent.pointerUp(window);
    expect((container.querySelector(".line-guide") as HTMLElement).style.top).toBe("54px");

    fireEvent.pointerDown(container.querySelector(".line-guide") as HTMLElement, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 0, 999 * DEFAULT_ZOOM));
    fireEvent.pointerUp(window);

    expect(Number.parseFloat((container.querySelector(".line-guide") as HTMLElement).style.top)).toBe(792 - 54 - lineHeight);
  });

  it("does not create a new line or word box on page double-click", () => {
    const { container } = render(<App />);
    const page = container.querySelector(".page") as HTMLElement;
    const initialWordBoxCount = container.querySelectorAll(".word-box").length;
    const initialLineCount = container.querySelectorAll(".line-layer").length;

    fireEvent.doubleClick(page, { clientX: 300, clientY: 420 });

    expect(container.querySelectorAll(".word-box")).toHaveLength(initialWordBoxCount);
    expect(container.querySelectorAll(".line-layer")).toHaveLength(initialLineCount);
  });

  it("places a new line from line placement mode", () => {
    const { container } = render(<App />);
    const initialLineCount = container.querySelectorAll(".line-layer").length;

    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(screen.getByRole("button", { name: "Add line" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add line" })).not.toHaveAttribute("data-sticky");
    expect(container.querySelectorAll(".line-layer")).toHaveLength(initialLineCount);

    clickPageAt(container, 90, 220);

    expect(container.querySelectorAll(".line-layer")).toHaveLength(initialLineCount + 1);
    expect(Number.parseFloat((container.querySelectorAll(".line-guide")[initialLineCount] as HTMLElement).style.top)).toBeCloseTo(220);
    expect(screen.getByRole("button", { name: "Add line" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps line placement active after double-clicking the line tool", () => {
    const { container } = render(<App />);
    const initialLineCount = container.querySelectorAll(".line-layer").length;

    const addLine = activateStickyPlacementMode("Add line");
    expect(addLine).toHaveAttribute("aria-pressed", "true");
    expect(addLine).toHaveAttribute("data-sticky", "true");
    expect(addLine).toHaveClass("sticky");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText(/Repeated line placement mode active/i)).not.toBeInTheDocument();

    clickPageAt(container, 90, 220);
    clickPageAt(container, 90, 280);

    expect(container.querySelectorAll(".line-layer")).toHaveLength(initialLineCount + 2);
    expect(addLine).toHaveAttribute("aria-pressed", "true");
    expect(addLine).toHaveAttribute("data-sticky", "true");
  });

  it("places a text block at the clicked page location from text block placement mode", () => {
    const { container } = rtlRender(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add text block" }));
    expect(screen.getByRole("button", { name: "Add text block" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".page-object")).toHaveLength(0);

    clickPageAt(container, 220, 260);

    const pageObject = container.querySelector(".page-object") as HTMLElement;
    expect(pageObject).toBeInTheDocument();
    expect(Number.parseFloat(pageObject.style.left)).toBeCloseTo(220);
    expect(Number.parseFloat(pageObject.style.top)).toBeCloseTo(260);
    expect(pageObject).toHaveTextContent("Independent text block");
  });

  it.each([
    ["Add title block", "Title", "title-block", 420, 52],
    ["Add subtitle block", "Subtitle", "subtitle-block", 380, 40],
    ["Add section block", "Section", "section-block", 320, 36]
  ] as const)("places a %s element at the clicked page location", (buttonLabel, content, className, width, height) => {
    const { container } = rtlRender(<App />);

    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    expect(screen.getByRole("button", { name: buttonLabel })).toHaveAttribute("aria-pressed", "true");

    clickPageAt(container, 80, 90);

    const pageObject = container.querySelector(".page-object") as HTMLElement;
    expect(pageObject).toBeInTheDocument();
    expect(pageObject.querySelector(`.${className}`)).toBeInTheDocument();
    expect(Number.parseFloat(pageObject.style.left)).toBeCloseTo(80);
    expect(Number.parseFloat(pageObject.style.top)).toBeCloseTo(90);
    expect(Number.parseFloat(pageObject.style.width)).toBeCloseTo(width);
    expect(Number.parseFloat(pageObject.style.height)).toBeCloseTo(height);
    expect(pageObject).toHaveTextContent(content);
    expect(screen.getByRole("button", { name: buttonLabel })).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["Add title block", "Title", "Title block text", "Edited title"],
    ["Add subtitle block", "Subtitle", "Subtitle block text", "Edited subtitle"],
    ["Add section block", "Section", "Section block text", "Edited section"]
  ] as const)("edits a %s element inline after double click", async (buttonLabel, content, inputLabel, editedContent) => {
    const { container } = rtlRender(<App />);

    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    clickPageAt(container, 80, 90);

    const pageObject = container.querySelector(".page-object") as HTMLElement;
    fireEvent.doubleClick(pageObject);

    const input = screen.getByLabelText<HTMLInputElement>(inputLabel);
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue(content);

    fireEvent.keyDown(window, { key: "x" });
    expect(container.querySelectorAll(".page-object")).toHaveLength(1);

    fireEvent.change(input, { target: { value: editedContent } });
    expect(input).toHaveValue(editedContent);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByLabelText(inputLabel)).not.toBeInTheDocument();
    expect(pageObject).toHaveTextContent(editedContent);
  });

  it("hides title block wrapper chrome with visual guides", () => {
    const { container } = rtlRender(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add title block" }));
    clickPageAt(container, 80, 90);

    const pageObject = container.querySelector(".page-object-titleBlock") as HTMLElement;
    expect(screen.getByRole("button", { name: "Resize page object southeast" })).toBeInTheDocument();
    expect(pageObject).toHaveTextContent("Title");

    fireEvent.click(screen.getByRole("button", { name: "Hide line guides" }));

    const style = getComputedStyle(pageObject);
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(["", "none"]).toContain(style.borderTopStyle);
    expect(["", "none"]).toContain(style.boxShadow);
    expect(screen.queryByRole("button", { name: "Resize page object southeast" })).not.toBeInTheDocument();
    expect(pageObject).toHaveTextContent("Title");
  });

  it("places a word on an existing line guide while word placement mode is active", () => {
    const { container } = rtlRender(<App />);
    const addWord = activateStickyPlacementMode("Add word box");
    clickPageAt(container, 90, 120);

    const initialWordCount = container.querySelectorAll(".word-box").length;
    const initialLineCount = container.querySelectorAll(".line-guide").length;
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    const initialTop = lineGuide.style.top;

    fireEvent.pointerDown(lineGuide, pointerInit(220 * DEFAULT_ZOOM, Number.parseFloat(initialTop) * DEFAULT_ZOOM));
    fireEvent.pointerUp(window);

    expect(container.querySelectorAll(".word-box")).toHaveLength(initialWordCount + 1);
    expect(container.querySelectorAll(".line-guide")).toHaveLength(initialLineCount);
    expect((container.querySelector(".line-guide") as HTMLElement).style.top).toBe(initialTop);
    expect(addWord).toHaveAttribute("aria-pressed", "true");
    expect(addWord).toHaveAttribute("data-sticky", "true");
  });

  it("renders word boxes without a separate grip indicator", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".word-grip")).not.toBeInTheDocument();
  });

  it("selects a word box on single click without entering text edit mode", () => {
    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("Word box το");
    const wordBox = input.closest(".word-box") as HTMLElement;

    expect(input).toHaveAttribute("readonly");

    fireEvent.click(wordBox);
    fireEvent.change(input, { target: { value: "logos" } });

    expect(wordBox).toHaveClass("selected");
    expect(screen.getByLabelText("Word box το")).toHaveValue("το");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("edits a word box only after double-clicking it", () => {
    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("Word box το");
    const wordBox = input.closest(".word-box") as HTMLElement;

    fireEvent.doubleClick(wordBox);
    expect(input).not.toHaveAttribute("readonly");

    fireEvent.change(input, { target: { value: "logos" } });

    expect(screen.getByLabelText("Word box logos")).toHaveValue("logos");
    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();
  });

  it("keeps editing when a growing word box reflows to a new line", async () => {
    const { container } = render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("Word box το");
    const wordBox = input.closest(".word-box") as HTMLElement;
    const initialLineCount = container.querySelectorAll(".line-guide").length;
    const longWord = "supercalifragilisticexpialidocioussupercalifragilisticexpialidocious";

    fireEvent.doubleClick(wordBox);
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: longWord } });

    await waitFor(() => expect(container.querySelectorAll(".line-guide").length).toBeGreaterThan(initialLineCount));
    const movedInput = [...container.querySelectorAll<HTMLInputElement>(".word-box .word-input")].find(
      (candidate) => candidate.value === longWord
    )!;

    await waitFor(() => expect(document.activeElement).toBe(movedInput));
    movedInput.focus();
    fireEvent.blur(movedInput);
    movedInput.focus();

    await waitFor(() => expect(movedInput).not.toHaveAttribute("readonly"));
    fireEvent.change(movedInput, { target: { value: `${longWord}x` } });

    expect(
      [...container.querySelectorAll<HTMLInputElement>(".word-box .word-input")].find((candidate) => candidate.value === `${longWord}x`)
    ).toBeInTheDocument();
  });

  it("creates and focuses the next word box when pressing Space while editing", () => {
    const { container } = render(<App />);

    editWordBox("Word box το", "logos");
    const editedInput = screen.getByLabelText<HTMLInputElement>("Word box logos");

    fireEvent.keyDown(editedInput, { key: " ", code: "Space" });

    const wordInputs = [...container.querySelectorAll<HTMLInputElement>(".word-input")];
    const values = wordInputs.map((input) => input.value);
    const newInput = screen.getByLabelText<HTMLInputElement>("Word box empty");

    expect(values.slice(0, 3)).toEqual(["logos", "", "τι"]);
    expect(newInput).not.toHaveAttribute("readonly");
    expect(document.activeElement).toBe(newInput);

    fireEvent.change(newInput, { target: { value: "kai" } });
    expect(screen.getByLabelText("Word box kai")).toHaveValue("kai");
  });

  it("stops editing a word box when pressing Enter", () => {
    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("Word box το");
    const wordBox = input.closest(".word-box") as HTMLElement;

    fireEvent.doubleClick(wordBox);
    expect(input).not.toHaveAttribute("readonly");

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(input).toHaveAttribute("readonly");
    expect(document.activeElement).not.toBe(input);
  });

  it("exits word-box edit mode when clicking outside the active box", () => {
    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("Word box το");
    const wordBox = input.closest(".word-box") as HTMLElement;

    fireEvent.doubleClick(wordBox);
    expect(input).not.toHaveAttribute("readonly");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Document", exact: true }), pointerInit(0, 0));

    expect(input).toHaveAttribute("readonly");
  });

  it("drags a word box from the box body", () => {
    const { container } = render(<App />);
    const wordBox = container.querySelector(".word-box") as HTMLElement;
    const initialLeft = Number.parseFloat(wordBox.style.left);

    fireEvent.pointerDown(wordBox, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 150, 140));
    fireEvent.pointerUp(window);

    const movedWordBox = container.querySelector(".word-box") as HTMLElement;
    expect(Number.parseFloat(movedWordBox.style.left)).toBeGreaterThan(initialLeft);
  });

  it("keeps a word box at its freely dragged horizontal position after release", () => {
    const { container } = rtlRender(<App />);
    placeWordBoxAt(container, 100, 120);
    const lineGuide = container.querySelector(".line-guide") as HTMLElement;
    fireEvent.pointerDown(lineGuide, pointerInit(300 * DEFAULT_ZOOM, Number.parseFloat(lineGuide.style.top) * DEFAULT_ZOOM));
    fireEvent.pointerUp(window);

    const secondWordBox = [...container.querySelectorAll<HTMLElement>(".word-box")].at(-1)!;
    const initialLeft = Number.parseFloat(secondWordBox.style.left);
    const rawDragDelta = 51;

    fireEvent.pointerDown(secondWordBox, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", rawDragDelta, 0));
    fireEvent.pointerUp(window);

    const movedWordBox = [...container.querySelectorAll<HTMLElement>(".word-box")].at(-1)!;
    expect(Number.parseFloat(movedWordBox.style.left)).toBeCloseTo(initialLeft + rawDragDelta / DEFAULT_ZOOM);
    expect(findOverlappingWordBoxes(container)).toEqual([]);
  });

  it("undoes dragged word box movement", () => {
    const { container } = render(<App />);
    const wordBox = container.querySelector(".word-box") as HTMLElement;
    const initialLeft = Number.parseFloat(wordBox.style.left);

    fireEvent.pointerDown(wordBox, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 150, 140));
    fireEvent.pointerUp(window);
    expect(Number.parseFloat((container.querySelector(".word-box") as HTMLElement).style.left)).toBeGreaterThan(initialLeft);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(Number.parseFloat((container.querySelector(".word-box") as HTMLElement).style.left)).toBe(initialLeft);
  });

  it("undoes page object movement", () => {
    const { container } = render(<App />);
    const pageObject = container.querySelector(".page-object") as HTMLElement;
    const initialLeft = Number.parseFloat(pageObject.style.left);

    fireEvent.pointerDown(pageObject, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 60, 0));
    fireEvent.pointerUp(window);
    expect(Number.parseFloat((container.querySelector(".page-object") as HTMLElement).style.left)).toBeGreaterThan(initialLeft);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(Number.parseFloat((container.querySelector(".page-object") as HTMLElement).style.left)).toBe(initialLeft);
  });

  it("resizes a selected page object with corner handles and updates routing immediately", () => {
    const { container } = render(<App />);
    const pageObject = container.querySelector(".page-object") as HTMLElement;
    const initialWidth = Number.parseFloat(pageObject.style.width);
    const initialBandWidth = Number.parseFloat((container.querySelector(".routing-band") as HTMLElement).style.width);

    fireEvent.click(pageObject);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize page object northwest" }), pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", -92, 0));

    expect(Number.parseFloat((container.querySelector(".page-object") as HTMLElement).style.width)).toBeGreaterThan(initialWidth);
    expect(Number.parseFloat((container.querySelector(".routing-band") as HTMLElement).style.width)).toBeLessThan(
      initialBandWidth
    );
    fireEvent.pointerUp(window);
  });

  it("clamps page object drag resizing to minimum dimensions and makes resize undoable", () => {
    const { container } = render(<App />);
    const pageObject = container.querySelector(".page-object") as HTMLElement;
    const initialWidth = Number.parseFloat(pageObject.style.width);
    const initialHeight = Number.parseFloat(pageObject.style.height);

    fireEvent.click(pageObject);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize page object southeast" }), pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", -999, -999));
    fireEvent.pointerUp(window);

    expect((container.querySelector(".page-object") as HTMLElement).style.width).toBe("48px");
    expect((container.querySelector(".page-object") as HTMLElement).style.height).toBe("36px");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(Number.parseFloat((container.querySelector(".page-object") as HTMLElement).style.width)).toBe(initialWidth);
    expect(Number.parseFloat((container.querySelector(".page-object") as HTMLElement).style.height)).toBe(initialHeight);
  });

  it("uses the constrained page object rect path from inspector size edits", () => {
    const { container } = render(<App />);
    const pageObject = container.querySelector(".page-object") as HTMLElement;

    fireEvent.click(pageObject);
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("H"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "999" } });

    expect((container.querySelector(".page-object") as HTMLElement).style.width).toBe("180px");
    expect((container.querySelector(".page-object") as HTMLElement).style.height).toBe("120px");
    expect((container.querySelector(".page-object") as HTMLElement).style.left).toBe("432px");
    expect((container.querySelector(".page-object") as HTMLElement).style.top).toBe("672px");
  });

  it("stops routing around a selected page object when wrap mode is none", () => {
    const { container } = render(<App />);
    const pageObject = container.querySelector(".page-object") as HTMLElement;
    const initialBandWidth = Number.parseFloat((container.querySelector(".routing-band") as HTMLElement).style.width);

    fireEvent.click(pageObject);
    fireEvent.change(screen.getByLabelText("Wrap"), { target: { value: "none" } });

    expect(Number.parseFloat((container.querySelector(".routing-band") as HTMLElement).style.width)).toBeGreaterThan(
      initialBandWidth
    );
    expect((container.querySelector(".routing-band") as HTMLElement).style.width).toBe("504px");
  });

  it("does not drag while clicking into a word input without meaningful movement", () => {
    const { container } = render(<App />);
    const wordBox = container.querySelector(".word-box") as HTMLElement;
    const input = wordBox.querySelector(".word-input") as HTMLInputElement;
    const initialLeft = wordBox.style.left;

    fireEvent.doubleClick(wordBox);
    fireEvent.pointerDown(input, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", 2, 0));
    fireEvent.pointerUp(window);
    fireEvent.change(input, { target: { value: "λόγος" } });

    const unchangedWordBox = container.querySelector(".word-box") as HTMLElement;
    expect(unchangedWordBox.style.left).toBe(initialLeft);
    expect(input.value).toBe("λόγος");
  });

  it("places repeated word boxes without rendered overlap", () => {
    const { container } = rtlRender(<App />);

    placeWordBoxAt(container, 90, 120);
    placeWordBoxAt(container, 90, 120);

    expect(findOverlappingWordBoxes(container)).toEqual([]);
  });

  it("keeps rendered word boxes from overlapping after editing text widths", () => {
    const { container } = rtlRender(<App />);

    placeLineAt(container, 90, 240);
    placeWordBoxAt(container, 90, 240);
    placeWordBoxAt(container, 90, 240);
    const emptyInputs = screen.getAllByPlaceholderText("word").filter((input) => (input as HTMLInputElement).value === "");
    fireEvent.change(emptyInputs[0], { target: { value: "λόγος" } });
    fireEvent.change(emptyInputs[1], { target: { value: "μακροτατος" } });

    expect(findOverlappingWordBoxes(container)).toEqual([]);
  });

  it("resolves rendered overlap after dragging a word box into an occupied area", () => {
    const { container } = rtlRender(<App />);

    placeLineAt(container, 90, 240);
    placeWordBoxAt(container, 90, 240);
    placeWordBoxAt(container, 90, 240);
    const emptyInputs = screen.getAllByPlaceholderText("word").filter((input) => (input as HTMLInputElement).value === "");
    fireEvent.change(emptyInputs[0], { target: { value: "alpha" } });
    fireEvent.change(emptyInputs[1], { target: { value: "beta" } });

    const boxesBeforeDrag = [...container.querySelectorAll<HTMLElement>(".word-box")];
    const lastBox = boxesBeforeDrag.at(-1) as HTMLElement;
    const previousBox = boxesBeforeDrag.at(-2) as HTMLElement;
    const dx = Number.parseFloat(previousBox.style.left) - Number.parseFloat(lastBox.style.left);
    const dy = Number.parseFloat(previousBox.style.top) - Number.parseFloat(lastBox.style.top);

    fireEvent.pointerDown(lastBox, pointerInit(0, 0));
    fireEvent(window, pointerEvent("pointermove", dx, dy));
    expect(container.querySelector(".drop-slot")).not.toBeInTheDocument();
    expect(findOverlappingWordBoxes(container)).toEqual([]);
    fireEvent.pointerUp(window);

    expect(container.querySelector(".drop-slot")).not.toBeInTheDocument();
    expect(findOverlappingWordBoxes(container)).toEqual([]);
  });
});

function pointerInit(clientX: number, clientY: number): { clientX: number; clientY: number } {
  return { clientX, clientY };
}

function pointerEvent(type: string, clientX: number, clientY: number, options: { button?: number; buttons?: number } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: options.button ?? 0 },
    buttons: { value: options.buttons ?? 0 },
    clientX: { value: clientX },
    clientY: { value: clientY }
  });
  return event;
}

function findOverlappingWordBoxes(container: HTMLElement): string[] {
  const boxes = [...container.querySelectorAll<HTMLElement>(".word-box")].map((box, index) => ({
    id: box.querySelector<HTMLInputElement>(".word-input")?.value || `empty-${index}`,
    x: Number.parseFloat(box.style.left),
    y: Number.parseFloat(box.style.top),
    width: Number.parseFloat(box.style.width),
    height: Number.parseFloat(box.style.minHeight)
  }));

  const overlaps: string[] = [];
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      if (
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
      ) {
        overlaps.push(`${left.id}:${right.id}`);
      }
    }
  }
  return overlaps;
}

function createBottomOverflowDocument(): InterlinearDocument {
  const doc = createEmptyDocument();
  const page = doc.pages[0];
  const lineId = "line_bottom";
  const tokenId = "tok_seed";
  const maxLineY = doc.pageSettings.height - doc.pageSettings.marginBottom - sourceLineBoxHeight(doc.pageSettings);
  const contentWidth = doc.pageSettings.width - doc.pageSettings.marginLeft - doc.pageSettings.marginRight;

  return {
    ...doc,
    tokens: {
      [tokenId]: {
        id: tokenId,
        text: "seed",
        normalized: "seed",
        direction: "ltr",
        lineId,
        offset: { x: 0, y: 0 },
        textMetrics: {}
      }
    },
    pages: [
      {
        ...page,
        lines: [
          {
            id: lineId,
            tokenIds: [tokenId],
            y: maxLineY,
            offset: { x: 0, y: 0 },
            direction: "ltr"
          }
        ],
        pageObjects: [
          {
            id: "full_width_obstacle",
            kind: "textBlock",
            rect: {
              x: doc.pageSettings.marginLeft,
              y: maxLineY - 4,
              width: contentWidth,
              height: sourceLineBoxHeight(doc.pageSettings) + 8
            },
            wrapMode: "rectangular",
            zIndex: 1,
            content: "",
            caption: "",
            metadata: {}
          }
        ]
      }
    ]
  };
}
