# Yjs CRDT Sync — Migration Epic

> **Goal:** Eliminate data loss when the *same note* is edited on two devices while
> offline. Replace the current file-blob "last-write-wins + manual conflict resolver"
> Google Drive sync for **text notes** with a Yjs CRDT model that auto-merges
> character-level edits. Keep Google Drive as the transport (no sync server).
>
> **This document is self-contained.** An engineer with **no prior context** on this
> repo should be able to implement the whole thing by following it top-to-bottom.
> Read the "Codebase Map" and "Key Invariants" sections before writing any code.

---

## 0. TL;DR of the approach

- Each **text note** becomes a Yjs document (`Y.Doc`) instead of an HTML string being
  the source of truth.
- Tiptap (which this app already uses) binds directly to the `Y.Doc` via the official
  `@tiptap/extension-collaboration` + `y-prosemirror`. This is the *easy* part.
- The `Y.Doc` is persisted **two** ways:
  1. **Locally** via `y-indexeddb` (offline-safe, instant).
  2. **Remotely** as a **binary Yjs update blob** stored as a file on Google Drive.
- Sync becomes **merge, not overwrite**: download the remote update → `Y.applyUpdate`
  → upload the merged state. Two offline edits to the same note converge with **zero
  data loss and no user prompt**.
- **HTML remains a derived artifact.** On every save we still serialize `Y.Doc → HTML`
  and keep writing the `.html` file, so search indexing, tags, calc-tags, budget,
  thumbnails, export (PDF/Excel), and the file browser keep working **unchanged**.
- **Derived indexes come for free:** because tags/calc-tags/budget/search are rebuilt
  from note HTML in `refreshNotes()`, a correctly-merged note automatically yields
  correct indexes. **No per-index merge logic is needed.**

### Explicitly OUT OF SCOPE (per product owner)
- **Tldraw / canvas / `.notebook.json` handwriting notes** — being replaced with
  Excalidraw later. Leave these on the **existing file-blob sync path**. Do NOT
  Yjs-ify them.
- **Focus (swipe planner)** — being removed later. Do not touch `FocusCardStore`.
- **Real-time collaboration / multiple live cursors** — not a goal. We only need
  *eventual* convergence between a user's own devices. No awareness/presence, no
  websocket server.

---

## 1. Why (problem statement)

Current sync (`src/lib/sync/GoogleDriveSync.ts` + `syncNotes()` in
`src/lib/stores/appState.svelte.ts`) is already very defensive: it compares content,
saves `.conflicts/` backups, and pops a manual conflict resolver
(`ConflictResolver.svelte`). But it fundamentally **cannot merge two concurrent edits
to the same note** — the user must choose *local*, *remote*, or *both* (both = two
separate files). One side's edits are always sidelined.

Yjs is a CRDT: it represents the document as a mergeable structure so concurrent
edits from different devices **combine automatically** and deterministically.

---

## 2. Codebase Map (read this before coding)

All paths are relative to repo root.

### 2.1 Editor
- **`src/lib/components/Editor.svelte`** (~7k lines) — the Tiptap editor. Critical spots:
  - **Editor construction:** `new Editor({ ... extensions: [...] })` around **line 6703**.
    The `extensions` array (lines ~6706–6811) includes `StarterKit.configure({ codeBlock: false })`
    plus many custom nodes/marks: `Metrics`, `NumbatBlockExt`, `MathBlock`, `MathInline`,
    `Diagram`, `Callout`, `PageBreak`, `WikiLink`, `TaskList/TaskItem`, `Table*`, etc.
  - **`onUpdate` callback** (~line 6983): sets `$editorDirty = true` and calls `autoSave()`.
  - **`loadNote(path, content)`** (~line 5701): parses HTML/markdown and calls
    `editor.commands.setContent(html)` to load a note into the editor.
  - **Save functions** all build HTML via `generateHtmlNote(meta, bodyHtml)` then call
    `saveNote(...)` (a bridge into `appState`):
    - `autoSave` (debounced) ~line 5500
    - `forceSave` ~line 5524
    - `flushSave` (synchronous, on note switch) ~line 5686
    - `handleCanvasSave` ~line 490 / `handleNotebookSave` ~line 505 (**canvas — leave alone**)
  - **`clearEditorHistory()`** ~line 5655: recreates ProseMirror `EditorState` to clear
    undo/redo between notes. **Important:** Collaboration replaces ProseMirror history,
    so this needs adjustment (see §6.3).
  - **Undo/redo** currently comes from StarterKit's `history` extension.

