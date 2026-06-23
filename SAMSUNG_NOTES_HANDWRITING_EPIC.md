# Epic: Samsung Notes-Style Multi-Page Handwriting Notebook

> Product & Engineering Specification — myNotes
> Status: **Proposed**
> Author: Copilot (AI Architect) & Piyush (Staff Engineer)
> Last updated: 2026-06-23

---

## 1. Executive Summary

### 1.1 Problem Statement

The current `CanvasEditor.svelte` is a **single-page, fixed-dimension canvas** (800×1130px) designed for quick sketching. It does not emulate the experience of a real handwriting notebook. Users expect a **Samsung Notes-like** writing surface where:

- Pages stack **vertically** in a continuous scroll
- Writing naturally flows from one page to the next
- The final output can be exported as a **multi-page PDF**
- It feels like writing on paper — not drawing on a canvas

### 1.2 Vision

Transform the canvas editor into a **page-based handwriting notebook** that mirrors Samsung Notes:

1. **Infinite vertical pages** — Users scroll down, new blank pages appear automatically
2. **Page-aware strokes** — Each stroke belongs to a specific page
3. **Natural scroll writing** — Finger/stylus scrolls AND writes contextually
4. **Multi-page PDF export** — All pages render as a single downloadable PDF
5. **Page management** — Add, delete, reorder, duplicate pages
6. **Page templates** — Blank, ruled, grid, dotted (per-page customizable)
7. **Responsive** — Works on desktop, tablet, and mobile (Capacitor/Android)

### 1.3 Reference: Samsung Notes Behavior

| Feature | Samsung Notes | Our Implementation |
|---------|--------------|-------------------|
| Page layout | Vertical stack, continuous scroll | Same — vertical scroll container with discrete pages |
| Auto-page creation | New page when you draw near bottom | Same — auto-append page when last page gets content |
| Page separation | Subtle shadow/gap between pages | Card-style pages with 16px gap, shadow, rounded corners |
| Scroll vs Draw | Palm rejection; scroll with 2 fingers, draw with pen | `InputMode` system: auto/penOnly/touchDraw |
| PDF export | Multi-page PDF | `jsPDF` (already in dependencies) with per-page rendering |
| Page background | Per-page templates | Per-page `CanvasBackground` setting |
| Zoom | Pinch zoom on page area | Already implemented — retain viewport system |
| Undo/Redo | Global across pages | Global undo/redo stack |

---

## 2. Architecture & Technical Design

### 2.1 Current State vs Target State

| Aspect | Current (`CanvasEditor.svelte`) | Target (`NotebookEditor.svelte`) |
|--------|--------------------------------|----------------------------------|
| Data model | `Stroke[]` + single `CanvasBackground` | `NotebookPage[]` each with own strokes + background |
| Canvas | Single `<canvas>` element, viewport transforms | Multiple `<canvas>` per visible page OR single canvas with page-aware viewport |
| Rendering | All strokes on one plane | Per-page clipping, page boundaries |
| Export | PNG of single page | Multi-page PDF via `jsPDF` |
| Storage | Flat `strokes[]` array | `NotebookDocument` with pages array |
| Scroll | Zoom/pan (no natural scroll) | Vertical scroll container with optional zoom |

### 2.2 Data Model

```typescript
// src/lib/utils/notebookTypes.ts

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  timestamp?: number;
}

export type NotebookTool = 'pen' | 'highlighter' | 'eraser';
export type PageBackground = 'blank' | 'lined' | 'grid' | 'dotted';
export type InputMode = 'auto' | 'penOnly' | 'touchDraw';

export interface Stroke {
  id: string;
  tool: NotebookTool;
  points: StrokePoint[];
  color: string;
  size: number;
  opacity: number;
}

export interface NotebookPage {
  id: string;
  index: number;           // page order (0-based)
  background: PageBackground;
  strokes: Stroke[];
  width: number;           // default 800
  height: number;          // default 1130 (A4 ratio)
}

export interface NotebookDocument {
  version: number;         // schema version for migrations
  id: string;
  title: string;
  pages: NotebookPage[];
  defaultBackground: PageBackground;
  createdAt: string;
  updatedAt: string;
}
```

### 2.3 Rendering Strategy

**Approach: Virtualized Multi-Canvas**

Instead of one massive canvas, use a **scrollable container** with one `<canvas>` per page:

```
┌─────────────────────────────────┐
│  Scrollable Container           │  ← overflow-y: auto
│  ┌───────────────────────────┐  │
│  │  Page 1 <canvas>          │  │  ← 800×1130 (scaled)
│  │  [strokes for page 1]     │  │
│  └───────────────────────────┘  │
│         16px gap                │
│  ┌───────────────────────────┐  │
│  │  Page 2 <canvas>          │  │
│  │  [strokes for page 2]     │  │
│  └───────────────────────────┘  │
│         16px gap                │
│  ┌───────────────────────────┐  │
│  │  Page 3 (auto-created)    │  │
│  │  [empty - ready to write] │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

**Why multi-canvas over single canvas?**
- Each page is independently renderable (better performance)
- Natural DOM scroll instead of manual viewport pan
- Easy per-page operations (delete, reorder, change background)
- Intersection Observer for virtualization (only render visible pages)
- Simpler hit-testing and coordinate mapping

### 2.4 Technology Stack

| Need | Technology | Notes |
|------|-----------|-------|
| Stroke rendering | `perfect-freehand` | Already in `package.json` |
| PDF generation | `jsPDF` | Already in `package.json` |
| Canvas API | Native HTML5 Canvas 2D | Current approach |
| Scroll virtualization | IntersectionObserver | Native API, no dependency |
| State management | Svelte 5 `$state` runes | Current approach |
| Storage | IndexedDB / FileSystem Access API | Via existing `StorageAdapter` |
| Mobile | Capacitor | Already configured |

### 2.5 Component Architecture

```
src/lib/components/
├── NotebookEditor.svelte        ← Main container (replaces CanvasEditor for notebook mode)
├── NotebookPage.svelte          ← Individual page canvas + logic
├── NotebookToolbar.svelte       ← Drawing tools toolbar
├── NotebookPageManager.svelte   ← Page thumbnails sidebar/panel
└── NotebookExporter.ts          ← PDF export utility

src/lib/utils/
├── notebookTypes.ts             ← Type definitions
└── notebookStorage.ts           ← Serialize/deserialize notebook documents

