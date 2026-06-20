<script lang="ts">
  import { appState, generateHtmlNote, parseHtmlMetadata } from '../stores/appState.svelte';
  import {
    Cloud, CloudOff, RefreshCw, LogOut, Palette, Settings,
    FileText, FolderOpen, Calculator, Search, X, ChevronRight
  } from 'lucide-svelte';
  import Modal from './Modal.svelte';

  // --- Local State ---
  let showFolderPicker = $state(false);
  let newDriveFolderName = $state('');
  let mobilePastedToken = $state('');
  let searchQuery = $state('');
  let fileInput = $state<HTMLInputElement>();

  let activeThemeCategory = $state<'all' | 'light' | 'dark' | 'vivid'>('all');
  let displayedThemes = $derived(
    activeThemeCategory === 'all'
      ? appState.themes
      : appState.themes.filter((t: any) => t.category === activeThemeCategory)
  );

  // --- Nav Items ---
  const navItems = [
    { id: 'sync' as const, label: 'Cloud Sync', icon: Cloud },
    { id: 'styling' as const, label: 'Appearance', icon: Palette },
    { id: 'editor' as const, label: 'Editor & Files', icon: FileText },
    { id: 'calculation' as const, label: 'Calculation', icon: Calculator },
  ];

  // --- Search filtering ---
  const sectionKeywords: Record<string, string[]> = {
    sync: ['cloud', 'sync', 'google', 'drive', 'oauth', 'client', 'token', 'folder', 'connect', 'disconnect', 'email'],
    styling: ['theme', 'appearance', 'color', 'dark', 'light', 'vivid', 'look', 'style'],
    editor: ['editor', 'diagram', 'mermaid', 'drawio', 'native', 'import', 'export', 'file', 'tag', 'prune', 'vault', 'folder'],
    calculation: ['calculation', 'calc', 'currency', 'income', 'label', 'money', 'finance'],
  };

  let matchingTabs = $derived.by(() => {
    if (!searchQuery.trim()) return null; // null means "show all"
    const q = searchQuery.toLowerCase();
    const matches = new Set<string>();
    for (const [tab, keywords] of Object.entries(sectionKeywords)) {
      if (keywords.some(kw => kw.includes(q) || q.includes(kw))) {
        matches.add(tab);
      }
    }
    return matches;
  });

  let showCurrentTab = $derived(
    matchingTabs === null || matchingTabs.has(appState.settingsActiveTab)
  );

  // --- Handlers ---
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
        created: bundle.created || new Date().toISOString(),
        modified: new Date().toISOString()
      };
      const htmlContent = generateHtmlNote(meta, bundle.content);
      await appState.storage.writeNote(finalPath, htmlContent);
      await appState.refreshNotes();
      appState.selectNote(finalPath);
      appState.showSettings = false;
      appState.showToast(`Imported "${cleanTitle}" successfully`, 'success');
    } catch (e: any) {
      appState.showToast(e.message || 'Failed to import file', 'error');
    }
    input.value = '';
  }
</script>

<Modal
  show={appState.showSettings}
  title="Settings"
  onClose={() => appState.showSettings = false}
  maxWidth="680px"
  bodyStyle="padding: 0; display: flex; flex-direction: row; min-height: 420px; max-height: 70vh;"
