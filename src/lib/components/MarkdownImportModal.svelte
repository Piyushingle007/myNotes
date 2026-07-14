<script lang="ts">
  import Modal from './Modal.svelte';
  import { appState, generateHtmlNote, parseHtmlMetadata } from '../stores/appState.svelte';
  import { FileText, Clipboard, Plus, Upload, Code, Eye, EyeOff } from 'lucide-svelte';

  let activeTab = $state<'paste' | 'upload'>('paste');
  let inputText = $state<string>('');
  let titleInput = $state<string>('Imported Document');
  let uploadedFileName = $state<string>('');
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let isDragging = $state(false);

  // Preview & Format Badge States (Stories 3.1 & 3.2)
  let showPreview = $state(false);
  let previewHtml = $state<string>('');
  let previewDebounceTimer: any;

  // Sniff and detect document format reactively
  let detectedFormat = $derived.by(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return '';
    if (isHtml(trimmed)) {
      try {
        const parsed = parseHtmlMetadata(trimmed);
        if (parsed.meta && (parsed.meta.id || parsed.meta.title || parsed.meta.created)) {
          return 'MyNotes Export';
        }
      } catch (e) {}
      return 'Generic HTML';
    }
    return 'Markdown';
  });

  // Debounced preview generation to prevent input lag
  $effect(() => {
    const text = inputText;
    const title = titleInput;
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(() => {
      if (!text.trim()) {
        previewHtml = '';
        return;
      }
      try {
        previewHtml = getFinalHtmlContent();
      } catch (e) {
        previewHtml = `<span style="color: var(--semantic-error, #f87171);">Preview generation failed.</span>`;
      }
    }, 300);
    return () => clearTimeout(previewDebounceTimer);
  });

  $effect(() => {
    if (!appState.showMarkdownImportModal) {
      // Reset state on close
      inputText = '';
      titleInput = 'Imported Document';
      uploadedFileName = '';
      activeTab = 'paste';
      showPreview = false;
      previewHtml = '';
    }
  });

  function handleClose() {
    appState.showMarkdownImportModal = false;
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target?.files?.[0];
    processFile(file);
  }

  async function processFile(file: File | undefined) {
    if (!file) return;
    uploadedFileName = file.name;
    const nameWithoutExt = file.name.replace(/\.(md|html|htm|mf)$/i, '');
    titleInput = nameWithoutExt;

    try {
      const text = await file.text();
      inputText = text;
    } catch (err: any) {
      appState.showToast(`Failed to read file: ${err.message || err}`, 'error');
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const nameLower = file.name.toLowerCase();
      if (nameLower.endsWith('.md') || nameLower.endsWith('.html') || nameLower.endsWith('.htm') || nameLower.endsWith('.mf')) {
        processFile(file);
      } else {
        appState.showToast('Please upload a valid .md, .html, or .mf file.', 'warning');
      }
    }
  }

  function triggerFileSelect() {
    fileInputRef?.click();
  }

  function isHtml(text: string): boolean {
    if (uploadedFileName) {
      const ext = uploadedFileName.split('.').pop()?.toLowerCase();
      if (ext === 'html' || ext === 'htm') return true;
      if (ext === 'md' || ext === 'mf') return false;
    }
    const trimmed = text.trim();
    if (trimmed.toLowerCase().startsWith('<!doctype') || 
        trimmed.toLowerCase().startsWith('<html') || 
        trimmed.toLowerCase().startsWith('<body') || 
        trimmed.toLowerCase().startsWith('<head')) {
      return true;
    }
    return /^\s*<[a-zA-Z1-6]+[^>]*>/.test(trimmed);
  }

  function getFinalHtmlContent(): string {
    const trimmed = inputText.trim();
    if (isHtml(trimmed)) {
      let hasMeta = false;
      try {
        const parsed = parseHtmlMetadata(trimmed);
        if (parsed.meta && (parsed.meta.id || parsed.meta.title || parsed.meta.created)) {
          hasMeta = true;
        }
      } catch (e) {}

      if (hasMeta) {
        return trimmed;
      } else {
        // Wrap generic HTML body content in MyNotes note structure
        let bodyContent = trimmed;
        let parsedTitle = titleInput;
        if (typeof DOMParser !== 'undefined') {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(trimmed, 'text/html');
            if (doc.title) parsedTitle = doc.title;
            if (doc.body) bodyContent = doc.body.innerHTML;
          } catch (e) {}
        }
        const meta = {
          id: '',
          title: parsedTitle,
          tags: [],
          pinned: false,
          created: new Date().toISOString(),
          modified: new Date().toISOString()
        };
        return generateHtmlNote(meta, bodyContent);
      }
    } else {
      // Standard markdown conversion using the shared converter in appState
      return appState.convertMarkdownToHtml(titleInput, trimmed);
    }
  }

  async function handleCreateNote() {
    const content = inputText.trim();
    if (!content) {
      appState.showToast('Document content is empty.', 'warning');
      return;
    }

    try {
      if (isHtml(content)) {
        await appState.createNoteFromUploadedHtml(uploadedFileName || `${titleInput}.html`, content, appState.activeNotebook);
        appState.showToast(`HTML Note "${titleInput}" imported successfully.`, 'success');
      } else {
        const htmlContent = appState.convertMarkdownToHtml(titleInput, content);
        await appState.createNoteFromHtml(titleInput, htmlContent, appState.activeNotebook);
        appState.showToast(`Note "${titleInput}" created from Markdown successfully.`, 'success');
      }
      handleClose();
    } catch (err: any) {
      appState.showToast(`Failed to create note: ${err.message || err}`, 'error');
    }
  }

  function handleCopyHtml() {
    const content = inputText.trim();
    if (!content) {
      appState.showToast('Document content is empty.', 'warning');
      return;
    }

    try {
      const htmlContent = getFinalHtmlContent();
      navigator.clipboard.writeText(htmlContent);
      appState.showToast('Project HTML code copied to clipboard!', 'success');
    } catch (err: any) {
      appState.showToast(`Failed to copy HTML: ${err.message || err}`, 'error');
    }
  }

  function handleCopySource() {
    const content = inputText.trim();
    if (!content) {
      appState.showToast('Document content is empty.', 'warning');
      return;
    }

    try {
      navigator.clipboard.writeText(content);
      appState.showToast('Source code copied to clipboard!', 'success');
    } catch (err: any) {
      appState.showToast(`Failed to copy source: ${err.message || err}`, 'error');
    }
  }
