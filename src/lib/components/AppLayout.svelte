<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../stores/appState.svelte';
  import Sidebar from './Sidebar.svelte';
  import NoteList from './NoteList.svelte';
  import Editor from './Editor.svelte';
  import GraphView from './GraphView.svelte';
  import { 
    Home, Search, Library, Calendar, ChevronLeft, Plus, 
    FileText, Tag, FolderPlus, Compass, ArrowRight, Settings,
    X, Cloud, RefreshCw, LogOut, Moon, Sun
  } from 'lucide-svelte';

  // Responsive state
  let isMobile = $state(false);
  let showGraph = $state(false);
  let mobileSearchInput = $state('');
  let newMobileFolder = $state('');
  let showMobileFolderForm = $state(false);

  // Time-based greeting helper
  let greeting = $derived.by(() => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good morning';
    if (hours < 17) return 'Good afternoon';
    return 'Good evening';
  });

  // Handle window resizing
  function handleResize() {
    isMobile = window.innerWidth < 768;
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
        <div class="mobile-editor-wrapper">
          <Editor bind:showGraph={showGraph} />
        </div>
      </div>
    {:else}
      <!-- Main Mobile Navigation Tabs -->
      <div class="mobile-content flex-grow">
        <!-- 1. HOME TAB -->
        {#if appState.activeTab === 'home'}
          <div class="mobile-tab-view flex-col">
            <div class="mobile-header flex-row" style="justify-content: space-between; width: 100%;">
              <h1>{greeting}</h1>
              <button 
                class="icon-circle-btn flex-row" 
                onclick={() => appState.showSettings = true}
                aria-label="Settings"
              >
                <Settings size={20} />
              </button>
            </div>

            <!-- Recently Played Notes (2x3 Grid) -->
            <div class="home-section">
              <h2 class="section-title">Recently Opened</h2>
              <div class="recent-grid">
                {#each appState.recentNotes as note}
                  <button class="recent-tile flex-row" onclick={() => appState.selectNote(note.path)}>
                    <div class="tile-art flex-row">🎵</div>
                    <span class="tile-title">{note.name}</span>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Tags Carousel Section -->
            <div class="home-section">
              <h2 class="section-title">Popular Tags</h2>
              <div class="tags-carousel flex-row">
                {#each appState.tags.slice(0, 8) as [tag, count]}
                  <button 
                    class="tag-pill flex-row" 
                    onclick={() => {
                      appState.activeTag = tag;
                      appState.activeTab = 'search';
                    }}
                  >
                    #{tag} <span class="badge">{count}</span>
                  </button>
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

        <!-- 2. SEARCH TAB -->
        {:else if appState.activeTab === 'search'}
          <div class="mobile-tab-view flex-col">
            <div class="mobile-header">
              <h1>Search</h1>
            </div>

            <div class="mobile-search-bar flex-row">
              <Search size={20} class="search-icon" />
              <input 
                type="text" 
                placeholder="Search notes, folders, tags..." 
                bind:value={mobileSearchInput}
                oninput={() => appState.searchQuery = mobileSearchInput}
                class="mobile-search-input"
              />
            </div>

            {#if appState.searchQuery.trim()}
              <!-- Search Results -->
              <div class="search-results flex-col">
                <span class="section-title">Tracks (Notes)</span>
                {#each appState.filteredNotes as note}
                  <button class="search-result-row flex-row" onclick={() => appState.selectNote(note.path)}>
                    <div class="row-art">📄</div>
                    <div class="row-info flex-col">
                      <span class="row-title">{note.name}</span>
                      <span class="row-sub">{note.path}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {:else}
              <!-- Browse Categories (Colored Tags Grid) -->
              <div class="browse-categories flex-col">
                <span class="section-title">Browse all tags</span>
                <div class="browse-grid">
                  <!-- Custom styled colored cards -->
                  {#each appState.tags as [tag, _], index}
                    <!-- Cycle through distinct Spotify category colors -->
                    {@const colors = ['#E8115B', '#BC4639', '#1C8A43', '#1E3264', '#E1118C', '#E91429', '#27856A', '#608108']}
                    {@const color = colors[index % colors.length]}
                    <button 
                      class="browse-card" 
                      style="background-color: {color};"
                      onclick={() => {
                        appState.activeTag = tag;
                        mobileSearchInput = `#${tag}`;
                        appState.searchQuery = tag;
                      }}
                    >
                      <span class="category-name">#{tag}</span>
                    </button>
                  {:else}
                    <div class="empty-browse">No categories available. Add tags like #work or #personal.</div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

        <!-- 3. LIBRARY TAB -->
        {:else if appState.activeTab === 'library'}
          <div class="mobile-tab-view flex-col">
            <!-- Library Header -->
            <div class="mobile-header mobile-library-header flex-row">
              <h1>Your Library</h1>
              <div class="flex-row" style="gap: 12px;">
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
              <form onsubmit={createMobileFolder} class="mobile-folder-form">
                <input 
                  type="text" 
                  placeholder="Notebook Name..." 
                  bind:value={newMobileFolder}
                  class="mobile-folder-input"
                  required
                  autofocus
                />
              </form>
            {/if}

            <!-- Filter Categories Row -->
            <div class="lib-filters flex-row">
              <button 
                class="lib-filter-pill" 
                class:active={appState.activeNotebook === null}
                onclick={() => appState.activeNotebook = null}
              >
                All Playlists
              </button>
              {#each appState.notebooks as notebook}
                <button 
                  class="lib-filter-pill" 
                  class:active={appState.activeNotebook === notebook}
                  onclick={() => appState.activeNotebook = notebook}
                >
                  {notebook}
                </button>
              {/each}
            </div>

            <!-- Notebook Files Playlist -->
            <div class="mobile-notes-list flex-col">
              <div class="list-meta flex-row">
                <span>{appState.filteredNotes.length} notes</span>
                <button class="btn-pill btn-pill-primary add-note-mobile" onclick={() => {
                  const title = prompt('Enter note title:', 'New Note');
                  if (title) appState.createNote(title, appState.activeNotebook);
                }}>
                  <Plus size={14} /> Add
                </button>
              </div>

              {#each appState.filteredNotes as note}
                <button class="search-result-row flex-row" onclick={() => appState.selectNote(note.path)}>
                  <div class="row-art">📄</div>
                  <div class="row-info flex-col">
                    <span class="row-title">{note.name}</span>
                    <span class="row-sub">{note.path}</span>
                  </div>
                </button>
              {:else}
                <div class="empty-lib flex-col">
                  <span>📂</span>
                  <span class="title">Empty Playlist</span>
                </div>
              {/each}
            </div>
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

      <!-- Android Bottom Navigation Bar (Spotify Style) -->
      <div class="android-bottom-nav flex-row">
        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'home'} 
          onclick={() => { appState.activeTab = 'home'; appState.activeNotebook = null; appState.activeTag = null; }}
        >
          <Home size={22} />
          <span>Home</span>
        </button>
        
        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'search'} 
          onclick={() => { appState.activeTab = 'search'; appState.searchQuery = ''; mobileSearchInput = ''; }}
        >
          <Search size={22} />
          <span>Search</span>
        </button>
        
        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'library'} 
          onclick={() => { appState.activeTab = 'library'; appState.activeNotebook = null; appState.activeTag = null; }}
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
  <div class="desktop-app flex-row">
    <!-- Left Sidebar (Notebook / Tag Selection) -->
    <Sidebar />

    <!-- Middle Panel (Note list) -->
    <NoteList />

    <!-- Right Panel (Editor) -->
    <div class="editor-panel flex-row">
      <Editor bind:showGraph={showGraph} />
      
      <!-- Far Right Graph visualizer (Collapsible) -->
      {#if showGraph}
        <GraphView />
      {/if}
    </div>
  </div>
{/if}

<!-- Settings Modal Overlay -->
{#if appState.showSettings}
  <div class="settings-backdrop flex-row" onclick={(e) => { if (e.target === e.currentTarget) appState.showSettings = false; }} role="presentation">
    <div class="settings-modal flex-col">
      <div class="settings-header flex-row">
        <div class="settings-title flex-row">
          <Cloud size={20} class="sync-icon-accent" />
          <span>Google Drive Sync</span>
        </div>
        <button class="close-btn flex-row" onclick={() => appState.showSettings = false} aria-label="Close settings">
          <X size={18} />
        </button>
      </div>

      <div class="settings-content flex-col">
        <!-- General Settings (Mobile friendly / accessible) -->
        <span class="settings-section-title">General Settings</span>
        
        <div class="form-group flex-col" style="gap: 8px;">
          <span class="form-label">Theme</span>
          <button 
            class="btn-pill btn-pill-outline flex-row" 
            style="justify-content: center; width: 100%; gap: 8px;"
            onclick={() => {
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
            }}
          >
            {#if appState.theme === 'dark'}
              <Moon size={14} />
              <span>Amoled Black Theme</span>
            {:else}
              <Sun size={14} />
              <span>Standard Dark Theme</span>
            {/if}
          </button>
        </div>

        <div class="form-group flex-col" style="margin-bottom: 8px; gap: 8px;">
          <span class="form-label">Active Directory</span>
          <div class="flex-row" style="justify-content: space-between; gap: 8px; background-color: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: var(--radius-standard); border: 1px solid var(--border-color);">
            <span style="font-size: 11px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 60%;">
              {appState.vaultName || 'None Loaded'}
            </span>
            <button 
              class="btn-pill btn-pill-outline flex-row" 
              onclick={() => {
                appState.showSettings = false;
                appState.openDirectory();
              }}
              style="padding: 6px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase;"
            >
              Change Folder
            </button>
          </div>
        </div>

        <!-- Recent Folders (Mobile Swapper) -->
        {#if appState.recentFolders.length > 0}
          <div class="form-group flex-col" style="gap: 6px; margin-top: 4px;">
            <span class="form-label">Switch Recent Folder</span>
            <div class="recent-folders-mobile flex-col" style="gap: 4px; max-height: 120px; overflow-y: auto;">
              <!-- Local Sandbox Option -->
              <div class="recent-folder-row-mobile flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
                <button 
                  class="btn-recent-folder-mobile"
                  class:active={appState.vaultName === 'Local Sandbox' || appState.vaultName === null}
                  onclick={() => {
                    appState.showSettings = false;
                    appState.selectRecentFolder('Local Sandbox');
                  }}
                  style="flex-grow: 1; text-align: left; background: transparent; border: none; padding: 6px 8px; border-radius: var(--radius-small); font-size: 12px; color: var(--text-secondary);"
                >
                  ⭐ Local Sandbox
                </button>
              </div>

              {#each appState.recentFolders as folder}
                <div class="recent-folder-row-mobile flex-row" style="justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
                  <button 
                    class="btn-recent-folder-mobile"
                    class:active={appState.vaultName === folder.name}
                    onclick={() => {
                      appState.showSettings = false;
                      appState.selectRecentFolder(folder.name);
                    }}
                    style="flex-grow: 1; text-align: left; background: transparent; border: none; padding: 6px 8px; border-radius: var(--radius-small); font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  >
                    📂 {folder.name}
                  </button>
                  <button 
                    onclick={() => appState.removeRecentFolder(folder.name)}
                    style="background: transparent; border: none; padding: 6px; color: var(--text-tertiary);"
                    aria-label="Remove folder"
                  >
                    <X size={12} />
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <span class="settings-section-title" style="margin-top: 8px; border-top: 1px solid var(--border-color); padding-top: 16px;">Google Drive Sync</span>

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

        {#if !appState.googleConnected}
          <div class="auth-section flex-col">
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
                  {:else}
                    Connected & Sync Enabled
                  {/if}
                </span>
              </div>
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
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

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
    width: 100vw;
    height: 100vh;
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
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    background-color: #000000;
    overflow: hidden;
    position: relative;
  }

  .mobile-content {
    overflow-y: auto;
    padding-bottom: 70px; /* space for bottom nav */
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

  /* Recent Grid (2x3 tiles) */
  .recent-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .recent-tile {
    background-color: rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-subtle);
    padding: 0;
    text-align: left;
    height: 48px;
    overflow: hidden;
    gap: 8px;
    transition: background-color 0.2s;
  }

  .recent-tile:active {
    background-color: rgba(255, 255, 255, 0.15);
  }

  .tile-art {
    width: 48px;
    height: 48px;
    background-color: var(--bg-surface);
    font-size: 18px;
    justify-content: center;
    flex-shrink: 0;
  }

  .tile-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 8px;
  }

  /* Tags Carousel */
  .tags-carousel {
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scroll-snap-type: x mandatory;
  }

  .tags-carousel::-webkit-scrollbar {
    display: none; /* Hide scrollbars for app feel */
  }

  .tag-pill {
    background-color: var(--bg-surface);
    color: var(--text-primary);
    padding: 6px 12px;
    border-radius: var(--radius-full-pill);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    gap: 4px;
  }

  .tag-pill .badge {
    background-color: var(--bg-mid-dark);
    padding: 2px 6px;
    border-radius: 50%;
    font-size: 9px;
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

  /* Browse Category Grid */
  .browse-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 8px;
  }

  .browse-card {
    height: 90px;
    border-radius: var(--radius-comfortable);
    padding: 12px;
    text-align: left;
    position: relative;
    overflow: hidden;
  }

  .browse-card:active {
    transform: scale(0.97);
  }

  .category-name {
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
    word-break: break-all;
  }

  .empty-browse {
    grid-column: 1 / span 2;
    text-align: center;
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 24px 0;
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
  }

  .search-result-row:active {
    background-color: rgba(255, 255, 255, 0.05);
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

  /* Mobile Bottom Navigation Bar */
  .android-bottom-nav {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    background-color: rgba(24, 24, 24, 0.95);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--border-color);
    justify-content: space-around;
    z-index: 10;
  }

  .nav-tab {
    padding: 8px 12px;
    color: var(--text-secondary);
    gap: 4px;
    align-items: center;
    transition: color 0.2s;
  }

  .nav-tab.active {
    color: var(--text-primary);
  }

  .nav-tab span {
    font-size: 9px;
    font-weight: 600;
  }

  /* Full-Screen Mobile Editor Overlay */
  .mobile-editor-container {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    background-color: var(--bg-base);
    z-index: 50;
    position: absolute;
    top: 0;
    left: 0;
  }



  .mobile-editor-wrapper {
    flex-grow: 1;
    overflow: hidden;
  }

  /* ============================================== */
  /* Settings Modal Styles                          */
  /* ============================================== */
  .settings-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
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
    box-shadow: var(--shadow-heavy);
    animation: settings-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
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
    gap: 16px;
  }

  .settings-section-title {
    font-size: 11px;
    font-weight: 800;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 4px;
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

  .btn-recent-folder-mobile {
    transition: background-color 0.2s, color 0.2s;
    cursor: pointer;
  }

  .btn-recent-folder-mobile:active {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .btn-recent-folder-mobile.active {
    color: var(--accent) !important;
    font-weight: 600;
    background-color: rgba(255, 255, 255, 0.03);
  }
</style>
