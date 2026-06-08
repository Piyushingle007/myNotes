<script lang="ts">
  import { appState } from '../stores/appState.svelte';

  // Local state for layout and sorting
  let viewMode = $state<'grid' | 'list' | 'compact'>('grid');
  let sortBy = $state<'name' | 'modified' | 'size'>('modified');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  let searchVal = $state<string>('');

  // Bulk actions selection
  let selectedPaths = $state<string[]>([]);
  let showBulkBar = $derived(selectedPaths.length > 0);

  // Sync search query
  $effect(() => {
    appState.searchQuery = searchVal;
  });

  // Derived: Current folder structure navigation
  // We determine what folders and files are at the CURRENT level (based on appState.activeNotebook)
  const currentFolder = $derived(appState.activeNotebook);

  const breadcrumbs = $derived.by(() => {
    if (!currentFolder) return [{ name: 'Root', path: null }];
    const parts = currentFolder.split('/');
    const list: Array<{ name: string; path: string | null }> = [{ name: 'Root', path: null }];
    let accum = '';
    parts.forEach(p => {
      accum = accum ? `${accum}/${p}` : p;
      list.push({ name: p, path: accum });
    });
    return list;
  });

  // Child folders and files at the current level
  const contents = $derived.by(() => {
    const folders = new Set<string>();
    const files: typeof appState.notes = [];

    // Filter notes based on tag/search, or just path if not searching
    let notesToPartition = appState.notes;
    
    // If not searching, restrict to current folder level
    if (!searchVal.trim() && !appState.activeTag) {
      notesToPartition = notesToPartition.filter(n => {
        if (!currentFolder) {
          return !n.path.includes('/');
        } else {
          // Note must be inside currentFolder and not in a sub-subfolder
          const prefix = `${currentFolder}/`;
          if (!n.path.startsWith(prefix)) return false;
          const relative = n.path.substring(prefix.length);
          return !relative.includes('/');
        }
      });

      // Find subfolders at current level
      appState.notes.forEach(n => {
        if (!currentFolder) {
          if (n.path.includes('/')) {
            folders.add(n.path.split('/')[0]);
          }
        } else {
          const prefix = `${currentFolder}/`;
          if (n.path.startsWith(prefix)) {
            const relative = n.path.substring(prefix.length);
            if (relative.includes('/')) {
              folders.add(`${currentFolder}/${relative.split('/')[0]}`);
            }
          }
        }
      });
    } else {
      // Searching or filtering by tag: show flattened filtered list of files
      files.push(...appState.filteredNotes);
    }

    if (!searchVal.trim() && !appState.activeTag) {
      files.push(...notesToPartition);
    }

    // Sort files
    const sortedFiles = [...files].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'modified') {
        comparison = a.modified - b.modified;
      } else if (sortBy === 'size') {
        comparison = a.size - b.size;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return {
      subfolders: Array.from(folders).sort(),
      files: sortedFiles
    };
  });

  // Folder management
  function enterFolder(path: string | null) {
    appState.activeNotebook = path;
    selectedPaths = []; // reset bulk selection
  }

  function handleCreateFolder() {
    const name = prompt('Enter folder name:');
    if (name && name.trim()) {
      const folderPath = currentFolder ? `${currentFolder}/${name.trim()}` : name.trim();
      appState.createNotebook(folderPath);
    }
  }

  function handleCreateNote() {
    const name = prompt('Enter note title:', 'Untitled Note');
    if (name && name.trim()) {
      appState.createNote(name.trim(), currentFolder);
    }
  }

  // Selection helpers
  function toggleSelectAll(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      selectedPaths = contents.files.map(f => f.path);
    } else {
      selectedPaths = [];
    }
  }

  function toggleSelect(path: string) {
    if (selectedPaths.includes(path)) {
      selectedPaths = selectedPaths.filter(p => p !== path);
    } else {
      selectedPaths = [...selectedPaths, path];
    }
  }

  // Bulk operations
  async function handleBulkDelete() {
    if (confirm(`Are you sure you want to delete ${selectedPaths.length} notes?`)) {
      const pathsToDelete = [...selectedPaths];
      selectedPaths = [];
      for (const p of pathsToDelete) {
        await appState.deleteNote(p);
      }
    }
  }

  async function handleBulkAddTag() {
    const tag = prompt('Enter tag to add (e.g. work, ideas):');
    if (tag && tag.trim()) {
      const cleanTag = tag.trim().replace(/^#/, '').toLowerCase();
      const pathsToTag = [...selectedPaths];
      selectedPaths = [];
      for (const p of pathsToTag) {
        const note = appState.notes.find(n => n.path === p);
        if (note) {
          appState.activeNotePath = note.path;
          appState.activeNoteContent = note.content + `\n\n#${cleanTag}`;
          await appState.saveActiveNote(true);
        }
      }
      appState.activeNotePath = null;
      appState.activeNoteContent = '';
      appState.activeNoteTitle = '';
    }
  }

  // Formatting helpers
  function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatSize(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
</script>

<div class="documents-container">
  <!-- Top Search & Actions Bar -->
  <div class="search-actions-bar">
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input 
        type="text" 
        placeholder="Search documents by name, content, or #tag..." 
        bind:value={searchVal}
        class="search-input"
      />
      {#if searchVal}
        <button class="clear-btn" onclick={() => searchVal = ''}>×</button>
      {/if}
    </div>

    <div class="action-buttons">
      <button class="md3-btn" onclick={handleCreateNote}>
        <span>+</span> New Note
      </button>
      <button class="md3-btn md3-btn-tonal" onclick={handleCreateFolder}>
        <span>📁</span> New Folder
      </button>
    </div>
  </div>

  <!-- Breadcrumbs & Directory Path -->
  <div class="breadcrumbs-row">
    <div class="breadcrumbs">
      {#each breadcrumbs as crub, idx}
        {#if idx > 0}<span class="divider">/</span>{/if}
        <button 
          class="crumb-btn" 
          class:active={currentFolder === crub.path}
          onclick={() => enterFolder(crub.path)}
        >
          {crub.name}
        </button>
      {/each}
    </div>

    <!-- Toggles (View & Sort) -->
    <div class="view-toggles">
      <!-- Sort dropdowns -->
      <div class="sort-selector">
        <select bind:value={sortBy} class="sort-select">
          <option value="name">Name</option>
          <option value="modified">Date Modified</option>
          <option value="size">Size</option>
        </select>
        <button 
          class="sort-order-btn" 
          onclick={() => sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'}
          title={sortOrder === 'asc' ? 'Sort Ascending' : 'Sort Descending'}
        >
          {sortOrder === 'asc' ? '▲' : '▼'}
        </button>
      </div>

      <!-- View Mode Buttons -->
      <div class="view-mode-buttons">
        <button 
          class="mode-btn" 
          class:active={viewMode === 'grid'} 
          onclick={() => viewMode = 'grid'}
          title="Grid View"
        >
          🎛️
        </button>
        <button 
          class="mode-btn" 
          class:active={viewMode === 'list'} 
          onclick={() => viewMode = 'list'}
          title="List View"
        >
          📄
        </button>
        <button 
          class="mode-btn" 
          class:active={viewMode === 'compact'} 
          onclick={() => viewMode = 'compact'}
          title="Compact View"
        >
          ☰
        </button>
      </div>
    </div>
  </div>

  <!-- Tag Filter row -->
  {#if appState.activeTag}
    <div class="tag-filter-indicator">
      <span class="md3-label-medium">Filtering by tag:</span>
      <span class="tag-chip">
        #{appState.activeTag}
        <button class="remove-tag" onclick={() => appState.activeTag = null}>×</button>
      </span>
    </div>
  {/if}

  <!-- Directory Canvas -->
  <div class="canvas-scroll">
    <!-- Subfolders Grid -->
    {#if contents.subfolders.length > 0 && !searchVal.trim() && !appState.activeTag}
      <div class="folders-block">
        <h4 class="block-title">Folders</h4>
        <div class="folders-grid">
          {#each contents.subfolders as folder}
            <div class="md3-card-filled folder-card" onclick={() => enterFolder(folder)}>
              <span class="folder-icon">📁</span>
              <span class="folder-name">{folder.split('/').pop()}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Files Block -->
    <div class="files-block">
      <div class="files-header">
        <h4 class="block-title">Documents</h4>
        {#if contents.files.length > 0}
          <div class="select-all-row">
            <input 
              type="checkbox" 
              id="select-all" 
              checked={contents.files.length > 0 && selectedPaths.length === contents.files.length}
              onchange={toggleSelectAll}
            />
            <label for="select-all" class="md3-label-medium">Select All</label>
          </div>
        {/if}
      </div>

      {#if contents.files.length === 0}
        <div class="md3-card-outlined empty-state">
          <span class="empty-icon">📂</span>
          <p class="empty-title">This folder is empty</p>
          <p class="empty-subtitle">Create a new note or folder to start organizing.</p>
        </div>
      {:else if viewMode === 'grid'}
        <!-- Grid Mode -->
        <div class="files-grid">
          {#each contents.files as file (file.path)}
            <div 
              class="md3-card-outlined file-card" 
              class:selected={selectedPaths.includes(file.path)}
              onclick={() => appState.selectNote(file.path)}
            >
              <div class="card-top" onclick={(e) => { e.stopPropagation(); toggleSelect(file.path); }}>
                <input 
                  type="checkbox" 
                  checked={selectedPaths.includes(file.path)}
                  onchange={() => toggleSelect(file.path)}
                  onclick={(e) => e.stopPropagation()}
                />
                <button 
                  class="pin-indicator" 
                  class:active={appState.pinnedPaths.includes(file.path)}
                  onclick={(e) => { e.stopPropagation(); appState.togglePin(file.path); }}
                >
                  📌
                </button>
              </div>

              <div class="card-body">
                <span class="file-icon">📄</span>
                <span class="file-name" title={file.path}>{file.name.replace(/\.md$/, '')}</span>
                <p class="file-preview">{file.content.substring(0, 80) || 'Empty document...'}</p>
              </div>

              <div class="card-meta">
                <span class="file-size">{formatSize(file.size)}</span>
                <span class="file-date">{formatDate(file.modified)}</span>
              </div>
            </div>
          {/each}
        </div>
      {:else if viewMode === 'list'}
        <!-- List Mode -->
        <div class="files-list">
          {#each contents.files as file (file.path)}
            <div 
              class="list-row md3-card-outlined" 
              class:selected={selectedPaths.includes(file.path)}
              onclick={() => appState.selectNote(file.path)}
            >
              <div class="list-check" onclick={(e) => e.stopPropagation()}>
                <input 
                  type="checkbox" 
                  checked={selectedPaths.includes(file.path)}
                  onchange={() => toggleSelect(file.path)}
                />
              </div>
              <button 
                class="pin-indicator" 
                class:active={appState.pinnedPaths.includes(file.path)}
                onclick={(e) => { e.stopPropagation(); appState.togglePin(file.path); }}
              >
                📌
              </button>
              <span class="file-icon">📄</span>
              <div class="list-details">
                <span class="file-name">{file.name.replace(/\.md$/, '')}</span>
                <span class="file-path">{file.path}</span>
              </div>
              <span class="file-size">{formatSize(file.size)}</span>
              <span class="file-date">{formatDate(file.modified)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <!-- Compact Mode -->
        <div class="files-compact">
          {#each contents.files as file (file.path)}
            <div 
              class="compact-row" 
              class:selected={selectedPaths.includes(file.path)}
              onclick={() => appState.selectNote(file.path)}
            >
              <div class="list-check" onclick={(e) => e.stopPropagation()}>
                <input 
                  type="checkbox" 
                  checked={selectedPaths.includes(file.path)}
                  onchange={() => toggleSelect(file.path)}
                />
              </div>
              <span class="file-name">{file.name.replace(/\.md$/, '')}</span>
              <span class="file-path">{file.path}</span>
              <span class="file-date">{formatDate(file.modified)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Bulk Actions Bar -->
  {#if showBulkBar}
    <div class="bulk-actions-bar md3-card-filled">
      <span class="selected-count">{selectedPaths.length} items selected</span>
      <div class="bulk-buttons">
        <button class="md3-btn md3-btn-tonal" onclick={handleBulkAddTag}>
          🏷️ Add Tag
        </button>
        <button class="md3-btn" style="background-color: var(--semantic-error); color: white;" onclick={handleBulkDelete}>
          🗑️ Delete Selected
        </button>
        <button class="md3-btn md3-btn-outlined" onclick={() => selectedPaths = []}>
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .documents-container {
    padding: 32px;
    display: flex;
    flex-direction: column;
    height: 100%;
    animation: fadeIn 0.3s ease-out;
    position: relative;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Search bar */
  .search-actions-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    margin-bottom: 24px;
    flex-shrink: 0;
  }

  .search-box {
    display: flex;
    align-items: center;
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    padding: 0 16px;
    flex-grow: 1;
    height: 48px;
    max-width: 600px;
    transition: var(--transition-fast);
  }

  .search-box:focus-within {
    border-color: var(--primary);
    background-color: var(--bg-surface);
    box-shadow: var(--shadow-lvl1);
  }

  .search-icon {
    font-size: 16px;
    color: var(--text-tertiary);
    margin-right: 12px;
  }

  .search-input {
    flex-grow: 1;
    font-size: 14px;
    color: var(--text-primary);
  }

  .clear-btn {
    font-size: 20px;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .action-buttons {
    display: flex;
    gap: 12px;
  }

  /* Breadcrumbs */
  .breadcrumbs-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  .crumb-btn {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    transition: var(--transition-fast);
  }

  .crumb-btn:hover {
    color: var(--primary);
  }

  .crumb-btn.active {
    color: var(--text-primary);
    cursor: default;
  }

  .divider {
    color: var(--text-tertiary);
    margin: 0 8px;
  }

  /* Sorting & View Controls */
  .view-toggles {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .sort-selector {
    display: flex;
    align-items: center;
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
    padding: 4px 8px;
  }

  .sort-select {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    background: transparent;
  }

  .sort-order-btn {
    font-size: 10px;
    margin-left: 6px;
    color: var(--text-secondary);
  }

  .view-mode-buttons {
    display: flex;
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
    overflow: hidden;
    padding: 2px;
  }

  .mode-btn {
    width: 32px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-xs);
    font-size: 14px;
    color: var(--text-secondary);
  }

  .mode-btn.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  /* Tag indicator */
  .tag-filter-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background-color: var(--primary-container);
    color: var(--on-primary-container);
    padding: 4px 10px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 700;
  }

  .remove-tag {
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    color: inherit;
  }

  /* Folders Grid */
  .canvas-scroll {
    flex-grow: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .folders-block {
    margin-bottom: 28px;
  }

  .block-title {
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 12px;
  }

  .folders-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }

  .folder-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-radius: var(--radius-m);
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .folder-card:hover {
    background-color: rgba(120, 120, 120, 0.08);
  }

  .folder-icon {
    font-size: 22px;
  }

  .folder-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Files list/grid header */
  .files-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .select-all-row {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .select-all-row input {
    cursor: pointer;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
    color: var(--text-tertiary);
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .empty-subtitle {
    font-size: 13px;
    margin-top: 4px;
  }

  /* Grid layout */
  .files-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 16px;
    padding-bottom: 80px; /* Spacer for bulk actions bar */
  }

  .file-card {
    height: 180px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 16px;
    cursor: pointer;
    position: relative;
  }

  .file-card.selected {
    border-color: var(--primary);
    background-color: rgba(var(--accent-base), 10%, 5%);
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .card-top input {
    cursor: pointer;
  }

  .pin-indicator {
    font-size: 12px;
    opacity: 0.2;
    transition: var(--transition-fast);
  }

  .file-card:hover .pin-indicator, .pin-indicator.active {
    opacity: 1;
  }

  .card-body {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow: hidden;
  }

  .card-body .file-name {
    font-weight: 600;
    font-size: 15px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-preview {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    color: var(--text-tertiary);
    margin-top: 10px;
  }

  /* List layout */
  .files-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 80px;
  }

  .list-row {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    cursor: pointer;
    border-radius: var(--radius-m);
    gap: 16px;
  }

  .list-row.selected {
    border-color: var(--primary);
    background-color: rgba(var(--accent-base), 10%, 5%);
  }

  .list-check input {
    cursor: pointer;
  }

  .list-details {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    overflow: hidden;
  }

  .list-details .file-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
  }

  .list-details .file-path {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .list-row .file-size, .list-row .file-date {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* Compact View */
  .files-compact {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-m);
    overflow: hidden;
    padding-bottom: 0;
    margin-bottom: 80px;
  }

  .compact-row {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    gap: 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-surface);
  }

  .compact-row:last-child {
    border-bottom: none;
  }

  .compact-row.selected {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .compact-row .file-name {
    font-weight: 500;
    font-size: 13px;
    flex-grow: 1;
  }

  .compact-row .file-path {
    font-size: 11px;
    color: var(--text-tertiary);
    width: 30%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compact-row .file-date {
    font-size: 11px;
    color: var(--text-secondary);
  }

  /* Bulk Actions Bar styles */
  .bulk-actions-bar {
    position: absolute;
    bottom: 24px;
    left: 32px;
    right: 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-lvl4);
    z-index: 100;
    animation: slideUp 0.25s cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .selected-count {
    font-weight: 600;
    font-size: 14px;
    color: var(--on-secondary-container);
  }

  .bulk-buttons {
    display: flex;
    gap: 10px;
  }

  @media (max-width: 768px) {
    .documents-container {
      padding: 16px;
    }
    .search-actions-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }
    .search-box {
      max-width: none;
    }
    .action-buttons {
      width: 100%;
    }
    .action-buttons button {
      flex-grow: 1;
    }
    .breadcrumbs-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
    .view-toggles {
      width: 100%;
      justify-content: space-between;
    }
    .bulk-actions-bar {
      left: 16px;
      right: 16px;
      bottom: 16px;
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
      text-align: center;
    }
    .bulk-buttons {
      flex-direction: column;
    }
    .bulk-buttons button {
      width: 100%;
    }
  }
</style>