### 2.2 App state / orchestration
- **`src/lib/stores/appState.svelte.ts`** (~2.5k+ lines):
  - `class AppState` holds all reactive state (Svelte 5 runes `$state`).
  - **`saveActiveNote(immediateSync)`** ~line 2355: writes `activeNoteContent` via
    `this.storage.writeNote(path, content)`, calls `refreshNotes(true)`, then triggers sync.
  - **`refreshNotes(silent)`** ~line 1617: re-lists notes from storage and **rebuilds all
    derived indexes** (tags via `TagDatabase`, calc-tags, budget categories, MiniSearch).
    *This is the function that makes indexes "free" after a merge.*
  - **`syncNotes()`** ~line 1081: the whole Drive sync cycle. Contains the conflict
    detection, first-sync reconciliation, `.conflicts/` backups, and deletion handling
    (lines ~1123–1490). **This is what we replace for text notes.**
  - **`triggerDebouncedSync()`** ~line 1060: 5s debounce wrapper around `syncNotes()`.
  - **`SyncMapping` interface** ~line 11: `{ id, lastSyncRemoteTime, lastSyncLocalTime }`,
    persisted in `localStorage['mynotes_drive_mappings']`.
  - **`parseHtmlMetadata(html)`** ~line 30 and **`generateHtmlNote(meta, body)`** ~line 108:
    the HTML ⇄ metadata boundary. Notes are stored as a full HTML doc with `<meta>` tags
    for id/title/tags/pinned/created/modified/thumbnail, body in `<body>`.
  - **`notesBodyEqual(a, b)`**: helper that compares note *bodies* ignoring metadata
    (used to suppress false conflicts). Reuse it.
  - **Pending conflict state** ~line 226 (`pendingConflicts`, `showConflictResolver`,
    `conflictResolveCallback`) + resolve logic ~lines 1420–1490.

### 2.3 Storage
- **`src/lib/storage/StorageAdapter.ts`**: `interface StorageAdapter` with
  `listNotes()`, `writeNote(path, content)`, `deleteNote(path)`, `renameNote()`,
  `readBlob?()`, `writeBlob?()`, etc. Two implementations: `IndexedDBAdapter`
  (sandbox/mobile) and `FileSystemAccessAdapter` (desktop, File System Access API).
  Notes are plain strings keyed by relative `path`.

### 2.4 Sync transport
- **`src/lib/sync/GoogleDriveSync.ts`**: raw Drive v3 REST wrapper. Relevant methods:
  - `getOrCreateSyncFolder()`, `getOrCreateSubfolders(parent, names[])`
  - `listFiles(rootFolderId)` → `DriveFileMeta[] { id, name, modifiedTime, path }`
    (currently filters to `.html`/`.md`/`.notebook.json`)
  - `downloadFile(fileId)` → **returns `res.text()` (string only!)**
  - `uploadFile(filename, content, fileId?, parentFolderId?)` → multipart text upload;
    content-type chosen by extension.
  - `deleteFile(fileId)`
  - **Limitation to fix:** download/upload are **text-only**. Yjs updates are **binary**
    (`Uint8Array`). We must add binary-capable variants (see §6.5).

### 2.5 Existing epics (style reference)
`CALCULATION_BOX_EPIC.md`, `EXCEL_EXPORT_EPIC.md`, etc. Follow the same tone/structure.

---

## 3. Key Invariants (do NOT break these)

1. **The `.html` file on disk/Drive stays the human-readable source of record.** Every
   note must still have a valid `.html` file after every save. The Yjs blob is an
   *additional* sidecar, never a replacement for the readable file.
2. **`refreshNotes()` must keep receiving HTML.** Tags, calc-tags, budget, MiniSearch,
   thumbnails, wiki-links, and the note list all parse HTML. Do not feed them binary.
3. **Canvas/notebook notes (`editorMode === 'canvas'` / path endsWith `.notebook.json`)
   bypass Yjs entirely** and keep the current save/sync path.
4. **Metadata (title/tags/pinned/thumbnail) is NOT stored in the Yjs body.** It stays in
   the HTML `<meta>` tags / app state, exactly as today. Only the note **body** is CRDT.
   (Metadata conflicts are rare and low-stakes; keep the current timestamp handling for
   them.)
