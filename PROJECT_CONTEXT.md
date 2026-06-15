# PROJECT CONTEXT

## Context Metadata

| Field              | Value                          |
| ------------------ | ------------------------------ |
| Project Name       | MyNotes                        |
| Context Version    | 2.0.0                          |
| Last Updated       | 2026-06-15                     |
| Repository Version | 0.0.0                          |
| Framework          | Svelte 5 + TypeScript          |
| Build Tool         | Vite 8.0.12                    |

---

# Executive Summary

## What This Application Does

**MyNotes** is a local-first, privacy-focused notes application that enables users to create, organize, and sync rich-text notes across devices. It combines the power of a full WYSIWYG editor with the simplicity of local storage, offering optional Google Drive synchronization for cross-device access.

## Who Uses It

- **Individual note-takers** who value privacy and offline access
- **Knowledge workers** who need rich formatting (tables, code blocks, math, diagrams)
- **Mobile-first users** who want a responsive PWA experience
- **Power users** who want direct file system access to their notes

## Primary Business Goals

1. Provide a beautiful, distraction-free note-taking experience
2. Ensure data ownership (local-first, user controls their data)
3. Support offline-first workflows with optional cloud sync
4. Deliver cross-platform experience via PWA

## Key Workflows

1. **Note Creation**: Create notes in notebooks with rich formatting
2. **Organization**: Organize with folders (notebooks), tags, and favorites
3. **Editing**: Full WYSIWYG editing with slash commands, tables, diagrams
4. **Task Management**: Create task lists with due dates, priorities, reminders
5. **Sync**: Optional bidirectional Google Drive synchronization
6. **Export**: PDF/HTML export capabilities

---

# Architecture Overview

## High-Level Architecture

```mermaid
graph TB
    subgraph "Frontend (Svelte 5 SPA)"
        App[App.svelte]
        AppLayout[AppLayout.svelte]
        Editor[Editor.svelte]
        Sidebar[Sidebar.svelte]
        NoteList[NoteList.svelte]
        TasksView[TasksView.svelte]
    end
    
    subgraph "State Management"
        AppState[appState.svelte.ts]
        MiniSearch[MiniSearch Index]
    end
    
    subgraph "Storage Layer"
        StorageAdapter[StorageAdapter Interface]
        IndexedDB[IndexedDBAdapter]
        FileSystem[FileSystemAccessAdapter]
    end
    
    subgraph "Sync Layer"
        GoogleDriveSync[GoogleDriveSync.ts]
        DriveAPI[Google Drive API v3]
    end
    
    App --> AppLayout
    AppLayout --> Sidebar
    AppLayout --> NoteList
    AppLayout --> Editor
    AppLayout --> TasksView
    
    Editor --> AppState
    Sidebar --> AppState
    NoteList --> AppState
    TasksView --> AppState
    
    AppState --> StorageAdapter
    AppState --> MiniSearch
    AppState --> GoogleDriveSync
    
    StorageAdapter --> IndexedDB
    StorageAdapter --> FileSystem
    GoogleDriveSync --> DriveAPI
```

## Layer Separation

| Layer | Responsibility | Key Files |
|-------|---------------|-----------|
| **View** | UI rendering, user interaction | All `.svelte` components |
| **State** | Reactive state, business logic | `appState.svelte.ts` |
| **Storage** | Data persistence abstraction | `StorageAdapter.ts` |
| **Sync** | Cloud synchronization | `GoogleDriveSync.ts` |
| **Utils** | Helper functions | `diagram.ts`, `taskTypes.ts`, `debounce.ts` |

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Editor
    participant AppState
    participant Storage
    participant GoogleDrive
    
    User->>Editor: Type content
    Editor->>AppState: Update activeNoteContent
    AppState->>AppState: Set editorDirty = true
    
    User->>Editor: Save (Ctrl+S)
    Editor->>AppState: saveActiveNote()
    AppState->>Storage: writeNote(path, content)
    Storage-->>AppState: Success
    AppState->>AppState: triggerDebouncedSync()
    
    Note over AppState: 5 second debounce
    
    AppState->>GoogleDrive: syncNotes()
    GoogleDrive->>GoogleDrive: Compare timestamps
    GoogleDrive->>GoogleDrive: Upload/Download as needed
    GoogleDrive-->>AppState: Sync complete
