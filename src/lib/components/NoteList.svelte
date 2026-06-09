<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { FileText, Plus, Trash2, Search, Clock, CalendarDays, X, Menu } from 'lucide-svelte';

  let searchInput = $state('');
  
  // Set query store reactively when typing
  $effect(() => {
    appState.searchQuery = searchInput;
  });

  function formatModified(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    return new Date(timestamp).toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric' 
    });
  }

  function handleCreateNote() {
    const title = prompt('Enter note title:', 'Untitled Note');
    if (title === null) return; // Cancelled
    appState.createNote(title, appState.activeNotebook);
  }

  async function handleDeleteNote(path: string, event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this note?')) {
      await appState.deleteNote(path);
    }
  }

  function clearFilters() {
    appState.activeNotebook = null;
    searchInput = '';
  }
</script>

<div 
  class="note-list flex-col" 
  style="width: {appState.notelistCollapsed ? 0 : appState.notelistWidth}px; display: {appState.notelistCollapsed ? 'none' : 'flex'}; overflow: hidden; flex-shrink: 0;"
>
  <!-- Top Playlist Header -->
  <div class="list-header flex-col" style="position: relative;">
    <div class="flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
      <div class="flex-row" style="gap: 8px; align-items: center;">
        {#if appState.sidebarCollapsed}
          <button 
            onclick={() => appState.setSidebarCollapsed(false)} 
            title="Expand Sidebar"
            aria-label="Expand sidebar"
            style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
            onmouseover={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
          >
            <Menu size={16} />
          </button>
        {/if}
        <div class="meta-label">
          {#if appState.vaultName}
            DIRECTORY: {appState.vaultName.toUpperCase()}
          {:else}
            NOTEBOOK
          {/if}
        </div>
      </div>
      <button 
        class="close-panel-btn flex-row" 
        onclick={() => appState.setNotelistCollapsed(true)} 
        aria-label="Collapse note list"
        style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;"
        onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
        onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <X size={16} />
      </button>
    </div>
    <h1 class="list-title">
      {#if appState.activeNotebook}
        {appState.activeNotebook}
      {:else if appState.activeNotePath?.startsWith('Daily Notes/')}
        Daily Logs
      {:else}
        All Notes
      {/if}
    </h1>
    
    <div class="header-actions flex-row">
      <span class="count-indicator">
        {appState.filteredNotes.length} notes
        {#if appState.activeNotebook}
          <button class="clear-btn" onclick={clearFilters}>• Clear Filter</button>
        {/if}
        {#if appState.googleConnected && appState.syncEnabled}
          • ☁️ {appState.customDriveFolderName || 'MyNotes'}
        {/if}
      </span>
      
      <div class="flex-row" style="gap: 8px; align-items: center;">
        {#if appState.editorCollapsed}
          <button 
            class="btn-pill btn-pill-outline" 
            style="font-size: 11px; padding: 6px 12px; height: 32px;" 
            onclick={() => appState.setEditorCollapsed(false)}
          >
            Show Editor
          </button>
        {/if}
          <button class="btn-pill btn-pill-primary add-note-btn" onclick={handleCreateNote}>
            <Plus size={16} />
            <span>Add Note</span>
          </button>
      </div>
    </div>
  </div>

  <!-- Search Filter -->
  <div class="search-container flex-row">
    <div class="search-wrapper">
      <Search size={16} class="search-icon" />
      <input 
        type="text" 
        placeholder="Search notes..." 
        bind:value={searchInput}
        class="search-input"
      />
    </div>
  </div>

  <!-- Note Playlist Headers -->
  <div class="playlist-columns flex-row">
    <span class="col-index">#</span>
    <span class="col-title">TITLE</span>
    <span class="col-modified flex-row"><Clock size={14} style="margin-right: 4px;" /> MODIFIED</span>
    <span class="col-actions"></span>
  </div>

  <!-- Notes Grid -->
  <div class="playlist-rows">
    {#each appState.filteredNotes as note, index}
      <div 
        class="note-row flex-row"
        class:active={appState.activeNotePath === note.path}
        role="button"
        tabindex="0"
        onclick={() => appState.selectNote(note.path)}
        onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
      >
        <div class="col-index font-mono">{index + 1}</div>
        
        <div class="col-title flex-row">
          <div class="track-icon">
            <FileText size={18} />
          </div>
          <div class="track-info flex-col">
            <span class="track-name">{note.name}</span>
            {#if note.path.includes('/')}
              <span class="track-folder">{note.path.split('/').slice(0, -1).join(' / ')}</span>
            {/if}
          </div>
        </div>

        <div class="col-modified text-secondary">
          {formatModified(note.modified)}
        </div>

        <div class="col-actions">
            <button 
              class="row-delete-btn" 
              onclick={(e) => handleDeleteNote(note.path, e)}
              aria-label="Delete note"
            >
              <Trash2 size={16} />
            </button>
        </div>
      </div>
    {:else}
      <div class="empty-state flex-col">
        <span class="empty-icon">📄</span>
        <span class="empty-title">Your library is empty</span>
        <span class="empty-subtitle">Click "Add Note" to write your first note.</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .note-list {
    background-color: var(--bg-base);
    height: 100%;
    padding: 20px 12px 12px;
    border-right: 1px solid var(--border-color);
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

  .list-header {
    gap: 4px;
    margin-bottom: 16px;
    padding: 0 4px;
  }

  .meta-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.8px;
  }

  .list-title {
    font-size: 28px;
    font-weight: 850;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.5px;
  }

  .header-actions {
    justify-content: space-between;
    margin-top: 8px;
  }

  .count-indicator {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .clear-btn {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
    margin-left: 6px;
    transition: opacity 0.2s;
  }

  .clear-btn:hover {
    text-decoration: underline;
  }

  .add-note-btn {
    font-size: 11px;
    padding: 6px 12px;
  }

  .search-container {
    padding: 0 4px;
    margin-bottom: 16px;
  }

  .search-wrapper {
    position: relative;
    width: 100%;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-secondary);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    background-color: var(--bg-surface);
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    padding: 8px 12px 8px 38px;
    font-size: 13px;
    color: var(--text-primary);
    transition: all 0.2s;
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-input:focus {
    background-color: var(--bg-mid-dark);
    border-color: var(--border-highlight);
  }

  .playlist-columns {
    border-bottom: 1px solid var(--border-color);
    padding: 0 12px 8px;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.8px;
  }

  .col-index {
    width: 24px;
    text-align: right;
    margin-right: 12px;
    flex-shrink: 0;
  }

  .col-title {
    flex-grow: 1;
    overflow: hidden;
    gap: 12px;
  }

  .col-modified {
    width: 70px;
    text-align: right;
    flex-shrink: 0;
    justify-content: flex-end;
  }

  .col-actions {
    width: 28px;
    flex-shrink: 0;
  }

  .playlist-rows {
    overflow-y: auto;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    padding-top: 8px;
    gap: 2px;
  }

  .note-row {
    padding: 8px 12px;
    border-radius: var(--radius-standard);
    width: 100%;
    text-align: left;
    transition: background-color 0.2s;
  }

  .note-row:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .note-row.active {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .note-row.active .track-name {
    color: var(--accent);
  }

  .track-icon {
    width: 32px;
    height: 32px;
    background-color: var(--bg-surface);
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .note-row:hover .track-icon {
    background-color: var(--bg-mid-dark);
    color: var(--text-primary);
  }

  .track-info {
    overflow: hidden;
  }

  .track-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-folder {
    font-size: 10px;
    color: var(--text-secondary);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-modified {
    font-size: 12px;
    white-space: nowrap;
  }

  .row-delete-btn {
    opacity: 0;
    color: var(--text-secondary);
    transition: opacity 0.2s, color 0.2s;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .note-row:hover .row-delete-btn {
    opacity: 1;
  }

  .row-delete-btn:hover {
    color: var(--semantic-error);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .empty-state {
    align-items: center;
    justify-content: center;
    flex-grow: 1;
    padding: 40px 16px;
    text-align: center;
    gap: 8px;
  }

  .empty-icon {
    font-size: 40px;
    margin-bottom: 8px;
    opacity: 0.5;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .empty-subtitle {
    font-size: 12px;
    color: var(--text-secondary);
    max-width: 200px;
  }
</style>
