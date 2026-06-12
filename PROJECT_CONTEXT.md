# MyNotes - Project Context Reference

## 📋 Project Overview

**MyNotes** is a local-first markdown/HTML notes application built with Svelte 5, TypeScript, and Vite. It features a modern, dark-themed UI inspired by Spotify's design language, supporting multiple color themes, rich text editing via TipTap, and optional Google Drive synchronization.

**Key Characteristics:**
- **Local-First Architecture**: Notes are stored locally (IndexedDB or native File System Access API)
- **Offline Capable**: Service worker enabled PWA with full offline support
- **Rich Text Editing**: Full WYSIWYG editor powered by TipTap with extensive formatting options
- **Cross-Device Sync**: Optional Google Drive integration for cloud backup
- **Responsive Design**: Desktop 3-panel layout and mobile bottom-nav layout

---

## 🛠 Technology Stack

### Core Framework
- **Svelte 5** (`^5.55.5`) - Using new Runes reactivity (`$state`, `$derived`, `$effect`)
- **TypeScript** (`~6.0.2`)
- **Vite** (`^8.0.12`) - Build tool and dev server

### Rich Text Editor
- **TipTap** (`@tiptap/core ^3.19.0`) - Headless editor framework
- **Extensions Used**:
  - `@tiptap/starter-kit` - Basic formatting (bold, italic, lists, etc.)
  - `@tiptap/extension-table` - Tables with cell coloring
  - `@tiptap/extension-task-list` / `task-item` - Checklists
  - `@tiptap/extension-code-block-lowlight` - Syntax-highlighted code blocks
  - `@tiptap/extension-details` - Collapsible sections
  - `@tiptap/extension-image` - Image embeds
  - `@tiptap/extension-link` - Hyperlinks
  - `@tiptap/extension-highlight` - Text highlighting
  - `@tiptap/extension-color` / `text-style` / `font-family` - Text styling
  - `@tiptap/extension-text-align` - Paragraph alignment
  - `@tiptap/extension-placeholder` - Placeholder text
  - `@tiptap/extension-typography` - Smart typography
  - `@tiptap/extension-underline` / `subscript` / `superscript` - Extended formatting

### Additional Libraries
- **lowlight** (`^3.3.0`) - Syntax highlighting engine
- **KaTeX** (`^0.16.28`) - LaTeX math rendering
- **Mermaid** (`^11.14.0`) - Diagram rendering (on-demand)
- **Markmap** (`markmap-lib`, `markmap-view ^0.18.12`) - Mind map visualization
- **MiniSearch** (`^7.2.0`) - Client-side full-text search
- **markdown-it** (`^14.1.0`) - Markdown parsing
- **lucide-svelte** (`^1.0.1`) - Icon library
- **JSZip** (`^3.10.1`) - File compression

---

## 📁 Project Structure

```
myNotes/
├── src/
│   ├── main.ts              # App entry point
│   ├── App.svelte           # Root component with welcome/init flow
│   ├── app.css              # Global styles + 30+ color themes
│   ├── app.d.ts             # TypeScript declarations
│   ├── lib/
│   │   ├── components/
│   │   │   ├── AppLayout.svelte    # Main layout (desktop/mobile)
│   │   │   ├── Editor.svelte       # TipTap rich text editor (~11K lines)
│   │   │   ├── Sidebar.svelte      # Left navigation panel
│   │   │   ├── NoteList.svelte     # Middle notes list panel
│   │   │   ├── GraphView.svelte    # Note graph visualization
│   │   │   ├── ResizeHandle.svelte # Draggable panel resizers
│   │   │   └── GoogleLogo.svelte   # Brand logo component
│   │   ├── stores/
│   │   │   └── appState.svelte.ts  # Central state management (1250+ lines)
│   │   ├── storage/
│   │   │   └── StorageAdapter.ts   # Storage abstraction layer
│   │   ├── sync/
│   │   │   └── GoogleDriveSync.ts  # Google Drive API integration
│   │   └── utils/
│   │       └── debounce.ts         # Utility functions
│   └── assets/               # Static assets (images)
├── public/
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker
│   ├── icons.svg             # Icon sprite
│   └── favicon.svg
├── index.html                # HTML entry
├── vite.config.ts            # Vite configuration
├── svelte.config.js          # Svelte configuration
├── tsconfig.json             # TypeScript config
└── package.json              # Dependencies
```

---

## 🏗 Architecture

### State Management (`appState.svelte.ts`)

The application uses a singleton `AppState` class with Svelte 5 runes for reactivity:

