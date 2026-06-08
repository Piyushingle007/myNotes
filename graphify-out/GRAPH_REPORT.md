# Graph Report - .  (2026-06-08)

## Corpus Check
- Corpus is ~16,340 words - fits in a single context window. You may not need a graph.

## Summary
- 170 nodes · 230 edges · 21 communities (11 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Storage Adapters|Storage Adapters]]
- [[_COMMUNITY_Frontend Layout Components|Frontend Layout Components]]
- [[_COMMUNITY_Core App State Store|Core App State Store]]
- [[_COMMUNITY_NPM Package Meta|NPM Package Meta]]
- [[_COMMUNITY_Node TSConfig Config|Node TSConfig Config]]
- [[_COMMUNITY_Google Drive Sync Engine|Google Drive Sync Engine]]
- [[_COMMUNITY_App TSConfig Config|App TSConfig Config]]
- [[_COMMUNITY_PWA Web App Manifest|PWA Web App Manifest]]
- [[_COMMUNITY_Graph Visualizer Canvas|Graph Visualizer Canvas]]
- [[_COMMUNITY_Deployment & Setup Entrypoints|Deployment & Setup Entrypoints]]
- [[_COMMUNITY_TSConfig References|TSConfig References]]
- [[_COMMUNITY_PWA SW Registration|PWA SW Registration]]
- [[_COMMUNITY_HMR State & Store|HMR State & Store]]
- [[_COMMUNITY_Service Worker Caching|Service Worker Caching]]
- [[_COMMUNITY_VSCode Extension Configs|VSCode Extension Configs]]
- [[_COMMUNITY_Google Identity Services|Google Identity Services]]
- [[_COMMUNITY_TSConfig JS Options|TSConfig JS Options]]
- [[_COMMUNITY_TSConfig Global Typings|TSConfig Global Typings]]

## God Nodes (most connected - your core abstractions)
1. `AppState` - 21 edges
2. `compilerOptions` - 16 edges
3. `GoogleDriveSync` - 15 edges
4. `FileSystemAccessAdapter` - 13 edges
5. `IndexedDBAdapter` - 11 edges
6. `compilerOptions` - 9 edges
7. `../stores/appState.svelte` - 6 edges
8. `scripts` - 5 edges
9. `StorageAdapter` - 5 edges
10. `getMousePos()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `AppState` --references--> `StorageAdapter`  [EXTRACTED]
  src/lib/stores/appState.svelte.ts → src/lib/storage/StorageAdapter.ts
- `GitHub Pages Deploy Workflow` --conceptually_related_to--> `Svelte + TS + Vite Template`  [INFERRED]
  myNotes/.github/workflows/deploy.yml → myNotes/README.md
- `Deploy Job` --references--> `Main Script Entry Point`  [INFERRED]
  myNotes/.github/workflows/deploy.yml → myNotes/index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Template Configuration Decisions** — mynotes_readme_global_d_ts, mynotes_readme_allowjs, mynotes_readme_hmr_state [EXTRACTED 1.00]
- **PWA Frontend Setup** — mynotes_index_app_mount, mynotes_index_sw_registration, mynotes_index_web_manifest [INFERRED 0.85]

## Communities (21 total, 10 thin omitted)

### Community 0 - "Storage Adapters"
Cohesion: 0.15
Nodes (5): FileSystemAccessAdapter, IndexedDBAdapter, NoteFile, StorageAdapter, SyncMapping

### Community 1 - "Frontend Layout Components"
Cohesion: 0.16
Nodes (10): active, active, active, dependencies, lucide-svelte, marked, minisearch, @types/marked (+2 more)

### Community 3 - "NPM Package Meta"
Cohesion: 0.11
Nodes (17): devDependencies, svelte, svelte-check, @sveltejs/vite-plugin-svelte, @tsconfig/svelte, @types/node, typescript, vite (+9 more)

### Community 4 - "Node TSConfig Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 6 - "App TSConfig Config"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, checkJs, module, moduleDetection, noEmit, target, tsBuildInfoFile (+3 more)

### Community 7 - "PWA Web App Manifest"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 8 - "Graph Visualizer Canvas"
Cohesion: 0.39
Nodes (5): getMousePos(), handleMouseDown(), handleMouseMove(), handleWheel(), toSimCoords()

### Community 9 - "Deployment & Setup Entrypoints"
Cohesion: 0.40
Nodes (5): Svelte Application Mount Point, Main Script Entry Point, Svelte + TS + Vite Template, Deploy Job, GitHub Pages Deploy Workflow

## Knowledge Gaps
- **67 isolated node(s):** `recommendations`, `name`, `private`, `version`, `type` (+62 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppState` connect `Core App State Store` to `Storage Adapters`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `GoogleDriveSync` connect `Google Drive Sync Engine` to `Storage Adapters`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `recommendations`, `name`, `private` to the rest of the system?**
  _70 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `NPM Package Meta` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `Node TSConfig Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._