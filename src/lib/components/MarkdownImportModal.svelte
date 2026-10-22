<script lang="ts">
  import Modal from './Modal.svelte';
  import { appState, generateHtmlNote, parseHtmlMetadata, type ZipInspectionResult } from '../stores/appState.svelte';
  import { FileText, Clipboard, Plus, Upload, Code, Eye, EyeOff, FolderArchive, Folder, AlertCircle, LoaderCircle } from 'lucide-svelte';

  let activeTab = $state<'paste' | 'upload' | 'zip'>('paste');
  let inputText = $state<string>('');
  let titleInput = $state<string>('Imported Document');
  let uploadedFileName = $state<string>('');
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let isDragging = $state(false);

  // ZIP Import State
  let zipInputRef = $state<HTMLInputElement | null>(null);
  let selectedZipFile = $state<File | null>(null);
  let zipInspection = $state<ZipInspectionResult | null>(null);
  let zipLoading = $state<boolean>(false);
  let zipImporting = $state<boolean>(false);
  let zipProgress = $state<{ current: number; total: number }>({ current: 0, total: 0 });
  let selectedTargetFolder = $state<string>(appState.activeNotebook || '');
  let isCreatingNewFolder = $state<boolean>(false);
  let newFolderName = $state<string>('');

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
    if (appState.showMarkdownImportModal) {
      if (appState.markdownImportInitialTab) {
        activeTab = appState.markdownImportInitialTab;
        appState.markdownImportInitialTab = 'paste';
      }
      selectedTargetFolder = appState.activeNotebook || '';
      isCreatingNewFolder = false;
      newFolderName = '';
    } else {
      // Reset state on close
      inputText = '';
      titleInput = 'Imported Document';
      uploadedFileName = '';
      activeTab = 'paste';
      showPreview = false;
      previewHtml = '';
      selectedZipFile = null;
      zipInspection = null;
      zipLoading = false;
      zipImporting = false;
      zipProgress = { current: 0, total: 0 };
    }
  });

  function handleClose() {
    appState.showMarkdownImportModal = false;
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target?.files?.[0];
    if (file) {
      if (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')) {
        activeTab = 'zip';
        processZipFile(file);
      } else {
        processFile(file);
      }
    }
  }

  function handleZipFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target?.files?.[0];
    if (file) {
      processZipFile(file);
    }
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

  async function processZipFile(file: File | undefined) {
    if (!file) return;
    selectedZipFile = file;
    zipLoading = true;
    zipInspection = null;

    try {
      zipInspection = await appState.inspectMarkdownZip(file);
      if (zipInspection.mdFiles.length === 0) {
        appState.showToast('No .md or .markdown files found in this ZIP archive.', 'warning', 4000);
      }
    } catch (err: any) {
      console.error('Failed to parse zip archive:', err);
      appState.showToast(`Failed to parse ZIP archive: ${err.message || err}`, 'error', 4000);
      zipInspection = null;
      selectedZipFile = null;
    } finally {
      zipLoading = false;
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
      if (nameLower.endsWith('.zip') || file.type.includes('zip')) {
        activeTab = 'zip';
        processZipFile(file);
      } else if (nameLower.endsWith('.md') || nameLower.endsWith('.html') || nameLower.endsWith('.htm') || nameLower.endsWith('.mf')) {
        activeTab = 'upload';
        processFile(file);
      } else {
        appState.showToast('Please upload a valid .md, .html, .mf or .zip file.', 'warning');
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

  async function handleImportZip() {
    if (!selectedZipFile || !zipInspection || zipInspection.mdFiles.length === 0) {
      appState.showToast('No markdown files available to import.', 'warning');
      return;
    }

    let targetFolder: string | null = null;
    if (isCreatingNewFolder) {
      const trimmed = newFolderName.trim();
      if (!trimmed) {
        appState.showToast('Please enter a name for the new folder.', 'warning');
        return;
      }
      targetFolder = trimmed;
    } else {
      targetFolder = selectedTargetFolder.trim() || null;
    }

    zipImporting = true;
    zipProgress = { current: 0, total: zipInspection.mdFiles.length };

    try {
      const result = await appState.importMarkdownZip(
        selectedZipFile,
        targetFolder,
        (current, total) => {
          zipProgress = { current, total };
        }
      );

      const folderDisplay = result.targetFolder ? `folder "${result.targetFolder}"` : 'root workspace';
      appState.showToast(
        `Successfully imported ${result.importedCount} flat ${result.importedCount === 1 ? 'note' : 'notes'} into ${folderDisplay}!`,
        'success',
        4000
      );
      handleClose();
    } catch (err: any) {
      console.error('ZIP import error:', err);
      appState.showToast(`Failed to import ZIP archive: ${err.message || err}`, 'error', 5000);
    } finally {
      zipImporting = false;
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
          <span>Paste Code</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'upload'}
          onclick={() => activeTab = 'upload'}
        >
          <FileText size={14} />
          <span>Single File (.md, .html)</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'zip'}
          onclick={() => activeTab = 'zip'}
        >
          <FolderArchive size={14} />
          <span>ZIP Archive (.zip)</span>
        </button>
      </div>

      {#if activeTab === 'zip'}
        <!-- ZIP Archive Tab View -->
        <div class="zip-section flex-col">
          {#if !zipInspection && !zipLoading}
            <!-- ZIP Drop Zone -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="drop-zone flex-col zip-drop-zone"
              class:dragging={isDragging}
              onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') zipInputRef?.click(); }}
              onclick={() => zipInputRef?.click()}
              ondragover={handleDragOver}
              ondragleave={handleDragLeave}
              ondrop={handleDrop}
              role="button"
              tabindex="0"
              aria-label="Upload ZIP archive"
            >
              <input
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                class="hidden-file-input"
                bind:this={zipInputRef}
                onchange={handleZipFileChange}
              />
              <div class="drop-zone-content flex-col">
                <FolderArchive size={38} class="drop-icon zip-icon" />
                <span class="drop-main">Click or Drag & Drop .zip Archive here</span>
                <span class="drop-sub">Extracts all nested .md files directly into a targeted folder as flat notes</span>
              </div>
            </div>
          {:else if zipLoading}
            <div class="zip-loading-card flex-col">
              <LoaderCircle size={28} class="spin-icon" style="color: var(--accent);" />
              <span class="zip-loading-text">Analyzing ZIP archive...</span>
              <span class="zip-loading-sub">Searching for all Markdown (.md) documents</span>
            </div>
          {:else if zipInspection}
            <div class="zip-details-card flex-col">
              <!-- Archive Header Bar -->
              <div class="zip-header-bar flex-row">
                <div class="flex-row" style="gap: var(--spacing-xs); flex-grow: 1; min-width: 0;">
                  <FolderArchive size={20} style="color: var(--accent); flex-shrink: 0;" />
                  <div class="flex-col" style="min-width: 0; align-items: flex-start;">
                    <span class="zip-filename" title={zipInspection.zipName}>{zipInspection.zipName}</span>
                    <span class="zip-stat-sub">
                      {zipInspection.totalEntries} total {zipInspection.totalEntries === 1 ? 'entry' : 'entries'} in archive · <strong>{zipInspection.mdFiles.length} Markdown {zipInspection.mdFiles.length === 1 ? 'file' : 'files'} found</strong>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  class="btn-pill btn-pill-outline small flex-row"
                  onclick={() => { selectedZipFile = null; zipInspection = null; }}
                  disabled={zipImporting}
                >
                  Change ZIP
                </button>
              </div>

              {#if zipInspection.mdFiles.length === 0}
                <div class="empty-zip-warning flex-row">
                  <AlertCircle size={18} style="color: var(--semantic-warning, #ffa42b); flex-shrink: 0;" />
                  <span>No <code>.md</code> or <code>.markdown</code> files found in this archive. Please select a different zip file.</span>
                </div>
              {:else}
                <!-- Target Folder Selector -->
                <div class="target-folder-group flex-col">
                  <div class="input-label flex-row" style="justify-content: space-between; width: 100%;">
                    <span>Target Folder (Notebook)</span>
                    <span class="target-badge">Flat Output Mode</span>
                  </div>
                  <div class="flex-row" style="gap: var(--spacing-xs); width: 100%;">
                    <select
                      id="zip-folder-select"
                      class="styled-select"
                      bind:value={selectedTargetFolder}
                      onchange={() => { if (selectedTargetFolder !== '__new__') isCreatingNewFolder = false; else isCreatingNewFolder = true; }}
                      disabled={zipImporting}
                    >
                      <option value="">📁 Root (Top-level / No Folder)</option>
                      {#each appState.notebooks as nb}
                        <option value={nb}>📁 {nb}</option>
                      {/each}
                      <option value="__new__">➕ Create New Folder...</option>
                    </select>
                  </div>

                  {#if isCreatingNewFolder || selectedTargetFolder === '__new__'}
                    <div class="new-folder-input-row flex-row" style="margin-top: var(--spacing-xs); width: 100%;">
                      <input
                        type="text"
                        class="styled-text-input"
                        placeholder="Enter new folder name (e.g. Imported Notes)..."
                        bind:value={newFolderName}
                        disabled={zipImporting}
                      />
                    </div>
                  {/if}
                </div>

                <!-- Flattening Guarantee Notice -->
                <div class="flat-guarantee-banner flex-row">
                  <span class="guarantee-icon">⚡</span>
                  <div class="flex-col" style="align-items: flex-start; gap: 2px;">
                    <span class="guarantee-title">Flat Organization Guarantee</span>
                    <span class="guarantee-desc">
                      Even if files are nested in folders inside the zip, all {zipInspection.mdFiles.length} notes will be placed directly in 
                      <strong>{isCreatingNewFolder ? (newFolderName.trim() || 'New Folder') : (selectedTargetFolder || 'Root Workspace')}</strong>. No subfolders will ever be created.
                    </span>
                  </div>
                </div>

                <!-- File List Preview -->
                <div class="zip-files-preview flex-col">
                  <div class="preview-files-header flex-row" style="justify-content: space-between;">
                    <span>Markdown Files Found ({zipInspection.mdFiles.length})</span>
                    <span style="font-size: 10px; color: var(--text-tertiary);">All will be saved flat</span>
                  </div>
                  <div class="zip-files-scroll">
                    {#each zipInspection.mdFiles as file}
                      <div class="zip-file-item flex-row">
                        <FileText size={13} class="zip-item-icon" />
                        <div class="flex-col" style="align-items: flex-start; min-width: 0; flex-grow: 1; gap: 1px;">
                          <span class="zip-item-title">{file.title}.html</span>
                          {#if file.originalPath !== file.filename}
                            <span class="zip-item-path" title={file.originalPath}>zip path: {file.originalPath}</span>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>

                <!-- Progress Bar (while importing) -->
                {#if zipImporting}
                  <div class="import-progress-card flex-col">
                    <div class="flex-row" style="justify-content: space-between; font-size: var(--font-size-xs); color: var(--text-secondary);">
                      <span>Importing flat notes...</span>
                      <span>{zipProgress.current} / {zipProgress.total}</span>
                    </div>
                    <div class="progress-bar-track">
                      <div
                        class="progress-bar-fill"
                        style="width: {zipProgress.total > 0 ? (zipProgress.current / zipProgress.total) * 100 : 0}%;"
                      ></div>
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <!-- Main Input Section for Paste / Single File Upload -->
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
                accept=".md,.html,.htm,.mf,.zip,application/zip"
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
                  <span class="drop-sub">Accepts files ending with .md, .html, .htm, .mf, or .zip archive</span>
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
      {/if}

      <!-- Action Panel Buttons -->
      <div class="modal-action-row flex-row">
        {#if activeTab === 'zip'}
          <div style="flex-grow: 1;"></div>
          <button
            type="button"
            class="btn-pill btn-pill-outline"
            style="border-color: var(--border-color); color: var(--text-secondary);"
            onclick={handleClose}
            disabled={zipImporting}
          >
            Cancel
          </button>
          {#if zipInspection && zipInspection.mdFiles.length > 0}
            <button
              type="button"
              class="btn-pill btn-pill-primary flex-row"
              onclick={handleImportZip}
              disabled={zipImporting || (isCreatingNewFolder && !newFolderName.trim())}
              title="Import all extracted markdown notes"
            >
              {#if zipImporting}
                <LoaderCircle size={14} class="spin-icon" />
                <span>Importing ({zipProgress.current}/{zipProgress.total})...</span>
              {:else}
                <Plus size={14} />
                <span>Import {zipInspection.mdFiles.length} {zipInspection.mdFiles.length === 1 ? 'Note' : 'Notes'}</span>
              {/if}
            </button>
          {/if}
        {:else if inputText.trim()}
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

  .styled-select {
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
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .styled-select:focus {
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

  /* ZIP Section Styles */
  .zip-section {
    gap: var(--spacing-sm);
    margin-top: 4px;
  }

  .zip-drop-zone {
    padding: var(--spacing-2xl) var(--spacing-lg);
  }

  .zip-icon {
    color: var(--accent);
  }

  .zip-loading-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    background-color: var(--bg-mid-dark, #1f1f1f);
    padding: var(--spacing-xl);
    align-items: center;
    gap: var(--spacing-xs);
  }

  .zip-loading-text {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .zip-loading-sub {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .zip-details-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    background-color: var(--bg-mid-dark, #1f1f1f);
    padding: var(--spacing-md);
    gap: var(--spacing-sm);
  }

  .zip-header-bar {
    justify-content: space-between;
    padding-bottom: var(--spacing-xs);
    border-bottom: 1px solid var(--border-color);
  }

  .zip-filename {
    font-weight: 700;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .zip-stat-sub {
    font-size: var(--font-size-2xs);
    color: var(--text-secondary);
  }

  .empty-zip-warning {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: color-mix(in srgb, var(--semantic-warning, #ffa42b) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--semantic-warning, #ffa42b) 25%, transparent);
    border-radius: var(--radius-standard);
    gap: var(--spacing-xs);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
  }

  .target-folder-group {
    gap: 6px;
    align-items: flex-start;
  }

  .target-badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
  }

  .flat-guarantee-banner {
    background: color-mix(in srgb, var(--semantic-info, #539df5) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--semantic-info, #539df5) 28%, transparent);
    border-radius: var(--radius-standard);
    padding: var(--spacing-xs) var(--spacing-sm);
    gap: var(--spacing-sm);
    align-items: flex-start;
  }

  .guarantee-icon {
    font-size: 16px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .guarantee-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--semantic-info, #539df5);
  }

  .guarantee-desc {
    font-size: var(--font-size-2xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .zip-files-preview {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    background-color: var(--bg-surface, #121212);
    overflow: hidden;
  }

  .preview-files-header {
    padding: 6px var(--spacing-sm);
    background-color: rgba(255, 255, 255, 0.03);
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-color);
  }

  .zip-files-scroll {
    max-height: 140px;
    overflow-y: auto;
    padding: var(--spacing-2xs) var(--spacing-xs);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .zip-file-item {
    padding: 4px var(--spacing-2xs);
    border-radius: var(--radius-subtle, 4px);
    gap: var(--spacing-xs);
    font-size: var(--font-size-xs);
    align-items: flex-start;
  }

  .zip-file-item:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  .zip-item-icon {
    color: var(--accent);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .zip-item-title {
    color: var(--text-primary);
    font-weight: 600;
    font-size: var(--font-size-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .zip-item-path {
    font-size: 10px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-progress-card {
    gap: 6px;
    margin-top: 4px;
    padding: var(--spacing-xs);
    background-color: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-standard);
  }

  .progress-bar-track {
    width: 100%;
    height: 6px;
    background-color: var(--bg-mid-dark, #1f1f1f);
    border-radius: 9999px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background-color: var(--accent);
    transition: width 0.15s ease;
  }

  .spin-icon {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
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

  .btn-pill.small {
    padding: 4px 10px;
    height: 28px;
    font-size: var(--font-size-xs);
  }

  .btn-pill-primary {
    background-color: var(--accent);
    border: none;
    color: #000000;
  }

  .btn-pill-primary:hover:not(:disabled) {
    transform: scale(1.02);
    filter: brightness(1.05);
  }

  .btn-pill-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-pill-outline {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .btn-pill-outline:hover:not(:disabled) {
    border-color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .btn-pill-outline:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