```typescript
class AppState {
  // Core State (reactive with $state)
  vaultName = $state<string | null>(null);
  vaultReady = $state<boolean>(false);
  notes = $state<NoteFile[]>([]);
  activeNotePath = $state<string | null>(null);
  activeNoteContent = $state<string>('');
  activeNotebook = $state<string | null>(null);
  searchQuery = $state<string>('');
  editorDirty = $state<boolean>(false);
  
  // UI State
  theme = $state<string>('steel');
  sidebarWidth = $state<number>(260);
  sidebarCollapsed = $state<boolean>(false);
  notelistWidth = $state<number>(340);
  notelistCollapsed = $state<boolean>(false);
  editorCollapsed = $state<boolean>(false);
  showSettings = $state<boolean>(false);
  
  // Google Drive State
  googleConnected = $state<boolean>(false);
  syncStatus = $state<'idle' | 'syncing' | 'error'>('idle');
  syncEnabled = $state<boolean>(false);
  
  // Non-reactive
  storage: StorageAdapter;
  syncService: GoogleDriveSync;
  private searchIndex: MiniSearch;
}

export const appState = new AppState();
```

### Storage Layer (`StorageAdapter.ts`)

Two storage implementations with a common interface:

```typescript
interface StorageAdapter {
  selectDirectory(): Promise<string>;
  listNotes(): Promise<NoteFile[]>;
  writeNote(path: string, content: string): Promise<void>;
  deleteNote(path: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  readBlob?(path: string): Promise<Blob>;
  writeBlob?(path: string, blob: Blob): Promise<void>;
  migrateNotes?(convertFn: (md: string) => string): Promise<void>;
}
```

**Implementations:**
1. **IndexedDBAdapter** - Browser sandbox mode (default, always available)
2. **FileSystemAccessAdapter** - Native file system access (Chrome/Edge feature)

### Note Format

Notes are stored as HTML files with metadata in `<meta>` tags:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="id" content="path/to/note.html">
<meta name="title" content="Note Title">
<meta name="tags" content="tag1,tag2">
<meta name="pinned" content="false">
<meta name="created" content="2024-01-01T00:00:00.000Z">
<meta name="modified" content="2024-01-01T00:00:00.000Z">
<title>Note Title</title>
</head>
<body>
<h1>Note Title</h1>
<p>Content goes here...</p>
</body>
</html>
```

---

## 🎨 Theming System

30+ built-in themes defined in `app.css` using CSS custom properties:

```css
:root, :root.theme-steel {
  --bg-base: #111317;
  --bg-surface: #181b20;
  --bg-mid-dark: #22262d;
  --bg-card-hover: #2d333b;
  --accent: #00adb5;
  --accent-hover: #33bbc5;
  --text-primary: #ffffff;
  --text-secondary: #b3b3b3;
  --text-tertiary: #7c7c7c;
  --border-color: #252930;
  /* ... more tokens */
}

:root.theme-dracula {
  --bg-base: #1e1f29;
  --accent: #ff79c6;
  /* Override tokens */
}
```

**Theme Categories:**
- Dark themes: steel, nordic, dracula, sepia, emerald, black, dark, cyberpunk, etc.
- Light themes: paper, sakura, mint, lavender, matcha, barbie, etc.
- Multicolor/gradient themes: prism, synthwave, aurora, vaporwave, etc.

---

## ☁️ Google Drive Sync

### OAuth Flow
1. User provides their Google Cloud OAuth Client ID
2. Uses Google Identity Services (GIS) for token-based auth
3. Scope: `https://www.googleapis.com/auth/drive.file` (app-created files only)

### Sync Logic (`syncNotes()`)
- **Bidirectional sync** with timestamp-based conflict resolution
- Creates a "MyNotes" folder on Drive (or uses custom folder)
- Preserves folder hierarchy via recursive subfolder creation
- Debounced auto-sync (5 seconds after save)
- Tracks local-to-remote mapping in localStorage

### API Operations
- `getOrCreateSyncFolder()` - Find or create the sync root
- `listFiles(folderId)` - List all HTML/MD files recursively
- `uploadFile(filename, content, fileId?, parentFolderId?)` - Create/update file
- `downloadFile(fileId)` - Get file content
- `deleteFile(fileId)` - Remove from Drive

---

## 📱 Responsive Layouts

### Desktop (≥768px)
Three-panel layout with resizable sections:
```
┌─────────────┬────────────────┬─────────────────────────────────┐
│   Sidebar   │   Note List    │         Editor Panel            │
│  (260px)    │   (340px)      │         (flex-grow)             │
│  Resizable  │   Resizable    │                                 │
└─────────────┴────────────────┴─────────────────────────────────┘
```

