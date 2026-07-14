<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { appState, generateHtmlNote } from '../stores/appState.svelte';
  import { mobileNav } from '../stores/mobileNav.svelte';
  import {
    Cloud, RefreshCw, LogOut, Palette, Settings,
    FileText, Calculator, X, ChevronRight, ChevronLeft, Check,
    AlertTriangle, RotateCw, ShieldCheck
  } from 'lucide-svelte';

  // UI-M-013 — Mobile Settings Redesign.
  // A full-screen, sectioned settings experience that mirrors all desktop
  // settings functionality (Sync / Appearance / Editor & Files / Calculation)
  // but is optimized for touch: large rows, a master/detail flow, and a
  // mobile-friendly theme browser with large swatches + live preview.

  type Section = 'sync' | 'styling' | 'editor' | 'calculation';

  // null = section list (master), otherwise a detail screen is open.
  let activeSection = $state<Section | null>(null);

  // --- Local State (mirrors SettingsModal) ---
  let showFolderPicker = $state(false);
  let newDriveFolderName = $state('');
  let mobilePastedToken = $state('');
  let fileInput = $state<HTMLInputElement>();

  let activeThemeCategory = $state<'all' | 'light' | 'dark' | 'vivid'>('all');
  let displayedThemes = $derived(
    activeThemeCategory === 'all'
      ? appState.themes
      : appState.themes.filter((t: any) => t.category === activeThemeCategory)
  );

  const isCapacitor = typeof window !== 'undefined' && !!(window as any).Capacitor;

  // --- Section catalog ---
  const sections: { id: Section; label: string; desc: string; icon: any }[] = [
    { id: 'sync', label: 'Cloud Sync', desc: 'Google Drive connection & sync', icon: Cloud },
    { id: 'styling', label: 'Appearance', desc: 'Theme & colors', icon: Palette },
    { id: 'editor', label: 'Editor & Files', desc: 'Diagrams, import & vault', icon: FileText },
    { id: 'calculation', label: 'Calculation', desc: 'Currency & labels', icon: Calculator },
  ];

  let activeSectionMeta = $derived(sections.find((s) => s.id === activeSection));

  function close() {
    appState.showSettings = false;
    activeSection = null;
  }

  // Back-button / edge-swipe integration (UI-M-001 / UI-M-010).
  // While the panel is open, register a close handler. When a detail screen is
  // open, register a second handler so the first back press returns to the
  // section list, and the next closes settings entirely (LIFO overlay stack).
  $effect(() => {
    if (!appState.showSettings) return;
    return mobileNav.registerOverlay(close);
  });

  $effect(() => {
    if (activeSection === null) return;
    return mobileNav.registerOverlay(() => (activeSection = null));
  });

  // Reset transient sub-state whenever settings is re-opened.
  $effect(() => {
    if (appState.showSettings) {
      activeSection = null;
      showFolderPicker = false;
    }
  });

  // --- File import (mirrors SettingsModal) ---
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
        appState.showToast('Invalid .mynote file format. Missing title or content.', 'error', 4000);
        return;
      }

      const cleanTitle = bundle.title.trim();
      const folder = appState.activeNotebook;
      let path = folder ? `${folder}/${cleanTitle}.html` : `${cleanTitle}.html`;

      let version = 1;
      let finalPath = path;
      while (appState.notes.some((n) => n.path === finalPath)) {
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
        modified: new Date().toISOString(),
      };
      const htmlContent = generateHtmlNote(meta, bundle.content);
      await appState.storage.writeNote(finalPath, htmlContent);
      await appState.refreshNotes();
      appState.selectNote(finalPath);
      close();
      appState.showToast(`Imported "${cleanTitle}" successfully`, 'success');
    } catch (e: any) {
      appState.showToast(e.message || 'Failed to import file', 'error');
    }
    input.value = '';
  }
</script>

