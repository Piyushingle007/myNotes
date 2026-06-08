<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { Folder, Plus, Trash2, Tag, Settings, Library, Moon, Sun, FolderOpen } from 'lucide-svelte';

  let newNotebookName = $state('');
  let showCreateInput = $state(false);

  function selectNotebook(notebook: string | null) {
    appState.activeNotebook = notebook;
    appState.activeTag = null;
  }

  function selectTag(tag: string | null) {
    appState.activeTag = tag;
    appState.activeNotebook = null;
  }

  async function handleCreateNotebook(e: SubmitEvent) {
    e.preventDefault();
    if (!newNotebookName.trim()) return;
    await appState.createNotebook(newNotebookName);
    newNotebookName = '';
    showCreateInput = false;
  }

  async function handleDeleteNotebook(notebook: string, event: Event) {
    event.stopPropagation();
    if (confirm(`Are you sure you want to delete folder "${notebook}" and all its notes?`)) {
      await appState.deleteNotebook(notebook);
    }
  }

  function toggleTheme() {
    appState.theme = appState.theme === 'dark' ? 'black' : 'dark';
    const root = document.documentElement;
    if (appState.theme === 'black') {
      root.style.setProperty('--bg-base', '#000000');
      root.style.setProperty('--bg-surface', '#0a0a0a');
      root.style.setProperty('--bg-mid-dark', '#121212');
    } else {
      root.style.setProperty('--bg-base', '#121212');
      root.style.setProperty('--bg-surface', '#181818');
      root.style.setProperty('--bg-mid-dark', '#1f1f1f');
    }
  }
</script>