```

---

# Technology Stack

## Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| Svelte | 5.55.5 | UI framework with Runes reactivity |
| TypeScript | 6.0.2 | Type safety |
| Vite | 8.0.12 | Build tool, dev server, HMR |

## Rich Text Editor (TipTap)

| Extension | Purpose |
|-----------|---------|
| `@tiptap/starter-kit` | Core formatting (bold, italic, lists, etc.) |
| `@tiptap/extension-table` | Table editing with cell colors |
| `@tiptap/extension-task-list` | Interactive checklists |
| `@tiptap/extension-code-block-lowlight` | Syntax-highlighted code |
| `@tiptap/extension-details` | Collapsible sections |
| `@tiptap/extension-image` | Image embeds |
| `@tiptap/extension-link` | Hyperlinks |
| `@tiptap/extension-highlight` | Text highlighting |
| `@tiptap/extension-color` | Text colors |
| `@tiptap/extension-text-align` | Paragraph alignment |
| `@tiptap/extension-typography` | Smart typography |

## Additional Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| KaTeX | 0.16.28 | LaTeX math rendering |
| Mermaid | 11.14.0 | Diagram rendering |
| Markmap | 0.18.12 | Mind map visualization |
| MiniSearch | 7.2.0 | Full-text search |
| lowlight | 3.3.0 | Syntax highlighting |
| lucide-svelte | 1.0.1 | Icon library |
| JSZip | 3.10.1 | File compression |
| jsPDF | 4.2.1 | PDF generation |
| html2canvas | 1.4.1 | HTML to canvas rendering |
| xlsx-js-style | 1.2.0 | Excel export |

## State Management

- **Pattern**: Singleton class with Svelte 5 Runes (`$state`, `$derived`, `$effect`)
- **File**: `appState.svelte.ts` (~1400 lines)
- **Export**: `export const appState = new AppState()`

## Styling

- **Approach**: CSS custom properties (CSS variables)
- **Theme System**: 9+ built-in themes (dark, light, gradient)
- **File**: `app.css` for global styles and themes
- **Component styles**: Scoped `<style>` blocks

## Build System

| Tool | Configuration |
|------|---------------|
| Vite | `vite.config.ts` - base: './' for relative paths |
| TypeScript | `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` |
| Svelte | `svelte.config.js` |

## Testing

- **Current**: No formal test framework implemented
- **Type Checking**: `npm run check` (svelte-check + tsc)

---

# Repository Structure

```
myNotes/
├── src/
│   ├── main.ts                    # App entry point, mounts Svelte app
│   ├── App.svelte                 # Root component, welcome flow
│   ├── app.css                    # Global styles, theme definitions
│   ├── app.d.ts                   # TypeScript declarations
│   ├── assets/                    # Static images (hero.png, logos)
│   └── lib/
│       ├── components/
│       │   ├── AppLayout.svelte   # Main layout (desktop 3-panel, mobile tabs)
│       │   ├── Editor.svelte      # TipTap WYSIWYG editor (~12K lines)
│       │   ├── Sidebar.svelte     # Left navigation panel
│       │   ├── NoteList.svelte    # Middle notes list
│       │   ├── TasksView.svelte   # Task management view
│       │   ├── GraphView.svelte   # Note graph visualization
│       │   ├── DiagramEditor.svelte    # Native diagram editor
│       │   ├── DrawIOEditor.svelte     # Draw.io integration
│       │   ├── MermaidEditor.svelte    # Mermaid diagram editor
│       │   ├── ResizeHandle.svelte     # Panel resize handles
│       │   └── GoogleLogo.svelte       # Branding component
│       ├── extensions/
│       │   └── TaskItemExtended.ts     # Custom TipTap task extension
│       ├── stores/
│       │   └── appState.svelte.ts      # Central state management
│       ├── storage/
│       │   └── StorageAdapter.ts       # Storage abstraction layer
│       ├── sync/
│       │   └── GoogleDriveSync.ts      # Google Drive API integration
│       └── utils/
│           ├── debounce.ts             # Debounce utility
│           ├── diagram.ts              # Diagram data model & renderer
│           └── taskTypes.ts            # Task data types & helpers
├── public/
│   ├── manifest.json              # PWA manifest
│   ├── sw.js                      # Service worker (offline support)
│   ├── favicon.svg                # App icon
│   └── icons.svg                  # Icon sprite
├── index.html                     # HTML entry point
├── vite.config.ts                 # Vite configuration
├── svelte.config.js               # Svelte configuration
├── tsconfig.json                  # TypeScript configuration
├── package.json                   # Dependencies
└── PROJECT_CONTEXT.md             # This file
```

## Key Directories

### `/src/lib/components/`
**Purpose**: All Svelte UI components  
**Ownership**: Frontend team  
**Important Files**:
- `Editor.svelte` - The largest component (~12K lines), handles all rich text editing
- `AppLayout.svelte` - Layout orchestration, responsive design
- `DiagramEditor.svelte`, `DrawIOEditor.svelte`, `MermaidEditor.svelte` - Diagram editing options

### `/src/lib/stores/`
**Purpose**: Application state management  
**Ownership**: Core team  
**Important Files**:
- `appState.svelte.ts` - Single source of truth for all app state

### `/src/lib/storage/`
**Purpose**: Data persistence abstraction  
**Ownership**: Core team  
**Important Files**:
- `StorageAdapter.ts` - Interface + two implementations (IndexedDB, File System Access)

### `/src/lib/sync/`
**Purpose**: Cloud synchronization  
**Ownership**: Core team  
**Important Files**:
- `GoogleDriveSync.ts` - Google Drive API integration

### `/src/lib/utils/`
**Purpose**: Reusable utilities  
**Ownership**: Core team  
**Important Files**:
- `diagram.ts` - Diagram data model, shape rendering, SVG generation
- `taskTypes.ts` - Task data types, date helpers, extraction functions

---

# Feature Catalog

## Feature: Rich Text Editor

### Purpose
Provide full WYSIWYG editing experience with extensive formatting options.

### User Flow
1. User selects or creates a note
2. Editor loads with content
3. User formats text using toolbar or slash commands
4. Auto-save on blur/navigation, manual save with Ctrl+S

### Components
- `Editor.svelte` (main)
- TipTap extensions

### Services
- TipTap/ProseMirror

### Dependencies
- `@tiptap/*` packages
- `lowlight` for syntax highlighting
- `katex` for math rendering

### Status
✅ Complete

### Related Features
- Slash Commands, Tables, Diagrams, Task Lists

---

## Feature: Notebook Organization

### Purpose
Organize notes into folder-based notebooks.

### User Flow
1. User creates a notebook (folder)
2. Notes are created within notebooks
3. Sidebar shows notebook hierarchy
4. Filter notes by selecting a notebook

### Components
- `Sidebar.svelte`
- `NoteList.svelte`

### Services
- `appState.createNotebook()`
- `appState.deleteNotebook()`

### Status
✅ Complete

---

## Feature: Task Management

### Purpose
Create interactive task lists with due dates, priorities, and reminders.

### User Flow
1. Create task list with `/checklist`
2. Set due date, priority, reminder via task menu
3. View all tasks in Tasks tab
4. Receive reminder notifications

### Components
- `TasksView.svelte`
- `TaskItemExtended.ts` (TipTap extension)

### Services
- `appState.allTasks`
- `appState.refreshTasks()`
- `appState.startReminderChecker()`

### Dependencies
- `taskTypes.ts` utilities

### Status
✅ Complete

### Related Features
- Rich Text Editor, Notifications

---

## Feature: Diagram Editor

### Purpose
Create and edit diagrams inline in notes.

### User Flow
1. Insert diagram with `/diagram`
2. Choose editor type (Native, Draw.io, Mermaid)
3. Edit in modal
4. Save to embed in note

### Components
- `DiagramEditor.svelte` - Native shape editor
- `DrawIOEditor.svelte` - Embedded diagrams.net
- `MermaidEditor.svelte` - Mermaid code editor

### Services
- `diagram.ts` utilities

### Status
✅ Complete

---

## Feature: Google Drive Sync

### Purpose
Bidirectional synchronization with Google Drive for cross-device access.

### User Flow
1. User enters Google OAuth Client ID
2. User connects and authorizes
3. Notes sync automatically (debounced 5s)
4. Manual sync available
5. Conflict resolution: Last Modified Wins

### Components
- Settings modal in `AppLayout.svelte`

### Services
- `GoogleDriveSync.ts`
- `appState.syncNotes()`
- `appState.connectGoogleDrive()`

### Dependencies
- Google Identity Services SDK
- Google Drive API v3

### Status
✅ Complete

---

## Feature: Full-Text Search

### Purpose
Search across all notes by title and content.

### User Flow
1. Type in search box
2. Results filter instantly
3. Click result to open note

### Components
- Search input in `Sidebar.svelte` / `AppLayout.svelte`

### Services
- MiniSearch index in `appState`
- `appState.searchQuery`
- `appState.filteredNotes`

### Status
✅ Complete

---

## Feature: Theming System

### Purpose
Customizable visual themes for user preference.

### User Flow
1. Open Settings
2. Select theme from grid
3. Theme applies immediately

### Components
- Theme selector in `AppLayout.svelte`

### Services
- `appState.setTheme()`
- CSS custom properties in `app.css`

### Status
✅ Complete (9+ themes)

---

## Feature: PWA / Offline Support

### Purpose
Installable app with full offline functionality.

### User Flow
1. App works offline via service worker
2. Can install to home screen
3. Data persists in IndexedDB

### Components
- `public/sw.js`
- `public/manifest.json`

### Status
✅ Complete

---

# Google Drive Integration

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant MyNotes
    participant GIS as Google Identity Services
    participant DriveAPI as Google Drive API
    
    User->>MyNotes: Enter Client ID
    MyNotes->>MyNotes: Store in localStorage
    
    User->>MyNotes: Click "Connect"
    MyNotes->>GIS: initTokenClient()
    GIS->>User: OAuth popup
    User->>GIS: Grant permission
    GIS-->>MyNotes: access_token
    
    MyNotes->>MyNotes: Store token (localStorage)
    MyNotes->>DriveAPI: Get user email
    DriveAPI-->>MyNotes: Email address
    MyNotes->>MyNotes: Set googleConnected = true
```

## APIs Used

| API | Endpoint | Purpose |
|-----|----------|---------|
| Drive v3 | `/drive/v3/files` | List, create, update, delete files |
| Drive v3 | `/drive/v3/about` | Get user info |
| Drive v3 | `/upload/drive/v3/files` | Upload file content |

## Permissions Required

- **Scope**: `https://www.googleapis.com/auth/drive.file`
- **Access**: Only files created by the app
- **No access to**: User's other Drive files

## Folder Structure on Drive

```
Google Drive/
└── MyNotes/                    # Default sync folder
    ├── Note Title.html
    ├── Notebook Folder/
    │   └── Nested Note.html
    └── Daily Notes/
        └── 2026-06-15.html
```

## Sync Flow

```mermaid
sequenceDiagram
    participant Local as Local Storage
    participant AppState
    participant Drive as Google Drive
    
    Note over AppState: syncNotes() triggered
    
    AppState->>Drive: getOrCreateSyncFolder()
    Drive-->>AppState: folderId
    
    AppState->>Drive: listFiles(folderId)
    Drive-->>AppState: Remote files list
    
    loop For each local note
        AppState->>AppState: Check mapping
        alt No mapping (first sync)
            AppState->>Drive: Download for comparison
            alt Content identical
                AppState->>AppState: Link without transfer
            else Remote newer
                Drive-->>Local: Download
            else Local newer
                Local-->>Drive: Upload
            end
        else Has mapping
            alt Local changed
                Local-->>Drive: Upload
            else Remote changed
                Drive-->>Local: Download
            end
        end
    end
    
    loop For each remote file (not matched)
        alt Previously synced (now deleted locally)
            AppState->>Drive: Delete remote
        else New from another device
            Drive-->>Local: Download
        end
    end
    
    AppState->>AppState: Update mappings
    AppState->>AppState: refreshNotes()
```

## Error Handling

| Error | Handling |
|-------|----------|
| 401 Unauthorized | Clear token, prompt re-auth |
| Network error | Show error toast, retry on next trigger |
| Conflict | Last Modified Wins (with 5-min skew buffer) |

---

# Data Flow Reference

## Note Creation

```mermaid
flowchart LR
    A[User clicks New Note] --> B[createNote]
    B --> C[Generate HTML with metadata]
    C --> D[storage.writeNote]
    D --> E[refreshNotes]
    E --> F[selectNote]
    F --> G{Sync enabled?}
    G -->|Yes| H[syncNotes]
```

## Note Content Format

Notes are stored as complete HTML documents:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="id" content="Notebook/Note Title.html">
<meta name="title" content="Note Title">
<meta name="tags" content="tag1,tag2">
<meta name="pinned" content="false">
<meta name="created" content="2026-06-15T10:30:00.000Z">
<meta name="modified" content="2026-06-15T14:45:00.000Z">
<title>Note Title</title>
</head>
<body>
<h1>Note Title</h1>
<p>Note content here...</p>
</body>
</html>
```

## State Update Propagation

```mermaid
flowchart TB
    subgraph "Component"
        A[User Action]
    end
    
    subgraph "AppState"
        B[Update $state]
        C[Trigger $derived]
        D[Run $effect]
    end
    
    subgraph "Storage"
        E[Persist to storage]
    end
    
    subgraph "UI"
        F[Re-render components]
    end
    
    A --> B
    B --> C
    B --> D
    D --> E
    C --> F
```

---

# UI Component Library

## AppLayout.svelte

### Purpose
Main application layout with responsive desktop/mobile views.

### Inputs
None (uses appState directly)

### Outputs
None

### Key Responsibilities
- Desktop: 3-panel resizable layout
- Mobile: Tab-based navigation with bottom nav
- Settings modal
- Toast notifications

---

## Editor.svelte

### Purpose
Full WYSIWYG rich text editor.

### Inputs
None (uses appState.activeNoteContent)

### Outputs
Updates appState.activeNoteContent, appState.editorDirty

### Key Features
- TipTap integration
- Toolbar with all formatting options
- Slash commands (`/`)
- Math blocks (KaTeX)
- Diagram blocks
- Table editing
- Export functions

---

## Sidebar.svelte

### Purpose
Left navigation panel showing notebooks and favorites.

### Inputs
None (uses appState)

### Outputs
Updates appState.activeNotebook, appState.activeTab

---

## NoteList.svelte

### Purpose
Middle panel showing filtered list of notes.

### Inputs
None (uses appState.filteredNotes)

### Outputs
Calls appState.selectNote()

---

## TasksView.svelte

### Purpose
Dedicated view for task management across all notes.

### Inputs
None (uses appState.allTasks)

### Features
- Group by: overdue, today, upcoming, no date
- Filter by completion status
- Navigate to task's source note

---

## DiagramEditor.svelte

### Purpose
Native shape-based diagram editor.

### Inputs
- `data: string` - Encoded diagram data
- `onSave: (encoded: string) => void`
- `onCancel: () => void`

### Features
- Shapes: rect, ellipse, diamond, line, arrow, text, freehand
- Color picker, stroke width
- Resize, move, delete shapes

---

# Coding Standards

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `NoteList.svelte` |
| Files | camelCase for utils, PascalCase for components | `debounce.ts`, `Editor.svelte` |
| Variables | camelCase | `activeNotePath` |
| Constants | UPPER_SNAKE_CASE | `CACHE_NAME` |
| Interfaces | PascalCase | `NoteFile`, `TaskData` |
| Types | PascalCase | `DiagramShapeType` |

## Component Patterns

### Props Pattern (Svelte 5)
```typescript
interface Props {
  data: string;
  onSave: (value: string) => void;
}
let { data, onSave }: Props = $props();
```

### State Pattern
```typescript
let isOpen = $state(false);
let items = $state<Item[]>([]);
```

### Derived Pattern
```typescript
let filtered = $derived(items.filter(i => i.active));
let computed = $derived.by(() => {
  // Complex computation
  return result;
});
```

### Effect Pattern
```typescript
$effect(() => {
  // Side effect on state change
  return () => {
    // Cleanup
  };
});
```

## File Organization

1. Imports at top
2. Interface definitions
3. Component props
4. State declarations
5. Derived values
6. Effects
7. Functions
8. Template markup
9. Scoped styles

## Error Handling Pattern

```typescript
try {
  await riskyOperation();
  appState.showToast('Success!', 'success');
} catch (e) {
  console.error('Operation failed:', e);
  appState.showToast('Operation failed', 'error');
}
```

---

# Architectural Decisions

## ADR-001: Local-First Architecture

**Decision**: Store all data locally by default, with optional cloud sync.

**Reason**: User data ownership and privacy. App must work offline.

**Alternatives Considered**:
- Cloud-first with local cache
- Server-rendered app

**Impact**: Requires robust offline capability, conflict resolution for sync.

---

## ADR-002: Svelte 5 Runes

**Decision**: Use Svelte 5 Runes (`$state`, `$derived`, `$effect`) for reactivity.

**Reason**: Simpler mental model, better TypeScript integration, future-proof.

**Alternatives Considered**:
- Svelte 4 stores
- External state management (Redux-like)

**Impact**: All state management uses Svelte 5 patterns.

---

## ADR-003: HTML Note Format

**Decision**: Store notes as complete HTML documents with metadata in `<meta>` tags.

**Reason**: Rich formatting preservation, portable, can be opened in browsers.

**Alternatives Considered**:
- Markdown with frontmatter
- JSON with HTML content field

**Impact**: Migration from markdown was implemented.

---

## ADR-004: TipTap Editor

**Decision**: Use TipTap (ProseMirror-based) for rich text editing.

**Reason**: Headless, extensible, excellent Svelte integration.

**Alternatives Considered**:
- Slate.js
- Quill
- CodeMirror (for markdown)

**Impact**: Large Editor.svelte component (~12K lines), but full control.

---

## ADR-005: Google Drive Sync Scope

**Decision**: Use `drive.file` scope (app-created files only).

**Reason**: Minimal permissions, users trust the app more.

**Alternatives Considered**:
- Full drive access
- AppData folder only

**Impact**: Can only sync files created by MyNotes, not import existing Drive files.

---

## ADR-006: Dual Storage Adapters

**Decision**: Support both IndexedDB (sandbox) and File System Access API.

**Reason**: Broad browser support (IndexedDB) plus power-user feature (file system).

**Alternatives Considered**:
- IndexedDB only
- Third-party sync service

**Impact**: StorageAdapter interface abstracts differences.

---

## ADR-007: Diagram Editor Options

**Decision**: Offer three diagram editor types: Native, Draw.io, Mermaid.

**Reason**: Different users have different needs. Native is fast, Draw.io is powerful, Mermaid is code-based.

**Alternatives Considered**:
- Single editor type
- Excalidraw integration

**Impact**: Three separate editor components, user preference stored.

---

# Known Limitations

## Technical Debt

1. **Editor.svelte size**: ~12K lines, should be split into smaller modules
2. **No test coverage**: No unit or integration tests
3. **Limited accessibility**: Some ARIA labels missing
4. **Mobile keyboard**: Virtual keyboard handling could be improved

## Constraints

1. **File System Access API**: Only works in Chrome/Edge
2. **Google Drive scope**: Cannot import existing Drive files
3. **Service Worker**: Caches aggressively, may need manual refresh
4. **Large notes**: Performance degrades with very large notes (>100KB)

## Workarounds

1. **Token expiry**: Tokens stored in localStorage, 1-hour expiry, auto-refresh on action
2. **Sync conflicts**: Last Modified Wins with 5-minute skew buffer

## Performance Concerns

1. **Initial load**: Large bundle size due to TipTap/Mermaid dependencies
2. **Search indexing**: Re-indexes all notes on refresh
3. **Diagram rendering**: Complex diagrams may cause lag

---

# Future Work

## Planned Features

- [ ] **Collaborative editing** - Real-time multi-user editing
- [ ] **End-to-end encryption** - Encrypted notes on Drive
- [ ] **Note templates** - Reusable note structures
- [ ] **Backlinks panel** - Show notes linking to current note
- [ ] **Table of contents** - Auto-generated from headings
- [ ] **Voice notes** - Audio recording and transcription

## Partially Implemented

- **PDF export**: Basic implementation, needs formatting improvements
- **Image handling**: Works, but no cloud image sync
- **Mobile responsiveness**: Functional, could use polish

## Improvement Opportunities

1. **Code splitting**: Lazy load Mermaid, KaTeX
2. **Virtualization**: Virtual scroll for large note lists
3. **Offline indicators**: Better UI for sync status
4. **Keyboard navigation**: Full keyboard-only operation
5. **Undo/Redo**: Global undo across app actions

---

# Agent Instructions

Future agents working on this codebase MUST:

## Before Starting Work

1. **Read this PROJECT_CONTEXT.md first** - Do not scan the entire codebase
2. **Understand the architecture** - Follow established patterns
3. **Check ADRs** - Respect previous decisions

## During Development

4. **Follow coding standards** - Use Svelte 5 Runes, naming conventions
5. **Use appState** - All state changes go through appState
6. **Handle errors** - Use try/catch with toast notifications
7. **Consider both layouts** - Desktop and mobile views

## After Changes

8. **Update PROJECT_CONTEXT.md** if:
   - New features added → Update Feature Catalog
   - Architecture changes → Update diagrams
   - New decisions → Add ADR entry
9. **Run type check** - `npm run check`
10. **Increment Context Version** - Update metadata table

## What NOT to Do

- Do NOT bypass appState for direct storage access
- Do NOT add new global state outside appState
- Do NOT use Svelte 4 store patterns
- Do NOT add dependencies without documenting in Technology Stack

---

# Context Update Log

## Version 1.0.0 (June 2025)
- Initial context creation
- Basic project overview
- Technology stack documentation

## Version 2.0.0 (2026-06-15)
- Complete rewrite following new template structure
- Added comprehensive feature catalog
- Added Google Drive integration documentation with sequence diagrams
- Added architectural decision records (ADRs)
- Added detailed component documentation
- Added coding standards and patterns
- Added known limitations and future work
- Added agent instructions
- Documented task management feature
- Documented diagram editor options (Native, Draw.io, Mermaid)
- Updated technology stack with all dependencies

---

*This document is the authoritative project memory. Keep it updated.*