Panels can be collapsed individually via X buttons.

### Mobile (<768px)
Bottom tab navigation with full-screen views:
```
┌─────────────────────────────────────────┐
│            Content Area                  │
│    (Home / Search / Library / Daily)     │
├─────────────────────────────────────────┤
│   Home  │  Search  │  Library  │ Daily  │ ← Tab bar
└─────────────────────────────────────────┘
```

Editor opens as full-screen overlay when note is selected.

---

## ✏️ Editor Features

### Toolbar Options
- **Headings**: H1-H6 + paragraph
- **Text Formatting**: Bold, Italic, Underline, Strikethrough, Code, Subscript, Superscript
- **Colors**: Text color, Highlight/background color
- **Alignment**: Left, Center, Right, Justify
- **Lists**: Bullet, Numbered, Task/Checklist
- **Inserts**: Table, Blockquote, Code Block, Horizontal Rule, Image, Link, Math (LaTeX)
- **Font**: Font family, Font size

### Slash Commands (`/` menu)
Type `/` to open command palette with options:
- `/table`, `/checklist`, `/bullet`, `/numbered`
- `/quote`, `/code`, `/callout`, `/details`
- `/hr`, `/pagebreak`, `/math`, `/mathinline`
- `/h1`, `/h2`, `/h3`, `/text`
- `/date`, `/time`, `/datetime`, `/color`

### Special Features
- **Math Rendering**: LaTeX via KaTeX (inline and block)
- **Mermaid Diagrams**: `mermaid` code blocks rendered as SVG
- **PDF Embeds**: Local PDF files can be embedded
- **Focus Mode**: Highlights active block (toggleable)
- **Typewriter Scroll**: Keeps cursor centered (toggleable)
- **Auto-close Pairs**: Brackets, quotes auto-complete
- **Selection Wrapping**: Wrap selected text in marks

---

## 🔧 Key Svelte Patterns Used

### Svelte 5 Runes
```typescript
// Reactive state
let count = $state(0);

// Derived values
let doubled = $derived(count * 2);

// Complex derived
let filtered = $derived.by(() => {
  return items.filter(item => item.active);
});

// Effects (replaces onMount + reactive statements)
$effect(() => {
  console.log('Count changed:', count);
  return () => cleanup(); // Cleanup function
});
```

### Component Communication
- **Props**: Standard Svelte props for parent→child
- **Stores**: Shared `appState` singleton for global state
- **Events**: Click handlers with `onclick={}`

---

## 🧪 Development

### Commands
```bash
npm run dev      # Start dev server (port 5173)
npm run build    # Production build
npm run preview  # Preview production build
npm run check    # TypeScript + Svelte type checking
```

### Environment
- Node.js 18+
- Modern browser with IndexedDB support
- Optional: Chrome/Edge for File System Access API

---

## 📦 Build Output

Vite builds to `./dist/` with:
- Hashed JS/CSS bundles
- Service worker for offline caching
- PWA manifest for installability
- Relative base URL (`./`) for portable deployment

---

## 🔒 Security Notes

1. **Google OAuth**: Tokens stored in localStorage (short-lived)
2. **Drive Scope**: `drive.file` limits access to app-created files only
3. **XSS Protection**: Editor sanitizes HTML input via TipTap/ProseMirror
4. **Local Data**: Never leaves device unless sync is enabled

---

## 🚀 Key Files to Edit

| Feature | File(s) |
|---------|---------|
| Add new theme | `src/app.css` |
| Modify editor toolbar | `src/lib/components/Editor.svelte` |
| Change note storage | `src/lib/storage/StorageAdapter.ts` |
| Update sync logic | `src/lib/sync/GoogleDriveSync.ts`, `appState.svelte.ts` |
| App state/data model | `src/lib/stores/appState.svelte.ts` |
| Layout/navigation | `src/lib/components/AppLayout.svelte` |
| Sidebar features | `src/lib/components/Sidebar.svelte` |
| Note list features | `src/lib/components/NoteList.svelte` |
| Global styles | `src/app.css` |
| PWA config | `public/manifest.json`, `public/sw.js` |

---

## 📝 Common Operations

### Creating a New Note
```typescript
await appState.createNote('My Title', 'Notebook Folder');
```

### Saving Current Note
```typescript
await appState.saveActiveNote(immediateSync = false);
```

### Manual Sync to Drive
```typescript
await appState.syncNotes();
```

### Changing Theme
```typescript
appState.setTheme('dracula');
```

### Adding to Favorites
```typescript
appState.toggleFavorite(notePath);
```

---

*Generated: June 2026*

