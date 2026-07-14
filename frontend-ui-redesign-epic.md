# MyNotes — Frontend UI/UX Redesign Initiative

> A large-scale, enterprise-grade UI modernization program covering Desktop, Mobile, and a unifying Design System for the MyNotes local-first notes application (Svelte 5 + TypeScript + Vite + Capacitor).

| Field | Value |
| ----- | ----- |
| Document | `frontend-ui-redesign-epic.md` |
| Version | 1.0.0 |
| Last Updated | 2026-06-21 |
| Status | Proposed |
| Owner | Frontend / Design Systems |
| Target Platforms | Desktop (PWA), Mobile (Capacitor/Android/iOS), Tablet |
| Styling Foundation | CSS Custom Properties (no framework) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals, Principles & Non-Goals](#2-goals-principles--non-goals)
4. [Epic Overview](#4-epic-overview)
5. [Epic 1 — Desktop UI Redesign](#5-epic-1--desktop-ui-redesign)
6. [Epic 2 — Mobile UI Redesign](#6-epic-2--mobile-ui-redesign)
7. [Epic 3 — Design System](#7-epic-3--design-system)
8. [Execution Roadmap](#8-execution-roadmap)
9. [Dependencies Matrix](#9-dependencies-matrix)
10. [Risks & Mitigations](#10-risks--mitigations)
11. [Success Metrics](#11-success-metrics)
12. [Appendix — Story Index](#12-appendix--story-index)

---

## 1. Executive Summary

MyNotes is a privacy-focused, local-first notes application that pairs a full WYSIWYG (TipTap) editor with optional Google Drive sync. The app today ships a feature-rich but organically-grown UI: a Spotify-inspired 3-panel desktop layout, a tab + bottom-navigation mobile layout, 30+ color themes driven by CSS custom properties, and a very large monolithic `Editor.svelte` (~12–14K lines).

While functionally complete, the interface suffers from inconsistency that is typical of fast iteration:

- **No formalized design system.** Tokens exist in `app.css` but are partially applied; many components use hardcoded values, native `prompt()`/`confirm()` dialogs, and ad-hoc spacing.
- **Inconsistent interaction patterns.** Three different diagram editors, multiple popover styles, mixed modal/sheet conventions, and duplicated desktop/mobile markup inside a 4,200-line `AppLayout.svelte`.
- **Accessibility gaps.** Missing ARIA labels, incomplete keyboard navigation, no documented focus management, and unverified color contrast across 30+ themes.
- **Mobile polish debt.** Touch targets, gesture handling, virtual keyboard behavior, and orientation handling are functional but unrefined.

This initiative defines **three coordinated epics** — Desktop Redesign, Mobile Redesign, and a foundational Design System — broken into **measurable, independently shippable user stories**. The strategy is **token-first**: the Design System epic lands first and de-risks both platform epics by giving every screen a shared vocabulary of colors, type, spacing, elevation, and reusable components.

**Critical constraint:** *All existing functionality must be preserved.* This is a presentation-layer and interaction-layer modernization, not a feature rewrite. No note data formats, storage adapters, sync logic, or editor capabilities are to be removed.

---

## 2. Goals, Principles & Non-Goals

### 2.1 Goals
- Establish a single, documented, themeable **Design System** consumed by every component.
- Deliver a **modern, consistent, accessible** desktop experience.
- Deliver a **touch-first, ergonomic** mobile/tablet experience.
- Replace all native `prompt()`/`confirm()`/`alert()` calls with branded components.
- Reach **WCAG 2.1 AA** for core flows.
- Improve perceived performance (skeletons, optimistic UI, virtualization).

### 2.2 Design Principles
1. **Token-first** — no hardcoded colors, spacing, radius, or shadow values in components.
2. **One component, two layouts** — shared logic, responsive presentation; eliminate duplicated desktop/mobile markup.
3. **Content-first** — chrome recedes, the note and editor are the hero.
4. **Progressive disclosure** — advanced tools (diagrams, metrics, sync) reveal on demand.
5. **Accessible by default** — keyboard, screen reader, contrast, and motion preferences are first-class.
6. **Offline-honest** — sync/offline states are always communicated clearly.

### 2.3 Non-Goals
- No backend/server introduction (remains local-first).
- No removal of existing features (editor, diagrams, metrics, themes, sync).
- No change to the on-disk HTML note format or storage adapters.
- No migration away from Svelte 5 Runes or CSS custom properties.

---

## 3. Complete UI Audit

A full inventory of the current frontend, derived from source review. This is the basis for every story below.

### 3.1 Pages / Screens / Views
| Area | Screens |
| ---- | ------- |
| **App entry (`App.svelte`)** | Loading/init screen (pulsing logo + spinner); Welcome screen ("Launch Local Sandbox", "Open Folder on Device") |
| **Desktop (`AppLayout.svelte`)** | 3-panel workspace (Sidebar / NoteList / Editor); Home dashboard; Library (root + notebook sub-view); Tags (root + tag detail); Daily logs |
| **Mobile (`AppLayout.svelte`)** | Full-screen editor overlay; Home tab; Library tab (root + notebook); Tags tab (root + detail); Daily tab; bottom nav + FAB |

### 3.2 Components
| Component | Responsibility |
| --------- | -------------- |
| `App.svelte` | Entry, init/welcome flow, routing into AppLayout |
| `AppLayout.svelte` (~4.2K lines) | Layout orchestration (desktop 3-panel + mobile tabs), settings modal, toasts, move/copy modal |
| `Sidebar.svelte` (~1K lines) | Favorites, Notebooks, Tags, Daily logs, footer actions, sync status, color picker |
| `NoteList.svelte` (~1K lines) | Playlist-style note grid, search, bulk select, action popovers, empty states |
| `Editor.svelte` (~14K lines) | TipTap WYSIWYG: toolbar, slash commands, tables, code, math, images, callouts, exports, focus/typewriter/source modes |
| `MermaidEditor.svelte` | Mermaid code/split/preview, zoom/pan |
| `DiagramEditor.svelte` | Native SVG shape editor (box, circle, line, arrow, text, freehand) |
| `DrawIOEditor.svelte` | Embedded diagrams.net iframe |
| `GraphView.svelte` | Force-directed note graph, WikiLink detection |
| `MetricsBlock.svelte` (~2K lines) | Inline calculation/budget block, auto-sum, calc tags |
| `ResizeHandle.svelte` | Draggable panel resize handle |
| `GoogleLogo.svelte` | Branding logo |
| `Counter.svelte` | Unused demo (removal candidate) |

### 3.3 Navigation Elements
- **Desktop:** collapsible Sidebar (Favorites, Notebooks, Tags, Daily, footer), NoteList header (breadcrumb, count, actions), panel collapse toggles, resize handles.
- **Mobile:** bottom tab bar (Home / Tags / Library / Daily), Floating Action Button (new note), full-screen editor header (Back, breadcrumb, Done, Favorite, Focus/Typewriter, ⋯ menu), slide-up "More Actions" sheet.

### 3.4 Forms & Input Controls
- Search inputs (NoteList, Library, Tags) with debounce.
- Notebook creation (inline autofocus field).
- **Native `prompt()`** for note title and tag rename (replacement target).
- Hex color input with validation (tag/calc color pickers).
- Bulk tag picker (searchable multi-select + "Create & Apply").
- Settings form controls (toggles, selects, theme grid, currency/income fields).

### 3.5 Tables / Data Grids / Lists
- NoteList playlist grid: index, title + folder path, modified time, hover actions, selection checkboxes, staggered entrance animation.
- Mobile note cards (recent notes, folder badge, inline rename/delete).
- MetricsBlock calculation grid (rows, checkboxes, category totals).
- Daily logs list, Tags list, Favorites list.

### 3.6 Dashboards / Metrics
- Home dashboard: 3 stat cards (Notebooks, Files, Lines), Favorites feed, Recent Notes feed, daily prompt CTA.
- MetricsBlock: inline live spreadsheet (Count, Sum, Average, Min, Max, Median, Income, Expenses, Net).

### 3.7 Modals & Dialogs
- Confirmation modal (delete note/notebook/tag/bulk).
- Move/Copy note modal (notebook selector + create-new + move/copy toggle).
- Settings modal (tabbed: Sync / Appearance / Editor & Files / Calculation).
- Bulk tag picker, bulk notebook picker, color picker popovers.
- Diagram editor modals (Native / Draw.io / Mermaid).

### 3.8 Settings
- **Cloud Sync** (Google Drive login, token, folder selection, status).
- **Appearance** (30+ theme grid, preview).
- **Editor & Files** (focus mode, typewriter scroll, source mode, diagram editor type, import).
- **Calculation** (currency, income label, calc tags).

### 3.9 Authentication Flows
- Google Drive OAuth via Google Identity Services popup.
- States: enable sync → OAuth popup → token stored → folder select → status badges (Syncing / Synced / Error / Disabled).
- State fields: `googleConnected`, `googleUserEmail`, `syncStatus`.
- No traditional user accounts (local-first; no profile system).

### 3.10 Error / Empty / Loading States
- **Empty:** library empty (📄), notebook empty (📂), no tagged notes (🏷️).
- **Loading:** init pulsing logo, GraphView spinner, Mermaid render, tag fetch skeleton.
- **Error:** Mermaid syntax error, sync error badge, failed-operation toasts.

### 3.11 Notifications / Toasts
- Toast system in `appState`: `{ id, message, type, title?, loading?, duration? }`; types success/info/error/warning; auto-dismiss; loading/persistent variants.

### 3.12 Search & Filters
- MiniSearch full-text (title + content), real-time filtering.
- Filters: by notebook, by tag, by query (AND logic).
- Tag system (`TagSchema.ts`): create/rename/delete/color, bulk tag/untag.
- Calc tags (`CalcTagSchema.ts`) for MetricsBlock categorization.

### 3.13 User Profile / Account
- No profile area. Surfaces: vault/directory name, Google account email (when synced), Drive sync folder name.

### 3.14 Theming
- 30+ themes via `:root.theme-*` CSS custom properties.
- Tokens present: `--bg-base/surface/mid-dark/card-hover`, `--accent/-hover/-active`, `--text-primary/secondary/tertiary`, `--semantic-error/warning/info`, `--border-color/-highlight`, shadows, fonts, radii.
- Gaps: spacing scale not tokenized, elevation ad-hoc, z-index unmanaged, contrast unverified.

### 3.15 Audit Findings Summary (Pain Points)
1. Native `prompt()`/`confirm()` break visual consistency and accessibility.
2. Duplicated desktop/mobile markup in one 4.2K-line file → drift and bugs.
3. Inconsistent popover/modal/sheet patterns.
4. Partial token adoption; hardcoded values remain.
5. No spacing/elevation/z-index/motion tokens.
6. Accessibility: missing ARIA, incomplete keyboard nav, unverified contrast.
7. Three diagram editors with divergent UX.
8. No list virtualization (large vaults degrade).
9. Sync/offline status under-communicated.
10. `Editor.svelte` monolith hampers UI iteration.

---

## 4. Epic Overview

| # | Epic | Theme | Stories | Sizing |
| - | ---- | ----- | ------- | ------ |
| 1 | **Desktop UI Redesign** | Modernize the 3-panel workspace, navigation, forms, tables, modals, and settings for large screens | 24 (`UI-D-001` … `UI-D-024`) | ~3 XL, 8 L, 9 M, 4 S |
| 2 | **Mobile UI Redesign** | Touch-first navigation, gestures, drawers, mobile forms/tables, tablet & orientation, offline | 18 (`UI-M-001` … `UI-M-018`) | ~2 XL, 6 L, 7 M, 3 S |
| 3 | **Design System** | Tokens, typography, color, spacing, elevation, icons, components, a11y standards, breakpoints | 12 (`UI-DS-001` … `UI-DS-012`) | ~2 XL, 4 L, 4 M, 2 S |

**Sequencing rule:** Design System (Epic 3) tokens + component primitives are prerequisites for most Desktop and Mobile stories. See [Roadmap](#8-execution-roadmap).

---

## 5. Epic 1 — Desktop UI Redesign

> **Goal:** A cohesive, accessible, content-first desktop workspace built entirely on Design System tokens and primitives, preserving every existing capability.

---

### UI-D-001 — Global Desktop Layout & Grid Redesign
**Description:** Re-architect the 3-panel workspace (Sidebar / NoteList / Editor) onto a tokenized layout grid with consistent gutters, panel chrome, and a managed z-index/stacking model.
**Current Issues:** Hardcoded widths/paddings; ad-hoc backgrounds; inconsistent panel borders; no formal stacking model; layout logic buried in a 4.2K-line file.
**Proposed Improvements:** CSS grid shell using spacing tokens; standardized panel surface/border/elevation; documented z-index scale; extract layout shell from monolith.
**Acceptance Criteria:**
- All three panels use spacing, surface, border, and elevation tokens (zero hardcoded layout values).
- Panel min/max widths defined via tokens; layout reflows without overlap from 1024px→4K.
- A single documented z-index scale governs panels, popovers, modals, toasts.
- No functional regressions to panel content.
**Dependencies:** UI-DS-001, UI-DS-004, UI-DS-005.
**Estimated Complexity:** XL

---

### UI-D-002 — Desktop Navigation System Redesign
**Description:** Unify navigation affordances (panel toggles, breadcrumbs, section switching) into a consistent, keyboard-navigable model.
**Current Issues:** Mixed toggle styles; breadcrumb only in NoteList header; no global keyboard nav between panels.
**Proposed Improvements:** Standard nav controls from the component library; global breadcrumb pattern; `F6`/arrow keyboard traversal between panels.
**Acceptance Criteria:**
- All nav controls use shared Button/IconButton primitives.
- Keyboard can move focus across panels and activate items without a mouse.
- Active location is always visible via a consistent breadcrumb/active-state pattern.
**Dependencies:** UI-D-001, UI-DS-008, UI-DS-010.
**Estimated Complexity:** L

---

### UI-D-003 — Application Header / Top Bar Redesign
**Description:** Introduce a consistent desktop top bar housing global search, current context, sync status, and quick actions.
**Current Issues:** No unified header; search/sync/actions scattered across sidebar footer and list header.
**Proposed Improvements:** Slim top bar with global search entry, breadcrumb context, sync indicator, and primary actions (New Note, Settings).
**Acceptance Criteria:**
- Global search reachable via header and `Ctrl/Cmd+K`.
- Sync status badge present with accessible label and live updates.
- Header uses tokens and collapses gracefully at narrow desktop widths.
**Dependencies:** UI-D-001, UI-D-008, UI-D-020.
**Estimated Complexity:** M

---

### UI-D-004 — Sidebar Redesign (Favorites / Notebooks / Tags / Daily)
**Description:** Rebuild the sidebar with consistent section headers, collapsible groups, hover/active states, and tokenized density.
**Current Issues:** Hover-revealed actions inconsistent; mixed spacing; color picker popover styling diverges; delete buttons easy to mis-click.
**Proposed Improvements:** Standard list-item primitive with leading icon, label, count badge, and overflow menu; consistent collapse animation; safer destructive actions.
**Acceptance Criteria:**
- All sidebar items use a shared ListItem primitive.
- Section collapse state persists and animates with motion tokens.
- Destructive actions live behind an overflow menu with confirmation.
- Tag color indicators and counts render consistently.
**Dependencies:** UI-D-001, UI-DS-008, UI-DS-010.
**Estimated Complexity:** L

---

### UI-D-005 — NoteList / Data Grid Redesign
**Description:** Modernize the playlist-style note grid: columns, density toggles, sorting, hover actions, and selection.
**Current Issues:** Hardcoded row styling; action buttons appear only on hover (discoverability); no sorting controls; no density options.
**Proposed Improvements:** Tokenized table primitive with sortable columns (Title, Modified, Notebook), density toggle, persistent overflow actions, and accessible selection.
**Acceptance Criteria:**
- Columns sortable with visible sort indicators and keyboard support.
- Row actions reachable by keyboard and screen reader (not hover-only).
- Selection state has visible + ARIA representation; bulk bar uses shared components.
- Empty/loading states use shared primitives (UI-D-017, UI-D-018).
**Dependencies:** UI-D-001, UI-DS-008, UI-D-022.
**Estimated Complexity:** L

---

### UI-D-006 — Home Dashboard Redesign
**Description:** Reimagine the Home dashboard with a clear hierarchy: stats, favorites, recents, and quick actions.
**Current Issues:** Stat cards and feeds use inconsistent card styling; daily prompt CTA visually competes with content.
**Proposed Improvements:** Tokenized card grid; clear section headings; standardized stat cards; consolidated quick-action zone.
**Acceptance Criteria:**
- All dashboard cards use the shared Card primitive and spacing tokens.
- Responsive grid from 1→3+ columns based on available width.
- Each section has a heading and consistent empty state.
**Dependencies:** UI-D-001, UI-DS-008.
**Estimated Complexity:** M

---

### UI-D-007 — Form & Input Controls Redesign
**Description:** Replace all native `prompt()`/`confirm()` and ad-hoc inputs with a consistent, accessible form component set.
**Current Issues:** Native dialogs for note title & tag rename; inconsistent input styling; weak validation feedback.
**Proposed Improvements:** Shared TextField, Select, Toggle, Checkbox, and inline validation; modal-based create/rename flows.
**Acceptance Criteria:**
- Zero `prompt()`/`confirm()`/`alert()` remain in the desktop codebase.
- All inputs use shared form primitives with labels, focus rings, and error text.
- Validation messages are announced to screen readers.
**Dependencies:** UI-DS-008, UI-D-010.
**Estimated Complexity:** L

---

### UI-D-008 — Global Search UX Redesign
**Description:** Elevate full-text search into a fast, keyboard-driven command/search palette.
**Current Issues:** Search inputs duplicated across views; no global entry; results lack preview/context.
**Proposed Improvements:** `Ctrl/Cmd+K` palette with recent items, scoped filters (notebook/tag), highlighted matches, and keyboard result navigation.
**Acceptance Criteria:**
- Palette opens via shortcut and header; fully keyboard operable.
- Results show title, notebook, and matched snippet.
- Scope filters combine with MiniSearch results without regressions.
**Dependencies:** UI-D-003, UI-DS-008.
**Estimated Complexity:** L

---

### UI-D-009 — Filter UX Redesign
**Description:** Standardize notebook/tag/active filters into a visible, removable filter-chip system.
**Current Issues:** Active filters communicated inconsistently; "Clear Filter" buried; tag + notebook + search interplay unclear.
**Proposed Improvements:** Filter chip bar showing active notebook/tag/query with individual remove + "clear all".
**Acceptance Criteria:**
- Active filters always visible as chips with accessible remove buttons.
- Removing a chip updates `filteredNotes` correctly (AND logic preserved).
- Chip bar uses tokens and wraps gracefully.
**Dependencies:** UI-D-005, UI-DS-008.
**Estimated Complexity:** M

---

### UI-D-010 — Modal & Dialog System Redesign
**Description:** Build one modal framework (confirm, form, move/copy, settings) with focus trapping and consistent structure.
**Current Issues:** Multiple modal/popover styles; inconsistent headers/footers; focus management unverified.
**Proposed Improvements:** Composable Modal primitive (header/body/footer), focus trap, ESC/overlay close, scroll lock, and motion tokens.
**Acceptance Criteria:**
- All dialogs use the shared Modal primitive.
- Focus is trapped and returned to the trigger on close.
- ESC and overlay click close (where appropriate); background scroll locked.
- Confirmation, move/copy, and settings all migrated.
**Dependencies:** UI-DS-008, UI-DS-010.
**Estimated Complexity:** L

---

### UI-D-011 — Theme System Refinement & Theme Picker Redesign
**Description:** Refine the 30+ theme system and rebuild the theme picker with live preview and contrast safety.
**Current Issues:** Theme grid is dense; some themes only override a subset of tokens; contrast not verified.
**Proposed Improvements:** Categorized theme picker (Dark/Light/Vivid) with swatch previews; ensure every theme defines the full token set; contrast checks.
**Acceptance Criteria:**
- Every theme defines all required tokens (no inherited gaps).
- Theme picker previews swatches and applies instantly without flicker.
- All themes pass AA contrast for primary text/UI (or are flagged).
**Dependencies:** UI-DS-001, UI-DS-002, UI-DS-003.
**Estimated Complexity:** M

---

### UI-D-012 — Typography System Application (Desktop)
**Description:** Apply the Design System type scale consistently across all desktop surfaces.
**Current Issues:** Many discrete font sizes/weights hardcoded; inconsistent heading hierarchy.
**Proposed Improvements:** Replace hardcoded sizes with type tokens/classes; consistent heading and body ramps.
**Acceptance Criteria:**
- All desktop text uses type tokens (no raw px font sizes outside the editor content area).
- Heading hierarchy consistent across dashboard, lists, settings.
**Dependencies:** UI-DS-002.
**Estimated Complexity:** S

---

### UI-D-013 — Color Palette Standardization (Desktop)
**Description:** Eliminate hardcoded colors in desktop components in favor of semantic color tokens.
**Current Issues:** Hardcoded hex values in components (e.g., status colors, accents).
**Proposed Improvements:** Map every desktop color usage to semantic tokens (`--accent`, `--semantic-*`, `--text-*`, `--bg-*`).
**Acceptance Criteria:**
- Static color audit shows zero non-token color literals in desktop components (excluding theme definitions and user-chosen tag colors).
- Status/semantic colors come from `--semantic-*`.
**Dependencies:** UI-DS-003.
**Estimated Complexity:** S

---

### UI-D-014 — Spacing & Density System Application (Desktop)
**Description:** Apply a spacing scale across all desktop components and offer a comfortable/compact density option.
**Current Issues:** Inconsistent paddings/margins; no density control.
**Proposed Improvements:** Replace ad-hoc spacing with tokens; expose density preference affecting list/grid rows.
**Acceptance Criteria:**
- All desktop spacing uses scale tokens.
- Density toggle changes list/grid row height predictably and persists.
**Dependencies:** UI-DS-004.
**Estimated Complexity:** M

---

### UI-D-015 — Accessibility Improvements (Desktop)
**Description:** Bring core desktop flows to WCAG 2.1 AA: keyboard, ARIA, focus, contrast, motion.
**Current Issues:** Missing ARIA labels; hover-only actions; incomplete keyboard paths; `prefers-reduced-motion` unhandled.
**Proposed Improvements:** Add roles/labels, visible focus rings, full keyboard operability, reduced-motion support, screen-reader live regions for toasts.
**Acceptance Criteria:**
- Core flows (create/open/edit/delete note, search, filter, settings) fully keyboard operable.
- Automated a11y scan (e.g., axe) shows zero critical issues on core screens.
- `prefers-reduced-motion` disables non-essential animation.
- Toasts/sync status announced via ARIA live regions.
**Dependencies:** UI-DS-009, UI-D-007, UI-D-010.
**Estimated Complexity:** L

---

### UI-D-016 — Loading States & Skeletons (Desktop)
**Description:** Replace blank/spinner-only loads with skeletons and optimistic UI.
**Current Issues:** Init shows only a pulsing logo; lists pop in; no skeletons.
**Proposed Improvements:** Skeleton primitives for list/grid/dashboard; optimistic rendering for note open/save.
**Acceptance Criteria:**
- Note list, dashboard, and editor open show skeletons during load.
- Skeletons honor reduced-motion.
**Dependencies:** UI-DS-008.
**Estimated Complexity:** S

---

### UI-D-017 — Empty States Redesign (Desktop)
**Description:** Create consistent, helpful empty states with clear CTAs.
**Current Issues:** Emoji-only empty states; inconsistent messaging.
**Proposed Improvements:** Shared EmptyState primitive (illustration/icon, title, description, primary action).
**Acceptance Criteria:**
- Empty library, empty notebook, no-tag-results, and no-search-results use the shared primitive.
- Each empty state offers a relevant action (e.g., "New Note").
**Dependencies:** UI-DS-008.
**Estimated Complexity:** S

---

### UI-D-018 — Error Handling UI (Desktop)
**Description:** Standardize error presentation (inline, banner, dialog) including sync and editor errors.
**Current Issues:** Errors surface as toasts or raw text (Mermaid); no recovery guidance.
**Proposed Improvements:** Error primitives with severity, message, and recovery actions (retry/reconnect); render Mermaid/diagram errors consistently.
**Acceptance Criteria:**
- Sync, save, and render errors use shared error components with retry where possible.
- Errors are announced to assistive tech.
**Dependencies:** UI-DS-008, UI-D-020.
**Estimated Complexity:** M

---

### UI-D-019 — Notifications & Alerts Redesign (Desktop)
**Description:** Rebuild the toast system with consistent variants, stacking, and accessibility.
**Current Issues:** Toasts vary; loading/persistent variants ad-hoc; not announced.
**Proposed Improvements:** Toast primitive with success/info/warning/error, loading state, action buttons, max-stack, and ARIA live region.
**Acceptance Criteria:**
- All `showToast` calls render through the new component.
- Stacking, auto-dismiss, and persistent loading toasts work consistently.
- Toasts are screen-reader announced and pausable on hover/focus.
**Dependencies:** UI-DS-008, UI-D-015.
**Estimated Complexity:** M

---

### UI-D-020 — Sync Status & Account Surface (Desktop)
**Description:** Design a clear sync/account surface (the closest thing to a "profile") for Google Drive state.
**Current Issues:** Sync status is a small sidebar badge; account email and folder buried in settings.
**Proposed Improvements:** Account/sync popover showing connected email, folder, last-sync time, status, and manual sync/disconnect actions.
**Acceptance Criteria:**
- Connected email, sync folder, last-sync timestamp, and status visible in one surface.
- Manual sync, reconnect, and disconnect available with clear feedback.
- Disconnected/offline states clearly communicated.
**Dependencies:** UI-D-003, UI-D-018.
**Estimated Complexity:** M

---

### UI-D-021 — Settings Experience Redesign (Desktop)
**Description:** Rebuild the tabbed settings modal (Sync / Appearance / Editor & Files / Calculation) with consistent layout and controls.
**Current Issues:** Mixed control styles; long unstructured panels; theme grid dense.
**Proposed Improvements:** Settings shell with left nav, grouped sections, shared form controls, and search-within-settings.
**Acceptance Criteria:**
- All four settings areas migrated to shared form primitives and Modal framework.
- Settings searchable; changes apply instantly with confirmation feedback.
- No settings functionality removed (sync, themes, editor prefs, calc).
**Dependencies:** UI-D-007, UI-D-010, UI-D-011.
**Estimated Complexity:** L

---

### UI-D-022 — Performance-Related UI (Virtualization & Code-Split)
**Description:** Improve perceived and actual performance via list virtualization and lazy-loading heavy UI.
**Current Issues:** No virtualization (large vaults lag); heavy deps (Mermaid/KaTeX/Editor) load eagerly.
**Proposed Improvements:** Virtualized NoteList/Tags/Daily lists; lazy-load diagram/graph/math UI; route-level code splitting where possible.
**Acceptance Criteria:**
- Lists with 5,000+ items scroll smoothly (no measurable main-thread jank in profiling).
- Diagram/graph/math editors load on demand, reducing initial bundle.
- No functional regressions to lists or editors.
**Dependencies:** UI-D-005.
**Estimated Complexity:** L

---

### UI-D-023 — Editor Chrome & Toolbar Redesign (Desktop)
**Description:** Modernize the editor's surrounding chrome (toolbar, status, mode toggles) without altering TipTap behavior.
**Current Issues:** Dense toolbar; mode toggles (focus/typewriter/source) inconsistent; export buried.
**Proposed Improvements:** Grouped, overflow-aware toolbar using IconButton primitives; clear mode indicators; accessible export menu. (Editor content engine unchanged.)
**Acceptance Criteria:**
- Toolbar uses shared primitives and groups (format/insert/view/export).
- Focus, typewriter, and source modes toggle with clear state and keyboard support.
- All existing formatting, insert, math, diagram, and export actions remain functional.
**Dependencies:** UI-D-001, UI-DS-008.
**Estimated Complexity:** XL

---

### UI-D-024 — Authentication / Welcome & Onboarding (Desktop)
**Description:** Redesign the entry/welcome flow and Google Drive OAuth entry for clarity and trust.
**Current Issues:** Black hero with two pill buttons; OAuth entry minimal; no onboarding guidance.
**Proposed Improvements:** Branded welcome with clear storage choice explanation, optional sync intro, and progressive onboarding hints.
**Acceptance Criteria:**
- Welcome screen explains "Local Sandbox" vs "Open Folder" choices.
- OAuth entry communicates scope/permissions and uses branded components.
- Onboarding is dismissible and persists its dismissed state.
**Dependencies:** UI-DS-008, UI-D-020.
**Estimated Complexity:** M

---

## 6. Epic 2 — Mobile UI Redesign

> **Goal:** A touch-first, ergonomic mobile and tablet experience that shares logic with desktop while optimizing for one-handed use, gestures, the virtual keyboard, and offline reliability (Capacitor).

---

### UI-M-001 — Mobile Information Architecture & Navigation Model
**Description:** Define a coherent mobile IA and stack-based navigation across Home/Tags/Library/Daily and the editor overlay.
**Current Issues:** Mobile markup duplicated inside the desktop file; nested stack navigation ad-hoc; back behavior inconsistent.
**Proposed Improvements:** Formal navigation/stack model with predictable back handling (incl. Android hardware back via Capacitor); shared screen primitives.
**Acceptance Criteria:**
- Each tab maintains its own navigation stack with consistent back behavior.
- Android hardware back and gesture back behave predictably and never lose unsaved edits.
- Mobile screens extracted into dedicated components (not duplicated desktop markup).
**Dependencies:** UI-DS-011, UI-D-001.
**Estimated Complexity:** XL

---

### UI-M-002 — Bottom Navigation Redesign
**Description:** Rebuild the bottom tab bar (Home / Tags / Library / Daily) with proper touch targets, active states, and safe-area handling.
**Current Issues:** Spotify-style bar functional but spacing/active states inconsistent; safe-area insets not fully handled.
**Proposed Improvements:** Tokenized bottom nav with ≥48px targets, clear active indicator, badge support, and iOS/Android safe-area insets.
**Acceptance Criteria:**
- All tabs have ≥48×48px touch targets and visible active state.
- Safe-area insets respected on notched devices.
- Bottom nav hides appropriately in full-screen editor.
**Dependencies:** UI-M-001, UI-DS-004, UI-DS-008.
**Estimated Complexity:** M

---

### UI-M-003 — Floating Action Button & Quick Create
**Description:** Refine the FAB and new-note flow for thumb reach and contextual creation.
**Current Issues:** FAB creates note via native `prompt()`; placement not context-aware.
**Proposed Improvements:** Thumb-zone FAB with contextual default (current notebook/day), optional speed-dial (note/daily/diagram), replacing `prompt()`.
**Acceptance Criteria:**
- New-note flow uses a mobile sheet/form (no `prompt()`).
- FAB respects safe areas and the keyboard; never overlaps bottom nav.
- Creation context defaults to the active notebook/tab.
**Dependencies:** UI-M-001, UI-M-004, UI-M-007.
**Estimated Complexity:** M

---

### UI-M-004 — Mobile Dashboard (Home) Redesign
**Description:** Optimize Home for vertical, scannable, single-column consumption.
**Current Issues:** Greeting/stats/favorites/recents stack without strong hierarchy; cards inconsistent.
**Proposed Improvements:** Single-column card stack with sticky greeting, horizontally scrollable favorites, and clear recents list.
**Acceptance Criteria:**
- Home renders as a performant single-column scroll using shared Card primitives.
- Favorites use a horizontal carousel with snap; recents use list primitive.
- Pull-to-refresh re-syncs/refreshes notes.
**Dependencies:** UI-M-001, UI-DS-008.
**Estimated Complexity:** M

---

### UI-M-005 — Mobile Forms & Inputs Redesign
**Description:** Build mobile-optimized inputs with proper keyboard types, focus, and keyboard-avoidance.
**Current Issues:** Native `prompt()` for titles/rename; inputs not optimized for virtual keyboard; content hidden behind keyboard.
**Proposed Improvements:** Mobile form primitives with correct `inputmode`, sticky action bars above keyboard, and viewport-aware scrolling.
**Acceptance Criteria:**
- Zero `prompt()`/`confirm()` on mobile.
- Focused inputs are never obscured by the keyboard (visualViewport handling).
- Submit/cancel actions remain reachable above the keyboard.
**Dependencies:** UI-M-001, UI-DS-008, UI-M-010.
**Estimated Complexity:** L

---

### UI-M-006 — Mobile Data Presentation (Lists & "Tables")
**Description:** Replace desktop grid columns with mobile-appropriate card/list presentations, including MetricsBlock.
**Current Issues:** Grid columns cramped on mobile; MetricsBlock spreadsheet hard to use on small screens.
**Proposed Improvements:** Card-based note rows with swipe actions; responsive MetricsBlock (stacked rows, horizontal scroll where needed) keeping all calculations.
**Acceptance Criteria:**
- Note rows render as cards with title, notebook badge, and modified time.
- MetricsBlock is usable on mobile with all metrics (Count/Sum/Avg/Min/Max/Median/Income/Expenses/Net) intact.
- Tables inside notes scroll horizontally without breaking layout.
**Dependencies:** UI-M-001, UI-M-007, UI-DS-008.
**Estimated Complexity:** L

---

### UI-M-007 — Touch Interaction Standards
**Description:** Establish consistent touch standards: target sizes, tap/long-press, hit slop, and feedback.
**Current Issues:** Long-press is timer-based and inconsistent; tap vs. drag detection ad-hoc; small targets.
**Proposed Improvements:** Documented touch standards (≥44–48px targets, unified long-press/tap detection, ripple/press feedback, hit slop).
**Acceptance Criteria:**
- All interactive elements meet minimum target size.
- Long-press and tap behaviors are consistent app-wide.
- Visible press feedback honors reduced-motion.
**Dependencies:** UI-DS-009.
**Estimated Complexity:** M

---

### UI-M-008 — Gesture Support
**Description:** Add ergonomic gestures: swipe actions on list items, swipe-to-go-back, and pinch/pan in diagram/graph views.
**Current Issues:** Limited gestures; diagram pinch/pan exists but inconsistent; no swipe actions on lists.
**Proposed Improvements:** Swipe-to-favorite/delete on note rows, edge swipe-back, and standardized pinch/pan in diagram/graph editors.
**Acceptance Criteria:**
- List rows support configurable swipe actions with undo.
- Edge swipe-back integrates with the navigation stack (UI-M-001).
- Pinch/pan in diagram and graph views is smooth and consistent.
**Dependencies:** UI-M-001, UI-M-007.
**Estimated Complexity:** L

---

### UI-M-009 — Mobile Search Experience
**Description:** Deliver a full-screen, keyboard-friendly mobile search.
**Current Issues:** Search inputs per-view; results cramped; no recent/scoped search on mobile.
**Proposed Improvements:** Full-screen search overlay with recent searches, scope chips, and large tappable results.
**Acceptance Criteria:**
- Search opens full-screen with autofocus and recent queries.
- Scope chips (notebook/tag) filter results; MiniSearch results preserved.
- Results have large touch targets and matched snippets.
**Dependencies:** UI-M-001, UI-DS-008, UI-D-008.
**Estimated Complexity:** M

---

### UI-M-010 — Mobile Filters & Bottom Sheets
**Description:** Move filters and pickers into ergonomic bottom sheets.
**Current Issues:** Filter/tag/notebook pickers use varied popovers; reachability poor on tall screens.
**Proposed Improvements:** Reusable BottomSheet primitive for filters, tag picker, notebook picker, and color picker; drag-to-dismiss.
**Acceptance Criteria:**
- Filters, tag/notebook pickers, and color pickers use the shared BottomSheet.
- Sheets support drag-to-dismiss and respect safe areas/keyboard.
- Filter results match desktop AND-logic behavior.
**Dependencies:** UI-M-001, UI-DS-008.
**Estimated Complexity:** M

---

### UI-M-011 — Mobile Modals & Drawers
**Description:** Standardize mobile dialogs/drawers (confirm, move/copy, "More Actions") on the sheet framework.
**Current Issues:** "More Actions" sheet bespoke; confirmations vary; move/copy not mobile-optimized.
**Proposed Improvements:** Confirm/action/move-copy flows on the shared BottomSheet/Drawer with consistent structure and motion.
**Acceptance Criteria:**
- Editor "More Actions", confirmations, and move/copy use shared sheet/drawer primitives.
- Focus and back-button handling are correct.
- All actions (favorite, modes, export, move/copy, delete) preserved.
**Dependencies:** UI-M-010, UI-M-001.
**Estimated Complexity:** M

---

### UI-M-012 — Mobile Editor Experience Redesign
**Description:** Refine the full-screen editor overlay: header, toolbar, keyboard toolbar, and mode toggles for touch.
**Current Issues:** Header dense; formatting toolbar not optimized above keyboard; diagram tap/keyboard bugs historically.
**Proposed Improvements:** Clean editor header (Back, breadcrumb, Done, overflow), a keyboard-anchored formatting toolbar, and reliable diagram tap/double-tap handling. TipTap engine unchanged.
**Acceptance Criteria:**
- Formatting toolbar stays anchored above the keyboard and is scrollable.
- Single-tap and double-tap behaviors for diagrams are reliable (no cursor jump / unwanted keyboard).
- All editor capabilities (format/insert/math/diagram/export/modes) function on mobile.
**Dependencies:** UI-M-001, UI-M-005, UI-D-023.
**Estimated Complexity:** XL

---

### UI-M-013 — Mobile Settings Redesign
**Description:** Adapt the settings experience to a full-screen, sectioned mobile layout.
**Current Issues:** Tabbed desktop modal cramped on mobile; theme grid hard to browse on small screens.
**Proposed Improvements:** Full-screen settings with grouped sections, large rows, and a mobile-friendly theme browser.
**Acceptance Criteria:**
- All settings areas (Sync/Appearance/Editor & Files/Calculation) usable full-screen.
- Theme browsing uses large swatches with preview.
- No settings functionality lost.
**Dependencies:** UI-M-001, UI-D-021.
**Estimated Complexity:** M

---

### UI-M-014 — Mobile Authentication / Google Sync Flow
**Description:** Optimize the Drive OAuth and sync setup for mobile/Capacitor.
**Current Issues:** OAuth popup flow not tuned for mobile webview; status feedback minimal.
**Proposed Improvements:** Mobile-appropriate OAuth handoff, clear permission explanation, and prominent sync status/feedback.
**Acceptance Criteria:**
- OAuth completes reliably in the mobile/Capacitor context with clear progress.
- Connected account, folder, and status are clearly visible.
- Errors offer retry/reconnect.
**Dependencies:** UI-M-013, UI-D-020.
**Estimated Complexity:** M

---

### UI-M-015 — Tablet Layouts
**Description:** Introduce adaptive tablet layouts bridging mobile and desktop (e.g., two-pane on landscape tablets).
**Current Issues:** Tablets fall into mobile (<768px) or desktop with no tailored experience.
**Proposed Improvements:** Tablet breakpoints enabling list+editor two-pane in landscape and single-pane in portrait.
**Acceptance Criteria:**
- Landscape tablets show a two-pane (list + editor) layout.
- Portrait tablets show an optimized single-pane layout.
- Breakpoints come from Design System tokens (UI-DS-012).
**Dependencies:** UI-M-001, UI-DS-012.
**Estimated Complexity:** L

---

### UI-M-016 — Orientation & Responsive Handling
**Description:** Ensure graceful behavior across portrait/landscape rotation and dynamic viewports.
**Current Issues:** Rotation can disrupt scroll position/layout; keyboard + rotation edge cases.
**Proposed Improvements:** Preserve scroll/selection across rotation; recompute safe areas and keyboard insets on orientation change.
**Acceptance Criteria:**
- Rotating the device preserves the current note, scroll, and selection.
- Layouts reflow without clipping; safe areas recomputed.
**Dependencies:** UI-M-001, UI-M-015.
**Estimated Complexity:** M

---

### UI-M-017 — Mobile Accessibility
**Description:** Bring mobile flows to accessibility parity (screen readers, target size, contrast, motion).
**Current Issues:** ARIA gaps; some targets small; gestures lack non-gesture alternatives.
**Proposed Improvements:** VoiceOver/TalkBack labels, focus order, non-gesture fallbacks for swipe actions, and reduced-motion support.
**Acceptance Criteria:**
- Core mobile flows operable with VoiceOver/TalkBack.
- Every swipe action has a non-gesture alternative.
- Targets meet minimum size; reduced-motion honored.
**Dependencies:** UI-DS-009, UI-M-007, UI-M-008.
**Estimated Complexity:** L

---

### UI-M-018 — Mobile Performance & Offline Experience
**Description:** Optimize mobile performance and make offline/sync state explicit (PWA + Capacitor).
**Current Issues:** Heavy bundle on mobile; offline state under-communicated; large lists lag.
**Proposed Improvements:** Lazy-load heavy editors, virtualize lists, add offline banner/indicator, and queue/sync feedback.
**Acceptance Criteria:**
- Diagram/graph/math editors load on demand on mobile.
- Lists virtualize for smooth scrolling on mid-range devices.
- A clear offline indicator appears when disconnected; pending sync is communicated.
**Dependencies:** UI-M-001, UI-D-022, UI-D-020.
**Estimated Complexity:** L

---

## 7. Epic 3 — Design System

> **Goal:** The single source of truth — tokens, primitives, patterns, and standards — that powers both platform epics and guarantees consistency across 30+ themes.

---

### UI-DS-001 — Design Token Architecture
**Description:** Formalize a complete, layered token system (primitive → semantic → component) consumed by all themes and components.
**Current Issues:** Tokens exist but are partial; some themes override only a subset; no primitive/semantic separation; spacing/elevation/z-index untokenized.
**Proposed Improvements:** Define primitive tokens, map to semantic tokens (`--text-*`, `--bg-*`, `--accent*`, `--semantic-*`, spacing, radius, elevation, z-index, motion), and document usage. Ensure every theme defines the full semantic set.
**Acceptance Criteria:**
- A documented token layer (primitive/semantic/component) exists in `app.css` (or a `tokens.css`).
- Every `theme-*` defines the complete semantic token set (no inherited gaps).
- Token reference documented with intended usage.
**Dependencies:** None (foundational).
**Estimated Complexity:** XL

---

### UI-DS-002 — Typography System
**Description:** Define a complete type scale (families, sizes, weights, line-heights, letter-spacing) and helper classes/tokens.
**Current Issues:** Many discrete hardcoded sizes; inconsistent heading ramp; mono/sans usage informal.
**Proposed Improvements:** Modular type scale with named roles (display, h1–h6, body, label, caption, code) as tokens/utility classes.
**Acceptance Criteria:**
- Named type tokens/classes defined and documented.
- Editor content typography reconciled with UI typography (no clashes).
**Dependencies:** UI-DS-001.
**Estimated Complexity:** M

---

### UI-DS-003 — Color System & Theme Contract
**Description:** Define the semantic color model and a "theme contract" every theme must satisfy.
**Current Issues:** Themes override varying token subsets; contrast unverified; status colors inconsistent.
**Proposed Improvements:** Semantic color roles (surface, on-surface, accent, semantic states, borders) + automated contrast validation for AA.
**Acceptance Criteria:**
- Documented theme contract listing required tokens.
- Automated check verifies AA contrast for text/UI across all themes (failures flagged).
- Status colors standardized to `--semantic-*`.
**Dependencies:** UI-DS-001.
**Estimated Complexity:** L

---

### UI-DS-004 — Spacing & Layout Scale
**Description:** Define a spacing scale and layout primitives (stack, cluster, grid gutters).
**Current Issues:** Ad-hoc paddings/margins; no scale; no layout helpers.
**Proposed Improvements:** 4px-based spacing scale tokens + documented layout helper patterns.
**Acceptance Criteria:**
- Spacing scale tokens defined and documented.
- Layout helper patterns (stack/cluster/grid) documented with examples.
**Dependencies:** UI-DS-001.
**Estimated Complexity:** S

---

### UI-DS-005 — Elevation & Shadow System
**Description:** Define an elevation scale (shadows + surface tints) and a managed z-index scale.
**Current Issues:** Shadows ad-hoc (`--shadow-medium/heavy` only); z-index unmanaged across popovers/modals/toasts.
**Proposed Improvements:** Elevation levels (0–5) with shadow + optional surface tint, plus a documented z-index scale.
**Acceptance Criteria:**
- Elevation tokens defined; components reference them (no raw box-shadow literals).
- Documented z-index scale governs all stacking contexts.
**Dependencies:** UI-DS-001.
**Estimated Complexity:** S

---

### UI-DS-006 — Iconography System
**Description:** Standardize icon usage (lucide-svelte) with sizing, stroke, and accessibility conventions; replace emoji where appropriate.
**Current Issues:** Mixed emoji + lucide icons; inconsistent sizing; decorative vs. meaningful icons not distinguished.
**Proposed Improvements:** Icon size tokens, standard stroke, `aria-hidden` for decorative + labels for meaningful icons, and an icon usage guide.
**Acceptance Criteria:**
- Icon sizing/stroke standardized via tokens.
- Meaningful icons have accessible labels; decorative icons are hidden from AT.
- Emoji-as-UI replaced with proper icons where it improves clarity/consistency.
**Dependencies:** UI-DS-001, UI-DS-002.
**Estimated Complexity:** M

---

### UI-DS-007 — Motion & Animation System
**Description:** Define motion tokens (durations, easings) and reduced-motion strategy.
**Current Issues:** Durations/easings hardcoded (`cubic-bezier(0.4,0,0.2,1)`, 150–300ms); `prefers-reduced-motion` unhandled.
**Proposed Improvements:** Motion duration/easing tokens + a global reduced-motion strategy.
**Acceptance Criteria:**
- Motion tokens defined and applied to transitions/keyframes.
- `prefers-reduced-motion` disables/reduces non-essential animation app-wide.
**Dependencies:** UI-DS-001.
**Estimated Complexity:** S

---

### UI-DS-008 — Core Component Library (Primitives)
**Description:** Build the shared, themeable component primitives consumed by both platform epics.
**Current Issues:** No shared component layer; buttons/inputs/cards/popovers duplicated and inconsistent across components.
**Proposed Improvements:** Implement primitives: Button, IconButton, TextField, Select, Toggle, Checkbox, Card, ListItem, Badge/Chip, Tooltip, Popover, Modal, BottomSheet, Toast, Skeleton, EmptyState, Tabs, Avatar/StatusBadge.
**Acceptance Criteria:**
- Each primitive is token-driven, themeable, accessible, and documented with usage examples.
- Primitives expose Svelte 5 Runes props per project conventions.
- A catalog/gallery view renders every primitive across multiple themes.
**Dependencies:** UI-DS-001 … UI-DS-007.
**Estimated Complexity:** XL

---

### UI-DS-009 — Accessibility Standards & Guidelines
**Description:** Define the project's a11y standards: focus management, ARIA patterns, contrast, target sizes, keyboard maps, and motion.
**Current Issues:** No documented a11y standard; gaps across components.
**Proposed Improvements:** Written a11y standard + reusable focus-trap/live-region/visually-hidden utilities baked into primitives.
**Acceptance Criteria:**
- Documented a11y standard (WCAG 2.1 AA target) with patterns and checklists.
- Reusable focus-trap, ARIA live region, and visually-hidden utilities available.
- Primitives ship a11y-compliant by default.
**Dependencies:** UI-DS-008.
**Estimated Complexity:** M

---

### UI-DS-010 — Reusable UI Patterns
**Description:** Document composite patterns built from primitives (list-with-actions, search bar, filter chips, settings section, confirmation flow, sheet/drawer flows).
**Current Issues:** Each screen re-implements patterns differently.
**Proposed Improvements:** A pattern library showing canonical compositions for recurring UX.
**Acceptance Criteria:**
- Documented patterns for: list+actions, search, filter chips, settings section, confirm flow, picker sheet.
- Desktop and mobile variants shown for each pattern.
**Dependencies:** UI-DS-008.
**Estimated Complexity:** M

---

### UI-DS-011 — Responsive Layout Primitives & Adaptive Components
**Description:** Provide responsive primitives and a strategy for "one component, two layouts" to eliminate duplicated desktop/mobile markup.
**Current Issues:** Desktop/mobile markup duplicated in `AppLayout.svelte`, causing drift.
**Proposed Improvements:** Responsive container/adaptive components and conventions so a single component renders desktop and mobile presentations.
**Acceptance Criteria:**
- Documented adaptive-component strategy with at least two reference implementations.
- Reduced duplication: shared screens render correctly on both platforms from one source.
**Dependencies:** UI-DS-008, UI-DS-012.
**Estimated Complexity:** L

---

### UI-DS-012 — Responsive Breakpoints & Density Tokens
**Description:** Define the breakpoint system (mobile/tablet/desktop/wide) and density tokens.
**Current Issues:** Single hardcoded 768px breakpoint; no tablet/wide tiers; no density tokens.
**Proposed Improvements:** Named breakpoint tokens (e.g., sm/md/lg/xl) + comfortable/compact density tokens, with helper utilities.
**Acceptance Criteria:**
- Breakpoint tokens defined and used consistently (no scattered raw 768px checks).
- Density tokens defined and consumed by list/grid components.
- Tablet and wide tiers supported.
**Dependencies:** UI-DS-001.
**Estimated Complexity:** M

---

## 8. Execution Roadmap

A phased, dependency-aware plan. The Design System lands first to de-risk both platform epics.

### Phase 0 — Foundations (Design System Core)
**Goal:** Token + primitive foundation before any screen work.
- UI-DS-001 Design Token Architecture
- UI-DS-002 Typography
- UI-DS-003 Color System & Theme Contract
- UI-DS-004 Spacing
- UI-DS-005 Elevation & Z-index
- UI-DS-007 Motion
- UI-DS-012 Breakpoints & Density
**Milestone M0:** Complete token system; all 30+ themes satisfy the theme contract; AA contrast validated.

### Phase 1 — Component Library & Standards
**Goal:** Shared primitives and patterns ready for consumption.
- UI-DS-006 Iconography
- UI-DS-008 Core Component Library
- UI-DS-009 Accessibility Standards
- UI-DS-010 Reusable Patterns
- UI-DS-011 Responsive/Adaptive Components
**Milestone M1:** Component gallery renders all primitives across themes; a11y utilities in place.

### Phase 2 — Desktop Structural Redesign
**Goal:** Rebuild desktop shell on the new system.
- UI-D-001 Global Layout
- UI-D-002 Navigation
- UI-D-003 Header / Top Bar
- UI-D-004 Sidebar
- UI-D-005 NoteList / Grid
- UI-D-010 Modal Framework
- UI-D-007 Forms (removes `prompt()`/`confirm()`)
**Milestone M2:** Desktop shell fully token-driven; native dialogs eliminated.

### Phase 3 — Desktop Feature Surfaces
**Goal:** Dashboards, search, filters, settings, editor chrome, theming.
- UI-D-006 Dashboard
- UI-D-008 Global Search Palette
- UI-D-009 Filters
- UI-D-011 Theme Picker
- UI-D-021 Settings
- UI-D-020 Sync/Account Surface
- UI-D-023 Editor Chrome
- UI-D-024 Welcome/Onboarding
**Milestone M3:** All desktop feature surfaces redesigned; settings/sync/search modernized.

### Phase 4 — Desktop Polish, States & Performance
- UI-D-012 Typography Application
- UI-D-013 Color Standardization
- UI-D-014 Spacing/Density
- UI-D-016 Loading/Skeletons
- UI-D-017 Empty States
- UI-D-018 Error UI
- UI-D-019 Notifications
- UI-D-015 Accessibility (desktop)
- UI-D-022 Virtualization & Code-Split
**Milestone M4:** Desktop reaches AA on core flows; performance targets met.

### Phase 5 — Mobile Structural Redesign
- UI-M-001 IA & Navigation Model
- UI-M-002 Bottom Navigation
- UI-M-003 FAB / Quick Create
- UI-M-005 Mobile Forms
- UI-M-010 Filters & Bottom Sheets
- UI-M-011 Modals & Drawers
**Milestone M5:** Mobile shell extracted from monolith; sheet/drawer framework live; native dialogs gone on mobile.

### Phase 6 — Mobile Feature Surfaces & Interactions
- UI-M-004 Mobile Dashboard
- UI-M-006 Mobile Lists/Tables/Metrics
- UI-M-007 Touch Standards
- UI-M-008 Gestures
- UI-M-009 Mobile Search
- UI-M-012 Mobile Editor
- UI-M-013 Mobile Settings
- UI-M-014 Mobile Auth/Sync
**Milestone M6:** Mobile feature parity with modernized UX and gestures.

### Phase 7 — Tablet, Orientation, A11y, Performance & Offline
- UI-M-015 Tablet Layouts
- UI-M-016 Orientation Handling
- UI-M-017 Mobile Accessibility
- UI-M-018 Mobile Performance & Offline
**Milestone M7:** Tablet/orientation supported; mobile AA; offline state explicit; performance validated.

> **Recommended cadence:** 2-week sprints. Phases 0–1 (~2–3 sprints) are the critical path; Desktop (Phases 2–4) and Mobile (Phases 5–7) can partially overlap once primitives stabilize, with shared component owners coordinating.

---

## 9. Dependencies Matrix

| Story | Depends On |
| ----- | ---------- |
| UI-DS-001 | — |
| UI-DS-002–005, 007, 012 | UI-DS-001 |
| UI-DS-006 | UI-DS-001, 002 |
| UI-DS-008 | UI-DS-001–007 |
| UI-DS-009, 010 | UI-DS-008 |
| UI-DS-011 | UI-DS-008, 012 |
| UI-D-001 | UI-DS-001, 004, 005 |
| UI-D-002 | UI-D-001, UI-DS-008, 010 |
| UI-D-003 | UI-D-001, 008, 020 |
| UI-D-004 | UI-D-001, UI-DS-008, 010 |
| UI-D-005 | UI-D-001, UI-DS-008, UI-D-022 |
| UI-D-006 | UI-D-001, UI-DS-008 |
| UI-D-007 | UI-DS-008, UI-D-010 |
| UI-D-008 | UI-D-003, UI-DS-008 |
| UI-D-009 | UI-D-005, UI-DS-008 |
| UI-D-010 | UI-DS-008, 010 |
| UI-D-011 | UI-DS-001, 002, 003 |
| UI-D-012 | UI-DS-002 |
| UI-D-013 | UI-DS-003 |
| UI-D-014 | UI-DS-004 |
| UI-D-015 | UI-DS-009, UI-D-007, 010 |
| UI-D-016, 017 | UI-DS-008 |
| UI-D-018 | UI-DS-008, UI-D-020 |
| UI-D-019 | UI-DS-008, UI-D-015 |
| UI-D-020 | UI-D-003, 018 |
| UI-D-021 | UI-D-007, 010, 011 |
| UI-D-022 | UI-D-005 |
| UI-D-023 | UI-D-001, UI-DS-008 |
| UI-D-024 | UI-DS-008, UI-D-020 |
| UI-M-001 | UI-DS-011, UI-D-001 |
| UI-M-002 | UI-M-001, UI-DS-004, 008 |
| UI-M-003 | UI-M-001, 004, 007 |
| UI-M-004 | UI-M-001, UI-DS-008 |
| UI-M-005 | UI-M-001, UI-DS-008, UI-M-010 |
| UI-M-006 | UI-M-001, 007, UI-DS-008 |
| UI-M-007 | UI-DS-009 |
| UI-M-008 | UI-M-001, 007 |
| UI-M-009 | UI-M-001, UI-DS-008, UI-D-008 |
| UI-M-010 | UI-M-001, UI-DS-008 |
| UI-M-011 | UI-M-010, 001 |
| UI-M-012 | UI-M-001, 005, UI-D-023 |
| UI-M-013 | UI-M-001, UI-D-021 |
| UI-M-014 | UI-M-013, UI-D-020 |
| UI-M-015 | UI-M-001, UI-DS-012 |
| UI-M-016 | UI-M-001, 015 |
| UI-M-017 | UI-DS-009, UI-M-007, 008 |
| UI-M-018 | UI-M-001, UI-D-022, 020 |

---

## 10. Risks & Mitigations

| # | Risk | Impact | Likelihood | Mitigation |
| - | ---- | ------ | ---------- | ---------- |
| R1 | **`Editor.svelte` monolith** (~14K lines) makes editor chrome redesign risky (UI-D-023, UI-M-012). | High | High | Treat as XL; redesign only chrome (toolbar/header/modes), not TipTap engine; incremental extraction; snapshot tests of editor output. |
| R2 | **30+ themes break** when token contract changes (UI-DS-003). | High | Medium | Theme contract + automated token completeness & contrast checks; visual regression across all themes. |
| R3 | **Functional regression** during presentation refactor. | High | Medium | "Preserve all functionality" gate; per-story regression checklist; keep logic in `appState`, change only presentation. |
| R4 | **Duplicated desktop/mobile markup** drifts during parallel work. | Medium | High | Land UI-DS-011 adaptive strategy early; assign shared component owners; avoid editing legacy duplicated blocks once migrated. |
| R5 | **Native dialog removal** misses edge cases (UI-D-007, UI-M-005). | Medium | Medium | Inventory all `prompt`/`confirm`/`alert` usages up front; replace behind shared flows; track removal with a static check. |
| R6 | **Capacitor/mobile webview quirks** (OAuth, keyboard, back button) (UI-M-001, 005, 012, 014). | Medium | Medium | Device testing on real Android/iOS; visualViewport + safe-area handling; hardware-back integration tests. |
| R7 | **Performance work destabilizes lists/editor** (UI-D-022, UI-M-018). | Medium | Medium | Virtualization behind feature flag; profile before/after; fallback to non-virtualized for small vaults. |
| R8 | **Accessibility scope creep**. | Medium | Medium | Bake a11y into primitives (UI-DS-008/009) so screens inherit compliance; automated axe scans in CI. |
| R9 | **Scope/timeline** of an enterprise-scale redesign. | Medium | High | Strict phase gates/milestones; ship per-phase; primitives unblock parallelization. |
| R10 | **No existing test coverage** (per project context). | Medium | High | Add lightweight visual + a11y regression harness during Phase 0–1; manual regression checklists per story. |

---

## 11. Success Metrics

### Design System Adoption
- 100% of redesigned components consume tokens (0 hardcoded color/spacing/radius/shadow literals outside theme/token files).
- 100% of 30+ themes satisfy the theme contract (complete token set).
- 0 native `prompt()`/`confirm()`/`alert()` calls remain.

### Accessibility
- WCAG 2.1 AA on all core flows (desktop + mobile).
- 0 critical issues in automated axe scans on core screens.
- All themes pass AA contrast for primary text/UI (or are explicitly flagged).
- 100% of core flows keyboard operable; mobile flows operable with VoiceOver/TalkBack.

### Consistency & Maintainability
- ≥80% reduction in duplicated desktop/mobile layout markup (extracted from `AppLayout.svelte`).
- Single Modal/Sheet/Toast/Popover framework used app-wide.
- Documented component gallery + pattern library available.

### Performance (UX)
- Smooth scrolling (no measurable main-thread jank in profiling) for lists of 5,000+ notes.
- Reduced initial bundle via lazy-loaded diagram/graph/math editors (measurable byte reduction).
- Skeletons/optimistic UI on note open, list load, and dashboard.

### Functional Preservation
- 100% of pre-redesign features verified present post-redesign (editor capabilities, diagrams, metrics, themes, sync, search, export).
- 0 changes to on-disk HTML note format and storage adapters.

### Qualitative
- Improved task-completion time and reduced mis-clicks on destructive actions (usability testing).
- Positive SUS/usability score improvement vs. baseline.

---

## 12. Appendix — Story Index

### Epic 1 — Desktop (`UI-D-###`)
| ID | Title | Complexity |
| -- | ----- | ---------- |
| UI-D-001 | Global Desktop Layout & Grid | XL |
| UI-D-002 | Desktop Navigation System | L |
| UI-D-003 | Application Header / Top Bar | M |
| UI-D-004 | Sidebar Redesign | L |
| UI-D-005 | NoteList / Data Grid | L |
| UI-D-006 | Home Dashboard | M |
| UI-D-007 | Form & Input Controls | L |
| UI-D-008 | Global Search UX | L |
| UI-D-009 | Filter UX | M |
| UI-D-010 | Modal & Dialog System | L |
| UI-D-011 | Theme System & Picker | M |
| UI-D-012 | Typography Application | S |
| UI-D-013 | Color Standardization | S |
| UI-D-014 | Spacing & Density | M |
| UI-D-015 | Accessibility (Desktop) | L |
| UI-D-016 | Loading States & Skeletons | S |
| UI-D-017 | Empty States | S |
| UI-D-018 | Error Handling UI | M |
| UI-D-019 | Notifications & Alerts | M |
| UI-D-020 | Sync Status & Account Surface | M |
| UI-D-021 | Settings Experience | L |
| UI-D-022 | Performance UI (Virtualization) | L |
| UI-D-023 | Editor Chrome & Toolbar | XL |
| UI-D-024 | Authentication / Welcome & Onboarding | M |

### Epic 2 — Mobile (`UI-M-###`)
| ID | Title | Complexity |
| -- | ----- | ---------- |
| UI-M-001 | Mobile IA & Navigation Model | XL |
| UI-M-002 | Bottom Navigation | M |
| UI-M-003 | FAB & Quick Create | M |
| UI-M-004 | Mobile Dashboard | M |
| UI-M-005 | Mobile Forms & Inputs | L |
| UI-M-006 | Mobile Data Presentation | L |
| UI-M-007 | Touch Interaction Standards | M |
| UI-M-008 | Gesture Support | L |
| UI-M-009 | Mobile Search Experience | M |
| UI-M-010 | Mobile Filters & Bottom Sheets | M |
| UI-M-011 | Mobile Modals & Drawers | M |
| UI-M-012 | Mobile Editor Experience | XL |
| UI-M-013 | Mobile Settings | M |
| UI-M-014 | Mobile Authentication / Sync | M |
| UI-M-015 | Tablet Layouts | L |
| UI-M-016 | Orientation & Responsive Handling | M |
| UI-M-017 | Mobile Accessibility | L |
| UI-M-018 | Mobile Performance & Offline | L |

### Epic 3 — Design System (`UI-DS-###`)
| ID | Title | Complexity |
| -- | ----- | ---------- |
| UI-DS-001 | Design Token Architecture | XL |
| UI-DS-002 | Typography System | M |
| UI-DS-003 | Color System & Theme Contract | L |
| UI-DS-004 | Spacing & Layout Scale | S |
| UI-DS-005 | Elevation & Shadow System | S |
| UI-DS-006 | Iconography System | M |
| UI-DS-007 | Motion & Animation System | S |
| UI-DS-008 | Core Component Library | XL |
| UI-DS-009 | Accessibility Standards | M |
| UI-DS-010 | Reusable UI Patterns | M |
| UI-DS-011 | Responsive/Adaptive Components | L |
| UI-DS-012 | Breakpoints & Density Tokens | M |

---

*End of document. This is a presentation- and interaction-layer modernization plan. All existing MyNotes functionality — the TipTap editor, diagrams (Native/Draw.io/Mermaid), GraphView, MetricsBlock, 30+ themes, full-text search, tags, Google Drive sync, storage adapters, and the on-disk HTML note format — must be preserved throughout execution.*