src/lib/stores/
└── appState.svelte.ts           ← Add editorMode: 'text' | 'canvas' | 'notebook'
```

---

## 3. Epics & User Stories

### Epic 1: Core Multi-Page Notebook Engine

#### Story 1.1 — Data Model & Types
**As a** developer  
**I want** a well-defined `NotebookDocument` type system  
**So that** pages, strokes, and metadata are structured for multi-page support

**Acceptance Criteria:**
- [ ] Create `src/lib/utils/notebookTypes.ts` with all interfaces
- [ ] `NotebookPage` supports individual background per page
- [ ] `NotebookDocument` has version field for future migrations
- [ ] Unit-testable serialization/deserialization in `notebookStorage.ts`

**Implementation:**
```typescript
// notebookStorage.ts
export function createEmptyNotebook(title: string): NotebookDocument {
  return {
    version: 1,
    id: crypto.randomUUID(),
    title,
    pages: [createEmptyPage(0)],
    defaultBackground: 'lined',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createEmptyPage(index: number, bg?: PageBackground): NotebookPage {
  return {
    id: crypto.randomUUID(),
    index,
    background: bg || 'lined',
    strokes: [],
    width: 800,
    height: 1130
  };
}

export function serializeNotebook(doc: NotebookDocument): string {
  return JSON.stringify(doc);
}

export function deserializeNotebook(json: string): NotebookDocument {
  const parsed = JSON.parse(json);
  // version migration logic here
  return parsed;
}
```

---

#### Story 1.2 — NotebookPage Component (Single Page Canvas)
**As a** user  
**I want** each page to be an independent drawing surface  
**So that** I can write on individual pages that feel like paper

**Acceptance Criteria:**
- [ ] `NotebookPage.svelte` renders a single `<canvas>` element
- [ ] Draws page background (lined/grid/dotted/blank)
- [ ] Renders all strokes belonging to that page
- [ ] Handles pointer events for drawing (pen/highlighter/eraser)
- [ ] Supports HiDPI (devicePixelRatio scaling)
- [ ] Emits events: `onstrokeadd`, `onstrokeerase`, `onactive` (user is drawing on this page)

**Implementation Notes:**
- Reuse `drawStroke()` and `drawBackground()` logic from current `CanvasEditor.svelte`
- Each page canvas is sized to fit container width (responsive)
- Page aspect ratio maintained: `height = width × (1130/800)`
- Card styling: rounded corners, shadow, border (matches current page look)

**UI Style:**
```css
.notebook-page {
  position: relative;
  width: 100%;
  max-width: 800px;
  aspect-ratio: 800 / 1130;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color);
  overflow: hidden;
  touch-action: none; /* prevent browser gestures */
}

.notebook-page canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

---

#### Story 1.3 — NotebookEditor Container (Multi-Page Scroll)
**As a** user  
**I want** to scroll vertically through my notebook pages  
**So that** writing feels continuous like a real notebook

**Acceptance Criteria:**
- [ ] `NotebookEditor.svelte` wraps multiple `NotebookPage` components in a scrollable container
- [ ] Pages are rendered vertically with 16px gap between them
- [ ] Scroll is smooth and natural (native browser scroll)
- [ ] Only visible pages are fully rendered (IntersectionObserver virtualization)
- [ ] Off-screen pages show a static thumbnail or placeholder
- [ ] Active page is highlighted with subtle border glow

**Implementation:**
```svelte
<div class="notebook-scroll-container" bind:this={scrollContainer}>
  {#each notebook.pages as page (page.id)}
    <NotebookPage
      {page}
      active={activePageId === page.id}
      tool={currentTool}
      color={currentColor}
      size={currentSize}
      inputMode={inputMode}
      onStrokeAdd={(stroke) => addStroke(page.id, stroke)}
      onStrokeErase={(ids) => eraseStrokes(page.id, ids)}
      onActive={() => activePageId = page.id}
    />
  {/each}
</div>
```

**Scroll Container Style:**
```css
.notebook-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  gap: 16px;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}
```

---

#### Story 1.4 — Auto Page Creation
**As a** user  
**I want** new pages to appear automatically when I start writing near the bottom  
**So that** I never run out of space

**Acceptance Criteria:**
- [ ] When the last page has at least 1 stroke, a new empty page is auto-appended
- [ ] The new page inherits the notebook's `defaultBackground`
- [ ] Auto-creation happens ONLY when the last page gets content (not on scroll alone)
- [ ] Page count indicator shows "Page X of Y" in toolbar/footer
- [ ] Maximum page limit: 100 pages (with warning)

**Implementation Logic:**
```typescript
function addStroke(pageId: string, stroke: Stroke) {
  // ... add stroke to page ...
  
  // Auto-create next page if this is the last page
  const lastPage = notebook.pages[notebook.pages.length - 1];
  if (pageId === lastPage.id && lastPage.strokes.length === 1) {
    const newPage = createEmptyPage(notebook.pages.length, notebook.defaultBackground);
    notebook.pages = [...notebook.pages, newPage];
  }
}
```

---

#### Story 1.5 — Input Mode & Palm Rejection
**As a** user writing with a stylus  
**I want** touch events to scroll the notebook while pen draws  
**So that** I can navigate naturally without accidental marks

**Acceptance Criteria:**
- [ ] **Auto mode**: Pen/stylus draws; touch scrolls (Samsung Notes behavior)
- [ ] **Pen Only mode**: Only stylus input draws; touch always scrolls
- [ ] **Touch Draw mode**: Touch and pen both draw; 2-finger scrolls
- [ ] Palm rejection: Large touch areas ignored during pen drawing
- [ ] Stylus detection: Once pen is detected, auto-mode switches to pen-draws/touch-scrolls

**Implementation:**
- Pointer events on each page canvas determine draw vs. scroll
- In Auto/PenOnly mode, `touch-action: auto` on the scroll container (allows native scroll)
- In TouchDraw mode, `touch-action: none` on page canvases (captures touch for drawing), 2-finger gesture scrolls

```typescript
// On each page's pointerdown:
function shouldDraw(e: PointerEvent): boolean {
  if (e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse' && e.button === 0) return true;
  if (e.pointerType === 'touch') {
    if (inputMode === 'touchDraw') return true;
    if (inputMode === 'auto' && !hasStylusDetected) return true;
    return false; // let it scroll
  }
  return false;
}
```

---

### Epic 2: Toolbar & Drawing Tools

#### Story 2.1 — Notebook Toolbar (Desktop)
**As a** desktop user  
**I want** a floating toolbar with pen, highlighter, eraser, colors, and actions  
**So that** I can control my drawing tools efficiently

**Acceptance Criteria:**
- [ ] Floating toolbar at top-center (matches current `CanvasEditor` style)
- [ ] Tool buttons: Pen, Highlighter, Eraser
- [ ] Size presets + fine-tune slider per tool
- [ ] 8 preset colors + custom color picker
- [ ] Undo/Redo buttons (Ctrl+Z / Ctrl+Shift+Z)
- [ ] Page navigation: Jump to page, page indicator
- [ ] Settings dropdown: background, input mode
- [ ] Export button (PDF)
- [ ] Clear page / Delete page options

**UI Design:**
```
┌──────────────────────────────────────────────────────────────┐
│ [✏️ Pen] [🖍️ High] [◻ Erase] │ ●●●● ━━ │ 🎨🎨🎨🎨🎨 │ ↩ ↪ │ ⬇PDF │ ⋮ │
└──────────────────────────────────────────────────────────────┘
```

---

#### Story 2.2 — Notebook Toolbar (Mobile)
**As a** mobile user  
**I want** a minimal fixed toolbar that doesn't block writing space  
**So that** I have maximum area for handwriting

**Acceptance Criteria:**
- [ ] Fixed top toolbar: Tools + Undo/Redo + More (⋮)
- [ ] Expandable options bar below: colors + size slider
- [ ] Bottom sheet for settings (background, input mode, export, clear)
- [ ] Haptic feedback on tool selection (vibrate)
- [ ] Auto-hide options bar when user starts drawing
- [ ] Page indicator badge on toolbar (e.g., "3/5")

---

#### Story 2.3 — Per-Tool Memory
**As a** user  
**I want** each tool to remember its last-used color and size  
**So that** switching tools is instant without reconfiguration

**Acceptance Criteria:**
- [ ] Pen remembers: color + size
- [ ] Highlighter remembers: color + size
- [ ] Eraser remembers: size
- [ ] Settings persist in `localStorage` under `mynotes_notebook_tool_settings`
- [ ] Loading settings on component mount

---

### Epic 3: Page Management

#### Story 3.1 — Page Thumbnails Panel
**As a** user  
**I want** to see thumbnail previews of all pages  
**So that** I can quickly navigate to any page

**Acceptance Criteria:**
- [ ] Desktop: Optional side panel showing page thumbnails (toggle with button)
- [ ] Mobile: Bottom sheet or swipe-up panel with horizontal thumbnail scroll
- [ ] Thumbnails are 120×170px rendered previews
- [ ] Active page highlighted with accent border
- [ ] Click/tap thumbnail scrolls to that page
- [ ] Thumbnails update live as you draw (debounced 500ms)

**UI Layout (Desktop):**
```
┌──────┬─────────────────────────────┐
│ P1 📄│                             │
│ P2 📄│     Main Writing Area       │
│ P3 📄│     (scrollable pages)      │
│ P4 📄│                             │
│ +    │                             │
└──────┴─────────────────────────────┘
```

---

#### Story 3.2 — Page Operations
**As a** user  
**I want** to add, delete, duplicate, and reorder pages  
**So that** I can organize my notebook

**Acceptance Criteria:**
- [ ] **Add page**: Button at bottom of page list; adds after current page
- [ ] **Delete page**: Swipe-to-delete (mobile) or context menu (desktop); confirm dialog
- [ ] **Duplicate page**: Copies all strokes to a new page
- [ ] **Reorder pages**: Drag-and-drop in thumbnail panel
- [ ] **Change page background**: Per-page background picker
- [ ] Minimum 1 page always exists (cannot delete last page)
- [ ] Page index auto-updates after reorder/delete

---

#### Story 3.3 — Page Background Per-Page
**As a** user  
**I want** different pages to have different backgrounds  
**So that** I can use lined pages for writing and blank pages for diagrams

**Acceptance Criteria:**
- [ ] Right-click on page → "Change Background" context menu
- [ ] Long-press on mobile → bottom sheet with background options
- [ ] Options: Blank, Ruled (lined), Grid, Dotted
- [ ] Changing default background applies to NEW pages only (existing unchanged)
- [ ] Visual preview in background picker

---

### Epic 4: PDF Export

#### Story 4.1 — Multi-Page PDF Generation
**As a** user  
**I want** to export my entire notebook as a PDF file  
**So that** I can share or print my handwritten notes

**Acceptance Criteria:**
- [ ] Export generates a PDF with one page per notebook page
- [ ] PDF page size matches notebook page ratio (A4: 210×297mm)
- [ ] Page backgrounds included (optional toggle)
- [ ] Strokes rendered at 2x resolution for print quality
- [ ] File name: `{note-title}.pdf` or user-specified
- [ ] Progress indicator for large notebooks (10+ pages)
- [ ] Mobile: Share sheet integration via Capacitor

**Implementation using jsPDF:**
```typescript
// src/lib/components/NotebookExporter.ts
import { jsPDF } from 'jspdf';

export async function exportNotebookAsPdf(
  notebook: NotebookDocument,
  options: { includeBackground: boolean; quality: 'standard' | 'high' }
): Promise<Blob> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'  // 210 x 297 mm
  });

  const scale = options.quality === 'high' ? 3 : 2;
  
  for (let i = 0; i < notebook.pages.length; i++) {
    if (i > 0) pdf.addPage();
    
    const page = notebook.pages[i];
    const canvas = renderPageToCanvas(page, scale, options.includeBackground);
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
  }

  return pdf.output('blob');
}

function renderPageToCanvas(
  page: NotebookPage, 
  scale: number, 
  includeBackground: boolean
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = page.width * scale;
  canvas.height = page.height * scale;
  const ctx = canvas.getContext('2d')!;
  
  ctx.scale(scale, scale);
  
  // Draw background
  if (includeBackground) {
    drawPageBackground(ctx, page);
  }
  
  // Draw strokes (highlighters first, then pens)
  for (const stroke of page.strokes.filter(s => s.tool === 'highlighter')) {
    drawStroke(ctx, stroke);
  }
  for (const stroke of page.strokes.filter(s => s.tool === 'pen')) {
    drawStroke(ctx, stroke);
  }
  
  return canvas;
}
```

---

#### Story 4.2 — Export Options Dialog
**As a** user  
**I want** to configure export settings before generating the PDF  
**So that** I get the output format I need

**Acceptance Criteria:**
- [ ] Modal/dialog with export options
- [ ] Options:
  - Include page background: Yes/No (default: Yes)
  - Quality: Standard (faster, smaller) / High (print-quality)
  - Page range: All pages / Current page / Custom range (e.g., 1-5)
  - Page color: Use theme page color / Force white background
- [ ] Preview of first page before export
- [ ] File size estimate
- [ ] "Exporting..." progress bar with page counter

---

#### Story 4.3 — Single Page PNG Export (Retain)
**As a** user  
**I want** to export individual pages as PNG images  
**So that** I can share single drawings quickly

**Acceptance Criteria:**
- [ ] Right-click page → "Export as PNG"
- [ ] Same high-res (2x) PNG export as current implementation
- [ ] Share sheet on mobile

---

### Epic 5: Undo/Redo & History

#### Story 5.1 — Global Undo/Redo Across Pages
**As a** user  
**I want** undo/redo to work across all pages  
**So that** I can reverse any recent action regardless of which page it was on

**Acceptance Criteria:**
- [ ] Undo stack records: `{ pageId, action: 'add' | 'erase', strokes: Stroke[] }`
- [ ] Undo reverses the last action on any page (global ordering)
- [ ] Redo re-applies the last undone action
- [ ] Max history: 100 actions
- [ ] Keyboard: Ctrl+Z / Ctrl+Shift+Z
- [ ] Undo auto-scrolls to the affected page

**Implementation:**
```typescript
interface HistoryEntry {
  pageId: string;
  action: 'add' | 'erase' | 'clear';
  strokes: Stroke[];         // strokes added or removed
  timestamp: number;
}

let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];

function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  
  const page = notebook.pages.find(p => p.id === entry.pageId);
  if (!page) return;
  
  if (entry.action === 'add') {
    // Remove the added strokes
    page.strokes = page.strokes.filter(s => !entry.strokes.find(es => es.id === s.id));
  } else if (entry.action === 'erase') {
    // Re-add the erased strokes
    page.strokes = [...page.strokes, ...entry.strokes];
  }
  
  redoStack.push(entry);
  scrollToPage(entry.pageId);
  triggerSave();
}
```

---

### Epic 6: Storage & Persistence

#### Story 6.1 — Notebook Document Storage
**As a** user  
**I want** my notebook to auto-save  
**So that** I never lose my handwritten work

**Acceptance Criteria:**
- [ ] Notebooks stored as `.notebook.json` files via existing `StorageAdapter`
- [ ] Auto-save debounced (500ms after last stroke)
- [ ] Save on page switch, blur, beforeunload
- [ ] File format: serialized `NotebookDocument` JSON
- [ ] Backward compatible: existing canvas notes (.canvas.json?) remain readable
- [ ] Storage path: `{notebook}/{title}.notebook.json`

**File Structure:**
```json
{
  "version": 1,
  "id": "uuid",
  "title": "Meeting Notes 2026-06-23",
  "defaultBackground": "lined",
  "pages": [
    {
      "id": "page-uuid-1",
      "index": 0,
      "background": "lined",
      "strokes": [...],
      "width": 800,
      "height": 1130
    },
    {
      "id": "page-uuid-2",
      "index": 1,
      "background": "grid",
      "strokes": [...],
      "width": 800,
      "height": 1130
    }
  ],
  "createdAt": "2026-06-23T10:00:00Z",
  "updatedAt": "2026-06-23T15:30:00Z"
}
```

---

#### Story 6.2 — Migration from Current Canvas Format
**As a** user with existing canvas notes  
**I want** them automatically converted to the notebook format  
**So that** I don't lose my previous drawings

**Acceptance Criteria:**
- [ ] Detect old `CanvasDocument` format on load
- [ ] Auto-migrate: wrap existing strokes into a single-page notebook
- [ ] Preserve background setting
- [ ] One-time migration with version bump
- [ ] No data loss

---

#### Story 6.3 — Thumbnail Generation for Note List
**As a** user  
**I want** notebook cards in the note list to show a preview  
**So that** I can visually identify my handwritten notes

**Acceptance Criteria:**
- [ ] Generate 200×150 JPEG thumbnail of the first page
- [ ] Update thumbnail on save (debounced)
- [ ] Thumbnail stored in note metadata (base64 data URL)
- [ ] Note list shows thumbnail with "Notebook" badge/icon overlay

---

### Epic 7: Zoom & Navigation

#### Story 7.1 — Pinch-to-Zoom on Pages
**As a** user  
**I want** to zoom into a page for precise writing  
**So that** I can write small details clearly

**Acceptance Criteria:**
- [ ] Pinch-to-zoom on individual pages (not the entire scroll container)
- [ ] Zoom range: 1x – 3x per page
- [ ] Double-tap to toggle between 1x and 2x zoom
- [ ] When zoomed, 1-finger pans within the page
- [ ] Zoom resets when scrolling to another page
- [ ] Desktop: Ctrl+scroll wheel zooms

---

#### Story 7.2 — Page Navigation Shortcuts
**As a** user  
**I want** quick navigation between pages  
**So that** I can jump to any page without excessive scrolling

**Acceptance Criteria:**
- [ ] Page indicator: "Page 3 of 12" in toolbar
- [ ] Click page indicator → jump-to-page input
- [ ] Keyboard: Page Up / Page Down jumps between pages
- [ ] Thumbnail panel click scrolls to page (smooth)
- [ ] "Scroll to top" floating button when scrolled down

---

### Epic 8: Mobile-Specific Features

#### Story 8.1 — Mobile Writing Mode
**As a** mobile user  
**I want** the app to maximize writing space when I'm in a notebook  
**So that** my small screen is fully utilized

**Acceptance Criteria:**
- [ ] Auto-hide header/navigation when notebook is active
- [ ] Minimal floating toolbar (pen/highlighter/eraser + undo/redo)
- [ ] Toolbar auto-hides after 3s of drawing, reappears on tap
- [ ] Full-screen mode button
- [ ] Safe area respect (notch, gesture bars)

---

#### Story 8.2 — Wrist/Palm Rejection (Enhanced)
**As a** tablet user writing with a stylus  
**I want** my palm resting on screen to be ignored  
**So that** I can write naturally without accidental marks

**Acceptance Criteria:**
- [ ] Reject touch points with large contact area (palm)
- [ ] If stylus active, all touch → scroll only
- [ ] Samsung S-Pen / Apple Pencil pressure sensitivity supported
- [ ] Configurable: "Ignore touches when pen is near" toggle

---

#### Story 8.3 — Share & Save to Gallery
**As a** mobile user  
**I want** to share my notebook pages via system share sheet  
**So that** I can send handwritten notes via WhatsApp, email, etc.

**Acceptance Criteria:**
- [ ] Share current page as PNG via Capacitor Share API
- [ ] Share entire notebook as PDF via Capacitor Share API
- [ ] "Save to Gallery" for individual page images
- [ ] Progress toast during export

---

## 4. UI/UX Design Specifications

### 4.1 Desktop Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  ┌─ Floating Toolbar ──────────────────────────────────────────┐   │
│  │ [✏️][🖍️][◻️] │ ●●●● ━━━ │ 🟠🟡🟢🔵🟣 │ ↩↪ │ Pg 2/5 │ ⬇ ⋮ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─Thumbs─┐  ┌──────────────── Scroll Area ──────────────────┐   │
│  │ ┌────┐  │  │                                                │   │
│  │ │ P1 │  │  │  ┌──────────────────────────────────────────┐ │   │
│  │ └────┘  │  │  │            Page 1                         │ │   │
│  │ ┌────┐  │  │  │  ─────────────────────────────            │ │   │
│  │ │ P2 │◄─┼──┼──│  ─────────────────────────────            │ │   │
│  │ └────┘  │  │  │  ───────────────────                      │ │   │
│  │ ┌────┐  │  │  └──────────────────────────────────────────┘ │   │
│  │ │ P3 │  │  │              16px gap                          │   │
│  │ └────┘  │  │  ┌──────────────────────────────────────────┐ │   │
│  │  [+ ]   │  │  │            Page 2 (active)                │ │   │
│  └─────────┘  │  │  ════════════════════════════════         │ │   │
│               │  │  ─── ─── ─── ─── ─── ─── ───             │ │   │
│               │  └──────────────────────────────────────────┘ │   │
│               └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Mobile Layout

```
┌──────────────────────────┐
│ [✏️][🖍️][◻️] │ [↩][↪] │ ⋮ │  ← Fixed top toolbar
├──────────────────────────┤
│ [🟠🟡🟢🔵🟣] ━━━━ 4px  │  ← Expandable options (slide down)
├──────────────────────────┤
│                          │
│  ┌────────────────────┐  │
│  │      Page 1        │  │
│  │  ─────────────     │  │
│  │  ─────────         │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │      Page 2        │  │  ← Scrollable
│  │                    │  │
│  └────────────────────┘  │
│                          │
├──────────────────────────┤
│        Pg 2 of 5         │  ← Subtle page indicator
└──────────────────────────┘
```

### 4.3 Color & Styling Tokens

```css
/* Notebook-specific design tokens */
--notebook-page-gap: 16px;
--notebook-page-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
--notebook-page-border: 1px solid var(--border-color);
--notebook-page-radius: 8px;
--notebook-page-bg-light: #ffffff;
--notebook-page-bg-dark: #1c1c1e;
--notebook-active-glow: 0 0 0 2px var(--accent);
--notebook-toolbar-blur: 12px;
--notebook-line-color-light: #e5e7eb;
--notebook-line-color-dark: #2a2f38;
```

### 4.4 Animations & Transitions

| Action | Animation |
|--------|-----------|
| Page appear (auto-created) | Slide up + fade in (300ms, cubicOut) |
| Page delete | Collapse height + fade out (250ms) |
| Tool switch | Scale bounce on active indicator |
| Options bar expand | Slide down (200ms) |
| Bottom sheet | Fly up from bottom (250ms) |
| Toolbar auto-hide | Fade out (150ms) with translate up 4px |
| Scroll to page | Smooth scroll (native `scrollIntoView`) |

---

## 5. Performance Considerations

### 5.1 Virtualization Strategy

For notebooks with many pages (20+), rendering all canvases simultaneously would be expensive.

**Solution: IntersectionObserver-based virtualization**

```typescript
// Only render full canvas for visible pages
// Off-screen pages show a static thumbnail image

let visiblePages = new Set<string>();

function setupVirtualization() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const pageId = entry.target.getAttribute('data-page-id');
      if (entry.isIntersecting) {
        visiblePages.add(pageId);
      } else {
        visiblePages.delete(pageId);
      }
    }
  }, { rootMargin: '200px' }); // Pre-render 200px ahead
  
  // Observe each page container
}
```

**Off-screen pages render:**
- Static `<img>` with last-known thumbnail
- When scrolled into view → swap to live `<canvas>`
- Transition is instant (no flicker)

### 5.2 Stroke Batching

- Strokes stored as arrays, not individual reactive items
- During active drawing, points accumulate in a plain array (no reactivity overhead)
- Only on `pointerup` do we commit to reactive state + trigger re-render

### 5.3 Memory Management

- Offscreen canvases disposed after generating thumbnails
- Maximum 100 pages per notebook (configurable)
- Large notebooks (50+ pages) show "Consider splitting" suggestion

---

## 6. Integration Points

### 6.1 App State Changes

```typescript
// appState.svelte.ts additions
editorMode = $state<'text' | 'canvas' | 'notebook'>('text');
```

The note list should detect `.notebook.json` files and open them with `NotebookEditor` instead of the text editor.

### 6.2 Note List Display

Notebook notes in the list show:
- Thumbnail of first page (already planned)
- Badge: "📓 5 pages" 
- Different icon from text notes (notebook icon vs document icon)

### 6.3 Google Drive Sync

Notebooks sync as single JSON files via existing `GoogleDriveSync`. The file is small enough (strokes are compact coordinate arrays) for direct sync.

### 6.4 Creating New Notebooks

- "New Note" menu gets a new option: "New Notebook"
- Or: A toggle in the editor header to switch between text/notebook mode
- Long-press "+" on mobile shows notebook option

---

## 7. Migration & Backward Compatibility

### 7.1 Existing Canvas Notes

The current `editorMode: 'canvas'` uses `CanvasEditor.svelte` with a flat `strokes[]` stored in the HTML note's metadata. 

**Migration path:**
1. Keep `CanvasEditor.svelte` working as-is (no breaking changes)
2. New notebooks use `NotebookEditor.svelte` with `.notebook.json` format
3. Optional "Convert to Notebook" action on old canvas notes (wraps strokes in page 1)
4. Eventually deprecate single-page canvas mode

### 7.2 File Format Versioning

```typescript
// Version 1: Initial notebook format
// Future versions add fields with defaults for backward compat
if (doc.version < 2) {
  // migrate v1 → v2
  doc.pages.forEach(p => { p.someNewField = defaultValue; });
  doc.version = 2;
}
```

---

## 8. Testing Strategy

| Layer | Approach |
|-------|----------|
| Unit | `notebookStorage.ts` — serialize/deserialize, migration |
| Component | Individual page renders correctly with strokes |
| Integration | Multi-page scroll, auto-page creation, undo across pages |
| E2E | Draw on page 1 → scroll to page 2 → draw → export PDF |
| Performance | 50-page notebook scrolls at 60fps |
| Mobile | Touch/pen disambiguation on real devices |

---

## 9. Execution Order (Suggested)

| Phase | Stories | Outcome |
|-------|---------|---------|
| **Phase 1** | 1.1, 1.2, 1.3 | Basic multi-page scroll with drawing |
| **Phase 2** | 1.4, 1.5, 2.1, 2.2, 2.3 | Full toolbar, auto-pages, input modes |
| **Phase 3** | 3.1, 3.2, 3.3 | Page management |
| **Phase 4** | 4.1, 4.2, 4.3 | PDF & PNG export |
| **Phase 5** | 5.1, 6.1, 6.2, 6.3 | Undo/redo, storage, thumbnails |
| **Phase 6** | 7.1, 7.2 | Zoom & navigation |
| **Phase 7** | 8.1, 8.2, 8.3 | Mobile polish |

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Pages rendered at 60fps | ≤ 50 pages |
| Time to first draw after open | < 200ms |
| PDF export (10 pages) | < 3 seconds |
| Stroke latency (pointer → pixel) | < 16ms |
| Storage per page (avg) | < 50KB JSON |
| Mobile touch-to-draw accuracy | 99%+ (no false triggers) |

---

## 11. Open Questions

1. Should we support **landscape pages** in addition to portrait?
2. Should notebooks support **mixed content** (typed text blocks + handwriting) like Samsung Notes S-Pen-to-text?
3. Should we add a **lasso select** tool for moving/copying strokes between pages?
4. Do we want **real-time collaboration** on notebooks (future)?
5. Should PDF export include a **table of contents** based on page labels?

---

## 12. Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `perfect-freehand` | ✅ Installed | Stroke rendering |
| `jsPDF` | ✅ Installed | PDF generation |
| `lucide-svelte` | ✅ Installed | Icons |
| Svelte 5 | ✅ v5.55.5 | Runes, `$state`, `$derived` |
| Capacitor | ✅ Configured | Mobile share/export |
| IntersectionObserver | ✅ Native | Virtualization |
| Pointer Events API | ✅ Native | Drawing input |