# MyNotes - Feature Reference Guide

Welcome to the comprehensive feature catalog of **MyNotes**, a local-first, premium markdown/HTML notes application built with Svelte 5, TypeScript, and Vite.

---

## 🎨 Design & Layout System

### 1. Spotify-Inspired Glassmorphic UI
- **Responsive 3-Panel Layout**: Desktop view splits the screen into a Sidebar (navigation), Note List (active selection), and Editor (active writing). Panel dividers are fully resizable with custom hover states.
- **Mobile Bottom Navigation**: Smooth, tab-bar navigation for mobile screens that hides panels to maximize editor visibility.
- **Glassmorphism**: Elegant blur backdrops, thin translucent borders, and subtle glowing dropshadows that create a premium feel.
- **30+ Premium Curated Color Themes**: Includes Dracula, Cyberpunk, Nord, Steel, Emerald, Solarized, and custom high-contrast modes.

---

## 📝 WYSIWYG & Markdown Rich Editor

Powered by a highly customized **TipTap** engine. It seamlessly bridges Markdown syntax with WYSIWYG convenience.

### 1. Extended Text Formatting
- **Standard Typography**: Bold (`Ctrl+B`), Italic (`Ctrl+I`), Underline (`Ctrl+U`), Highlight (`multicolor`), Strikethrough, Subscript, Superscript.
- **Text Customizer**: Dropdowns for font size, font family (Sans, Serif, Monospace, Dyslexic-friendly), and custom text/background colors.
- **Paragraph Alignment**: Left, center, right, and justified alignments.

### 2. Advanced Embeds & Structuring
- **Tables with Cell Formatting**: Create resizable grid tables. Customize border colors, background fills, header columns, and align cells.
- **Collapsible Sections**: Toggle details blocks (`<details>`) with a title summary and nested content blocks. Perfect for organizing long notes.
- **Callout Boxes**: Highlight information in colorful callout panels with custom icons (Info, Warning, Success, Note).
- **Page Breaks**: Insert visual print page breaks for clean PDF document generation.
- **File Attachments**: Upload and download binary files, rendering previews for PDFs, audio, video, spreadsheets, and text logs inline.

---

## 📊 Diagramming, Visualization, & Math

### 1. LaTeX Math Equations
- **Inline Math**: Type `\( E=mc^2 \)` or `$E=mc^2$` to render mathematical expressions inline.
- **Block Math**: Wrap equations in `\[ ... \]` or `$$ ... $$` to render centered, block mathematical layouts using **KaTeX**.

### 2. Embedded Diagram Editors
- **Mermaid.js Diagrams**: Write simple text descriptions (e.g. flowcharts, sequence diagrams) and render them on-the-fly. Includes an inline source editor panel.
- **Draw.io/Excalidraw Diagram Editor**: Double-click embedded graphics to launch a drawing canvas. Draw vector shapes, save, and embed SVG renders directly inside the note HTML.
- **Markmap Mind Maps**: Automatically convert outline bullet hierarchies into visual, zoomable mind maps.

### 3. Live Metrics Block (Live Calculations)
- **Inline Spreadsheets**: Type `.calc`, `.metric`, or `.metrics` to insert a spreadsheet widget with custom title, rows, values, and calculations.
- **Auto-Calculations**: Computes metrics in real-time including: **Count, Sum, Average, Min, Max, Median, Income, Expenses, and Net Total**.
- **Interactive Checkboxes**: Click row checkboxes to mark items, and optionally exclude checked items from total metrics dynamically.
- **Drag-and-Drop & Accessibility**: Reorder rows easily using drag handles (`⋮⋮`), add new rows with `Enter`, delete rows with `Backspace` (on empty fields), and navigate using keyboard focus.

---

## 🚀 Evernote-Style Rich Task Management

A fully integrated, multi-file checklist and task management system designed to mirror the structure and aesthetics of Evernote.

### 1. Unified Task Row Widget (In-Editor)
- **monospaced Drag Handle (`⋮⋮`)**: Appears on the left margin of the task block when hovered or focused, facilitating easy list re-ordering.
- **Circle Checkbox**: A styled, circular border checkbox in a signature purple color (`#a855f7`) that ticks and fills with purple when completed.
- **"Untitled task" Placeholder**: Automatically shows a dim placeholder text if the task paragraph has no content.
- **Focus Capsule Styling**: When the cursor enters any task, the row morphs into a highlighted background bar (`rgba(255, 255, 255, 0.05)`) with a border, making it feel like a unified component.
- **Metadata Badges**: Inactive task rows show clean, inline metadata tags (due dates, priority flags) that hide when the row is focused to clear space for editing.

### 2. Floating Inline Options Bar (HUD)
- Automatically floats on the **right-hand side of the active task row** on desktop, blending transparently into the highlighted block.
- On **mobile**, it floats directly above the keyboard/task block to prevent viewport clipping.
- **Toolbar Actions**:
  - **Today / Tomorrow pills**: Fast-assign due dates in a single click.
  - **Date Picker Overlay**: Standard calendar widget for custom dates.
  - **Repeat**: Set recurring tasks (visual framework ready).
  - **Reminders**: Dropdown datetime selector for in-app alert times.
  - **Flag**: Toggle important/priority star status.
  - **Assign**: Personal user assignments (visual/disabled).
  - **More Options**: Opens a modal for advanced description edits.
  - **Delete (Trash icon)**: Instantly deletes the task item node from the document.

### 3. Aggregated Tasks View Dashboard
- A centralized panel showing all tasks aggregated across every single note.
- **Due Date Groups**: Grouped dynamically into *Overdue*, *Today*, *Upcoming*, and *No Date*.
- **Dashboard Controls**:
  - Toggle **"Hide Done"** to filter out finished checklist items.
  - Sort by **Due Date**, **Priority Rank** (High, Medium, Low), or **Note Title**.
- Clicking any aggregated task row instantly opens the source note and scrolls to the selected task in the editor.

### 4. Background Reminder Notifications
- Periodic loops check active task reminders in the background.
- Pops up visual in-app toast alerts when a task due time is reached.

---

## 💾 Local-First Storage & Cloud Sync

### 1. Storage Adaptability
- **Browser Sandbox**: Operates inside IndexedDB storage when accessed via a normal web browser.
- **Local Directory Access**: Utilizes the native HTML5 File System Access API. Select a folder on your drive, and read/write notes directly as files.

### 2. Google Drive Sync
- Pair with your Google account. Supports manual or periodic automated synchronization to back up note HTML/Markdown files seamlessly to the cloud.
- Integrated merge conflict handling for cross-device updates.