5. **Backwards compatibility:** existing users have `.html` notes and `SyncMapping`
   entries but **no `.ydoc` sidecar**. First open of a legacy note must transparently
   seed a `Y.Doc` from its HTML (see §6.7). Never require a manual migration step.
6. **No secrets, no new servers, no telemetry.**

---

## 4. Dependencies to add

```
npm install yjs y-indexeddb y-prosemirror @tiptap/extension-collaboration
```

- `yjs` — the CRDT core (`Y.Doc`, `Y.applyUpdate`, `Y.encodeStateAsUpdate`, etc.).
- `y-indexeddb` — local persistence provider (`IndexeddbPersistence`).
- `y-prosemirror` — binds a `Y.XmlFragment` to a ProseMirror doc (Tiptap uses ProseMirror).
- `@tiptap/extension-collaboration` — Tiptap wrapper around `y-prosemirror`. **Pin to a
  version compatible with the installed `@tiptap/core@^3.19`** (check the Tiptap 3.x line;
  install `@tiptap/extension-collaboration@^3`). Verify peer-deps after install.

> **Bundle note:** Yjs + providers add ~40–60 KB gzipped. Acceptable. If desired,
> lazy-load Collaboration only for text mode (not required for correctness).

---

## 5. Architecture / Data model

### 5.1 Per-note Yjs document
- One `Y.Doc` per note, keyed by the note's **stable id** (the `<meta name="id">` value,
  same id already used by the version-history feature). Call it `noteId`.
- The note body lives in a `Y.XmlFragment` named **`"prosemirror"`** (this is the name
  `y-prosemirror` / Collaboration expects by default — keep the default).
- The `Y.Doc` is created/opened by a new **`NoteDocManager`** (see §6.1).

### 5.2 Persistence layout
For a note at relative path `Work/Plan.html` with `noteId = abc123`:

| Artifact | Where | Format | Purpose |
|---|---|---|---|
| `Work/Plan.html` | storage + Drive | HTML string | Human-readable source, feeds indexes/export (UNCHANGED) |
| Yjs local state | IndexedDB (`y-indexeddb`, db name `ydoc-<noteId>`) | binary | Offline-safe local CRDT state |
| `.ydocs/<noteId>.ydoc` | storage + Drive | binary (Yjs update) | Remote CRDT state for cross-device merge |

- `.ydocs/` is a hidden folder (dot-prefixed) alongside `.conflicts/` and `.trash/`.
  It must be **excluded from the notes list and from the *legacy* HTML sync loop** the
  same way `.conflicts/` and `.trash/` already are (see `note.path.startsWith('.conflicts/')`
  checks in `syncNotes()`).

### 5.3 Sync mapping extension
Extend `SyncMapping` (backwards-compatibly) with an optional field:
```ts
export interface SyncMapping {
  id: string;                 // Drive fileId of the .html file (existing)
  lastSyncRemoteTime: number; // existing
  lastSyncLocalTime: number;  // existing
  ydocDriveId?: string;       // NEW: Drive fileId of the .ydocs/<noteId>.ydoc blob
  ydocStateVector?: string;   // NEW (optional optim.): base64 state vector last synced
}
```
Missing new fields ⇒ treat as legacy note, seed on first sync.

---

## 6. Implementation Phases

> Each phase is independently shippable and testable. Do them in order. After each
> phase, run `npm run check` and `npm run build` and smoke-test manually.

### Phase 1 — Introduce `NoteDocManager` (no behavior change yet)

**New file: `src/lib/sync/NoteDocManager.ts`**

Responsibilities:
- `getDoc(noteId: string): Y.Doc` — return (creating if needed) the singleton `Y.Doc`
  for a note. Cache by `noteId` in a `Map`.
- `getIndexeddbProvider(noteId): IndexeddbPersistence` — attach `y-indexeddb` so local
  edits persist. Await `provider.whenSynced` before first use.
- `getXmlFragment(doc): Y.XmlFragment` — `doc.getXmlFragment('prosemirror')`.
- `exportUpdate(doc): Uint8Array` — `Y.encodeStateAsUpdate(doc)`.
- `exportStateVector(doc): Uint8Array` — `Y.encodeStateVector(doc)`.
- `applyRemoteUpdate(doc, update: Uint8Array)` — `Y.applyUpdate(doc, update, 'remote')`
  (tag the origin `'remote'` so we can distinguish remote-applied changes from local
  typing in observers).
