# Interlinear

Local-first Electron app for layered interlinear translation, page composition, and XeLaTeX/PDF export.

## Run

```bash
npm install
npm run dev
```

The renderer alone can be previewed with:

```bash
npm run dev:renderer
```

## Verify

```bash
npm test
npm run test:smoke
npm run typecheck
npm run build
npm audit --omit=optional
```

## Package

Build an unsigned local macOS app bundle:

```bash
npm run package:mac
```

The package is written to `release/mac*/Interlinear.app`. The app uses placeholder `IL` branding generated at `build/icon.icns`; replace that icon before public distribution. Signing and notarization requirements are documented in [docs/release-verification.md](docs/release-verification.md).

## Browser Smoke Checklist

Start the renderer-only preview:

```bash
npm run dev:renderer
```

Open `http://127.0.0.1:5173` and check:

- Ribbon controls render, including Open, Save, Save As, exports, word/line tools, layer toggles, and visibility toggles.
- Direct word-box editing works on the page; the document shows Modified after an edit.
- Line guides can be hidden and shown without moving word boxes.
- Page objects can be selected, moved, resized, and switched between rectangular and none wrapping.
- Inspector tabs open for Selection, Document, Layers, and Lexicon; the Document tab shows Recent Documents.
- Browser console has no runtime errors.

Stop the preview with `Ctrl-C` after the smoke pass.

## Current MVP

- Structured `.iltdoc` document model with pages, source tokens, annotation cells, layers, nested layer spans, and floating page objects.
- Independent `.iltlex` lexicon model with token and multi-token concept entries.
- Paged editor with direct page word-box entry, explicit line creation, toggleable line guides, draggable lines, tokens, annotation cells, layer span labels, images, and text blocks.
- Ribbon controls for file actions, composition tools, layer visibility, and exports, with document metadata in the right inspector.
- Rectangular text routing around floating page objects.
- Lexicon suggestions for single-token terms and multi-token concepts.
- XeLaTeX export through `latexmk -xelatex`, preserving positioned text and page objects.