>
  {#snippet titleIcon()}
    <Settings size={20} style="color: var(--accent);" />
  {/snippet}

  <!-- Left sidebar nav -->
  <nav class="settings-nav" aria-label="Settings navigation">
    {#each navItems as item}
      {@const isActive = appState.settingsActiveTab === item.id}
      {@const isMatch = matchingTabs === null || matchingTabs.has(item.id)}
      <button
        class="nav-item"
        class:active={isActive}
        class:dimmed={!isMatch}
        onclick={() => { appState.settingsActiveTab = item.id; searchQuery = ''; }}
        aria-current={isActive ? 'page' : undefined}
      >
        <svelte:component this={item.icon} size={16} />
        <span>{item.label}</span>
        {#if isActive}
          <ChevronRight size={14} class="nav-chevron" />
        {/if}
      </button>
    {/each}

    <div class="nav-spacer"></div>
    <div class="nav-footer">
      <span class="nav-version">MyNotes v1.0</span>
    </div>
  </nav>

  <!-- Right content panel -->
  <div class="settings-panel">
    <!-- Search -->
    <div class="settings-search">
      <Search size={14} style="color: var(--text-tertiary); flex-shrink: 0;" />
      <input
        type="text"
        placeholder="Search settings..."
        bind:value={searchQuery}
        class="search-input"
      />
      {#if searchQuery}
        <button class="search-clear" onclick={() => { searchQuery = ''; }}>
          <X size={12} />
        </button>
      {/if}
    </div>

    <div class="settings-content">
      {#if !showCurrentTab && matchingTabs !== null}
        <!-- Search didn't match current tab -->
        {#if matchingTabs.size > 0}
          <div class="search-redirect">
            <span class="search-redirect-text">Results found in:</span>
            {#each [...matchingTabs] as tabId}
              {@const item = navItems.find(n => n.id === tabId)}
              {#if item}
                <button class="search-redirect-btn" onclick={() => { appState.settingsActiveTab = item.id; }}>
                  <svelte:component this={item.icon} size={14} />
                  {item.label}
                </button>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="search-empty">
            <Search size={24} style="color: var(--text-tertiary);" />
            <span>No settings match "{searchQuery}"</span>
          </div>
        {/if}

      <!-- ==================== SYNC PANEL ==================== -->
      {:else if appState.settingsActiveTab === 'sync'}
        <div class="section-group">
          <span class="section-title">Connection</span>

          <!-- Client ID -->
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Google OAuth Client ID</span>
              <span class="setting-desc">Required to connect Google Drive</span>
            </div>
          </div>
          <input
            type="text"
            placeholder="Paste Google Client ID here..."
            value={appState.googleClientId}
            oninput={(e) => appState.setClientId(e.currentTarget.value)}
            disabled={appState.googleConnected}
            class="setting-input"
          />

          {#if typeof window !== 'undefined' && (window as any).Capacitor}
            <div class="setting-row" style="flex-direction: column; align-items: stretch;">
              <div class="setting-info">
                <span class="setting-label">OAuth Redirect URI</span>
                <span class="setting-desc">For mobile authentication</span>
              </div>
              <input
                type="text"
                placeholder="e.g. http://localhost"
                value={appState.googleRedirectUri}
                oninput={(e) => appState.setRedirectUri(e.currentTarget.value)}
                disabled={appState.googleConnected}
                class="setting-input"
                style="margin-top: var(--spacing-xs);"
              />
            </div>
          {/if}
        </div>

        {#if !appState.googleConnected}
          <div class="section-group">
            <span class="section-title">Authentication</span>

            {#if typeof window !== 'undefined' && (window as any).Capacitor}
              <!-- Mobile flow -->
              <div class="mobile-auth-card">
                <span class="mobile-auth-title">Mobile Google Sign-In</span>
                <p class="mobile-auth-desc">Due to Google security policies, authentication must occur in your secure system browser.</p>

                <button
                  class="action-btn primary"
                  onclick={() => {
                    const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" +
                      encodeURIComponent(appState.googleClientId) +
                      "&redirect_uri=" + encodeURIComponent(appState.googleRedirectUri) +
                      "&response_type=token&scope=" + encodeURIComponent("https://www.googleapis.com/auth/drive.file");
                    window.open(url, '_system');
                  }}
                  disabled={!appState.googleClientId || !appState.googleRedirectUri}
                >
                  1. Sign In via Browser
                </button>

                <div class="setting-info" style="margin-top: var(--spacing-xs);">
                  <span class="setting-label">2. Paste Redirected URL or Token</span>
                </div>
                <input
                  type="text"
                  placeholder="Paste the URL from the browser address bar..."
                  bind:value={mobilePastedToken}
                  class="setting-input"
                />

                <button
                  class="action-btn accent"
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
                  3. Verify & Connect
                </button>
              </div>
            {:else}
              <!-- Web flow -->
              <button
                class="action-btn primary full-width"
                onclick={async () => {
                  try {
                    await appState.connectGoogleDrive();
                  } catch (e: any) {
                    alert(e.message || 'Failed to connect to Google Drive');
                  }
                }}
                disabled={!appState.googleClientId}
              >
                Connect Google Drive
              </button>
            {/if}

            <div class="helper-card">
              <span class="helper-title">
                {typeof window !== 'undefined' && (window as any).Capacitor ? 'Mobile Setup Instructions:' : 'Setup Instructions:'}
              </span>
              <ol class="helper-steps">
                <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" class="link-accent">Google Cloud Console</a>.</li>
                {#if typeof window !== 'undefined' && (window as any).Capacitor}
                  <li>Inside your OAuth Client ID, add the Redirect URI (currently <code>{appState.googleRedirectUri || 'http://localhost'}</code>) under <b>Authorized Redirect URIs</b>.</li>
                  <li>Enter your Client ID in the field above.</li>
                  <li>Click <b>Sign In via Browser</b>, sign in, copy the URL, paste it above, and click <b>Verify</b>.</li>
                {:else}
                  <li>Create a project and set up the <b>OAuth consent screen</b> (User Type: External).</li>
                  <li>Add your Google account as a <b>Test User</b>.</li>
                  <li>Create <b>OAuth client ID</b> credentials (Application Type: Web Application).</li>
                  <li>Add <code>http://localhost:5173</code> (or your URL) under <b>Authorized JavaScript Origins</b>.</li>
                  <li>Copy the Client ID and paste it in the field above.</li>
                {/if}
              </ol>
            </div>
          </div>
        {:else}
          <!-- Connected state -->
          <div class="section-group">
            <span class="section-title">Account</span>
            <div class="connected-card">
              <div class="connected-row">
                <span class="connected-dot" class:syncing={appState.syncStatus === 'syncing'} class:error={appState.syncStatus === 'error'}></span>
                <div class="connected-info">
                  <span class="connected-email">{appState.googleUserEmail}</span>
                  <span class="connected-status">
                    {#if appState.syncStatus === 'syncing'}
                      Syncing database...
                    {:else if !appState.syncEnabled}
                      Connected · Sync Disabled
                    {:else}
                      Connected · Sync Enabled
                    {/if}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="section-group">
            <span class="section-title">Sync Options</span>

            <!-- Sync toggle -->
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Enable Google Drive Syncing</span>
                <span class="setting-desc">Automatically sync notes to your Drive folder</span>
              </div>
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

            <!-- Stats -->
            <div class="stat-grid">
              <div class="stat-item">
                <span class="stat-label">Last Sync</span>
                <span class="stat-value">{appState.lastSyncedTime ? new Date(appState.lastSyncedTime).toLocaleTimeString() : 'Never'}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Conflict Policy</span>
                <span class="stat-value">Last Modified Wins</span>
              </div>
            </div>

            <!-- Actions -->
            <div class="action-row">
              <button
                class="action-btn primary"
                onclick={async () => { await appState.syncNotes(); }}
                disabled={appState.syncStatus === 'syncing'}
              >
                <RefreshCw size={14} class={appState.syncStatus === 'syncing' ? 'spin' : ''} />
                Sync Now
              </button>
              <button
                class="action-btn danger"
                onclick={() => appState.disconnectGoogleDrive()}
              >
                <LogOut size={14} />
                Disconnect
              </button>
            </div>
          </div>

          <!-- Folder picker -->
          <div class="section-group">
            <span class="section-title">Sync Target Folder</span>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Active Folder</span>
                <span class="setting-desc">{appState.customDriveFolderName || 'MyNotes (Default)'}</span>
              </div>
              {#if !showFolderPicker}
                <button class="action-btn outline small" onclick={() => { showFolderPicker = true; appState.fetchGoogleDriveFolders(); }}>
                  Change
                </button>
              {/if}
            </div>

            {#if showFolderPicker}
              <div class="folder-picker">
                <div class="folder-picker-header">
                  <span>Choose from Drive</span>
                  <button class="link-accent" onclick={() => showFolderPicker = false}>Close</button>
                </div>

                {#if appState.fetchingFolders}
                  <div class="folder-loading">
                    <span class="spinner"></span>
                  </div>
                {:else}
                  <div class="folder-list">
                    <button
                      class="folder-item"
                      class:active={!appState.customDriveFolderId}
                      onclick={() => { appState.setCustomDriveFolder(null, null); showFolderPicker = false; }}
                    >
                      📁 MyNotes (Default)
                    </button>
                    {#each appState.googleDriveFolders as folder}
                      <button
                        class="folder-item"
                        class:active={appState.customDriveFolderId === folder.id}
                        onclick={() => { appState.setCustomDriveFolder(folder.id, folder.name); showFolderPicker = false; }}
                      >
                        📁 {folder.name}
                      </button>
                    {/each}
                  </div>

                  <div class="create-folder-row">
                    <input
                      type="text"
                      placeholder="New folder name..."
                      bind:value={newDriveFolderName}
                      class="setting-input"
                      style="flex: 1;"
                    />
                    <button
                      class="action-btn primary small"
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
        {/if}

      <!-- ==================== APPEARANCE PANEL ==================== -->
      {:else if appState.settingsActiveTab === 'styling'}
        <div class="section-group">
          <span class="section-title">Theme ({displayedThemes.length})</span>

          <!-- Category pills -->
          <div class="category-pills">
            {#each ['all', 'light', 'dark', 'vivid'] as cat}
              <button
                class="category-pill"
                class:active={activeThemeCategory === cat}
                onclick={() => activeThemeCategory = cat as any}
              >
                {cat}
              </button>
            {/each}
          </div>

          <!-- Theme grid -->
          <div class="theme-grid">
            {#each displayedThemes as t}
              <button
                class="theme-chip"
                class:selected={appState.theme === t.id}
                onclick={() => appState.setTheme(t.id)}
              >
                <span class="theme-name">{t.name}</span>
                <div class="theme-colors">
                  <span class="color-dot" style="background: {t.bg}; border: 1.5px solid color-mix(in srgb, var(--text-primary) 20%, transparent);"></span>
                  <span class="color-dot" style="background: {t.accent};"></span>
                </div>
              </button>
            {/each}
          </div>
        </div>

      <!-- ==================== EDITOR & FILES PANEL ==================== -->
      {:else if appState.settingsActiveTab === 'editor'}
        <div class="section-group">
          <span class="section-title">Diagram Editor</span>
          <div class="option-grid three-col">
            <button
              class="option-chip"
              class:selected={appState.diagramEditorType === 'native'}
              onclick={() => appState.setDiagramEditorType('native')}
            >
              <span class="option-name">Native</span>
              <span class="option-desc">Offline</span>
            </button>
            <button
              class="option-chip"
              class:selected={appState.diagramEditorType === 'drawio'}
              onclick={() => appState.setDiagramEditorType('drawio')}
            >
              <span class="option-name">Draw.io</span>
              <span class="option-desc">Online</span>
            </button>
            <button
              class="option-chip"
              class:selected={appState.diagramEditorType === 'mermaid'}
              onclick={() => appState.setDiagramEditorType('mermaid')}
            >
              <span class="option-name">Mermaid</span>
              <span class="option-desc">AI syntax</span>
            </button>
          </div>
        </div>

        <div class="section-group">
          <span class="section-title">File Operations</span>

          <!-- Import -->
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Import .mynote File</span>
              <span class="setting-desc">Restores custom exported note format</span>
            </div>
            <input
              type="file"
              accept=".mynote"
              bind:this={fileInput}
              onchange={handleImportFile}
              style="display: none;"
            />
            <button class="action-btn outline small" onclick={triggerImport}>
              Import
            </button>
          </div>

          <!-- Auto-prune -->
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Auto-prune Empty Tags</span>
              <span class="setting-desc">Delete tags when no notes use them</span>
            </div>
            <label class="switch-container">
              <input
                type="checkbox"
                checked={appState.autoPruneTags}
                onchange={(e) => appState.setAutoPruneTags(e.currentTarget.checked)}
              />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="section-group">
          <span class="section-title">Vault Information</span>
          <div class="vault-card">
            <div class="vault-row">
              <span class="vault-label">Active Vault</span>
              <span class="vault-value">{appState.vaultName || 'Local Sandbox'}</span>
            </div>
            <div class="vault-row">
              <span class="vault-label">Total Notes</span>
              <span class="vault-value">{appState.notes.length}</span>
            </div>
          </div>
        </div>

      <!-- ==================== CALCULATION PANEL ==================== -->
      {:else if appState.settingsActiveTab === 'calculation'}
        <div class="section-group">
          <span class="section-title">Calculation Defaults</span>

          <div class="setting-row" style="flex-direction: column; align-items: stretch; gap: var(--spacing-xs);">
            <div class="setting-info">
              <span class="setting-label">Default Currency Symbol</span>
              <span class="setting-desc">Used in calculation blocks for monetary values</span>
            </div>
            <input
              type="text"
              value={appState.defaultCurrency}
              oninput={(e) => appState.setDefaultCurrency(e.currentTarget.value)}
              class="setting-input"
              placeholder="₹"
              style="max-width: 120px;"
            />
          </div>

          <div class="setting-row" style="flex-direction: column; align-items: stretch; gap: var(--spacing-xs);">
            <div class="setting-info">
              <span class="setting-label">Default Income Label</span>
              <span class="setting-desc">Label used for income entries in calculation blocks</span>
            </div>
            <input
              type="text"
              value={appState.defaultIncomeLabel}
              oninput={(e) => appState.setDefaultIncomeLabel(e.currentTarget.value)}
              class="setting-input"
              placeholder="Income"
              style="max-width: 200px;"
            />
          </div>
        </div>
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* ===== Layout ===== */
  .settings-nav {
    width: 160px;
    min-width: 160px;
    background: var(--bg-base);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    padding: var(--spacing-sm) 0;
    gap: var(--spacing-3xs);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-md);
    background: none;
    border: none;
    border-left: 3px solid transparent;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard),
                border-color var(--motion-duration-fast) var(--motion-ease-standard);
    position: relative;
  }

  .nav-item:hover {
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
  }

  .nav-item.active {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text-primary);
    font-weight: var(--font-weight-semibold);
  }

  .nav-item.dimmed {
    opacity: 0.4;
  }

  :global(.nav-chevron) {
    margin-left: auto;
    color: var(--accent);
  }

  .nav-spacer {
    flex: 1;
  }

  .nav-footer {
    padding: var(--spacing-xs) var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  .nav-version {
    font-size: 10px;
    color: var(--text-tertiary);
    letter-spacing: 0.3px;
  }

  /* ===== Right Panel ===== */
  .settings-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .settings-search {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    font-family: inherit;
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-clear {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: var(--spacing-3xs);
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
  }

  .search-clear:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }

  /* ===== Search States ===== */
  .search-redirect {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    padding: var(--spacing-md);
  }

  .search-redirect-text {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .search-redirect-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm);
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    color: var(--accent);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .search-redirect-btn:hover {
    border-color: var(--accent);
  }

  .search-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-xl) 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }

  /* ===== Section Groups ===== */
  .section-group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .section-title {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  /* ===== Setting Row ===== */
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    gap: var(--spacing-sm);
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
    min-width: 0;
  }

  .setting-label {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    line-height: 1.3;
  }

  .setting-input {
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .setting-input:focus {
    border-color: var(--accent);
  }

  .setting-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ===== Toggle Switch ===== */
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
    top: 0; left: 0; right: 0; bottom: 0;
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

  /* ===== Action Buttons ===== */
  .action-row {
    display: flex;
    gap: var(--spacing-sm);
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-pill);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    border: none;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                opacity var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.primary {
    background: var(--accent);
    color: var(--bg-base);
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .action-btn.accent {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .action-btn.accent:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .action-btn.danger {
    background: none;
    border: 1px solid var(--semantic-error);
    color: var(--semantic-error);
  }

  .action-btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
  }

  .action-btn.outline {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
  }

  .action-btn.outline:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .action-btn.small {
    padding: var(--spacing-2xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
  }

  .action-btn.full-width {
    width: 100%;
    justify-content: center;
  }

  /* ===== Connected Card ===== */
  .connected-card {
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
  }

  .connected-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .connected-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .connected-dot.syncing {
    background: var(--semantic-info);
    animation: dot-pulse 1s infinite alternate;
  }

  .connected-dot.error {
    background: var(--semantic-error);
  }

  @keyframes dot-pulse {
    from { opacity: 0.4; }
    to { opacity: 1; }
  }

  .connected-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
  }

  .connected-email {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .connected-status {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  /* ===== Stat Grid ===== */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-xs);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
  }

  .stat-label {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-value {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  /* ===== Folder Picker ===== */
  .folder-picker {
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    max-height: 200px;
    overflow-y: auto;
  }

  .folder-picker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-secondary);
  }

  .folder-loading {
    display: flex;
    justify-content: center;
    padding: var(--spacing-sm) 0;
  }

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2xs);
  }

  .folder-item {
    background: none;
    border: none;
    text-align: left;
    padding: var(--spacing-xs);
    border-radius: var(--radius-subtle);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .folder-item:hover {
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }

  .folder-item.active {
    color: var(--accent);
  }

  .create-folder-row {
    display: flex;
    gap: var(--spacing-xs);
    border-top: 1px dashed var(--border-color);
    padding-top: var(--spacing-xs);
  }

  /* ===== Theme Grid ===== */
  .category-pills {
    display: flex;
    gap: var(--spacing-xs);
  }

  .category-pill {
    border: none;
    cursor: pointer;
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    border-radius: var(--radius-pill);
    transition: all var(--motion-duration-fast) var(--motion-ease-standard);
    background: var(--bg-base);
    color: var(--text-secondary);
    font-family: inherit;
  }

  .category-pill.active {
    background: var(--accent);
    color: var(--bg-base);
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-xs);
    max-height: 35vh;
    overflow-y: auto;
    padding-right: var(--spacing-2xs);
  }

  .theme-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .theme-chip.selected {
    border-color: var(--accent);
  }

  .theme-name {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
  }

  .theme-chip.selected .theme-name {
    color: var(--text-primary);
  }

  .theme-colors {
    display: flex;
    gap: var(--spacing-2xs);
  }

  .color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ===== Option Grid (Diagram Editor) ===== */
  .option-grid {
    display: grid;
    gap: var(--spacing-xs);
  }

  .option-grid.three-col {
    grid-template-columns: repeat(3, 1fr);
  }

  .option-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-2xs);
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .option-chip.selected {
    border-color: var(--accent);
  }

  .option-name {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-secondary);
  }

  .option-chip.selected .option-name {
    color: var(--text-primary);
  }

  .option-desc {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  /* ===== Vault Card ===== */
  .vault-card {
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .vault-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-xs);
  }

  .vault-label {
    color: var(--text-secondary);
  }

  .vault-value {
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  /* ===== Mobile Auth ===== */
  .mobile-auth-card {
    background: color-mix(in srgb, var(--text-primary) 2%, transparent);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .mobile-auth-title {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--accent);
  }

  .mobile-auth-desc {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  /* ===== Helper Card ===== */
  .helper-card {
    background: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .helper-title {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .helper-steps {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.6;
    padding-left: var(--spacing-md);
    margin: 0;
  }

  .helper-steps li {
    margin-bottom: var(--spacing-xs);
  }

  .helper-steps li::marker {
    color: var(--accent);
    font-weight: bold;
  }

  .link-accent {
    color: var(--accent);
    text-decoration: underline;
    background: none;
    border: none;
    font-size: var(--font-size-xs);
    cursor: pointer;
    font-family: inherit;
  }

  .link-accent:hover {
    color: var(--accent-hover);
  }

  /* ===== Spinner ===== */
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Sync spin for RefreshCw icon */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
</style>