- `seedFromHtml(doc, html, editorSchema)` — **only if the doc is empty**: parse the HTML
  body into a ProseMirror doc using the app's Tiptap schema, then use
  `prosemirrorToYDoc` / `y-prosemirror`'s `prosemirrorToYXmlFragment` (from `y-prosemirror`)
  to fill the fragment. This is the legacy-migration seed (see §6.7). Guard with a check
  that the fragment length is 0 to stay idempotent.
- `destroy(noteId)` — free the doc + provider when a note is closed (optional; can keep
  a small LRU).

Also add helpers `uint8ToBase64` / `base64ToUint8` for storing update blobs where a
string is required.

**Acceptance:** Unit-level: create a doc, type into the fragment via a throwaway editor,
`exportUpdate`, apply to a fresh doc, confirm text matches. No app wiring yet.

---

### Phase 2 — Bind Tiptap to Yjs for text notes

**File: `src/lib/components/Editor.svelte`**

1. Import:
   ```ts
   import Collaboration from '@tiptap/extension-collaboration';
   import { noteDocManager } from '../sync/NoteDocManager';
   ```
2. **Remove StarterKit's history** so it doesn't fight Yjs undo. Change:
   ```ts
   StarterKit.configure({ codeBlock: false })
   ```
   to:
   ```ts
   StarterKit.configure({ codeBlock: false, undoRedo: false })
   ```
   > In Tiptap 3.x the history extension is named `undoRedo` inside StarterKit; verify the
   > exact key in the installed version and disable it. Collaboration provides its own
   > `Collaboration`-based undo (`y-prosemirror` yUndoPlugin). If a dedicated undo/redo is
   > needed, also add `@tiptap/extension-collaboration-caret` is NOT needed (no cursors),
   > but you MAY add Tiptap's `CollaborationHistory`/`yUndo` if toolbar undo/redo buttons
   > are wired — check current undo/redo button handlers and point them at
   > `editor.commands.undo()/redo()` which Collaboration remaps automatically.
3. **Add the Collaboration extension** to the `extensions` array. It needs the note's
   `Y.Doc`. Because the editor is constructed once and notes are swapped via
   `loadNote()`, we must construct the editor **with the active note's doc** and, on note
   switch, **recreate the collaboration binding**. Two options — implement **Option A**:

   **Option A (recommended): recreate the editor on note switch.**
   - Track `currentNoteId`. When the active note changes to a *text* note, if the
     `noteId` changed, **destroy and recreate** the `Editor` instance bound to the new
     `Y.Doc`'s fragment:
     ```ts
     Collaboration.configure({ fragment: noteDocManager.getXmlFragment(doc) })
     ```
     (Tiptap 3.x accepts either `document: Y.Doc` or `fragment: Y.XmlFragment`; prefer
     `fragment`.)
   - Do NOT pass `content:` when Collaboration is active — Yjs owns the content. Passing
     both throws/duplicates. Guard the existing `content: html` so it is only used for
     the non-collab (canvas/source) paths.
   - This is a real change to editor lifecycle. The editor is currently created lazily in
     a function around line 6703 (called when `editorElement` mounts). Wrap creation in a
     `createEditor(doc)` and add teardown (`editor?.destroy()`), then call it on note
     switch. Preserve existing `editorProps`, all extensions, `onUpdate`, `onTransaction`.

   > **Why recreate rather than swap fragments?** `y-prosemirror` binds a plugin to a
   > specific fragment at construction; cleanly swapping mid-life is fragile. Recreating
   > per note is simple and the note-switch cost is negligible.

4. **`loadNote(path, content)` changes for text notes:**
   - Resolve `noteId` from `parseHtmlMetadata(content).meta.id` (generate + persist one if
     missing — reuse whatever id-assignment logic `createNote`/version-history uses).
   - `const doc = noteDocManager.getDoc(noteId)` and await the IndexedDB provider sync.
   - If the fragment is **empty** (brand-new local doc with no persisted state), call
     `noteDocManager.seedFromHtml(doc, body, editor.schema)` to import existing HTML body.
   - Recreate the editor bound to this doc (Option A). Do **not** call
     `editor.commands.setContent(html)` for collab notes.
   - Keep the **source-mode** and **canvas/notebook** branches on the old path
     (they set content directly / are excluded).
