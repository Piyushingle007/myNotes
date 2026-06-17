<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { appState, generateHtmlNote } from '../stores/appState.svelte';
  import Sidebar from './Sidebar.svelte';
  import NoteList from './NoteList.svelte';
  import Editor from './Editor.svelte';
  import { 
    Home, Search, Library, Calendar, ChevronLeft, Plus, 
    FileText, Tag, FolderPlus, Compass, ArrowRight, Settings,
    X, Cloud, RefreshCw, LogOut, Palette, ChevronRight, Menu, Folder,
    Trash2, FolderOpen, Edit3, BookOpen, FileDown, Download, FolderInput, Code
  } from 'lucide-svelte';
  import ResizeHandle from './ResizeHandle.svelte';

  // Responsive state
  let isMobile = $state(false);
  let mobileSearchInput = $state('');
  let newMobileFolder = $state('');
  let showMobileFolderForm = $state(false);
  let showMobileMoreMenu = $state(false);
  
  // Custom Sync Folder and Theme Selectors
  let showFolderPicker = $state(false);
  let newDriveFolderName = $state('');
  let mobilePastedToken = $state('');

  // Time-based greeting helper
  let greeting = $derived.by(() => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good morning';
    if (hours < 17) return 'Good afternoon';
    return 'Good evening';
  });

  // Handle window resizing
  function handleResize() {
    isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent) || window.innerWidth < 768;
  }

  // Mobile Folder Creation
  async function createMobileFolder(e: SubmitEvent) {
    e.preventDefault();
    if (!newMobileFolder.trim()) return;
    await appState.createNotebook(newMobileFolder);
    newMobileFolder = '';
    showMobileFolderForm = false;
  }

  // Create standard daily note
  async function handleMobileDailyNote() {
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

  let selectedTargetNotebook = $state<string | null>(null);
  let newNotebookName = $state<string>('');

  $effect(() => {
    if (appState.showMoveCopyModal && appState.moveCopyNotePath) {
      const parts = appState.moveCopyNotePath.split('/');
      if (parts.length > 1) {
        selectedTargetNotebook = parts.slice(0, -1).join('/');
      } else {
        selectedTargetNotebook = null;
      }
      newNotebookName = '';
    }
  });

  async function handleCreateNotebookInModal() {
    const name = newNotebookName.trim();
    if (!name) return;
    try {
      await appState.createNotebook(name);
      selectedTargetNotebook = name;
      newNotebookName = '';
      appState.showToast(`Notebook "${name}" created.`, 'success', 3000);
    } catch (e) {
      console.error('Failed to create notebook in modal:', e);
    }
  }

  async function handleMoveNoteInModal() {
    if (!appState.moveCopyNotePath) return;
    await appState.moveNote(appState.moveCopyNotePath, selectedTargetNotebook);
    appState.showMoveCopyModal = false;
  }

  async function handleCopyNoteInModal() {
    if (!appState.moveCopyNotePath) return;
    await appState.copyNote(appState.moveCopyNotePath, selectedTargetNotebook);
    appState.showMoveCopyModal = false;
  }

  let fileInput = $state<HTMLInputElement>();

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

  onMount(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

{#if isMobile}
  <!-- ============================================== -->
  <!-- ANDROID MOBILE VIEW                            -->
  <!-- ============================================== -->
  <div class="mobile-app flex-col">
    {#if appState.activeNotePath}
      <!-- Fullscreen Editor Overlay for Mobile -->
      <div class="mobile-editor-container flex-col">
        <div class="mobile-editor-top flex-row" style="justify-content: space-between; width: 100%;">
          <button 
            class="back-btn flex-row" 
            onclick={() => {
              if (appState.editorDirty) appState.saveActiveNote();
              appState.activeNotePath = null;
              showMobileMoreMenu = false;
            }}
            aria-label="Back"
          >
            <ChevronLeft size={24} />
          </button>
          
          <!-- Note notebook / tag breadcrumb -->
          <span class="mobile-note-breadcrumb flex-row" style="gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary); max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <Folder size={13} style="color: var(--accent); flex-shrink: 0;" />
            {appState.activeNotePath.includes('/') ? appState.activeNotePath.split('/')[0] : 'All Notes'}
          </span>
          
          <!-- Save Checkmark & More Actions Button -->
          <div class="flex-row" style="gap: 12px; align-items: center; position: relative;">
            {#if appState.editorDirty}
              <button 
                class="mobile-save-check-btn flex-row" 
                onclick={() => appState.saveActiveNote()}
                aria-label="Save note"
                style="background: none; border: none; color: var(--accent); padding: 4px; cursor: pointer;"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            {/if}

            <!-- 1. Favorite Toggle Button -->
            <button
              class="mobile-action-btn flex-row"
              class:active={appState.favorites.includes(appState.activeNotePath || '')}
              onclick={() => appState.toggleFavorite(appState.activeNotePath || '')}
              aria-label={appState.favorites.includes(appState.activeNotePath || '') ? 'Remove from Favorites' : 'Add to Favorites'}
              style="background: none; border: none; color: {appState.favorites.includes(appState.activeNotePath || '') ? 'var(--accent)' : 'var(--text-secondary)'}; padding: 4px; cursor: pointer; transition: color 0.15s;"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={appState.favorites.includes(appState.activeNotePath || '') ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </button>

            <!-- 2. Zen Focus Mode Toggle Button -->
            {#if !appState.isReadOnly}
              <button
                class="mobile-action-btn flex-row"
                class:active={appState.focusModeEnabled}
                onclick={() => appState.setFocusMode(!appState.focusModeEnabled)}
                aria-label="Toggle Focus Mode"
                style="background: none; border: none; color: {appState.focusModeEnabled ? 'var(--accent)' : 'var(--text-secondary)'}; padding: 4px; cursor: pointer; transition: color 0.15s;"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                </svg>
              </button>
            {/if}

            <!-- 3. Typewriter Scroll Toggle Button -->
            {#if !appState.isReadOnly}
              <button
                class="mobile-action-btn flex-row"
                class:active={appState.typewriterScrollEnabled}
                onclick={() => appState.setTypewriterScroll(!appState.typewriterScrollEnabled)}
                aria-label="Toggle Typewriter Scroll"
                style="background: none; border: none; color: {appState.typewriterScrollEnabled ? 'var(--accent)' : 'var(--text-secondary)'}; padding: 4px; cursor: pointer; transition: color 0.15s;"
                title="Typewriter Scroll"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12" stroke-dasharray="3,3"/><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/>
                </svg>
              </button>
            {/if}

            <!-- 4. More Options Three-Dot Button -->
            <button 
              class="mobile-more-btn flex-row" 
              onclick={() => showMobileMoreMenu = !showMobileMoreMenu}
              aria-label="More options"
              style="background: none; border: none; color: var(--text-primary); padding: 4px; cursor: pointer;"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="mobile-editor-wrapper">
          <Editor />
        </div>

        {#if showMobileMoreMenu}
          <!-- Backdrop to close the menu on click-outside -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="mobile-more-menu-backdrop" onclick={() => showMobileMoreMenu = false}></div>

          <!-- Chrome-style Modern Dropdown Menu -->
          <div 
            class="mobile-more-menu flex-col" 
            onclick={(e) => e.stopPropagation()} 
            transition:fly={{ y: -6, duration: 150, easing: cubicOut }}
          >
            <div class="mobile-more-menu-content flex-col">
              <!-- 1. Edit/Read Toggle -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  appState.toggleReadMode();
                  showMobileMoreMenu = false;
                }}
              >
                {#if appState.isReadOnly}
                  <Edit3 size={15} class="menu-item-icon" />
                  <span>Switch to Edit Mode</span>
                {:else}
                  <BookOpen size={15} class="menu-item-icon" />
                  <span>Switch to Read Mode</span>
                {/if}
              </button>

              <!-- 2. Code Mode Toggle -->
              {#if !appState.isReadOnly}
                <button
                  class="menu-item flex-row"
                  onclick={() => {
                    appState.setSourceMode(!appState.sourceMode);
                    showMobileMoreMenu = false;
                  }}
                >
                  <Code size={15} class="menu-item-icon" style="color: {appState.sourceMode ? 'var(--accent)' : 'var(--text-secondary)'}" />
                  <span>Code Mode (Markdown)</span>
                </button>
              {/if}

              <div class="menu-divider"></div>

              <!-- 3. Export HTML -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  window.dispatchEvent(new CustomEvent('trigger-export-html'));
                }}
              >
                <FileDown size={15} class="menu-item-icon" />
                <span>Export as HTML</span>
              </button>

              <!-- 4. Export Markdown -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  window.dispatchEvent(new CustomEvent('trigger-export-markdown'));
                }}
              >
                <FileText size={15} class="menu-item-icon" />
                <span>Export as Markdown</span>
              </button>

              <!-- 5. Export PDF -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  window.dispatchEvent(new CustomEvent('trigger-export-pdf'));
                }}
              >
                <Download size={15} class="menu-item-icon" />
                <span>Export as PDF (Print)</span>
              </button>

              <div class="menu-divider"></div>

              <!-- 6. Move / Copy Note -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  if (appState.activeNotePath) {
                    appState.moveCopyNotePath = appState.activeNotePath;
                    appState.moveCopyNoteName = appState.activeNote?.name || '';
                    appState.showMoveCopyModal = true;
                  }
                }}
              >
                <FolderInput size={15} class="menu-item-icon" />
                <span>Move or Copy Note</span>
              </button>

              <!-- 7. Delete Note -->
              <button
                class="menu-item flex-row delete-item"
                onclick={() => {
                  showMobileMoreMenu = false;
                  if (confirm('Are you sure you want to delete this note?')) {
                    const path = appState.activeNotePath;
                    appState.activeNotePath = null;
                    if (path) appState.deleteNote(path);
                  }
                }}
              >
                <Trash2 size={15} class="menu-item-icon" />
                <span>Delete Note</span>
              </button>
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Main Mobile Navigation Tabs -->
      <div class="mobile-content flex-grow">
        <!-- 1. HOME TAB -->
        {#if appState.activeTab === 'home'}
          <div class="mobile-tab-view flex-col">
            <div class="mobile-header flex-row" style="justify-content: space-between; width: 100%;">
              <div class="flex-col">
                <h1>{greeting}</h1>
                <span class="mobile-vault-stat" style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">{appState.notes.length} notes in your vault</span>
              </div>
              <div class="flex-row" style="gap: 8px; align-items: center;">
                {#if appState.googleConnected && appState.syncEnabled}
                  {#if appState.syncStatus === 'syncing'}
                    <span class="sync-indicator spin" style="color: var(--accent); display: flex;" title="Syncing...">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                      </svg>
                    </span>
                  {:else if appState.syncStatus === 'error'}
                    <span class="sync-indicator" style="color: var(--semantic-error, #ff4444); display: flex;" title="Sync Error">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                    </span>
                  {/if}
                {/if}
                <button 
                  class="icon-circle-btn flex-row" 
                  onclick={() => appState.showSettings = true}
                  aria-label="Settings"
                >
                  <Settings size={20} />
                </button>
              </div>
            </div>

            <!-- Premium Stats Dashboard Card -->
            <div class="home-section stats-section" style="margin-top: 8px; margin-bottom: 8px;">
              <div class="stats-grid flex-row" style="gap: 12px; width: 100%;">
                <div class="stat-card flex-col" style="flex: 1; padding: 12px; background: var(--bg-surface); border-radius: var(--radius-standard); align-items: center; border: 1px solid var(--border-color); text-align: center;">
                  <span class="stat-value" style="font-size: 20px; font-weight: 700; color: var(--accent);">{appState.notebooks.length}</span>
                  <span class="stat-label" style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; font-weight: 600;">Notebooks</span>
                </div>
                <div class="stat-card flex-col" style="flex: 1; padding: 12px; background: var(--bg-surface); border-radius: var(--radius-standard); align-items: center; border: 1px solid var(--border-color); text-align: center;">
                  <span class="stat-value" style="font-size: 20px; font-weight: 700; color: var(--accent);">{appState.notes.length}</span>
                  <span class="stat-label" style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; font-weight: 600;">Files</span>
                </div>
                <div class="stat-card flex-col" style="flex: 1.2; padding: 12px; background: var(--bg-surface); border-radius: var(--radius-standard); align-items: center; border: 1px solid var(--border-color); text-align: center; justify-content: center; min-width: 0;">
                  <span class="stat-value" style="font-size: 20px; font-weight: 700; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">{appState.linesCountInActiveNotebook}</span>
                  <span class="stat-label" style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                    {#if appState.activeNotebook}
                      Lines in {appState.activeNotebook}
                    {:else}
                      Total Lines
                    {/if}
                  </span>
                </div>
              </div>
            </div>

            <!-- Starred Notes Cards Feed -->
            <div class="home-section">
              <h2 class="section-title">Favorites</h2>
              <div class="recent-cards-list flex-col" style="gap: 12px;">
                {#each appState.notes.filter(n => appState.favorites.includes(n.path)) as note}
                  <button class="recent-note-card flex-col" onclick={() => appState.selectNote(note.path)}>
                    <div class="card-header-row flex-row" style="justify-content: space-between; width: 100%;">
                      <span class="card-note-title">{note.name}</span>
                      <span class="card-note-time">{new Date(note.modified).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                    </div>
                    {#if note.path.includes('/')}
                      <span class="card-notebook-badge">{note.path.split('/')[0]}</span>
                    {/if}
                  </button>
                {:else}
                  <div class="empty-cards" style="font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 10px 0;">No favorites starred yet.</div>
                {/each}
              </div>
            </div>

            <!-- Recent Notes Cards Feed (Keep/Docs Style) -->
            <div class="home-section">
              <h2 class="section-title">Recent Notes</h2>
              <div class="recent-cards-list flex-col" style="gap: 12px;">
                {#each appState.recentNotes as note}
                  <button class="recent-note-card flex-col" onclick={() => appState.selectNote(note.path)}>
                    <div class="card-header-row flex-row" style="justify-content: space-between; width: 100%;">
                      <span class="card-note-title">{note.name}</span>
                      <span class="card-note-time">{new Date(note.modified).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                    </div>
                    {#if note.path.includes('/')}
                      <span class="card-notebook-badge">{note.path.split('/')[0]}</span>
                    {/if}
                  </button>
                {:else}
                  <div class="empty-cards" style="font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 20px 0;">No notes found. Click the + button below to create one!</div>
                {/each}
              </div>
            </div>

            <!-- Quick Daily Journal Prompt -->
            <div class="home-section">
              <div class="daily-prompt-card card-dark flex-row" onclick={handleMobileDailyNote}>
                <div class="card-art flex-row">🗓️</div>
                <div class="card-text flex-col">
                  <span class="card-headline">Write Daily Log</span>
                  <span class="card-sub">Record today's ideas & logs</span>
                </div>
                <ArrowRight size={20} class="arrow-accent" />
              </div>
            </div>
          </div>

        <!-- 3. LIBRARY TAB (Unified Search & Library) -->
        {:else if appState.activeTab === 'library'}
          <div class="mobile-tab-view flex-col">
            {#if appState.activeNotebook === null}
              <!-- Library Home / Search View -->
              <div class="mobile-header mobile-library-header flex-row" style="justify-content: space-between; width: 100%; align-items: center;">
                <h1>Your Library</h1>
                <div class="flex-row" style="gap: 12px; align-items: center;">
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => appState.showSettings = true}
                    aria-label="Settings"
                  >
                    <Settings size={20} />
                  </button>
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => showMobileFolderForm = !showMobileFolderForm}
                    aria-label="Add folder"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>

              {#if showMobileFolderForm}
                <form onsubmit={createMobileFolder} class="mobile-folder-form" style="width: 100%; margin-bottom: 8px;">
                  <input 
                    type="text" 
                    placeholder="New Notebook Name..." 
                    bind:value={newMobileFolder}
                    class="mobile-folder-input"
                    style="width: 100%; padding: 10px 14px; background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-standard); color: var(--text-primary); outline: none;"
                    required
                    autofocus
                  />
                </form>
              {/if}

              <!-- Search Bar -->
              <div class="mobile-search-bar flex-row">
                <Search size={20} class="search-icon" />
                <input 
                  type="text" 
                  placeholder="Search notes, content..." 
                  bind:value={mobileSearchInput}
                  oninput={() => appState.searchQuery = mobileSearchInput}
                  class="mobile-search-input"
                />
              </div>

              {#if appState.searchQuery.trim()}
                <!-- Search Results -->
                <div class="search-results flex-col" style="width: 100%; margin-top: 8px;">
                  <span class="section-title">Notes</span>
                  {#each appState.filteredNotes as note}
                    <button 
                      class="search-result-row flex-row" 
                      onclick={() => appState.selectNote(note.path)}
                      style="width: 100%; text-align: left;"
                    >
                      <div class="row-art">📄</div>
                      <div class="row-info flex-col">
                        <span class="row-title">{note.name}</span>
                        <span class="row-sub">{note.path}</span>
                      </div>
                    </button>
                  {:else}
                    <div class="empty-list" style="font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 24px 0;">No matching notes found.</div>
                  {/each}
                </div>
              {:else}
                <!-- Notebooks List -->
                <div class="search-section flex-col" style="gap: 8px; width: 100%; margin-top: 8px;">
                  <span class="section-title">Notebooks</span>
                  <div class="notebook-list flex-col" style="gap: 8px;">
                    {#each appState.notebooks as notebook}
                      <div class="notebook-card-wrapper" style="position: relative; width: 100%;">
                        <button 
                          class="notebook-row flex-row" 
                          onclick={() => {
                            appState.activeNotebook = notebook;
                          }}
                          style="width: 100%; padding: 12px 14px; border-radius: var(--radius-comfortable); border: 1px solid var(--border-color); background-color: var(--bg-surface); gap: 12px; text-align: left; align-items: center;"
                        >
                          <Folder size={18} style="color: var(--accent); flex-shrink: 0;" />
                          <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">{notebook}</span>
                        </button>
                        <!-- Notebook Delete Button -->
                        <button
                          onclick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete folder "${notebook}" and all its notes?`)) {
                              appState.deleteNotebook(notebook);
                            }
                          }}
                          style="position: absolute; top: 50%; transform: translateY(-50%); right: 12px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 6px; z-index: 2; display: flex; align-items: center; justify-content: center;"
                          aria-label="Delete notebook"
                          onmouseover={(e) => e.currentTarget.style.color = 'var(--semantic-error, #ff4444)'}
                          onmouseout={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    {:else}
                      <div class="empty-list" style="font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 12px 0; border: 1px dashed var(--border-color); border-radius: var(--radius-standard);">No notebooks created yet.</div>
                    {/each}
                  </div>
                </div>

                <!-- Recent Notes -->
                <div class="search-section flex-col" style="gap: 8px; width: 100%; margin-top: 16px;">
                  <span class="section-title">Recent Notes</span>
                  <div class="recent-list flex-col" style="gap: 6px; width: 100%;">
                    {#each appState.recentNotes.slice(0, 8) as note}
                      <button 
                        class="search-result-row flex-row" 
                        onclick={() => appState.selectNote(note.path)}
                        style="width: 100%; text-align: left;"
                      >
                        <div class="row-art">📄</div>
                        <div class="row-info flex-col">
                          <span class="row-title">{note.name}</span>
                          <span class="row-sub">{note.path}</span>
                        </div>
                      </button>
                    {:else}
                      <div class="empty-list" style="font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 12px 0;">No notes found.</div>
                    {/each}
                  </div>
                </div>
              {/if}

            {:else}
              <!-- Folder Notes List View (Sub-view inside active notebook) -->
              <div class="mobile-header flex-row" style="justify-content: space-between; width: 100%; border-bottom: 1px dashed var(--border-color); padding-bottom: 12px; margin-bottom: 8px;">
                <div class="flex-row" style="gap: 8px; max-width: 70%; align-items: center;">
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => { appState.activeNotebook = null; }}
                    aria-label="Back to Library"
                    style="width: 32px; height: 32px;"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span style="font-weight: 800; font-size: 16px; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: calc(100% - 40px);">
                    {appState.activeNotebook}
                  </span>
                </div>
                
                <button 
                  class="btn-pill btn-pill-primary flex-row" 
                  onclick={() => {
                    const title = prompt('Enter note title:', 'New Note');
                    if (title) appState.createNote(title, appState.activeNotebook);
                  }}
                  style="font-size: 11px; padding: 6px 12px;"
                >
                  <Plus size={12} style="margin-right: 4px;" /> Add Note
                </button>
              </div>

              <!-- Search inside notebook -->
              <div class="mobile-search-bar flex-row" style="margin-bottom: 10px;">
                <Search size={18} class="search-icon" />
                <input 
                  type="text" 
                  placeholder="Search in this folder..." 
                  bind:value={mobileSearchInput}
                  oninput={() => appState.searchQuery = mobileSearchInput}
                  class="mobile-search-input"
                />
              </div>

              <!-- Notes list inside selected folder -->
              <div class="mobile-notes-list flex-col" style="width: 100%; gap: 10px;">
                {#each appState.filteredNotes as note}
                  <button 
                    class="recent-note-card flex-col" 
                    onclick={() => appState.selectNote(note.path)}
                    style="background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-comfortable); padding: 14px 16px; text-align: left; width: 100%; gap: 8px;"
                  >
                    <div class="card-header-row flex-row" style="justify-content: space-between; width: 100%;">
                      <span class="card-note-title" style="font-weight: 700; font-size: 14px; color: var(--text-primary);">{note.name}</span>
                      <span class="card-note-time" style="font-size: 10px; color: var(--text-tertiary);">{new Date(note.modified).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                    </div>
                    <p class="card-note-snippet" style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">{(note.content || '').replace(/[#*`_\-\[\]()]/g, ' ').slice(0, 80)}...</p>
                  </button>
                {:else}
                  <div class="empty-lib flex-col" style="align-items: center; justify-content: center; gap: 8px; padding: 40px 0; color: var(--text-tertiary);">
                    <span style="font-size: 32px;">📂</span>
                    <span class="title" style="font-weight: 600; font-size: 13px;">No notes found</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- 4. DAILY TAB -->
        {:else if appState.activeTab === 'daily'}
          <div class="mobile-tab-view flex-col">
            <div class="mobile-header">
              <h1>Daily Logs</h1>
            </div>
            
            <div class="daily-view flex-col">
              <div class="daily-hero card-dark flex-col">
                <div class="hero-art">🗓️</div>
                <h2>Keep a Daily Log</h2>
                <p>Journal thoughts, logs, and notes organized automatically by date.</p>
                <button class="btn-pill btn-pill-primary hero-btn" onclick={handleMobileDailyNote}>
                  Create/Open Today's Log
                </button>
              </div>

              <div class="daily-history flex-col">
                <span class="section-title">Past Logs</span>
                {#each appState.notes.filter(n => n.path.startsWith('Daily Notes/')) as note}
                  <button class="search-result-row flex-row" onclick={() => appState.selectNote(note.path)}>
                    <div class="row-art">📅</div>
                    <div class="row-info flex-col">
                      <span class="row-title">{note.name}</span>
                      <span class="row-sub">Daily Log</span>
                    </div>
                  </button>
                {:else}
                  <span class="empty-text">No daily notes written yet</span>
                {/each}
              </div>
            </div>
          </div>


        {/if}
      </div>

      <!-- Floating Action Button (FAB) on Mobile -->
      {#if appState.activeTab === 'library' || appState.activeTab === 'home'}
        <button 
          class="mobile-fab flex-row" 
          onclick={() => {
            const title = prompt('Enter note title:', 'New Note');
            if (title) appState.createNote(title, appState.activeNotebook);
          }}
          aria-label="Add new note"
        >
          <Plus size={24} />
        </button>
      {/if}

      <!-- Android Bottom Navigation Bar (Spotify Style) -->
      <div class="android-bottom-nav flex-row">
        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'home'} 
          onclick={() => { appState.activeTab = 'home'; appState.activeNotebook = null; }}
        >
          <Home size={22} />
          <span>Home</span>
        </button>
        
        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'library'} 
          onclick={() => { appState.activeTab = 'library'; appState.activeNotebook = null; appState.searchQuery = ''; mobileSearchInput = ''; }}
        >
          <Library size={22} />
          <span>Library</span>
        </button>

         <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'daily'} 
          onclick={() => { appState.activeTab = 'daily'; }}
        >
          <Calendar size={22} />
          <span>Daily</span>
        </button>


      </div>
    {/if}
  </div>
{:else}
  <!-- ============================================== -->
  <!-- DESKTOP VIEW                                   -->
  <!-- ============================================== -->
  <div class="desktop-app flex-row" style="position: relative;">
    <!-- Left Sidebar (Notebook / Tag Selection) -->
    <Sidebar />

    {#if !appState.sidebarCollapsed && !appState.notelistCollapsed}
      <ResizeHandle onResize={(delta) => appState.resizeSidebar(delta)} />
    {/if}

    <!-- Middle Panel (Note list) -->
    <NoteList />

    {#if !appState.notelistCollapsed && !appState.editorCollapsed}
      <ResizeHandle onResize={(delta) => appState.resizeNotelist(delta)} />
    {/if}

    <!-- Right Panel (Editor) -->
    <div class="editor-panel flex-row" style="display: {appState.editorCollapsed ? 'none' : 'flex'}; min-width: 0;">
      <Editor />
    </div>

    {#if appState.sidebarCollapsed && appState.notelistCollapsed && appState.editorCollapsed}
      <div class="all-collapsed-placeholder flex-col" style="flex-grow: 1; align-items: center; justify-content: center; gap: 16px; color: var(--text-secondary); background-color: var(--bg-base); height: 100%;">
        <span>All sections are collapsed.</span>
        <button 
          class="btn-pill btn-pill-primary" 
          onclick={() => {
            appState.setSidebarCollapsed(false);
            appState.setNotelistCollapsed(false);
            appState.setEditorCollapsed(false);
          }}
        >
          Restore All Sections
        </button>
      </div>
    {/if}
  </div>
{/if}

<!-- Move / Copy Note Modal Overlay -->
{#if appState.showMoveCopyModal && appState.moveCopyNotePath}
  <div 
    class="settings-backdrop flex-row" 
    transition:fade={{ duration: 150 }}
    onclick={(e) => { if (e.target === e.currentTarget) appState.showMoveCopyModal = false; }} 
    role="presentation"
    style="z-index: 1200;"
  >
    <div 
      class="settings-modal flex-col"
      transition:fly={{ y: 20, duration: 250, easing: cubicOut }}
      style="padding: 24px; max-height: 90vh;"
    >
      <div class="settings-header flex-row" style="justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px;">
        <div class="settings-title flex-row" style="gap: 8px; align-items: center;">
          <FolderOpen size={20} class="sync-icon-accent" style="color: var(--accent);" />
          <span style="font-weight: 700;">Move or Copy Note</span>
        </div>
        <button class="close-btn flex-row" onclick={() => appState.showMoveCopyModal = false} aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>

      <div class="move-copy-body flex-col" style="padding: 8px 0; gap: 16px; overflow-y: auto;">
        <div class="flex-col" style="gap: 4px;">
          <span style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); font-weight: 700; letter-spacing: 0.5px;">Note to organize</span>
          <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">{appState.moveCopyNoteName}</span>
          <span style="font-size: 12px; color: var(--text-secondary); word-break: break-all; opacity: 0.7;">Current path: {appState.moveCopyNotePath}</span>
        </div>

        <div class="flex-col" style="gap: 8px;">
          <span style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); font-weight: 700; letter-spacing: 0.5px;">Select Destination Notebook</span>
          
          <div class="notebook-select-list flex-col">
            <!-- Root Folder Option -->
            <button 
              class="notebook-select-row flex-row"
              class:selected={selectedTargetNotebook === null}
              onclick={() => selectedTargetNotebook = null}
            >
              <span class="folder-icon">📂</span>
              <span class="folder-name">Root / (No notebook)</span>
              {#if selectedTargetNotebook === null}
                <span class="selected-checkmark">✓</span>
              {/if}
            </button>

            <!-- Available Notebooks -->
            {#each appState.notebooks as notebook}
              <button 
                class="notebook-select-row flex-row"
                class:selected={selectedTargetNotebook === notebook}
                onclick={() => selectedTargetNotebook = notebook}
              >
                <span class="folder-icon">📁</span>
                <span class="folder-name">{notebook}</span>
                {#if selectedTargetNotebook === notebook}
                  <span class="selected-checkmark">✓</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- Create New Notebook Section -->
        <div class="flex-col" style="gap: 8px; border-top: 1px dashed var(--border-color); padding-top: 16px;">
          <span style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); font-weight: 700; letter-spacing: 0.5px;">Or Create New Notebook</span>
          <div class="flex-row" style="gap: 8px;">
            <input 
              type="text" 
              placeholder="New notebook name..." 
              bind:value={newNotebookName}
              style="flex-grow: 1; background: var(--bg-base); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none;"
              onkeydown={(e) => { if (e.key === 'Enter') handleCreateNotebookInModal(); }}
            />
            <button 
              class="btn-pill btn-pill-outline" 
              style="padding: 0 16px; font-size: 12px; height: 36px;"
              onclick={handleCreateNotebookInModal}
            >
              Create
            </button>
          </div>
        </div>
      </div>

      <div class="move-copy-actions flex-row" style="justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 16px;">
        <button 
          class="btn-pill btn-pill-outline" 
          style="padding: 8px 16px; height: 38px;"
          onclick={() => appState.showMoveCopyModal = false}
        >
          Cancel
        </button>
        <button 
          class="btn-pill btn-pill-outline" 
          style="padding: 8px 16px; height: 38px; color: var(--accent); border-color: var(--accent);"
          onclick={handleCopyNoteInModal}
        >
          Copy Note
        </button>
        <button 
          class="btn-pill btn-pill-primary" 
          style="padding: 8px 20px; height: 38px;"
          onclick={handleMoveNoteInModal}
        >
          Move Note
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Settings Modal Overlay (Unified) -->
{#if appState.showSettings}
  <div 
    class="settings-backdrop flex-row" 
    transition:fade={{ duration: 150 }}
    onclick={(e) => { if (e.target === e.currentTarget) appState.showSettings = false; }} 
    role="presentation"
  >
    <div 
      class="settings-modal flex-col"
      transition:fly={{ y: 20, duration: 250, easing: cubicOut }}
    >
      <div class="settings-header flex-row" style="justify-content: space-between; border-bottom: none; padding-bottom: 8px;">
        <div class="settings-title flex-row">
          <Settings size={20} class="sync-icon-accent" />
          <span>App Settings</span>
        </div>
        <button class="close-btn flex-row" onclick={() => appState.showSettings = false} aria-label="Close settings">
          <X size={18} />
        </button>
      </div>

      <!-- Settings Tabs Segmented Control -->
      <div class="settings-tabs flex-row" style="display: flex; gap: 4px; padding: 0 16px 12px; border-bottom: 1px solid var(--border-color); width: 100%;">
        <button 
          class="settings-tab-btn" 
          class:active={appState.settingsActiveTab === 'sync'} 
          onclick={() => appState.settingsActiveTab = 'sync'}
          style="flex: 1; padding: 8px 12px; border-radius: var(--radius-standard); font-size: 12px; font-weight: 600; text-align: center; border: none; background: {appState.settingsActiveTab === 'sync' ? 'var(--accent)' : 'rgba(255,255,255,0.04)'}; color: {appState.settingsActiveTab === 'sync' ? 'var(--bg-primary)' : 'var(--text-secondary)'}; transition: all 0.2s; cursor: pointer;"
        >
          Cloud Sync
        </button>
        <button 
          class="settings-tab-btn" 
          class:active={appState.settingsActiveTab === 'styling'} 
          onclick={() => appState.settingsActiveTab = 'styling'}
          style="flex: 1; padding: 8px 12px; border-radius: var(--radius-standard); font-size: 12px; font-weight: 600; text-align: center; border: none; background: {appState.settingsActiveTab === 'styling' ? 'var(--accent)' : 'rgba(255,255,255,0.04)'}; color: {appState.settingsActiveTab === 'styling' ? 'var(--bg-primary)' : 'var(--text-secondary)'}; transition: all 0.2s; cursor: pointer;"
        >
          Appearance
        </button>
        <button 
          class="settings-tab-btn" 
          class:active={appState.settingsActiveTab === 'editor'} 
          onclick={() => appState.settingsActiveTab = 'editor'}
          style="flex: 1; padding: 8px 12px; border-radius: var(--radius-standard); font-size: 12px; font-weight: 600; text-align: center; border: none; background: {appState.settingsActiveTab === 'editor' ? 'var(--accent)' : 'rgba(255,255,255,0.04)'}; color: {appState.settingsActiveTab === 'editor' ? 'var(--bg-primary)' : 'var(--text-secondary)'}; transition: all 0.2s; cursor: pointer;"
        >
          Editor & Files
        </button>
      </div>

      <div class="settings-content flex-col" style="max-height: 60vh; overflow-y: auto; gap: 20px; padding: 20px; width: 100%;">
        
        <!-- ================= TAB 1: CLOUD SYNC ================= -->
        {#if appState.settingsActiveTab === 'sync'}
          <!-- Client ID input section -->
          <div class="form-group flex-col">
            <label for="google-client-id" class="form-label">Google OAuth Client ID</label>
            <div class="input-wrapper flex-row">
              <input 
                id="google-client-id"
                type="text" 
                placeholder="Paste Google Client ID here..." 
                value={appState.googleClientId} 
                oninput={(e) => appState.setClientId(e.currentTarget.value)}
                disabled={appState.googleConnected}
                class="input-pill client-id-input"
              />
            </div>
          </div>

          {#if typeof window !== 'undefined' && (window as any).Capacitor}
            <div class="form-group flex-col" style="margin-top: 8px; width: 100%;">
              <label for="google-redirect-uri" class="form-label">OAuth Redirect URI</label>
              <div class="input-wrapper flex-row">
                <input 
                  id="google-redirect-uri"
                  type="text" 
                  placeholder="e.g. http://localhost" 
                  value={appState.googleRedirectUri} 
                  oninput={(e) => appState.setRedirectUri(e.currentTarget.value)}
                  disabled={appState.googleConnected}
                  class="input-pill redirect-uri-input"
                  style="width: 100%; box-sizing: border-box;"
                />
              </div>
            </div>
          {/if}

          {#if !appState.googleConnected}
            <div class="auth-section flex-col">
              {#if typeof window !== 'undefined' && (window as any).Capacitor}
                <!-- Mobile Redirect and Verify flow -->
                <div class="mobile-sync-card flex-col" style="gap: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; width: 100%; box-sizing: border-box; text-align: left; margin-bottom: 16px;">
                  <span style="font-size: 14px; font-weight: 700; color: var(--accent);">Mobile Google Sign-In</span>
                  
                  <p style="font-size: 12px; color: var(--text-secondary); margin: 0; line-height: 1.4;">
                    Due to Google security policies, authentication must occur in your secure system browser.
                  </p>
                  
                  <button 
                    class="btn-pill btn-pill-primary flex-row" 
                    style="margin-top: 8px; width: 100%;"
                    onclick={() => {
                      const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" + 
                        encodeURIComponent(appState.googleClientId) + 
                        "&redirect_uri=" + encodeURIComponent(appState.googleRedirectUri) + 
                        "&response_type=token&scope=" + encodeURIComponent("https://www.googleapis.com/auth/drive.file");
                      window.open(url, '_system');
                    }}
                    disabled={!appState.googleClientId || !appState.googleRedirectUri}
                  >
                    <span>1. Sign In via Browser</span>
                  </button>
                  
                  <div class="form-group flex-col" style="margin-top: 8px; gap: 4px; width: 100%;">
                    <label for="mobile-pasted-token" class="form-label" style="font-size: 11px;">2. Paste Redirected URL or Token</label>
                    <input 
                      id="mobile-pasted-token"
                      type="text" 
                      placeholder="Paste the URL from the browser address bar..." 
                      bind:value={mobilePastedToken}
                      class="input-pill"
                      style="font-size: 12px; width: 100%; box-sizing: border-box;"
                    />
                  </div>

                  <button 
                    class="btn-pill btn-pill-accent flex-row" 
                    style="width: 100%;"
                    onclick={async () => {
                      try {
                        await appState.connectGoogleDriveMobile(mobilePastedToken);
                        mobilePastedToken = '';
                      } catch (e: any) {
                        alert(e.message || 'Failed to verify token');
                      }
                    }}
                    disabled={!mobilePastedToken}
                  >
                    <span>3. Verify & Connect</span>
                  </button>
                </div>

                <div class="helper-card flex-col">
                  <span class="helper-title">Mobile Setup Instructions:</span>
                  <ol class="helper-steps">
                    <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" class="link-accent">Google Cloud Console</a>.</li>
                    <li>Inside your OAuth Client ID, add the Redirect URI (currently <code>{appState.googleRedirectUri || 'http://localhost'}</code>) under <b>Authorized Redirect URIs</b> (needed for browser redirect).</li>
                    <li>Enter your Client ID in the field above.</li>
                    <li>Click <b>Sign In via Browser</b>, sign in, copy the full URL of the resulting page (e.g. <code>{appState.googleRedirectUri || 'http://localhost'}/#access_token=...</code>), paste it above, and click <b>Verify</b>.</li>
                  </ol>
                </div>
              {:else}
                <!-- Web Normal Flow -->
                <button 
                  class="btn-pill btn-pill-primary flex-row connect-btn" 
                  onclick={async () => {
                    try {
                      await appState.connectGoogleDrive();
                    } catch (e: any) {
                      alert(e.message || 'Failed to connect to Google Drive');
                    }
                  }}
                  disabled={!appState.googleClientId}
                >
                  <span>Connect Google Drive</span>
                </button>
                
                <div class="helper-card flex-col">
                  <span class="helper-title">Setup Instructions:</span>
                  <ol class="helper-steps">
                    <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" class="link-accent">Google Cloud Console</a>.</li>
                    <li>Create a project and set up the <b>OAuth consent screen</b> (User Type: External).</li>
                    <li>Add your Google account as a <b>Test User</b> since your app is in testing.</li>
                    <li>Create <b>OAuth client ID</b> credentials (Application Type: Web Application).</li>
                    <li>Add <code>http://localhost:5173</code> (or your URL) under <b>Authorized JavaScript Origins</b>.</li>
                    <li>Copy the Client ID and paste it in the field above.</li>
                  </ol>
                </div>
              {/if}
            </div>
          {:else}
            <!-- Connected view -->
            <div class="connected-card flex-col">
              <div class="status-row flex-row">
                <span class="status-dot" class:syncing={appState.syncStatus === 'syncing'} class:error={appState.syncStatus === 'error'}></span>
                <div class="status-info flex-col">
                  <span class="email-text">{appState.googleUserEmail}</span>
                  <span class="status-text">
                    {#if appState.syncStatus === 'syncing'}
                      Syncing database...
                    {:else if !appState.syncEnabled}
                      Connected & Sync Disabled
                    {:else}
                      Connected & Sync Enabled
                    {/if}
                  </span>
                </div>
              </div>

              <div class="sync-toggle-row flex-row" style="justify-content: space-between; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color); width: 100%;">
                <span style="font-size: 13px; color: var(--text-primary); font-weight: 500;">Enable Google Drive Syncing</span>
                <label class="switch-container">
                  <input 
                    type="checkbox" 
                    checked={appState.syncEnabled} 
                    onchange={(e) => {
                      appState.setSyncEnabled(e.currentTarget.checked);
                      if (e.currentTarget.checked) {
                        appState.syncNotes();
                      }
                    }}
                  />
                  <span class="slider"></span>
                </label>
              </div>

              <div class="sync-stats flex-col">
                <div class="stat-row flex-row">
                  <span class="stat-label">Last Sync Time</span>
                  <span class="stat-val">
                    {appState.lastSyncedTime ? new Date(appState.lastSyncedTime).toLocaleTimeString() : 'Never'}
                  </span>
                </div>
                <div class="stat-row flex-row">
                  <span class="stat-label">Conflict Policy</span>
                  <span class="stat-val">Last Modified Wins</span>
                </div>
              </div>

              <div class="sync-actions flex-row">
                <button 
                  class="btn-pill btn-pill-outline flex-row sync-now-btn" 
                  onclick={async () => {
                    await appState.syncNotes();
                  }}
                  disabled={appState.syncStatus === 'syncing'}
                >
                  <RefreshCw size={14} class={appState.syncStatus === 'syncing' ? 'spin' : ''} />
                  <span>Sync Now</span>
                </button>

                <button 
                  class="btn-pill btn-logout flex-row" 
                  onclick={() => appState.disconnectGoogleDrive()}
                >
                  <LogOut size={14} />
                  <span>Disconnect</span>
                </button>
              </div>

              <!-- Custom Target Folder selection section -->
              <div class="form-group flex-col" style="margin-top: 16px; border-top: 1px dashed var(--border-color); padding-top: 16px; gap: 8px;">
                <label class="form-label" style="font-weight: 700; margin-bottom: 2px;">Sync Target Folder</label>
                <div class="folder-selection-ui flex-col" style="gap: 8px;">
                  <div class="current-folder flex-row" style="justify-content: space-between; background-color: var(--bg-mid-dark); padding: 8px 12px; border-radius: var(--radius-standard); border: 1px solid var(--border-color);">
                    <div class="flex-col">
                      <span style="font-size: 10px; color: var(--text-tertiary); text-transform: uppercase;">Active Folder</span>
                      <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">
                        {appState.customDriveFolderName || 'MyNotes (Default)'}
                      </span>
                    </div>
                    
                    {#if !showFolderPicker}
                      <button class="btn-pill btn-pill-outline" style="padding: 4px 10px; font-size: 11px;" onclick={() => { showFolderPicker = true; appState.fetchGoogleDriveFolders(); }}>
                        Change
                      </button>
                    {/if}
                  </div>

                  {#if showFolderPicker}
                    <div class="folder-picker-panel flex-col" style="background-color: var(--bg-mid-dark); padding: 12px; border-radius: var(--radius-standard); border: 1px solid var(--border-color); gap: 10px; max-height: 180px; overflow-y: auto;">
                      <div class="flex-row" style="justify-content: space-between; font-size: 11px; font-weight: 700; color: var(--text-secondary);">
                        <span>CHOOSE FROM DRIVE</span>
                        <button onclick={() => showFolderPicker = false} style="color: var(--accent);">Close</button>
                      </div>
                      
                      {#if appState.fetchingFolders}
                        <div class="flex-row" style="justify-content: center; padding: 12px 0;">
                          <span class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span>
                        </div>
                      {:else}
                        <div class="folder-list flex-col" style="gap: 4px;">
                          <!-- Default Folder Option -->
                          <button 
                            class="folder-row flex-row" 
                            style="width: 100%; text-align: left; padding: 6px 8px; border-radius: var(--radius-subtle); gap: 8px; font-size: 12px; background: none;" 
                            class:active={!appState.customDriveFolderId}
                            onclick={() => { appState.setCustomDriveFolder(null, null); showFolderPicker = false; }}
                          >
                            <span>📁</span>
                            <span style="color: {!appState.customDriveFolderId ? 'var(--accent)' : 'var(--text-primary)'};">MyNotes (Default)</span>
                          </button>

                          {#each appState.googleDriveFolders as folder}
                            <button 
                              class="folder-row flex-row" 
                              style="width: 100%; text-align: left; padding: 6px 8px; border-radius: var(--radius-subtle); gap: 8px; font-size: 12px; background: none;"
                              class:active={appState.customDriveFolderId === folder.id}
                              onclick={() => { appState.setCustomDriveFolder(folder.id, folder.name); showFolderPicker = false; }}
                            >
                              <span>📁</span>
                              <span style="color: {appState.customDriveFolderId === folder.id ? 'var(--accent)' : 'var(--text-primary)'};">{folder.name}</span>
                            </button>
                          {/each}
                        </div>

                        <div class="create-folder-inline flex-row" style="gap: 8px; margin-top: 8px; border-top: 1px dashed var(--border-color); padding-top: 8px;">
                          <input 
                            type="text" 
                            placeholder="New folder name..." 
                            bind:value={newDriveFolderName}
                            style="flex-grow: 1; background-color: var(--bg-surface); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-subtle); font-size: 12px; color: var(--text-primary);"
                          />
                          <button 
                            class="btn-pill btn-pill-primary" 
                            style="padding: 4px 8px; font-size: 11px;"
                            onclick={async () => {
                              if (newDriveFolderName.trim()) {
                                await appState.createGoogleDriveFolder(newDriveFolderName.trim());
                                newDriveFolderName = '';
                                showFolderPicker = false;
                              }
                            }}
                          >
                            Create
                          </button>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

        <!-- ================= TAB 2: THEMES & APPEARANCE ================= -->
        {:else if appState.settingsActiveTab === 'styling'}
          <div class="form-group flex-col">
            <label class="form-label" style="font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
              <Palette size={18} class="sync-icon-accent" />
              <span>Appearance Themes</span>
            </label>
            
            <div class="theme-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
              {#each appState.themes as t}
                <button 
                  class="theme-chip flex-row" 
                  style="background-color: var(--bg-mid-dark); border: 1px solid {appState.theme === t.id ? 'var(--accent)' : 'var(--border-color)'}; padding: 10px; border-radius: var(--radius-standard); justify-content: space-between; text-align: left; width: 100%; transition: border-color 0.2s;"
                  onclick={() => appState.setTheme(t.id)}
                >
                  <span style="font-size: 12px; font-weight: 600; color: {appState.theme === t.id ? 'var(--text-primary)' : 'var(--text-secondary)'};">{t.name}</span>
                  <div class="color-preview flex-row" style="gap: 4px;">
                    <span style="width: 12px; height: 12px; border-radius: 50%; background-color: {t.bg}; border: 1.5px solid rgba(255,255,255,0.2);"></span>
                    <span style="width: 12px; height: 12px; border-radius: 50%; background-color: {t.accent};"></span>
                  </div>
                </button>
              {/each}
            </div>
          </div>

        <!-- ================= TAB 3: EDITOR & FILES ================= -->
        {:else if appState.settingsActiveTab === 'editor'}
          <!-- Diagram Editor Preferences -->
          <div class="form-group flex-col" style="gap: 8px;">
            <label class="form-label" style="font-weight: 700; display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sync-icon-accent">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
                <path d="M10 6.5h4a3 3 0 0 1 3 3V14"/>
              </svg>
              <span>Default Diagram Editor</span>
            </label>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
              <button
                class="theme-chip flex-row"
                style="background-color: var(--bg-mid-dark); border: 1px solid {appState.diagramEditorType === 'native' ? 'var(--accent)' : 'var(--border-color)'}; padding: 12px; border-radius: var(--radius-standard); flex-direction: column; align-items: flex-start; text-align: left; width: 100%; gap: 4px; transition: border-color 0.2s;"
                onclick={() => appState.setDiagramEditorType('native')}
              >
                <span style="font-size: 13px; font-weight: 700; color: {appState.diagramEditorType === 'native' ? 'var(--text-primary)' : 'var(--text-secondary)'};">Native</span>
                <span style="font-size: 10px; color: var(--text-tertiary);">Offline</span>
              </button>

              <button
                class="theme-chip flex-row"
                style="background-color: var(--bg-mid-dark); border: 1px solid {appState.diagramEditorType === 'drawio' ? 'var(--accent)' : 'var(--border-color)'}; padding: 12px; border-radius: var(--radius-standard); flex-direction: column; align-items: flex-start; text-align: left; width: 100%; gap: 4px; transition: border-color 0.2s;"
                onclick={() => appState.setDiagramEditorType('drawio')}
              >
                <span style="font-size: 13px; font-weight: 700; color: {appState.diagramEditorType === 'drawio' ? 'var(--text-primary)' : 'var(--text-secondary)'};">Draw.io</span>
                <span style="font-size: 10px; color: var(--text-tertiary);">Online</span>
              </button>

              <button
                class="theme-chip flex-row"
                style="background-color: var(--bg-mid-dark); border: 1px solid {appState.diagramEditorType === 'mermaid' ? 'var(--accent)' : 'var(--border-color)'}; padding: 12px; border-radius: var(--radius-standard); flex-direction: column; align-items: flex-start; text-align: left; width: 100%; gap: 4px; transition: border-color 0.2s;"
                onclick={() => appState.setDiagramEditorType('mermaid')}
              >
                <span style="font-size: 13px; font-weight: 700; color: {appState.diagramEditorType === 'mermaid' ? 'var(--text-primary)' : 'var(--text-secondary)'};">Mermaid</span>
                <span style="font-size: 10px; color: var(--text-tertiary);">AI syntax</span>
              </button>
            </div>
          </div>

          <div class="form-group flex-col" style="margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 20px; gap: 8px;">
            <label class="form-label" style="font-weight: 700; display: flex; align-items: center; gap: 8px;">
              <FolderOpen size={18} class="sync-icon-accent" />
              <span>File Operations</span>
            </label>

            <!-- Import Note Button (Mobile / Desktop settings) -->
            <div class="flex-col" style="gap: 12px; width: 100%;">
              <div class="flex-row" style="justify-content: space-between; background-color: var(--bg-mid-dark); padding: 12px; border-radius: var(--radius-standard); border: 1px solid var(--border-color); width: 100%;">
                <div class="flex-col">
                  <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">Import .mynote File</span>
                  <span style="font-size: 10px; color: var(--text-tertiary); margin-top: 2px;">Restores custom exported note format</span>
                </div>
                <input 
                  type="file" 
                  accept=".mynote" 
                  bind:this={fileInput} 
                  onchange={handleImportFile} 
                  style="display: none;" 
                />
                <button 
                  class="btn-pill btn-pill-outline" 
                  style="padding: 6px 12px; font-size: 11px;"
                  onclick={triggerImport}
                >
                  Import
                </button>
              </div>

              <!-- Vault Details -->
              <div class="flex-col" style="background-color: var(--bg-mid-dark); padding: 12px; border-radius: var(--radius-standard); border: 1px solid var(--border-color); font-size: 11px; color: var(--text-secondary); gap: 4px; width: 100%;">
                <span style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Vault Details</span>
                <span>Active Vault: <b>{appState.vaultName || 'Local Sandbox'}</b></span>
                <span>Total notes: <b>{appState.notes.length}</b></span>
              </div>
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>
{/if}

<!-- Toast Notifications Container -->
<div class="toast-container flex-col">
  {#each appState.toasts as toast (toast.id)}
    <div class="toast-item {toast.type} flex-row" class:loading={toast.loading}>
      <div class="toast-icon-wrapper flex-row">
        {#if toast.loading}
          <svg class="toast-spinner spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="8.46" y2="8.46"></line>
            <line x1="15.54" y1="15.54" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="8.46" y2="15.54"></line>
            <line x1="15.54" y1="8.46" x2="19.07" y2="4.93"></line>
          </svg>
        {:else if toast.type === 'success'}
          <svg class="toast-icon success" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        {:else if toast.type === 'error'}
          <svg class="toast-icon error" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        {:else if toast.type === 'warning'}
          <svg class="toast-icon warning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        {:else}
          <svg class="toast-icon info" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        {/if}
      </div>
      <div class="toast-body flex-col">
        {#if toast.title}
          <span class="toast-title">{toast.title}</span>
        {/if}
        <span class="toast-message">{toast.message}</span>
      </div>
      <button class="toast-close-btn flex-row" onclick={() => appState.dismissToast(toast.id)} aria-label="Close notification">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  {/each}
</div>

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

  /* ============================================== */
  /* Desktop Layout Styles                          */
  /* ============================================== */
  .desktop-app {
    display: flex;
    width: 100%;
    height: 100%;
    background-color: var(--bg-base);
    overflow: hidden;
  }

  .editor-panel {
    flex-grow: 1;
    height: 100%;
    overflow: hidden;
  }

  /* ============================================== */
  /* Mobile Android Layout Styles                   */
  /* ============================================== */
  .mobile-app {
    width: 100%;
    height: 100%;
    background-color: #000000;
    overflow: hidden;
    position: relative;
  }

  .mobile-content {
    flex-grow: 1;
    overflow-y: auto;
    padding-bottom: 90px; /* space for bottom nav and FAB */
    min-height: 0;
    -webkit-overflow-scrolling: touch;
  }

  .mobile-tab-view {
    padding: 24px 16px;
    gap: 20px;
    min-height: 100%;
  }

  .mobile-header {
    justify-content: space-between;
  }

  .mobile-header h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }

  .home-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }

  /* Recent Note Cards List */
  .recent-cards-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .recent-note-card {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: 14px 16px;
    text-align: left;
    width: 100%;
    gap: 8px;
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
  }

  .recent-note-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    border-color: var(--border-highlight);
  }

  .recent-note-card:active {
    transform: translateY(0) scale(0.98);
    background-color: var(--bg-mid-dark);
  }

  .card-header-row {
    justify-content: space-between;
    width: 100%;
  }

  .card-note-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-note-time {
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .card-note-snippet {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: left;
  }

  .card-notebook-badge {
    font-size: 9px;
    font-weight: 700;
    color: var(--accent);
    background-color: rgba(0, 173, 181, 0.08);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    align-self: flex-start;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Cards */
  .daily-prompt-card {
    padding: 12px 16px;
    gap: 12px;
    border-radius: var(--radius-comfortable);
    cursor: pointer;
  }

  .card-art {
    font-size: 32px;
  }

  .card-text {
    flex-grow: 1;
  }

  .card-headline {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-sub {
    font-size: 10px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .arrow-accent {
    color: var(--accent);
  }

  /* Search Input Mobile */
  .mobile-search-bar {
    background-color: var(--bg-surface);
    border-radius: var(--radius-subtle);
    padding: 8px 12px;
    gap: 8px;
    width: 100%;
  }

  .mobile-search-input {
    width: 100%;
    font-size: 13px;
    color: var(--text-primary);
  }

  .mobile-search-input::placeholder {
    color: var(--text-tertiary);
  }

  /* Notebook search lists */
  .notebook-row {
    transition: transform 0.15s ease, background-color 0.2s ease;
  }

  .notebook-row:active {
    transform: scale(0.98);
    background-color: var(--bg-mid-dark) !important;
  }

  /* Search Result List */
  .search-results, .mobile-notes-list {
    gap: 8px;
  }

  .search-result-row {
    width: 100%;
    padding: 6px 4px;
    gap: 12px;
    text-align: left;
    border-radius: var(--radius-standard);
    transition: background-color 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .search-result-row:hover {
    background-color: var(--bg-surface);
    transform: translateX(4px);
  }

  .search-result-row:active {
    background-color: rgba(255, 255, 255, 0.05);
    transform: scale(0.98);
  }

  .row-art {
    width: 38px;
    height: 38px;
    background-color: var(--bg-surface);
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .row-info {
    overflow: hidden;
  }

  .row-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-sub {
    font-size: 10px;
    color: var(--text-secondary);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Library Tab */
  .mobile-library-header {
    justify-content: space-between;
  }

  .icon-circle-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    justify-content: center;
  }

  .mobile-folder-form {
    width: 100%;
  }

  .mobile-folder-input {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    padding: 10px 14px;
    border-radius: var(--radius-subtle);
    width: 100%;
    font-size: 13px;
  }

  .mobile-folder-input:focus {
    border-color: var(--accent);
  }

  .lib-filters {
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
    -webkit-overflow-scrolling: touch;
  }

  .lib-filters::-webkit-scrollbar {
    display: none;
  }

  .lib-filter-pill {
    padding: 6px 12px;
    border-radius: var(--radius-full-pill);
    background-color: var(--bg-surface);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .lib-filter-pill.active {
    background-color: var(--accent);
    color: #000000;
  }

  .list-meta {
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-secondary);
    padding: 4px;
  }

  .add-note-mobile {
    padding: 4px 10px;
    font-size: 10px;
  }

  .empty-lib {
    padding: 40px 0;
    align-items: center;
    gap: 8px;
    color: var(--text-tertiary);
  }

  .empty-lib span {
    font-size: 36px;
  }

  .empty-lib .title {
    font-size: 12px;
  }

  /* Daily Tab */
  .daily-view {
    gap: 20px;
  }

  .daily-hero {
    align-items: center;
    text-align: center;
    padding: 24px 16px;
    gap: 10px;
  }

  .hero-art {
    font-size: 48px;
  }

  .daily-hero h2 {
    font-size: 16px;
    font-weight: 700;
  }

  .daily-hero p {
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 240px;
    line-height: 1.5;
  }

  .hero-btn {
    margin-top: 8px;
    font-size: 11px;
  }

  .daily-history {
    gap: 8px;
  }

  /* Mobile Bottom Navigation Bar - Floating Pill */
  .android-bottom-nav {
    position: absolute;
    bottom: 16px;
    left: 16px;
    right: 16px;
    height: 56px;
    background-color: var(--bg-surface);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-pill);
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
    justify-content: space-around;
    z-index: 10;
    padding: 0 8px;
  }

  .nav-tab {
    padding: 6px 12px;
    color: var(--text-secondary);
    gap: 2px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
    transition: all 0.2s ease;
  }

  .nav-tab.active {
    color: var(--accent);
    background-color: rgba(255, 255, 255, 0.04);
  }

  .nav-tab span {
    font-size: 9px;
    font-weight: 750;
  }

  /* Floating Action Button (FAB) */
  .mobile-fab {
    position: absolute;
    bottom: 88px; /* sits above floating bottom nav */
    right: 20px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background-color: var(--accent);
    color: #000000;
    box-shadow: 0 4px 16px rgba(0, 173, 181, 0.35);
    justify-content: center;
    z-index: 20;
    transition: transform 0.15s ease, background-color 0.2s;
  }

  .mobile-fab:active {
    transform: scale(0.9);
  }

  /* Full-Screen Mobile Editor Overlay */
  .mobile-editor-container {
    width: 100%;
    height: 100%;
    background-color: var(--bg-base);
    z-index: 50;
    position: absolute;
    top: 0;
    left: 0;
  }

  .mobile-editor-top {
    height: 56px;
    background-color: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
    padding: 0 16px;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .back-btn {
    color: var(--text-primary);
    font-weight: 700;
    gap: 4px;
  }

  .back-text {
    font-size: 14px;
  }

  .editor-note-meta {
    align-items: center;
    max-width: 50%;
  }

  .small-tag {
    font-size: 8px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
  }

  .note-name-header {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
    margin-top: 2px;
  }

  .save-icon-btn {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-secondary);
    padding: 6px 12px;
    border-radius: var(--radius-pill);
    background-color: var(--bg-mid-dark);
  }

  .save-icon-btn.dirty {
    background-color: var(--accent);
    color: #000000;
  }

  .mobile-editor-wrapper {
    flex-grow: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* ============================================== */
  /* Settings Modal Styles                          */
  /* ============================================== */
  .settings-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(12px);
    z-index: 1000;
    justify-content: center;
    align-items: center;
  }

  .settings-modal {
    background-color: #181818;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    width: 90%;
    max-width: 480px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-heavy);
    overflow: hidden;
  }

  @keyframes settings-slide-up {
    from {
      transform: translateY(20px) scale(0.95);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  .settings-header {
    padding: 18px 24px;
    border-bottom: 1px solid var(--border-color);
    justify-content: space-between;
  }

  .settings-title {
    font-size: 16px;
    font-weight: 800;
    gap: 10px;
    color: var(--text-primary);
  }

  .sync-icon-accent {
    color: var(--accent);
  }

  .close-btn {
    color: var(--text-secondary);
    transition: color 0.2s;
    background: transparent;
    padding: 4px;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .settings-content {
    padding: 24px;
    gap: 20px;
    overflow-y: auto;
    flex-grow: 1;
    min-height: 0;
    -webkit-overflow-scrolling: touch;
  }

  .form-group {
    gap: 8px;
  }

  .form-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .client-id-input {
    font-size: 13px;
    border: 1px solid var(--border-color);
  }

  .client-id-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .connect-btn {
    width: 100%;
    justify-content: center;
    padding: 12px;
    font-size: 13px;
    margin-bottom: 12px;
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .helper-card {
    background-color: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: 16px;
    gap: 8px;
  }

  .helper-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .helper-steps {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.6;
    padding-left: 16px;
  }

  .helper-steps li {
    margin-bottom: 6px;
  }

  .helper-steps li::marker {
    color: var(--accent);
    font-weight: bold;
  }

  .link-accent {
    color: var(--accent);
    text-decoration: underline;
  }

  .link-accent:hover {
    color: var(--accent-hover);
  }

  /* Connected Card Styles */
  .connected-card {
    background-color: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: 20px;
    gap: 20px;
  }

  .status-row {
    gap: 14px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--accent);
    position: relative;
  }

  .status-dot.syncing {
    background-color: var(--semantic-info);
    animation: status-pulse 1s infinite alternate;
  }

  .status-dot.error {
    background-color: var(--semantic-error);
  }

  @keyframes status-pulse {
    from { opacity: 0.4; }
    to { opacity: 1; }
  }

  .email-text {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .status-text {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .sync-stats {
    border-top: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    padding: 12px 0;
    gap: 8px;
  }

  .stat-row {
    justify-content: space-between;
    font-size: 12px;
  }

  .stat-label {
    color: var(--text-secondary);
  }

  .stat-val {
    font-weight: 600;
    color: var(--text-primary);
  }

  .sync-actions {
    gap: 12px;
  }

  .sync-now-btn {
    flex-grow: 1;
    justify-content: center;
    padding: 10px;
  }

  .btn-logout {
    border: 1px solid var(--semantic-error);
    color: var(--semantic-error);
    padding: 10px 16px;
    border-radius: var(--radius-pill);
    font-weight: 750;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: background-color 0.2s, color 0.2s;
  }

  .btn-logout:hover {
    background-color: rgba(243, 114, 127, 0.1);
  }

  .spin {
    animation: sync-spin 1s linear infinite;
  }

  @keyframes sync-spin {
    to { transform: rotate(360deg); }
  }

  /* ============================================== */
  /* Toast Notification System Styles               */
  /* ============================================== */
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    gap: 10px;
    max-width: 380px;
    width: calc(100vw - 48px);
    pointer-events: none;
  }

  .toast-item {
    pointer-events: auto;
    background: rgba(18, 20, 24, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-standard, 10px);
    padding: 12px 16px;
    box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.5);
    color: var(--text-primary, #ffffff);
    gap: 12px;
    align-items: flex-start;
    animation: toast-slide-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    transition: opacity 0.25s, transform 0.25s, border-color 0.25s;
    position: relative;
    overflow: hidden;
  }

  /* Success Theme */
  .toast-item.success {
    border-left: 4px solid #10b981;
    background: rgba(10, 25, 20, 0.88);
  }
  .toast-icon.success {
    color: #10b981;
  }

  /* Error Theme */
  .toast-item.error {
    border-left: 4px solid #ef4444;
    background: rgba(30, 15, 15, 0.88);
  }
  .toast-icon.error {
    color: #ef4444;
  }

  /* Warning Theme */
  .toast-item.warning {
    border-left: 4px solid #f59e0b;
    background: rgba(30, 24, 15, 0.88);
  }
  .toast-icon.warning {
    color: #f59e0b;
  }

  /* Info Theme */
  .toast-item.info {
    border-left: 4px solid var(--accent, #38bdf8);
    background: rgba(15, 22, 30, 0.88);
  }
  .toast-icon.info {
    color: var(--accent, #38bdf8);
  }

  /* Loading State Spinner */
  .toast-item.loading {
    border-left: 4px solid var(--accent, #38bdf8);
  }
  .toast-spinner {
    color: var(--accent, #38bdf8);
  }

  .toast-icon-wrapper {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .toast-body {
    flex-grow: 1;
    gap: 2px;
    min-width: 0;
  }

  .toast-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .toast-message {
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-secondary, #a1a1aa);
    word-break: break-word;
  }

  .toast-close-btn {
    background: transparent;
    border: none;
    padding: 4px;
    margin: -4px;
    color: var(--text-secondary);
    opacity: 0.5;
    cursor: pointer;
    border-radius: 4px;
    transition: opacity 0.2s, background-color 0.2s;
    flex-shrink: 0;
  }

  .toast-close-btn:hover {
    opacity: 1;
    background-color: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }

  @keyframes toast-slide-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Responsive Rules for Mobile viewports */
  @media (max-width: 768px) {
    .toast-container {
      bottom: 74px; /* offset for mobile bottom navigation tab bar */
      right: 16px;
      left: 16px;
      max-width: none;
      width: calc(100% - 32px);
    }
    .toast-item {
      width: 100%;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
  }

  /* Switch / Toggle styling */
  .switch-container {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 20px;
    flex-shrink: 0;
  }
  .switch-container input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color);
    transition: .2s;
    border-radius: 20px;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .2s;
    border-radius: 50%;
  }
  input:checked + .slider {
    background-color: var(--accent);
  }
  input:checked + .slider:before {
    transform: translateX(18px);
  }

  /* Mobile Dropdown Menu (Chrome style) */
  .mobile-more-menu-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: transparent;
    z-index: 999;
  }

  .mobile-more-menu {
    position: absolute;
    right: 16px;
    top: 48px;
    width: 220px;
    background: rgba(22, 22, 22, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(255, 255, 255, 0.05);
    z-index: 1000;
    padding: 6px 0;
    overflow: hidden;
  }

  .mobile-more-menu-content {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .mobile-more-menu .menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    font-size: 13px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    text-align: left;
    width: 100%;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .mobile-more-menu .menu-item:hover,
  .mobile-more-menu .menu-item:active {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .mobile-more-menu .menu-item :global(.menu-item-icon) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .mobile-more-menu .menu-item:hover :global(.menu-item-icon) {
    color: var(--text-primary);
  }

  .mobile-more-menu .menu-divider {
    height: 1px;
    background-color: var(--border-color);
    margin: 6px 0;
    width: 100%;
  }

  .mobile-more-menu .menu-item.delete-item {
    color: var(--semantic-error, #ff4d4d);
  }

  .mobile-more-menu .menu-item.delete-item:hover {
    background-color: rgba(255, 77, 77, 0.1);
    color: var(--semantic-error, #ff4d4d);
  }

  .mobile-more-menu .menu-item.delete-item :global(.menu-item-icon) {
    color: var(--semantic-error, #ff4d4d);
  }

  /* Make sure the direct icon buttons match desktop style */
  .mobile-action-btn {
    transition: color 0.15s, transform 0.1s;
  }
  .mobile-action-btn:active {
    transform: scale(0.9);
  }

  .notebook-select-list {
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
  }

  .notebook-select-row {
    background: transparent;
    border: none;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    color: var(--text-primary);
    font-size: 13px;
    transition: background-color 0.15s;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    box-sizing: border-box;
  }

  .notebook-select-row:last-child {
    border-bottom: none;
  }

  .notebook-select-row:hover {
    background: var(--bg-hover);
  }

  .notebook-select-row.selected {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
  }

  .folder-icon {
    font-size: 16px;
  }

  .folder-name {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-checkmark {
    color: var(--accent);
    font-weight: bold;
    font-size: 14px;
  }
</style>
