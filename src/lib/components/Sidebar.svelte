<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { Folder, Plus, Trash2, Calendar, Settings, Library, Palette, FolderOpen, X, ChevronRight, FileText } from 'lucide-svelte';
  import GoogleLogo from './GoogleLogo.svelte';

  let newNotebookName = $state('');
  let showCreateInput = $state(false);

  function selectNotebook(notebook: string | null) {
    appState.activeNotebook = notebook;
  }

  async function handleDesktopDailyNote() {
    const today = new Date().toISOString().split('T')[0];
    const dailyPath = `Daily Notes/${today}.md`;
    
    // Check if it already exists
    const existing = appState.notes.find(n => n.path === dailyPath);
    if (existing) {
      appState.selectNote(existing.path);
    } else {
      await appState.storage.createDirectory('Daily Notes');
      await appState.storage.writeNote(dailyPath, `# Daily Log: ${today} 🗓️\n\n- Write daily highlights here...\n\n#journal`);
      await appState.refreshNotes();
      appState.selectNote(dailyPath);
    }
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
    const themeIds = appState.themes.map(t => t.id);
    const currentIndex = themeIds.indexOf(appState.theme);
    const nextIndex = (currentIndex + 1) % themeIds.length;
    appState.setTheme(themeIds[nextIndex]);
  }
</script>

<div 
  class="sidebar flex-col" 
  style="width: {appState.sidebarCollapsed ? 0 : appState.sidebarWidth}px; display: {appState.sidebarCollapsed ? 'none' : 'flex'}; overflow: hidden; flex-shrink: 0;"
>
  <!-- Logo Section -->
  <div class="logo-section flex-row" style="justify-content: space-between; width: 100%;">
    <div class="flex-row" style="gap: 12px;">
      <GoogleLogo size={24} />
      <span class="logo-text">MyNotes</span>
    </div>
    <div class="flex-row" style="gap: 8px; align-items: center;">
      {#if appState.notelistCollapsed}
        <button 
          onclick={() => appState.setNotelistCollapsed(false)} 
          title="Expand Note List"
          aria-label="Expand note list"
          style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
          onmouseover={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        >
          <FileText size={16} />
        </button>
      {/if}
      {#if appState.editorCollapsed}
        <button 
          onclick={() => appState.setEditorCollapsed(false)} 
          title="Expand Editor"
          aria-label="Expand editor"
          style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
          onmouseover={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        >
          <ChevronRight size={16} />
        </button>
      {/if}
      <button 
        class="close-panel-btn flex-row" 
        onclick={() => appState.setSidebarCollapsed(true)} 
        aria-label="Collapse sidebar"
        style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;"
        onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
        onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <X size={16} />
      </button>
    </div>
  </div>

  <!-- Favorites Section -->
  <div class="section-container flex-col starred-container" style="flex: 0.6; margin-bottom: 12px; max-height: 200px;">
    <div class="section-header flex-row">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="sec-icon" style="color: var(--accent); margin-right: 8px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
      <span class="section-title">Favorites</span>
    </div>
    
    <div class="list-scroll">
      {#each appState.notes.filter(n => appState.favorites.includes(n.path)) as note}
        <div 
          class="nav-item flex-row" 
          class:active={appState.activeNotePath === note.path}
          role="button"
          tabindex="0"
          onclick={() => appState.selectNote(note.path)}
          onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
          style="padding: 6px 8px; gap: 8px;"
        >
          <div class="playlist-art" style="width: 28px; height: 28px; font-size: 14px;">⭐</div>
          <div class="nav-text flex-col">
            <span class="title" style="font-size: 12px;">{note.name}</span>
          </div>
        </div>
      {:else}
        <span class="empty-text">No favorite notes</span>
      {/each}
    </div>
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
        class:active={appState.activeNotebook === null && !appState.activeNotePath?.startsWith('Daily Notes/')}
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

  <!-- Daily Logs Section -->
  <div class="section-container flex-col daily-container">
    <div class="section-header flex-row">
      <Calendar size={18} class="sec-icon" />
      <span class="section-title">Daily Logs</span>
      <button class="add-btn flex-row" onclick={handleDesktopDailyNote} aria-label="Create/Open today's note">
        <Plus size={16} />
      </button>
    </div>
    
    <div class="list-scroll">
      {#each appState.notes.filter(n => n.path.startsWith('Daily Notes/')).sort((a, b) => (b.name || '').localeCompare(a.name || '')) as note}
        <div 
          class="nav-item flex-row" 
          class:active={appState.activeNotePath === note.path}
          role="button"
          tabindex="0"
          onclick={() => appState.selectNote(note.path)}
          onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
          style="padding: 6px 8px; gap: 8px;"
        >
          <div class="playlist-art" style="width: 28px; height: 28px; font-size: 14px;">🗓️</div>
          <div class="nav-text flex-col">
            <span class="title" style="font-size: 12px;">{note.name}</span>
          </div>
          <button 
            class="item-delete-btn" 
            onclick={(e) => { e.stopPropagation(); if (confirm('Delete this daily log?')) appState.deleteNote(note.path); }}
            aria-label="Delete daily note"
            style="right: 4px;"
          >
            <Trash2 size={12} />
          </button>
        </div>
      {:else}
        <span class="empty-text">No daily logs found</span>
      {/each}
    </div>
  </div>

  <!-- Footer Actions -->
  <div class="footer-actions flex-col">
    <button class="footer-btn flex-row" onclick={appState.openDirectory.bind(appState)}>
      <FolderOpen size={16} />
      <span>Open Local Directory</span>
    </button>
    
    <button class="footer-btn flex-row" onclick={toggleTheme}>
      <Palette size={16} />
      <span>Theme: {appState.themes.find(t => t.id === appState.theme)?.name || appState.theme}</span>
    </button>

    <button class="footer-btn flex-row" onclick={() => appState.showSettings = true}>
      <Settings size={16} />
      <span>Google Drive Sync</span>
    </button>

    <div class="vault-info flex-col">
      <span class="info-label">Active Directory</span>
      <span class="info-value">{appState.vaultName || 'Unknown'}</span>
      {#if appState.googleConnected && appState.syncEnabled}
        <span class="info-label" style="margin-top: 6px;">Drive Sync Folder</span>
        <span class="info-value">☁️ {appState.customDriveFolderName || 'MyNotes'}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .sidebar {
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

  .daily-container {
    flex: 0.8;
  }

  .starred-container {
    flex: 0.6;
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

  @media (max-width: 768px) {
    .item-delete-btn {
      opacity: 1;
    }
  }
</style>