5. **`clearEditorHistory()`**: with Collaboration, undo history is managed by the
   yUndoPlugin and is naturally per-doc (a fresh doc per note = fresh history). The manual
   `EditorState.create` hack should be **removed for collab notes** (it would desync the
   binding). Keep it only for non-collab code paths, or delete its call sites in the collab
   path.

**Acceptance:**
- Open a text note, type, close, reopen → content persists (via `y-indexeddb`).
- Undo/redo works.
- All custom nodes still render and edit (calc box, math, mermaid, wiki-links, tables,
  callouts, details, images). This is the **highest-risk validation** — see §7.
- Source mode toggle still works (it reads HTML, not the doc — see §6.4).

---

### Phase 3 — Serialize `Y.Doc → HTML` on save (keep `.html` current)

The editor's save paths already produce HTML via `editor.getHTML()` +
`generateHtmlNote()`. With Collaboration, `editor.getHTML()` still returns the current
rendered HTML — **so the existing `autoSave`/`forceSave`/`flushSave` continue to write a
correct `.html` file with no change.** 

Required additions in the save path (`autoSave`/`forceSave`/`flushSave` in
`Editor.svelte`, and/or centralize in `appState.saveActiveNote`):

1. After writing the `.html`, also **persist the Yjs update blob**:
   ```ts
   const update = noteDocManager.exportUpdate(doc);           // Uint8Array
   await appState.storage.writeBlob?.(`.ydocs/${noteId}.ydoc`, new Blob([update]));
   ```
   - If the active `StorageAdapter` lacks `writeBlob`/`readBlob`, add them (both adapters
     already have an `attachments`/blob concept — `IndexedDBAdapter` has an `attachments`
     store; extend it, and implement FS-access blob read/write). See §6.6.
2. Ensure `.ydocs/` is **never surfaced as a note** and never HTML-synced: add
   `path.startsWith('.ydocs/')` to the same guards used for `.conflicts/`/`.trash/` in
   `refreshNotes()` (note listing) and in the legacy `syncNotes()` per-note loop
   (line ~1126).

**Acceptance:** After editing, both `Work/Plan.html` and `.ydocs/<id>.ydoc` exist and are
updated. `refreshNotes()` shows exactly one note (not the `.ydoc`). Indexes/search still
correct.

---

### Phase 4 — Binary-capable Drive transport

**File: `src/lib/sync/GoogleDriveSync.ts`**

Add methods (do not remove the existing text ones — canvas path still uses them):
1. `async downloadFileBinary(fileId: string): Promise<Uint8Array>`
   - Same as `downloadFile` but `return new Uint8Array(await res.arrayBuffer())`.
2. `async uploadFileBinary(filename, bytes: Uint8Array, fileId?, parentFolderId?):
   Promise<{ id: string; modifiedTime: string }>`
   - Multipart upload with content-type `application/octet-stream`. **Important:** the
     current `uploadFile` builds the multipart body as a **string**, which corrupts
     binary. For binary, build the body as a `Blob`:
     ```ts
     const meta = JSON.stringify(metadata);
     const body = new Blob([
       `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
       meta,
       `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
       bytes,
       `\r\n--${boundary}--`,
     ], { type: `multipart/related; boundary=${boundary}` });
     ```
     Send `body` directly as `fetch` body (do NOT set a string content-type header that
     conflicts; let the Blob type drive it, or set the multipart header explicitly and
     pass the Blob).
   - Verify with a round-trip test (upload random bytes, download, compare) — binary
     multipart is easy to get subtly wrong.
3. Add a `.ydoc` file finder: extend `listFiles`/`listAllFilesAndFolders` filtering, OR
   add `findFileByName(parentFolderId, name)` to locate `.ydocs/<id>.ydoc`. Prefer storing
   the Drive fileId in `SyncMapping.ydocDriveId` so we usually skip a lookup.

**Acceptance:** Unit round-trip of arbitrary `Uint8Array` through
`uploadFileBinary`→`downloadFileBinary` returns identical bytes.

---

### Phase 5 — Merge-based sync for text notes

This is the core payoff. Implement a **new method** `syncNotesYjs()` (or fold into
`syncNotes()` behind a per-note check) in `appState.svelte.ts`.

