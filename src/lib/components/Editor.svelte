<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { Save, HelpCircle, Network, ArrowLeft, BookOpen, AlertTriangle, Eye, Edit3, Columns } from 'lucide-svelte';
  import { marked } from 'marked';

  // State to track if graph view is toggled open on the right
  let { showGraph = $bindable(false) } = $props();

  let autosaveTimer: number | null = null;

  function handleContentInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    appState.activeNoteContent = target.value;
    appState.editorDirty = true;

    // Reset autosave timer
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(async () => {
      if (appState.editorDirty) {
        await appState.saveActiveNote();
      }
    }, 2000); // 2s debounce autosave
  }

  // Clean up timer on destroy
  $effect(() => {
    return () => {
      if (autosaveTimer) clearTimeout(autosaveTimer);
    };
  });

  // Calculate statistics
  let wordCount = $derived.by(() => {
    const text = appState.activeNoteContent.trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  });

  let charCount = $derived.by(() => {
    return appState.activeNoteContent.length;
  });

  let readTime = $derived.by(() => {
    const wpm = 200; // average reading speed
    const mins = Math.ceil(wordCount / wpm);
    return `${mins} min read`;
  });

  function handleSaveClick() {
    appState.saveActiveNote(true);
  }

  function handleInsertWikiLink() {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.slice(start, end) || 'NoteTitle';
    
    appState.activeNoteContent = text.slice(0, start) + `[[${selected}]]` + text.slice(end);
    appState.editorDirty = true;
    
    // Set focus back and select text
    textarea.focus();
    setTimeout(() => {
      textarea.setSelectionRange(start + 2, start + 2 + selected.length);
    }, 0);
  }

  // View mode state (Edit, Split, Preview)
  let viewMode = $state<'edit' | 'split' | 'preview'>((localStorage.getItem('mynotes_editor_view_mode') as any) || 'edit');

  function setViewMode(mode: 'edit' | 'split' | 'preview') {
    viewMode = mode;
    localStorage.setItem('mynotes_editor_view_mode', mode);
  }

  // Preprocess Markdown & parse with marked
  let previewHtml = $derived.by(() => {
    const md = appState.activeNoteContent;
    if (!md) return '';
    
    // Preprocess wikilinks: [[Note Title]] or [[Note Title|Display Name]]
    let processed = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, path, display) => {
      const displayText = display ? display.trim() : path.trim();
      let targetPath = path.trim();
      if (!targetPath.endsWith('.md')) {
        targetPath += '.md';
      }
      return `<a href="#" class="wikilink" data-path="${encodeURIComponent(targetPath)}">${displayText}</a>`;
    });

    try {
      return marked.parse(processed, { async: false }) as string;
    } catch (e) {
      console.error('Failed to parse Markdown:', e);
      return `<p style="color: var(--semantic-error);">Error rendering preview: ${e}</p>`;
    }
  });

  // Wikilink click navigation handler
  function handlePreviewClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const wikilink = target.closest('.wikilink') as HTMLElement;
    if (wikilink) {
      e.preventDefault();
      const path = decodeURIComponent(wikilink.getAttribute('data-path') || '');
      if (path) {
        let resolvedPath = path;
        if (appState.activeNotePath && appState.activeNotePath.includes('/')) {
          const folder = appState.activeNotePath.substring(0, appState.activeNotePath.lastIndexOf('/'));
          if (!path.startsWith('/')) {
            resolvedPath = `${folder}/${path}`;
          }
        }

        const noteExists = appState.notes.some(n => n.path.toLowerCase() === resolvedPath.toLowerCase());
        if (noteExists) {
          appState.selectNote(resolvedPath);
        } else {
          const directMatch = appState.notes.some(n => n.path.toLowerCase() === path.toLowerCase());
          if (directMatch) {
            appState.selectNote(path);
          } else {
            const filenameMatch = appState.notes.find(n => n.name.toLowerCase() === path.replace(/\.md$/, '').toLowerCase());
            if (filenameMatch) {
              appState.selectNote(filenameMatch.path);
            } else {
              // Create new note in the active directory folder
              const folder = appState.activeNotePath && appState.activeNotePath.includes('/')
                ? appState.activeNotePath.substring(0, appState.activeNotePath.lastIndexOf('/'))
                : null;
              appState.createNote(path.replace(/\.md$/, ''), folder);
            }
          }
        }
      }
    }
  }
</script>

