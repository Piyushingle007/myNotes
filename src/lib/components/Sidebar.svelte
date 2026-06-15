<script lang="ts">
  import { appState, generateHtmlNote } from '../stores/appState.svelte';
  import { Folder, Plus, Trash2, Calendar, Settings, Library, Palette, FolderOpen, X, ChevronRight, FileText, Download, Cloud, RefreshCw, CloudOff } from 'lucide-svelte';
  import GoogleLogo from './GoogleLogo.svelte';

  let newNotebookName = $state('');
  let showCreateInput = $state(false);

  function selectNotebook(notebook: string | null) {
    appState.activeNotebook = notebook;
    appState.activeTab = 'home';
  }

  async function handleDesktopDailyNote() {
    const today = new Date().toISOString().split('T')[0];
    const dailyPath = `Daily Notes/${today}.html`;
    
    // Check if it already exists
    const existing = appState.notes.find(n => n.path === dailyPath);
    if (existing) {
      appState.selectNote(existing.path);
    } else {
      await appState.storage.createDirectory('Daily Notes');
      const meta = {
        id: dailyPath,
        title: `Daily Log: ${today}`,
        tags: ['journal'],
        pinned: false,
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      };
      const initialContent = `<h1>Daily Log: ${today} 🗓️</h1><h2>💼 Work</h2><ul><li></li></ul><h2>🧘 Personal</h2><ul><li></li></ul>`;
      const htmlContent = generateHtmlNote(meta, initialContent);
      await appState.storage.writeNote(dailyPath, htmlContent);
      await appState.refreshNotes();
      appState.selectNote(dailyPath);
    }
  }

  let fileInput: HTMLInputElement;

  function triggerImport() {
    fileInput?.click();
  }

  async function handleImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      
      if (!bundle.title || !bundle.content) {
        alert('Invalid .mynote file format. Missing title or content.');
        return;
      }
      
      const cleanTitle = bundle.title.trim();
      let path = `${cleanTitle}.html`;
      const folder = appState.activeNotebook;
      if (folder) {
        path = `${folder}/${cleanTitle}.html`;
      }
      
      let version = 1;
      let finalPath = path;
      while (appState.notes.some(n => n.path === finalPath)) {
        finalPath = folder 
          ? `${folder}/${cleanTitle} (${version}).html`
          : `${cleanTitle} (${version}).html`;
        version++;
      }
      
      const meta = {
        id: bundle.id || finalPath,
        title: cleanTitle,
        tags: bundle.tags || [],
        pinned: bundle.pinned || false,
        created: bundle.created ? new Date(bundle.created).toISOString() : new Date().toISOString(),
        modified: new Date().toISOString()
      };
      
      const fileContent = generateHtmlNote(meta, bundle.content);
      
      await appState.storage.writeNote(finalPath, fileContent);
      await appState.refreshNotes();
      appState.selectNote(finalPath);
      appState.showToast(`Imported note "${cleanTitle}" successfully!`, 'success');
    } catch (e) {
      console.error('Failed to import note:', e);
      alert('Failed to parse and import note file.');
    } finally {
      input.value = '';
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
</script>

<div 
  class="sidebar flex-col" 
  class:collapsed={appState.sidebarCollapsed}
  style="width: {appState.sidebarCollapsed ? 0 : appState.sidebarWidth}px;"
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
          onclick={() => { appState.selectNote(note.path); appState.activeTab = 'home'; }}
          onkeydown={(e) => e.key === 'Enter' && (appState.selectNote(note.path), appState.activeTab = 'home')}
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

  <!-- Tasks Section -->
  <div class="section-container flex-col tasks-sidebar-container" style="flex-shrink: 0; margin-bottom: 12px;">
    <div 
      class="nav-item flex-row" 
      class:active={appState.activeTab === 'tasks'}
      role="button"
      tabindex="0"
      onclick={() => { appState.activeTab = 'tasks'; }}
      onkeydown={(e) => e.key === 'Enter' && (appState.activeTab = 'tasks')}
      style="padding: 8px 12px; gap: 10px; border-radius: 8px; margin: 0 4px;"
    >
      <div class="playlist-art" style="font-size: 16px; background: rgba(0, 173, 181, 0.1); color: var(--accent); display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <div class="nav-text flex-row" style="justify-content: space-between; flex-grow: 1; align-items: center; width: calc(100% - 38px);">
        <span class="title" style="font-size: 13px; font-weight: 600;">Tasks</span>
        {#if appState.openTaskCount > 0}
          <span class="sidebar-badge" style="background: var(--accent); color: white; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 10px; margin-left: 6px;">
            {appState.openTaskCount}
          </span>
        {/if}
      </div>
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
          onclick={() => { appState.selectNote(note.path); appState.activeTab = 'home'; }}
          onkeydown={(e) => e.key === 'Enter' && (appState.selectNote(note.path), appState.activeTab = 'home')}
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
    <input 
      type="file" 
      accept=".mynote" 
      bind:this={fileInput} 
      onchange={handleImportFile} 
      style="display: none;" 
    />
    
    <button class="footer-btn flex-row" onclick={triggerImport}>
      <Download size={16} />
      <span>Import Note (.mynote)</span>
    </button>

    <button class="footer-btn flex-row" onclick={appState.openDirectory.bind(appState)}>
      <FolderOpen size={16} />
      <span>Open Local Directory</span>
    </button>
    
    <button class="footer-btn flex-row" onclick={() => appState.showPreferences = true}>
      <Palette size={16} />
      <span>Preferences & Themes</span>
    </button>

    <button 
      class="footer-btn flex-row" 
      onclick={() => appState.showSettings = true}
      style="justify-content: space-between; width: 100%;"
    >
      <div class="flex-row" style="gap: 12px;">
        {#if appState.googleConnected && appState.syncEnabled}
          <Cloud size={16} class={appState.syncStatus === 'syncing' ? 'pulse-icon' : ''} />
        {:else}
          <CloudOff size={16} />
        {/if}
        <span>Google Drive Sync</span>
      </div>
      {#if appState.googleConnected && appState.syncEnabled}
        {#if appState.syncStatus === 'syncing'}
          <span class="sync-badge syncing flex-row" style="gap: 4px; font-size: 10px; background: rgba(56, 189, 248, 0.15); color: var(--accent); padding: 2px 8px; border-radius: 9999px; font-weight: 700;">
            <span class="sync-dot pulsing" style="width: 6px; height: 6px; background-color: var(--accent); border-radius: 50%; display: inline-block;"></span>
            Syncing
          </span>
        {:else if appState.syncStatus === 'error'}
          <span class="sync-badge error flex-row" style="gap: 4px; font-size: 10px; background: rgba(239, 68, 68, 0.15); color: var(--semantic-error, #ff4444); padding: 2px 8px; border-radius: 9999px; font-weight: 700;">
            Error
          </span>
        {:else}
          <span class="sync-badge idle flex-row" style="gap: 4px; font-size: 10px; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 9999px; font-weight: 700;">
            Synced
          </span>
        {/if}
      {:else}
        <span class="sync-badge offline flex-row" style="gap: 4px; font-size: 10px; background: rgba(255, 255, 255, 0.08); color: var(--text-tertiary); padding: 2px 8px; border-radius: 9999px; font-weight: 700;">
          Disabled
        </span>
      {/if}
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
    overflow: hidden;
    flex-shrink: 0;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-right-color 0.3s ease;
    will-change: width, padding;
  }

  .sidebar.collapsed {
    padding-left: 0;
    padding-right: 0;
    border-right-color: transparent;
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
    transition: background-color 0.2s, color 0.2s, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
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
    position: relative;
    transition: background-color 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), padding-left 0.2s ease, box-shadow 0.2s ease;
  }

  .nav-item:hover {
    background-color: var(--bg-mid-dark);
    transform: scale(1.02) translateX(4px);
  }

  .nav-item:active {
    transform: scale(0.98);
  }

  .nav-item.active {
    background-color: rgba(255, 255, 255, 0.08);
    box-shadow: inset 3px 0 0 0 var(--accent);
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
    transition: background-color 0.2s, color 0.2s, transform 0.2s ease;
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

  /* Sync status animations and layout */
  .pulsing {
    animation: sync-pulse-dot 1.5s infinite;
  }
  @keyframes sync-pulse-dot {
    0% { transform: scale(0.8); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0.5; }
  }
  .pulse-icon {
    animation: sync-pulse-icon 2s infinite ease-in-out;
  }
  @keyframes sync-pulse-icon {
    0% { opacity: 0.6; }
    50% { opacity: 1; }
    100% { opacity: 0.6; }
  }
</style>