**Per text note (skip canvas/notebook/`.conflicts`/`.trash`/`.ydocs`):**

1. Resolve `noteId` and its `Y.Doc` (`noteDocManager.getDoc`, await IndexedDB sync).
2. Ensure a `.ydocs/<noteId>.ydoc` exists remotely:
   - Locate via `SyncMapping.ydocDriveId` or by name in the Drive `.ydocs` folder
     (create the `.ydocs` folder via `getOrCreateSubfolders`).
3. **Pull-merge:**
   - `remoteBytes = downloadFileBinary(ydocDriveId)` (if it exists).
   - `noteDocManager.applyRemoteUpdate(doc, remoteBytes)` — merges remote edits into the
     local doc. **This is the no-loss step.** Idempotent and commutative.
4. **Push-merge:**
   - `localUpdate = noteDocManager.exportUpdate(doc)` (full state; or a diff vs. remote
     state vector for efficiency later).
   - `uploadFileBinary('<noteId>.ydoc', localUpdate, ydocDriveId, ydocsFolderId)` and
     store the returned `id`/`modifiedTime` into `SyncMapping.ydocDriveId`.
5. **Re-derive the readable `.html`:** after the merge, the in-memory `Y.Doc` is the truth.
   Produce merged HTML and write it so indexes/export stay correct. Two options:
   - **5a (if the note is currently open in the editor):** `editor.getHTML()` already
     reflects the merged doc (the binding updated live). Save via the normal path.
   - **5b (note not open):** render headlessly. Provide a helper
     `noteDocManager.docToHtml(doc, schema)` that builds a ProseMirror doc from the
     fragment (`yXmlFragmentToProsemirrorDoc` from `y-prosemirror`) and serializes with the
     app's `DOMSerializer` (mirror what `generateHtmlNote` + Tiptap's `getHTML` do). Then
     `generateHtmlNote(meta, body)` and `storage.writeNote(path)`.
   - After writing HTML, call `refreshNotes(true)` **once** at the end of the cycle (not
     per note) to rebuild tags/calc/budget/search.
6. **Metadata (title/tags/pinned/thumbnail):** these live in HTML `<meta>`, not in Yjs.
   Keep the **existing timestamp-based** reconciliation for metadata-only differences, or
   simplest acceptable policy: on merge, take the newer `modified` timestamp's metadata
   block. Document whichever you choose. (Body content is always safely merged regardless.)
7. **New notes / deletions:**
   - **New local text note (no `ydocDriveId`, no remote `.ydoc`):** create the `.ydoc`
     remotely (push), and also upload the `.html` (existing path) so other clients that
     haven't upgraded still see a readable file.
   - **Deletion:** if the `.html` is intentionally deleted (existing logic determines
     this), also delete the `.ydocs/<id>.ydoc` and drop the mapping. Keep the existing
     "save a `.conflicts/` backup before honoring a remote deletion" safety net.

**Retire, for text notes only:** the `deferredConflicts` / `showConflictResolver` /
`pendingConflicts` path becomes unreachable for note **bodies** (they auto-merge). Leave
the ConflictResolver component and code in place but only reachable by the **legacy/canvas**
path (or gate it out for collab notes). Do not delete it in this epic — it's the safety net
during rollout.

**Acceptance (the whole point):**
- Device A (offline) edits paragraph 1; Device B (offline) edits paragraph 2 of the same
  note. Both reconnect and sync. Final note contains **both** edits, no `.conflicts/` copy,
  no prompt. Verify from a third fresh client too.

---

### Phase 6 — Cross-cutting details

#### 6.1 `NoteDocManager` singleton
Export a singleton instance (`export const noteDocManager = new NoteDocManager();`) so
`Editor.svelte` and `appState` share the same doc cache.

#### 6.2 Origin tagging
When applying remote updates use origin `'remote'`; when the editor makes local changes
`y-prosemirror` uses its own origin. This lets you (if needed) avoid feedback loops and
know when to re-serialize HTML. Not strictly required if you always re-serialize on save.

#### 6.3 Undo/redo
- Confirm the toolbar undo/redo buttons and keyboard shortcuts route to
  `editor.commands.undo()/redo()`. With Collaboration these are remapped to the
  yUndoPlugin automatically. Remove/adapt `clearEditorHistory()` for collab notes (§6.2 of
  Phase 2). Undo must not cross note boundaries (guaranteed by per-note `Y.Doc`).