<div class="editor-container flex-col">
  {#if appState.activeNote}
    <!-- Editor Header Player Controls -->
    <div class="editor-header flex-row">
      <div class="track-meta flex-col">
        <span class="now-playing-lbl">NOW EDITING</span>
        <input 
          type="text" 
          value={appState.activeNoteTitle} 
          class="note-title-input" 
          readonly
        />
      </div>

      <!-- Controls Toolbar -->
      <div class="controls-toolbar flex-row">
        <!-- WikiLink Button -->
        <button 
          class="btn-control flex-row" 
          onclick={handleInsertWikiLink} 
          title="Insert Wiki Link (Ctrl+K)"
        >
          <BookOpen size={18} />
          <span class="btn-label">Link</span>
        </button>

        <!-- Graph Visualization Toggle -->
        <button 
          class="btn-control flex-row" 
          class:active={showGraph} 
          onclick={() => showGraph = !showGraph}
          title="Toggle Note Graph"
        >
          <Network size={18} />
          <span class="btn-label">Visualizer</span>
        </button>

        <!-- Segmented View Toggle -->
        <div class="segmented-control flex-row">
          <button 
            class="btn-segment" 
            class:active={viewMode === 'edit'} 
            onclick={() => setViewMode('edit')}
            title="Edit Mode"
          >
            <Edit3 size={15} />
          </button>
          <button 
            class="btn-segment" 
            class:active={viewMode === 'split'} 
            onclick={() => setViewMode('split')}
            title="Split View"
          >
            <Columns size={15} />
          </button>
          <button 
            class="btn-segment" 
            class:active={viewMode === 'preview'} 
            onclick={() => setViewMode('preview')}
            title="Preview Mode"
          >
            <Eye size={15} />
          </button>
        </div>

        <!-- Circular Play/Save Button -->
        <button 
          class="btn-circle btn-circle-primary save-btn" 
          class:dirty={appState.editorDirty} 
          onclick={handleSaveClick}
          title="Save Note (Ctrl+S)"
          aria-label="Save note"
        >
          <Save size={18} />
        </button>
      </div>
    </div>

    <!-- Textarea Editing Panel / Preview Panel Workspace -->
    <div class="editor-body flex-row">
      {#if viewMode !== 'preview'}
        <div class="editor-pane">
          <textarea 
            class="editor-textarea font-mono" 
            value={appState.activeNoteContent} 
            oninput={handleContentInput}
            placeholder="Start writing in markdown..."
          ></textarea>
        </div>
      {/if}

      {#if viewMode === 'split'}
        <div class="editor-separator"></div>
      {/if}

      {#if viewMode !== 'edit'}
        <div 
          class="preview-pane markdown-body" 
          onclick={handlePreviewClick}
        >
          {@html previewHtml}
        </div>
      {/if}
    </div>

    <!-- Bottom Player / Status Bar -->
    <div class="editor-footer flex-row">
      <div class="stats-panel flex-row">
        <span class="stat-item">{wordCount} words</span>
        <span class="stat-divider">|</span>
        <span class="stat-item">{charCount} characters</span>
        <span class="stat-divider">|</span>
        <span class="stat-item">{readTime}</span>
      </div>

      <div class="save-status flex-row">
        {#if appState.editorDirty}
          <span class="status-unsaved flex-row">
            <span class="status-dot"></span> Unsaved changes
          </span>
        {:else}
          <span class="status-saved flex-row" style="gap: 8px;">
            <span>Saved locally</span>
            {#if appState.syncEnabled && appState.googleConnected}
              <span class="status-divider">|</span>
              {#if appState.syncStatus === 'syncing'}
                <span class="status-syncing flex-row" style="color: var(--semantic-info); gap: 4px;">
                  <span class="status-dot-syncing"></span> Syncing to Drive...
                </span>
              {:else if appState.syncStatus === 'error'}
                <span style="color: var(--semantic-error);">Sync Error</span>
              {:else}
                <span style="color: var(--accent);">Synced to Drive</span>
              {/if}
            {/if}
          </span>
        {/if}
      </div>
    </div>
  {:else}
    <div class="no-note-selected flex-col">
      <div class="disc-art">📓</div>
      <h2 class="no-note-title">No Note Loaded</h2>
      <p class="no-note-text">Select a track from the playlist or click "Add Note" to create one.</p>
      <button class="btn-pill btn-pill-primary select-vault-btn" onclick={appState.initSandbox.bind(appState)}>
        Load Local Sandbox
      </button>
    </div>
  {/if}
</div>

<style>
  .editor-container {
    flex-grow: 1;
    height: 100%;
    background-color: var(--bg-base);
    overflow: hidden;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .editor-header {
    height: 80px;
    background-color: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
    padding: 0 24px;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .track-meta {
    gap: 2px;
    overflow: hidden;
    max-width: 50%;
  }

  .now-playing-lbl {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1px;
  }

  .note-title-input {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: transparent;
    border: none;
    outline: none;
    pointer-events: none; /* read-only */
  }

  .controls-toolbar {
    gap: 16px;
  }

  .btn-control {
    color: var(--text-secondary);
    font-weight: 700;
    gap: 6px;
    padding: 8px 12px;
    border-radius: var(--radius-pill);
    transition: color 0.2s, background-color 0.2s;
  }

  .btn-control:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .btn-control.active {
    color: var(--accent);
    background-color: rgba(30, 215, 96, 0.08);
  }

  .btn-label {
    font-size: 12px;
  }

  .save-btn {
    box-shadow: var(--shadow-medium);
  }

  .save-btn.dirty {
    animation: save-glow 2s infinite ease-in-out;
  }

  @keyframes save-glow {
    0%, 100% {
      box-shadow: 0 0 0 0px rgba(30, 215, 96, 0.4);
    }
    50% {
      box-shadow: 0 0 12px 4px rgba(30, 215, 96, 0.6);
    }
  }

  .editor-body {
    flex-grow: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    padding: 16px 24px;
    background-color: var(--bg-base);
  }

  .editor-textarea {
    width: 100%;
    height: 100%;
    resize: none;
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-primary);
    background: transparent;
    border: none;
    outline: none;
  }

  .editor-footer {
    height: 48px;
    background-color: var(--bg-surface);
    border-top: 1px solid var(--border-color);
    padding: 0 24px;
    justify-content: space-between;
    flex-shrink: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .stats-panel {
    gap: 8px;
  }

  .stat-divider {
    color: var(--text-tertiary);
  }

  .save-status {
    gap: 8px;
    font-weight: 500;
  }

  .status-unsaved {
    color: var(--semantic-warning);
    gap: 6px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--semantic-warning);
    display: inline-block;
  }

  .status-saved {
    color: var(--text-tertiary);
  }

  .status-dot-syncing {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--semantic-info);
    display: inline-block;
    animation: sync-pulse 1s infinite alternate;
  }

  @keyframes sync-pulse {
    from { opacity: 0.4; }
    to { opacity: 1; }
  }

  .no-note-selected {
    align-items: center;
    justify-content: center;
    flex-grow: 1;
    gap: 16px;
    text-align: center;
    padding: 32px;
  }

  .disc-art {
    font-size: 64px;
    margin-bottom: 8px;
    animation: float 4s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  .no-note-title {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
  }

  .no-note-text {
    font-size: 13px;
    color: var(--text-secondary);
    max-width: 280px;
    line-height: 1.5;
  }

  .select-vault-btn {
    margin-top: 8px;
  }

  /* Segmented view controls */
  .segmented-control {
    background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    padding: 2px;
    gap: 2px;
    flex-shrink: 0;
  }

  .btn-segment {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    width: 30px;
    height: 30px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.2s, background-color 0.2s;
  }

  .btn-segment:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.03);
  }

  .btn-segment.active {
    color: var(--accent);
    background-color: rgba(255, 255, 255, 0.08);
  }

  /* Split and preview panes */
  .editor-pane {
    flex: 1;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .editor-separator {
    width: 1px;
    height: 100%;
    background-color: var(--border-color);
    margin: 0 16px;
    flex-shrink: 0;
  }

  .preview-pane {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    color: var(--text-primary);
    line-height: 1.6;
    font-size: 14px;
    padding-right: 8px;
  }

  /* Custom markdown renderer elements styling */
  .preview-pane :global(h1), .preview-pane :global(h2), .preview-pane :global(h3), .preview-pane :global(h4), .preview-pane :global(h5), .preview-pane :global(h6) {
    color: var(--text-primary);
    font-weight: 800;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    line-height: 1.35;
  }

  .preview-pane :global(h1) {
    font-size: 24px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 8px;
    margin-top: 0;
  }

  .preview-pane :global(h2) {
    font-size: 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 6px;
  }

  .preview-pane :global(h3) {
    font-size: 15px;
  }

  .preview-pane :global(p) {
    margin-top: 0;
    margin-bottom: 1em;
    font-size: 13.5px;
    color: var(--text-secondary);
  }

  .preview-pane :global(a) {
    color: var(--accent);
    text-decoration: none;
    transition: opacity 0.2s;
  }

  .preview-pane :global(a:hover) {
    opacity: 0.8;
  }

  .preview-pane :global(.wikilink) {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px dashed var(--accent);
    font-weight: 600;
  }

  .preview-pane :global(ul), .preview-pane :global(ol) {
    margin-top: 0;
    margin-bottom: 1em;
    padding-left: 20px;
    color: var(--text-secondary);
    font-size: 13.5px;
  }

  .preview-pane :global(li) {
    margin-bottom: 0.25em;
  }

  .preview-pane :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background-color: rgba(255, 255, 255, 0.05);
    padding: 2px 5px;
    border-radius: 4px;
    color: #e2e8f0;
  }

  .preview-pane :global(pre) {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-medium);
    padding: 14px;
    overflow-x: auto;
    margin-top: 0;
    margin-bottom: 1em;
  }

  .preview-pane :global(pre code) {
    background-color: transparent;
    padding: 0;
    border-radius: 0;
    color: inherit;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .preview-pane :global(blockquote) {
    margin: 0 0 1em 0;
    padding: 4px 0 4px 16px;
    border-left: 3px solid var(--accent);
    color: var(--text-secondary);
    font-style: italic;
    background-color: rgba(255, 255, 255, 0.01);
  }

  .preview-pane :global(hr) {
    height: 1px;
    background-color: var(--border-color);
    border: none;
    margin: 24px 0;
  }

  .preview-pane :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1em;
    font-size: 13px;
  }

  .preview-pane :global(th), .preview-pane :global(td) {
    border: 1px solid var(--border-color);
    padding: 8px 12px;
  }

  .preview-pane :global(th) {
    background-color: rgba(255, 255, 255, 0.03);
    font-weight: 700;
    color: var(--text-primary);
  }

  .preview-pane :global(td) {
    color: var(--text-secondary);
  }
</style>