</script>

<Modal
  show={appState.showMarkdownImportModal}
  title="Import Document"
  onClose={handleClose}
  maxWidth="680px"
>
  {#key activeTab}
    <div class="md-import-container flex-col">
      <!-- Tabs Selector -->
      <div class="md-tabs flex-row">
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'paste'}
          onclick={() => activeTab = 'paste'}
        >
          <Code size={14} />
          <span>Paste Code (MD / HTML / MF)</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'upload'}
          onclick={() => activeTab = 'upload'}
        >
          <Upload size={14} />
          <span>Upload File (MD / HTML / MF)</span>
        </button>
      </div>

      <!-- Main Input Section -->
      <div class="md-input-section flex-col">
        <!-- Title & Format Badge Row -->
        <div class="input-header-row flex-row">
          <div class="input-group flex-col" style="flex-grow: 1;">
            <label for="md-title-input" class="input-label">Note Title</label>
            <input
              id="md-title-input"
              type="text"
              class="styled-text-input"
              bind:value={titleInput}
              placeholder="Enter note title..."
            />
          </div>
          {#if detectedFormat}
            <div class="format-badge-container flex-col">
              <span class="input-label">Format</span>
              <span class="format-badge" class:badge-html={isHtml(inputText)}>
                {detectedFormat}
              </span>
            </div>
          {/if}
        </div>

        {#if activeTab === 'paste'}
          <!-- Monospace Text Area -->
          <div class="input-group flex-col">
            <label for="md-textarea-input" class="input-label">Raw Code Content</label>
            <textarea
              id="md-textarea-input"
              class="styled-textarea"
              bind:value={inputText}
              placeholder="# Markdown Heading&#10;Hello **world**!&#10;- Bullet items&#10;&#10;<!-- OR -->&#10;<h1>HTML Heading</h1>&#10;<p>Hello world</p>"
            ></textarea>
          </div>
        {:else}
          <!-- File Drop Zone -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="drop-zone flex-col"
            class:dragging={isDragging}
            onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') triggerFileSelect(); }}
            onclick={triggerFileSelect}
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
            ondrop={handleDrop}
            role="button"
            tabindex="0"
            aria-label="Upload document file"
          >
            <input
              type="file"
              accept=".md,.html,.htm,.mf"
              class="hidden-file-input"
              bind:this={fileInputRef}
              onchange={handleFileChange}
            />
            <div class="drop-zone-content flex-col">
              <Upload size={32} class="drop-icon" />
              {#if uploadedFileName}
                <span class="file-status-success">Selected: {uploadedFileName}</span>
                <span class="drop-sub">Click or drag another file to replace</span>
              {:else}
                <span class="drop-main">Click or Drag & Drop File here</span>
                <span class="drop-sub">Accepts files ending with .md, .html, .htm, or .mf</span>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- Live Preview Section (Story 3.1) -->
      {#if inputText.trim()}
        <div class="preview-section flex-col">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="preview-header flex-row" onclick={() => showPreview = !showPreview}>
            <div class="flex-row" style="gap: var(--spacing-xs);">
              {#if showPreview}
                <EyeOff size={14} class="preview-toggle-icon" />
              {:else}
                <Eye size={14} class="preview-toggle-icon" />
              {/if}
              <span class="preview-toggle-title">Live Preview</span>
            </div>
            <span class="preview-toggle-arrow" class:open={showPreview}>▸</span>
          </div>

          {#if showPreview}
            <div class="preview-content-container flex-col">
              <div class="preview-info-banner">
                💡 Rendering preview using standard MyNotes editor styling.
              </div>
              <div class="preview-scroll-wrapper">
                <div class="preview-body tiptap">
                  {@html parseHtmlMetadata(previewHtml).content || previewHtml}
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Action Panel Buttons -->
      <div class="modal-action-row flex-row">
        {#if inputText.trim()}
          <button
            type="button"
            class="btn-pill btn-pill-outline flex-row"
            onclick={handleCopyHtml}
            title="Copy converted HTML note structure to clipboard"
          >
            <Clipboard size={14} />
            <span>Copy HTML</span>
          </button>
          
          {#if activeTab === 'upload' || uploadedFileName}
            <button
              type="button"
              class="btn-pill btn-pill-outline flex-row"
              onclick={handleCopySource}
              title="Copy original raw source code to clipboard"
            >
              <FileText size={14} />
              <span>Copy Source</span>
            </button>
          {/if}

          <button
            type="button"
            class="btn-pill btn-pill-primary flex-row"
            onclick={handleCreateNote}
            title="Import/Create a new HTML note in MyNotes"
          >
            <Plus size={14} />
            <span>Create Note</span>
          </button>
        {:else}
          <div style="flex-grow: 1;"></div>
          <button
            type="button"
            class="btn-pill btn-pill-outline"
            style="border-color: var(--border-color); color: var(--text-secondary);"
            onclick={handleClose}
          >
            Cancel
          </button>
        {/if}
      </div>
    </div>
  {/key}
</Modal>

<style>
  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .md-import-container {
    padding: var(--spacing-sm) 0;
    gap: var(--spacing-md);
  }

  .md-tabs {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 4px;
    gap: var(--spacing-sm);
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-sm);
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    transition: all 0.15s ease;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .md-input-section {
    gap: var(--spacing-sm);
    margin-top: 4px;
  }

  .input-header-row {
    gap: var(--spacing-md);
    width: 100%;
  }

  .format-badge-container {
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }

  .format-badge {
    background-color: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: var(--font-size-xs);
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .format-badge.badge-html {
    background-color: color-mix(in srgb, var(--semantic-info, #539df5) 12%, transparent);
    color: var(--semantic-info, #539df5);
    border-color: color-mix(in srgb, var(--semantic-info, #539df5) 25%, transparent);
  }

  .input-group {
    gap: 6px;
    align-items: flex-start;
  }

  .input-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .styled-text-input {
    width: 100%;
    box-sizing: border-box;
    background-color: var(--bg-mid-dark, #1f1f1f);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: var(--spacing-xs) var(--spacing-sm);
    font-family: inherit;
    font-size: var(--font-size-sm);
    border-radius: var(--radius-standard);
    outline: none;
    transition: border-color 0.15s ease;
  }

  .styled-text-input:focus {
    border-color: var(--accent);
  }

  .styled-textarea {
    width: 100%;
    height: 180px;
    box-sizing: border-box;
    background-color: var(--bg-mid-dark, #1f1f1f);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: var(--spacing-sm);
    font-family: 'Courier New', Courier, monospace;
    font-size: 13px;
    line-height: 1.5;
    border-radius: var(--radius-standard);
    outline: none;
    resize: vertical;
    transition: border-color 0.15s ease;
  }

  .styled-textarea:focus {
    border-color: var(--accent);
  }

  .drop-zone {
    border: 2px dashed var(--border-color);
    border-radius: var(--radius-standard);
    background-color: var(--bg-mid-dark, #1f1f1f);
    padding: var(--spacing-xl) var(--spacing-lg);
    text-align: center;
    cursor: pointer;
    outline: none;
    transition: all 0.15s ease;
  }

  .drop-zone:focus,
  .drop-zone:hover {
    border-color: var(--accent);
    background-color: color-mix(in srgb, var(--accent) 4%, var(--bg-mid-dark, #1f1f1f));
  }

  .drop-zone.dragging {
    border-color: var(--accent);
    background-color: color-mix(in srgb, var(--accent) 8%, var(--bg-mid-dark, #1f1f1f));
  }

  .hidden-file-input {
    display: none;
  }

  .drop-zone-content {
    align-items: center;
    gap: var(--spacing-sm);
  }

  .drop-icon {
    color: var(--text-secondary);
  }

  .drop-zone:hover .drop-icon {
    color: var(--accent);
  }

  .drop-main {
    font-weight: 600;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .drop-sub {
    font-size: var(--font-size-2xs);
    color: var(--text-tertiary);
  }

  .file-status-success {
    font-weight: 600;
    color: var(--accent);
    font-size: var(--font-size-sm);
  }

  /* Live Preview Styles */
  .preview-section {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    background-color: var(--bg-mid-dark, #1f1f1f);
    overflow: hidden;
  }

  .preview-header {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: rgba(255, 255, 255, 0.02);
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.15s ease;
  }

  .preview-header:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .preview-toggle-icon {
    color: var(--text-secondary);
  }

  .preview-toggle-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .preview-toggle-arrow {
    font-size: 10px;
    color: var(--text-tertiary);
    transition: transform 0.2s ease;
  }

  .preview-toggle-arrow.open {
    transform: rotate(90deg);
  }

  .preview-content-container {
    border-top: 1px solid var(--border-color);
    max-height: 250px;
  }

  .preview-info-banner {
    padding: 6px var(--spacing-md);
    background-color: color-mix(in srgb, var(--accent) 5%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    border-bottom: 1px solid var(--border-color);
  }

  .preview-scroll-wrapper {
    overflow-y: auto;
    padding: var(--spacing-md);
    background-color: var(--bg-surface, #121212);
    height: 180px;
  }

  .preview-body {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-primary);
    /* TipTap styles overrides to look clean inside modal */
    word-break: break-word;
  }

  .modal-action-row {
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
    flex-shrink: 0;
  }

  /* Specific buttons overrides */
  .btn-pill {
    font-family: inherit;
    font-size: var(--font-size-sm);
    font-weight: 700;
    padding: 8px var(--spacing-md);
    cursor: pointer;
    border-radius: 9999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-2xs);
    transition: all 0.15s ease;
    height: 36px;
    box-sizing: border-box;
  }

  .btn-pill-primary {
    background-color: var(--accent);
    border: none;
    color: #000000;
  }

  .btn-pill-primary:hover {
    transform: scale(1.02);
    filter: brightness(1.05);
  }

  .btn-pill-outline {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .btn-pill-outline:hover {
    border-color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.05);
  }
</style>
