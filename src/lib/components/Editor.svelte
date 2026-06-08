<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { Save, HelpCircle, Network, ArrowLeft, BookOpen, AlertTriangle } from 'lucide-svelte';

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

    <!-- Textarea Editing Panel -->
    <div class="editor-body">
      <textarea 
        class="editor-textarea font-mono" 
        value={appState.activeNoteContent} 
        oninput={handleContentInput}
        placeholder="Start writing in markdown..."
      ></textarea>
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
</style>