#### 6.4 Source mode (raw markdown/HTML editing)
- Source mode edits a `<textarea>` of HTML/markdown, not the ProseMirror doc. When leaving
  source mode with changes, the current code re-parses into the editor. For collab notes:
  applying source-mode text must go **through the doc** — i.e. set the ProseMirror content
  which propagates into Yjs. Use `editor.commands.setContent(html)` **is not allowed with
  an active collab binding** in the naive way; instead, replace the fragment content via a
  ProseMirror transaction (`editor.commands.setContent` works if it dispatches a normal
  transaction that y-prosemirror observes — verify). Safest: apply the parsed doc as a
  replace-all transaction so Yjs records it as an edit. Test round-trip carefully.

#### 6.5 Binary in Drive
Covered in Phase 4. Never route `.ydoc` bytes through the text `downloadFile`/`uploadFile`.

#### 6.6 StorageAdapter blob support
- `StorageAdapter` already declares optional `readBlob?`/`writeBlob?`. Ensure **both**
  `IndexedDBAdapter` and `FileSystemAccessAdapter` implement them:
  - `IndexedDBAdapter`: it already has an `attachments` object store — store `.ydoc`
    blobs there (keyed by path) or add a dedicated `ydocs` store. Implement
    `writeBlob(path, blob)` / `readBlob(path): Blob`.
  - `FileSystemAccessAdapter`: write/read the file under the vault using the FS Access API
    (`getFileHandle(..., {create:true})`, `createWritable()`, `getFile()`).
- The `.ydocs/` folder must be created on demand.

#### 6.7 Legacy migration (seed-on-first-open)
- Any existing note has an `.html` but no `.ydoc` and no local IndexedDB doc.
- On first open (or first sync) of such a note: create the `Y.Doc`, and if its fragment is
  empty, `seedFromHtml(doc, body, schema)` to import the current body. From then on the
  `.ydoc` exists and is authoritative for the body.
- **Multi-device seeding hazard:** if Device A and Device B *both* seed independently from
  the same legacy HTML, they produce **different Yjs client states** representing the same
  text, and merging them **duplicates the content**. To avoid this:
  - **Rule:** the **first device to sync** creates the canonical `.ydocs/<id>.ydoc` on
    Drive. Any other device, on its first sync of that note, must **download the remote
    `.ydoc` and adopt it as the base** (do NOT seed locally) whenever a remote `.ydoc`
    already exists. Only seed-from-HTML when **no remote `.ydoc` exists**.
  - Implement this check in Phase 5 step 2/3: *if remote `.ydoc` exists → pull it and use
    it as the doc's initial state instead of seeding; if not → seed from local HTML and
    push.*
- This rule is critical. Add a test for it (§7).

#### 6.8 Feature flag / rollout
- Add a boolean setting `mynotes_yjs_sync_enabled` (default OFF initially, flip to ON after
  validation). When OFF, everything uses the legacy path unchanged. When ON, text notes use
  the Yjs path; canvas/notebook always legacy.
- Store in `localStorage` like other settings; surface a toggle in
  `SettingsModal.svelte` under the Sync tab (optional for internal testing).

---

## 7. Testing / Validation checklist

Manual + scripted. **All must pass before flipping the feature flag ON by default.**

**Correctness — the core goal**
- [ ] Concurrent offline edit to different paragraphs of the same note → both survive, no
      prompt, no `.conflicts/` copy.
- [ ] Concurrent offline edit to the **same** paragraph → both survive as a sane merge
      (Yjs interleaves; acceptable), no data loss.
- [ ] Legacy note (pre-existing `.html`, no `.ydoc`) opened on Device A then Device B →
      no content duplication (validates §6.7 adopt-remote rule).
- [ ] New note created offline on two devices with the same title → both reconcile
      without clobbering.
- [ ] Delete note on Device A → removed on Device B; `.ydoc` also cleaned up; backup saved.