{#if appState.showSettings}
  <div class="ms-overlay flex-col" transition:fly={{ x: 24, duration: 200, easing: cubicOut }}>
    <!-- ============ Header ============ -->
    <header class="ms-header flex-row">
      {#if activeSection === null}
        <span class="ms-header-title flex-row">
          <Settings size={20} style="color: var(--accent);" />
          Settings
        </span>
        <button class="ms-header-btn" onclick={close} aria-label="Close settings">
          <X size={22} />
        </button>
      {:else}
        <button class="ms-back-btn flex-row" onclick={() => (activeSection = null)} aria-label="Back to settings">
          <ChevronLeft size={24} />
        </button>
        <span class="ms-header-title">{activeSectionMeta?.label}</span>
        <button class="ms-header-btn" onclick={close} aria-label="Done">Done</button>
      {/if}
    </header>

    <div class="ms-body flex-col">
      {#if activeSection === null}
        <!-- ============ SECTION LIST (master) ============ -->
        <nav class="ms-section-list flex-col" aria-label="Settings sections">
          {#each sections as s}
            <button class="ms-section-row flex-row" onclick={() => (activeSection = s.id)}>
              <span class="ms-section-icon flex-row">
                <svelte:component this={s.icon} size={20} />
              </span>
              <span class="ms-section-text flex-col">
                <span class="ms-section-label">{s.label}</span>
                <span class="ms-section-desc">{s.desc}</span>
              </span>
              <ChevronRight size={20} style="color: var(--text-tertiary); flex-shrink: 0;" />
            </button>
          {/each}
        </nav>
        <div class="ms-version">MyNotes v1.0</div>

      {:else if activeSection === 'sync'}
        <!-- ============ CLOUD SYNC ============ -->
        <div class="ms-group flex-col">
          <span class="ms-group-title">Connection</span>
          <div class="ms-field flex-col">
            <span class="ms-field-label">Google OAuth Client ID</span>
            <span class="ms-field-desc">Required to connect Google Drive</span>
            <input
              type="text"
              placeholder="Paste Google Client ID here..."
              value={appState.googleClientId}
              oninput={(e) => appState.setClientId(e.currentTarget.value)}
              disabled={appState.googleConnected}
              class="ms-input"
            />
          </div>

          {#if isCapacitor}
            <div class="ms-field flex-col">
              <span class="ms-field-label">OAuth Redirect URI</span>
              <span class="ms-field-desc">For mobile authentication</span>
              <input
                type="text"
                placeholder="e.g. http://localhost"
                value={appState.googleRedirectUri}
                oninput={(e) => appState.setRedirectUri(e.currentTarget.value)}
                disabled={appState.googleConnected}
                class="ms-input"
              />
            </div>
          {/if}
        </div>

        {#if !appState.googleConnected}
          <div class="ms-group flex-col">
            <span class="ms-group-title">Authentication</span>

            {#if isCapacitor}
              <!-- UI-M-014: mobile-appropriate OAuth handoff with clear progress -->
              {#if appState.mobileAuthStep === 'awaiting'}
                <div class="ms-card flex-col">
                  <span class="ms-progress flex-row">
                    <span class="spinner"></span>
                    <span class="ms-card-title">Waiting for browser sign-in…</span>
                  </span>
                  <p class="ms-card-desc">Finish signing in inside your secure browser. We'll detect the redirect automatically and connect you.</p>

                  <details class="ms-details">
                    <summary class="ms-summary">Sign-in didn't return automatically?</summary>
                    <div class="flex-col" style="gap: var(--spacing-sm); margin-top: var(--spacing-sm);">
                      <span class="ms-field-desc">Copy the URL from the browser's address bar after signing in, paste it below, then connect.</span>
                      <input
                        type="text"
                        placeholder="Paste the redirected URL or token…"
                        bind:value={mobilePastedToken}
                        class="ms-input"
                      />
                      <button
                        class="ms-btn accent full"
                        onclick={async () => {
                          try {
                            await appState.completeMobileGoogleAuth(mobilePastedToken);
                            mobilePastedToken = '';
                          } catch { /* error surfaced via state */ }
                        }}
                        disabled={!mobilePastedToken}
                      >
                        Verify &amp; Connect
                      </button>
                    </div>
                  </details>

                  <button class="ms-btn outline full" onclick={() => appState.cancelMobileGoogleAuth()}>Cancel</button>
                </div>
              {:else if appState.mobileAuthStep === 'verifying'}
                <div class="ms-card flex-col">
                  <span class="ms-progress flex-row">
                    <span class="spinner"></span>
                    <span class="ms-card-title">Verifying &amp; connecting…</span>
                  </span>
                  <p class="ms-card-desc">Confirming your Google account and preparing your sync folder.</p>
                </div>
              {:else}
                <div class="ms-card flex-col">
                  <span class="ms-card-title flex-row" style="gap: var(--spacing-xs);">
                    <ShieldCheck size={18} style="color: var(--accent);" />
                    Sign in with Google
                  </span>
                  <p class="ms-card-desc">We'll open your secure system browser to sign in (required by Google), then connect automatically. MyNotes can only access files it creates in your Drive.</p>

                  {#if appState.mobileAuthStep === 'error' && appState.mobileAuthError}
                    <div class="ms-error flex-row">
                      <AlertTriangle size={16} style="flex-shrink: 0;" />
                      <span>{appState.mobileAuthError}</span>
                    </div>
                  {/if}

                  <button
                    class="ms-btn primary full"
                    onclick={() => appState.startMobileGoogleAuth()}
                    disabled={!appState.googleClientId || !appState.googleRedirectUri}
                  >
                    {#if appState.mobileAuthStep === 'error'}
                      <RotateCw size={16} /> Try Again
                    {:else}
                      Connect with Google
                    {/if}
                  </button>
                </div>
              {/if}
            {:else}
              <button
                class="ms-btn primary full"
                onclick={async () => {
                  try {
                    await appState.connectGoogleDrive();
                  } catch (e: any) {
                    appState.showToast(e.message || 'Failed to connect to Google Drive', 'error', 4000);
                  }
                }}
                disabled={!appState.googleClientId}
              >
                Connect Google Drive
              </button>
            {/if}

            <div class="ms-card flex-col">
              <span class="ms-card-title">{isCapacitor ? 'Mobile Setup Instructions:' : 'Setup Instructions:'}</span>
              <ol class="ms-steps">
                <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" class="ms-link">Google Cloud Console</a>.</li>
                {#if isCapacitor}
                  <li>Inside your OAuth Client ID, add the Redirect URI (currently <code>{appState.googleRedirectUri || 'http://localhost'}</code>) under <b>Authorized Redirect URIs</b>.</li>
                  <li>Enter your Client ID in the field above.</li>
                  <li>Tap <b>Connect with Google</b> and complete sign-in in the browser — you'll be returned automatically.</li>
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
          <!-- Connected -->
          <div class="ms-group flex-col">
            <span class="ms-group-title">Account</span>
            <div class="ms-card connected flex-row">
              <span class="ms-dot" class:syncing={appState.syncStatus === 'syncing'} class:error={appState.syncStatus === 'error'}></span>
              <div class="ms-section-text flex-col">
                <span class="ms-connected-email">{appState.googleUserEmail}</span>
                <span class="ms-field-desc">
                  {#if appState.syncStatus === 'syncing'}
                    Syncing database...
                  {:else if appState.syncStatus === 'error'}
                    Connection problem · action needed
                  {:else if !appState.syncEnabled}
                    Connected · Sync Disabled
                  {:else}
                    Connected · Sync Enabled
                  {/if}
                </span>
                <span class="ms-field-desc">📁 {appState.customDriveFolderName || 'MyNotes (Default)'}</span>
              </div>
            </div>

            {#if appState.syncStatus === 'error'}
              <!-- UI-M-014: clear error with retry/reconnect -->
              <div class="ms-card flex-col" style="border-color: var(--semantic-error);">
                <div class="ms-error flex-row" style="border: none; background: none; padding: 0;">
                  <AlertTriangle size={16} style="flex-shrink: 0;" />
                  <span>{appState.syncErrorMessage || "We couldn't reach Google Drive. Reconnect to continue syncing."}</span>
                </div>
                <div class="ms-action-row flex-row">
                  <button class="ms-btn primary" onclick={async () => { try { await appState.syncNotes(); } catch { /* state */ } }}>
                    <RotateCw size={16} /> Retry Sync
                  </button>
                  <button
                    class="ms-btn outline"
                    onclick={() => { if (isCapacitor) { appState.disconnectGoogleDrive(); appState.startMobileGoogleAuth(); } else { appState.connectGoogleDrive().catch((e: any) => appState.showToast(e?.message || 'Reconnect failed', 'error')); } }}
                  >
                    Reconnect
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <div class="ms-group flex-col">
            <span class="ms-group-title">Sync Options</span>
            <div class="ms-row flex-row">
              <div class="ms-section-text flex-col">
                <span class="ms-field-label">Enable Google Drive Syncing</span>
                <span class="ms-field-desc">Automatically sync notes to your Drive folder</span>
              </div>
              <label class="switch-container">
                <input
                  type="checkbox"
                  checked={appState.syncEnabled}
                  onchange={(e) => {
                    appState.setSyncEnabled(e.currentTarget.checked);
                    if (e.currentTarget.checked) appState.syncNotes();
                  }}
                />
                <span class="slider"></span>
              </label>
            </div>

            <div class="ms-stat-grid">
              <div class="ms-stat">
                <span class="ms-stat-label">Last Sync</span>
                <span class="ms-stat-value">{appState.lastSyncedTime ? new Date(appState.lastSyncedTime).toLocaleTimeString() : 'Never'}</span>
              </div>
              <div class="ms-stat">
                <span class="ms-stat-label">Conflict Policy</span>
                <span class="ms-stat-value">Last Modified Wins</span>
              </div>
            </div>

            <div class="ms-action-row flex-row">
              <button class="ms-btn primary" onclick={async () => { await appState.syncNotes(); }} disabled={appState.syncStatus === 'syncing'}>
                <RefreshCw size={16} class={appState.syncStatus === 'syncing' ? 'spin' : ''} />
                Sync Now
              </button>
              <button class="ms-btn danger" onclick={() => appState.disconnectGoogleDrive()}>
                <LogOut size={16} />
                Disconnect
              </button>
            </div>
          </div>

          <div class="ms-group flex-col">
            <span class="ms-group-title">Sync Target Folder</span>
            <div class="ms-row flex-row">
              <div class="ms-section-text flex-col">
                <span class="ms-field-label">Active Folder</span>
                <span class="ms-field-desc">{appState.customDriveFolderName || 'MyNotes (Default)'}</span>
              </div>
              {#if !showFolderPicker}
                <button class="ms-btn outline small" onclick={() => { showFolderPicker = true; appState.fetchGoogleDriveFolders(); }}>Change</button>
              {/if}
            </div>

            {#if showFolderPicker}
              <div class="ms-card flex-col">
                <div class="flex-row" style="justify-content: space-between; align-items: center;">
                  <span class="ms-field-label">Choose from Drive</span>
                  <button class="ms-link" onclick={() => (showFolderPicker = false)}>Close</button>
                </div>

                {#if appState.fetchingFolders}
                  <div class="flex-row" style="justify-content: center; padding: var(--spacing-sm) 0;">
                    <span class="spinner"></span>
                  </div>
                {:else}
                  <div class="ms-folder-list flex-col">
                    <button class="ms-folder-item" class:active={!appState.customDriveFolderId} onclick={() => { appState.setCustomDriveFolder(null, null); showFolderPicker = false; }}>
                      📁 MyNotes (Default)
                    </button>
                    {#each appState.googleDriveFolders as folder}
                      <button class="ms-folder-item" class:active={appState.customDriveFolderId === folder.id} onclick={() => { appState.setCustomDriveFolder(folder.id, folder.name); showFolderPicker = false; }}>
                        📁 {folder.name}
                      </button>
                    {/each}
                  </div>

                  <div class="flex-row" style="gap: var(--spacing-xs); border-top: 1px dashed var(--border-color); padding-top: var(--spacing-sm);">
                    <input type="text" placeholder="New folder name..." bind:value={newDriveFolderName} class="ms-input" style="flex: 1;" />
                    <button
                      class="ms-btn primary small"
                      onclick={async () => {
                        if (newDriveFolderName.trim()) {
                          await appState.createGoogleDriveFolder(newDriveFolderName.trim());
                          newDriveFolderName = '';
                          showFolderPicker = false;
                        }
                      }}
                    >Create</button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

      {:else if activeSection === 'styling'}
        <!-- ============ APPEARANCE ============ -->
        <div class="ms-group flex-col">
          <span class="ms-group-title">Theme ({displayedThemes.length})</span>

          <div class="ms-pills flex-row">
            {#each ['all', 'light', 'dark', 'vivid'] as cat}
              <button class="ms-pill" class:active={activeThemeCategory === cat} onclick={() => (activeThemeCategory = cat as any)}>{cat}</button>
            {/each}
          </div>

          <div class="ms-theme-grid">
            {#each displayedThemes as t}
              <button class="ms-theme-card" class:selected={appState.theme === t.id} onclick={() => appState.setTheme(t.id)}>
                <span class="ms-theme-preview" style="background: {t.bg};">
                  <span class="ms-theme-preview-bar" style="background: {t.accent};"></span>
                  <span class="ms-theme-preview-line" style="background: color-mix(in srgb, {t.accent} 35%, transparent);"></span>
                  <span class="ms-theme-preview-line short" style="background: color-mix(in srgb, {t.accent} 22%, transparent);"></span>
                  {#if appState.theme === t.id}
                    <span class="ms-theme-check flex-row" style="background: {t.accent};">
                      <Check size={14} color="#fff" />
                    </span>
                  {/if}
                </span>
                <span class="ms-theme-footer flex-row">
                  <span class="ms-theme-name">{t.name}</span>
                  <span class="ms-theme-dots flex-row">
                    <span class="ms-dot-sm" style="background: {t.bg}; border: 1.5px solid color-mix(in srgb, var(--text-primary) 20%, transparent);"></span>
                    <span class="ms-dot-sm" style="background: {t.accent};"></span>
                  </span>
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div class="ms-group flex-col" style="margin-top: var(--spacing-md);">
          <span class="ms-group-title">Layout Settings</span>
          <div class="ms-row flex-row">
            <div class="ms-section-text flex-col">
              <span class="ms-field-label">Force Mobile UI</span>
              <span class="ms-field-desc">Force the application to use mobile layout regardless of screen size</span>
            </div>
            <label class="switch-container">
              <input type="checkbox" checked={appState.forceMobileUi} onchange={() => appState.toggleForceMobileUi()} />
              <span class="slider"></span>
            </label>
          </div>
        </div>

      {:else if activeSection === 'editor'}
        <!-- ============ EDITOR & FILES ============ -->
        <div class="ms-group flex-col">
          <span class="ms-group-title">Diagram Editor</span>
          <div class="ms-option-grid">
            <button class="ms-option" class:selected={appState.diagramEditorType === 'native'} onclick={() => appState.setDiagramEditorType('native')}>
              <span class="ms-option-name">Native</span>
              <span class="ms-field-desc">Offline</span>
            </button>
            <button class="ms-option" class:selected={appState.diagramEditorType === 'drawio'} onclick={() => appState.setDiagramEditorType('drawio')}>
              <span class="ms-option-name">Draw.io</span>
              <span class="ms-field-desc">Online</span>
            </button>
            <button class="ms-option" class:selected={appState.diagramEditorType === 'mermaid'} onclick={() => appState.setDiagramEditorType('mermaid')}>
              <span class="ms-option-name">Mermaid</span>
              <span class="ms-field-desc">AI syntax</span>
            </button>
          </div>
        </div>

        <div class="ms-group flex-col">
          <span class="ms-group-title">File Operations</span>
          <div class="ms-row flex-row">
            <div class="ms-section-text flex-col">
              <span class="ms-field-label">Import .mynote File</span>
              <span class="ms-field-desc">Restores custom exported note format</span>
            </div>
            <input type="file" accept=".mynote" bind:this={fileInput} onchange={handleImportFile} style="display: none;" />
            <button class="ms-btn outline small" onclick={triggerImport}>Import</button>
          </div>

          <div class="ms-row flex-row">
            <div class="ms-section-text flex-col">
              <span class="ms-field-label">Auto-prune Empty Tags</span>
              <span class="ms-field-desc">Delete tags when no notes use them</span>
            </div>
            <label class="switch-container">
              <input type="checkbox" checked={appState.autoPruneTags} onchange={(e) => appState.setAutoPruneTags(e.currentTarget.checked)} />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="ms-group flex-col">
          <span class="ms-group-title">Vault Information</span>
          <div class="ms-card flex-col">
            <div class="flex-row" style="justify-content: space-between;">
              <span class="ms-field-desc">Active Vault</span>
              <span class="ms-field-label">{appState.vaultName || 'Local Sandbox'}</span>
            </div>
            <div class="flex-row" style="justify-content: space-between;">
              <span class="ms-field-desc">Total Notes</span>
              <span class="ms-field-label">{appState.notes.length}</span>
            </div>
          </div>
        </div>

      {:else if activeSection === 'calculation'}
        <!-- ============ CALCULATION ============ -->
        <div class="ms-group flex-col">
          <span class="ms-group-title">Calculation Defaults</span>

          <div class="ms-field flex-col">
            <span class="ms-field-label">Default Currency Symbol</span>
            <span class="ms-field-desc">Used in calculation blocks for monetary values</span>
            <input type="text" value={appState.defaultCurrency} oninput={(e) => appState.setDefaultCurrency(e.currentTarget.value)} class="ms-input" placeholder="₹" />
          </div>

          <div class="ms-field flex-col">
            <span class="ms-field-label">Default Income Label</span>
            <span class="ms-field-desc">Label used for income entries in calculation blocks</span>
            <input type="text" value={appState.defaultIncomeLabel} oninput={(e) => appState.setDefaultIncomeLabel(e.currentTarget.value)} class="ms-input" placeholder="Income" />
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .flex-row { display: flex; flex-direction: row; align-items: center; }
  .flex-col { display: flex; flex-direction: column; }

  /* ===== Overlay ===== */
  .ms-overlay {
    position: fixed;
    inset: 0;
    z-index: 9990;
    background: var(--bg-base);
    padding-top: env(safe-area-inset-top, 0px);
  }

  /* ===== Header ===== */
  .ms-header {
    height: 56px;
    flex-shrink: 0;
    justify-content: space-between;
    gap: var(--spacing-sm);
    padding: 0 var(--spacing-md);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
  }

  .ms-header-title {
    font-size: var(--font-size-base);
    font-weight: 800;
    color: var(--text-primary);
    gap: var(--spacing-xs);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-back-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: var(--spacing-2xs);
    margin-left: calc(-1 * var(--spacing-2xs));
  }

  .ms-header-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: var(--font-size-sm);
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    padding: var(--spacing-2xs);
    display: flex;
    align-items: center;
  }

  /* ===== Body ===== */
  .ms-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-md);
    gap: var(--spacing-lg);
    padding-bottom: calc(var(--spacing-2xl, 48px) + env(safe-area-inset-bottom, 0px));
  }

  /* ===== Section List (master) ===== */
  .ms-section-list { gap: var(--spacing-sm); }

  .ms-section-row {
    gap: var(--spacing-md);
    width: 100%;
    text-align: left;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
    cursor: pointer;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .ms-section-row:active { background: color-mix(in srgb, var(--text-primary) 6%, transparent); }

  .ms-section-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-standard);
    justify-content: center;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .ms-section-text { gap: var(--spacing-3xs); min-width: 0; flex: 1; }

  .ms-section-label {
    font-size: var(--font-size-base);
    font-weight: 700;
    color: var(--text-primary);
  }

  .ms-section-desc {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .ms-version {
    text-align: center;
    font-size: 11px;
    color: var(--text-tertiary);
    letter-spacing: 0.3px;
    margin-top: var(--spacing-xs);
  }

  /* ===== Groups ===== */
  .ms-group { gap: var(--spacing-sm); }

  .ms-group-title {
    font-size: var(--font-size-xs);
    font-weight: 800;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  /* ===== Field / Row ===== */
  .ms-field {
    gap: var(--spacing-2xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
  }

  .ms-row {
    justify-content: space-between;
    gap: var(--spacing-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
  }

  .ms-field-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .ms-field-desc {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .ms-input {
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    min-height: 44px;
    margin-top: var(--spacing-2xs);
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .ms-input:focus { border-color: var(--accent); }
  .ms-input:disabled { opacity: 0.5; }

  /* ===== Cards ===== */
  .ms-card {
    gap: var(--spacing-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
  }

  .ms-card.connected { flex-direction: row; align-items: center; gap: var(--spacing-md); }

  .ms-card-title {
    font-size: var(--font-size-sm);
    font-weight: 800;
    color: var(--text-primary);
  }

  .ms-card-desc {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .ms-connected-email {
    font-size: var(--font-size-base);
    font-weight: 700;
    color: var(--text-primary);
  }

  .ms-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .ms-dot.syncing { background: var(--semantic-info); animation: dot-pulse 1s infinite alternate; }
  .ms-dot.error { background: var(--semantic-error); }

  @keyframes dot-pulse { from { opacity: 0.4; } to { opacity: 1; } }

  .ms-steps {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.6;
    padding-left: var(--spacing-md);
    margin: 0;
  }
  .ms-steps li { margin-bottom: var(--spacing-xs); }
  .ms-steps li::marker { color: var(--accent); font-weight: bold; }

  .ms-link {
    color: var(--accent);
    text-decoration: underline;
    background: none;
    border: none;
    font-size: inherit;
    cursor: pointer;
    font-family: inherit;
    padding: 0;
  }

  /* ===== Buttons ===== */
  .ms-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    min-height: 44px;
    padding: var(--spacing-sm) var(--spacing-lg);
    border-radius: var(--radius-pill);
    font-size: var(--font-size-sm);
    font-weight: 700;
    cursor: pointer;
    border: none;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                opacity var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .ms-btn:disabled { opacity: 0.5; }
  .ms-btn.full { width: 100%; }
  .ms-btn.small { min-height: 38px; padding: var(--spacing-xs) var(--spacing-md); flex-shrink: 0; }

  .ms-btn.primary { background: var(--accent); color: var(--bg-base); }
  .ms-btn.accent { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
  .ms-btn.danger { background: none; border: 1px solid var(--semantic-error); color: var(--semantic-error); }
  .ms-btn.outline { background: none; border: 1px solid var(--border-color); color: var(--text-secondary); }

  .ms-action-row { gap: var(--spacing-sm); }
  .ms-action-row .ms-btn { flex: 1; }

  /* ===== Stats ===== */
  .ms-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-sm); }

  .ms-stat {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-md);
  }

  .ms-stat-label {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .ms-stat-value { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); }

  /* ===== Folder picker ===== */
  .ms-folder-list { gap: var(--spacing-2xs); max-height: 240px; overflow-y: auto; }

  .ms-folder-item {
    background: none;
    border: none;
    text-align: left;
    padding: var(--spacing-sm);
    min-height: 44px;
    border-radius: var(--radius-standard);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
  }
  .ms-folder-item:active { background: color-mix(in srgb, var(--text-primary) 6%, transparent); }
  .ms-folder-item.active { color: var(--accent); font-weight: 700; }

  /* ===== Theme browser ===== */
  .ms-pills { gap: var(--spacing-xs); flex-wrap: wrap; }

  .ms-pill {
    border: none;
    cursor: pointer;
    padding: var(--spacing-xs) var(--spacing-md);
    min-height: 38px;
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    border-radius: var(--radius-pill);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-family: inherit;
    transition: all var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .ms-pill.active { background: var(--accent); color: var(--bg-base); }

  .ms-theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-sm);
  }

  .ms-theme-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .ms-theme-card.selected { border-color: var(--accent); }

  .ms-theme-preview {
    position: relative;
    height: 72px;
    padding: var(--spacing-sm);
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
  }

  .ms-theme-preview-bar { width: 40%; height: 8px; border-radius: var(--radius-pill); }
  .ms-theme-preview-line { width: 80%; height: 6px; border-radius: var(--radius-pill); }
  .ms-theme-preview-line.short { width: 55%; }

  .ms-theme-check {
    position: absolute;
    top: var(--spacing-xs);
    right: var(--spacing-xs);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    justify-content: center;
  }

  .ms-theme-footer {
    justify-content: space-between;
    padding: var(--spacing-sm);
    gap: var(--spacing-xs);
    border-top: 1px solid var(--border-color);
  }

  .ms-theme-name {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ms-theme-card.selected .ms-theme-name { color: var(--text-primary); }

  .ms-theme-dots { gap: var(--spacing-2xs); flex-shrink: 0; }
  .ms-dot-sm { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }

  /* ===== Option grid (diagram editor) ===== */
  .ms-option-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacing-sm); }

  .ms-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-2xs);
    background: var(--bg-surface);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .ms-option.selected { border-color: var(--accent); }

  .ms-option-name { font-size: var(--font-size-sm); font-weight: 700; color: var(--text-secondary); }
  .ms-option.selected .ms-option-name { color: var(--text-primary); }

  /* ===== Toggle Switch ===== */
  .switch-container { position: relative; display: inline-block; width: 44px; height: 26px; flex-shrink: 0; }
  .switch-container input { opacity: 0; width: 0; height: 0; }

  .slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: var(--border-color);
    transition: .2s;
    border-radius: 26px;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .2s;
    border-radius: 50%;
  }
  input:checked + .slider { background-color: var(--accent); }
  input:checked + .slider:before { transform: translateX(18px); }

  /* ===== Spinner ===== */
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  :global(.spin) { animation: spin 1s linear infinite; }

  /* ===== Auth flow (UI-M-014) ===== */
  .ms-progress { gap: var(--spacing-sm); }

  .ms-error {
    align-items: center;
    gap: var(--spacing-xs);
    background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--semantic-error) 35%, transparent);
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm);
    font-size: var(--font-size-xs);
    line-height: 1.4;
    color: var(--semantic-error);
  }

  .ms-details { border-top: 1px dashed var(--border-color); padding-top: var(--spacing-sm); }

  .ms-summary {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--accent);
    cursor: pointer;
    list-style: none;
  }
  .ms-summary::-webkit-details-marker { display: none; }


  @media (prefers-reduced-motion: reduce) {
    .ms-overlay { transition: none; }
  }
</style>