<div class="sidebar flex-col">
  <!-- Logo Section -->
  <div class="logo-section flex-row">
    <div class="logo-icon">🎵</div>
    <span class="logo-text">myNotes</span>
  </div>

  <!-- Main Library Section -->
  <div class="section-container flex-col">
    <div class="section-header flex-row">
      <Library size={18} class="sec-icon" />
      <span class="section-title">Notebooks</span>
      <button class="add-btn flex-row" onclick={() => showCreateInput = !showCreateInput} aria-label="Add notebook">
        <Plus size={16} />
      </button>
    </div>

    {#if showCreateInput}
      <form onsubmit={handleCreateNotebook} class="create-form">
        <input 
          type="text" 
          placeholder="New Notebook..." 
          bind:value={newNotebookName}
          class="create-input"
          required
          autofocus
        />
      </form>
    {/if}

    <div class="list-scroll">
      <div 
        class="nav-item flex-row" 
        class:active={appState.activeNotebook === null && appState.activeTag === null}
        role="button"
        tabindex="0"
        onclick={() => selectNotebook(null)}
        onkeydown={(e) => e.key === 'Enter' && selectNotebook(null)}
      >
        <div class="playlist-art">⭐</div>
        <div class="nav-text flex-col">
          <span class="title">All Notes</span>
          <span class="subtitle">{appState.notes.length} notes</span>
        </div>
      </div>

      {#each appState.notebooks as notebook}
        <div 
          class="nav-item flex-row" 
          class:active={appState.activeNotebook === notebook}
          role="button"
          tabindex="0"
          onclick={() => selectNotebook(notebook)}
          onkeydown={(e) => e.key === 'Enter' && selectNotebook(notebook)}
        >
          <div class="playlist-art">📂</div>
          <div class="nav-text flex-col">
            <span class="title">{notebook}</span>
            <span class="subtitle">Notebook</span>
          </div>
          <button 
            class="item-delete-btn" 
            onclick={(e) => handleDeleteNotebook(notebook, e)}
            aria-label="Delete notebook"
          >
            <Trash2 size={14} />
          </button>
        </div>
      {/each}
    </div>
  </div>

  <!-- Tags Section -->
  <div class="section-container flex-col tags-container">
    <div class="section-header flex-row">
      <Tag size={18} class="sec-icon" />
      <span class="section-title">Tags</span>
    </div>
    
    <div class="list-scroll tag-grid">
      {#each appState.tags as [tag, count]}
        <button 
          class="tag-chip" 
          class:active={appState.activeTag === tag}
          onclick={() => selectTag(tag)}
        >
          #{tag} <span class="tag-count">({count})</span>
        </button>
      {/each}
      {#if appState.tags.length === 0}
        <span class="empty-text">No tags found in notes</span>
      {/if}
    </div>
  </div>

  <!-- Footer Actions -->
  <div class="footer-actions flex-col">
    <button class="footer-btn flex-row" onclick={appState.openDirectory.bind(appState)}>
      <FolderOpen size={16} />
      <span>Open Local Directory</span>
    </button>
    
    <button class="footer-btn flex-row" onclick={toggleTheme}>
      {#if appState.theme === 'dark'}
        <Moon size={16} />
        <span>Amoled Black Theme</span>
      {:else}
        <Sun size={16} />
        <span>Standard Dark Theme</span>
      {/if}
    </button>

    <button class="footer-btn flex-row" onclick={() => appState.showSettings = true}>
      <Settings size={16} />
      <span>Google Drive Sync</span>
    </button>

    <div class="vault-info flex-col">
      <span class="info-label">Active Directory</span>
      <span class="info-value">{appState.vaultName || 'Unknown'}</span>
    </div>
  </div>
</div>

<style>
  .sidebar {
    width: 260px;
    background-color: #000000;
    height: 100%;
    padding: 16px 8px;
    gap: 12px;
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

  .logo-section {
    padding: 8px 16px 16px;
    gap: 12px;
  }

  .logo-icon {
    font-size: 24px;
  }

  .logo-text {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }

  .section-container {
    background-color: var(--bg-surface);
    border-radius: var(--radius-comfortable);
    padding: 12px;
    flex: 1.2;
    overflow: hidden;
  }

  .tags-container {
    flex: 0.8;
  }

  .section-header {
    justify-content: space-between;
    padding: 4px 8px 12px;
    color: var(--text-secondary);
  }

  .sec-icon {
    margin-right: 8px;
  }

  .section-title {
    font-weight: 700;
    font-size: 14px;
    flex-grow: 1;
  }

  .add-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    justify-content: center;
    color: var(--text-secondary);
    transition: background-color 0.2s, color 0.2s;
  }

  .add-btn:hover {
    background-color: var(--bg-mid-dark);
    color: var(--text-primary);
  }

  .create-form {
    padding: 0 8px 8px;
  }

  .create-input {
    background-color: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    padding: 8px 12px;
    width: 100%;
    border-radius: var(--radius-subtle);
    font-size: 13px;
    color: var(--text-primary);
  }

  .create-input:focus {
    border-color: var(--accent);
  }

  .list-scroll {
    overflow-y: auto;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nav-item {
    padding: 8px;
    border-radius: var(--radius-standard);
    gap: 12px;
    text-align: left;
    width: 100%;
    transition: background-color 0.2s;
    position: relative;
  }

  .nav-item:hover {
    background-color: var(--bg-mid-dark);
  }

  .nav-item.active {
    background-color: rgba(255, 255, 255, 0.08);
  }

  .playlist-art {
    width: 44px;
    height: 44px;
    background-color: #282828;
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
  }

  .nav-text {
    flex-grow: 1;
    overflow: hidden;
  }

  .nav-text .title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-text .subtitle {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .item-delete-btn {
    opacity: 0;
    transition: opacity 0.2s, color 0.2s;
    color: var(--text-secondary);
    padding: 4px;
    border-radius: 4px;
    position: absolute;
    right: 8px;
  }

  .nav-item:hover .item-delete-btn {
    opacity: 1;
  }

  .item-delete-btn:hover {
    color: var(--semantic-error);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .tag-grid {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    align-content: flex-start;
  }

  .tag-chip {
    background-color: var(--bg-mid-dark);
    padding: 6px 10px;
    border-radius: var(--radius-full-pill);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    transition: background-color 0.2s, color 0.2s;
  }

  .tag-chip:hover {
    background-color: var(--bg-card-hover);
    color: var(--text-primary);
  }

  .tag-chip.active {
    background-color: var(--accent);
    color: #000000;
    font-weight: 600;
  }

  .tag-count {
    font-size: 10px;
    opacity: 0.8;
  }

  .empty-text {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 8px;
  }

  .footer-actions {
    gap: 8px;
    padding: 8px;
    border-top: 1px solid var(--border-color);
  }

  .footer-btn {
    padding: 8px 12px;
    border-radius: var(--radius-pill);
    gap: 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    transition: background-color 0.2s, color 0.2s;
    width: 100%;
    text-align: left;
    justify-content: flex-start;
  }

  .footer-btn:hover {
    background-color: var(--bg-surface);
    color: var(--text-primary);
  }

  .vault-info {
    padding: 12px 12px 4px;
    gap: 2px;
    border-top: 1px dashed var(--border-color);
    margin-top: 4px;
  }

  .info-label {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .info-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