**Editor fidelity (highest-risk — custom nodes)** — for each, type/edit, save, reload,
sync round-trip, confirm intact:
- [ ] Calculation/Metrics block (`data-type="metrics"` — big JSON in attrs)
- [ ] Numbat block
- [ ] Math (inline + block, KaTeX)
- [ ] Mermaid code block + rendered diagram
- [ ] Native Diagram node
- [ ] Tables (resizable, header/cell)
- [ ] Task lists (checkbox toggle in read mode)
- [ ] Callouts, Details/accordion, Page break
- [ ] Wiki-links (`[[...]]`) incl. disambiguation
- [ ] Images (base64 + asset paths), PDF embeds, file attachments, audio/video
- [ ] Color swatches, font family/size, highlight
- [ ] Source mode ⇄ rich mode round-trip (§6.4)
- [ ] Undo/redo within a note; history does NOT bleed across notes

**Derived data (should be automatic)**
- [ ] Tags update after merge
- [ ] Calc-tags / budget categories update after merge
- [ ] MiniSearch full-text finds merged content
- [ ] Thumbnails regenerate
- [ ] PDF export, Excel export from calc blocks still work

**Non-regression**
- [ ] Canvas/notebook notes still save & sync via legacy path (untouched)
- [ ] Feature flag OFF → byte-for-byte legacy behavior
- [ ] Mobile (Capacitor) OAuth + sync still works; IndexedDB provider works on Android WebView
- [ ] `npm run check` clean, `npm run build` succeeds, `npm run build:android` succeeds

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Double-seed duplicates content** across devices | §6.7 adopt-remote-first rule + explicit test |
| Binary multipart upload corrupts `.ydoc` | Build body as `Blob` (not string); round-trip test in Phase 4 |
| Collaboration breaks a custom node's schema mapping | Yjs stores ProseMirror nodes generically; validate every custom node (§7). Nodes storing large JSON in a single attr (Metrics) are LWW **inside** the node — acceptable, the surrounding doc still merges |
| Undo history desync from removed `clearEditorHistory` | Per-note `Y.Doc` gives per-note history; route undo/redo to `editor.commands` |
| Bundle size / mobile memory | Lazy-load Collaboration for text mode; LRU-evict idle `Y.Doc`s |
| Users on old app version (no `.ydoc` support) | We still upload readable `.html`; old clients keep working, just without merge |
| `Y.Doc` monotonic growth | Acceptable for note-sized docs; optionally periodically re-encode as a compact state |

---

## 9. Rollback plan
- The feature flag (`mynotes_yjs_sync_enabled`) gates everything. Turning it OFF reverts to
  the legacy blob sync with zero data loss (the `.html` files are always kept current).
- `.ydocs/` blobs are additive; deleting them does not harm the readable notes.

---

## 10. Suggested file-change summary

| File | Change |
|---|---|
| `package.json` | add `yjs`, `y-indexeddb`, `y-prosemirror`, `@tiptap/extension-collaboration` |
| `src/lib/sync/NoteDocManager.ts` | **NEW** — doc cache, providers, seed, export/apply, docToHtml |
| `src/lib/components/Editor.svelte` | disable StarterKit history; add Collaboration; `createEditor(doc)`/teardown; `loadNote` resolves doc + seeds; save paths also write `.ydoc`; source-mode via transaction |
| `src/lib/stores/appState.svelte.ts` | extend `SyncMapping`; new `syncNotesYjs()` merge path; exclude `.ydocs/`; feature flag; keep legacy path for canvas |
| `src/lib/sync/GoogleDriveSync.ts` | add `downloadFileBinary` / `uploadFileBinary` (Blob multipart); `.ydoc` locate/create |
| `src/lib/storage/StorageAdapter.ts` | implement `readBlob`/`writeBlob` in both adapters; `.ydocs/` support |
| `src/lib/components/SettingsModal.svelte` | (optional) sync-tab toggle for the flag |

---

## 11. Glossary
- **CRDT** — Conflict-free Replicated Data Type; data structure whose replicas converge
  deterministically after exchanging updates, regardless of order.
- **`Y.Doc`** — a Yjs document; the container for shared types.
- **`Y.XmlFragment`** — Yjs shared type that mirrors a ProseMirror/Tiptap document tree.
- **Update / state vector** — binary encodings Yjs uses to sync (`encodeStateAsUpdate`,
  `encodeStateVector`, `applyUpdate`).
- **`y-prosemirror`** — glue binding a `Y.XmlFragment` to a ProseMirror EditorView.
- **Provider** — a persistence/transport plugin for a `Y.Doc` (here: `y-indexeddb` local;
  Google Drive acts as a manual remote provider via our sync loop).
