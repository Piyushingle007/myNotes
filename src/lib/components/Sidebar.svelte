<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { 
    Home, 
    FileText, 
    Settings, 
    FolderOpen, 
    Moon, 
    Sun,
    Trash2,
    X,
    Folder
  } from 'lucide-svelte';

  let showRecentDropdown = $state(false);

  function selectTab(tab: typeof appState.activeTab) {
    appState.activeTab = tab;
    // Clear filters when switching top-level tabs to avoid getting stuck
    if (tab !== 'documents') {
      appState.activeNotebook = null;
      appState.activeTag = null;
    }
  }

  function toggleTheme() {
    const nextTheme = appState.theme === 'light' ? 'dark' : appState.theme === 'dark' ? 'black' : 'light';
    appState.setTheme(nextTheme);
  }

  async function handleOpenDirectory() {
    await appState.openDirectory();
  }

  async function handleRemoveRecent(name: string, event: Event) {
    event.stopPropagation();
    await appState.removeRecentFolder(name);
  }
</script>

<div class="sidebar flex-col">
  <!-- Logo Section -->
  <div class="logo-section flex-row">
    <div class="logo-icon">📓</div>
    <span class="logo-text">myNotes</span>
  </div>

  <!-- Main Navigation Drawer -->
  <div class="navigation-menu flex-col flex-grow">
    <!-- Dashboard -->
    <button 
      class="nav-item flex-row" 
      class:active={appState.activeTab === 'dashboard'} 
      onclick={() => selectTab('dashboard')}
    >
      <Home size={20} class="nav-icon" />
      <span class="nav-label">Dashboard</span>
    </button>

    <!-- Documents Browser -->
    <button 
      class="nav-item flex-row" 
      class:active={appState.activeTab === 'documents'} 
      onclick={() => selectTab('documents')}
    >
      <FileText size={20} class="nav-icon" />
      <span class="nav-label">Documents</span>
    </button>

    <!-- Settings -->
    <button 
      class="nav-item flex-row" 
      class:active={appState.activeTab === 'settings'} 
      onclick={() => selectTab('settings')}
    >
      <Settings size={20} class="nav-icon" />
      <span class="nav-label">Settings</span>
    </button>
  </div>

  <div class="divider"></div>

  <!-- Vault/Directory Controller Section -->
  <div class="vault-controller flex-col">
    <!-- Active Vault Button/Dropdown Toggle -->
    <button 
      class="vault-display-card flex-row" 
      onclick={() => showRecentDropdown = !showRecentDropdown}
    >
      <div class="vault-avatar">📂</div>
      <div class="vault-meta flex-col">
        <span class="vault-title">{appState.vaultName || 'Sandbox'}</span>
        <span class="vault-status">{appState.notes.length} notes</span>
      </div>
      <span class="dropdown-chevron">{showRecentDropdown ? '▲' : '▼'}</span>
    </button>

    <!-- Recent Vaults Dropdown List -->
    {#if showRecentDropdown}
      <div class="recent-vaults-list flex-col">
        <!-- Local Sandbox Default option -->
        <button 
          class="recent-vault-item flex-row" 
          class:active={appState.vaultName === 'Local Sandbox' || appState.vaultName === null}
          onclick={() => { appState.selectRecentFolder('Local Sandbox'); showRecentDropdown = false; }}
        >
          <span class="icon">⭐</span>
          <span class="name">Local Sandbox</span>
        </button>

        {#each appState.recentFolders as folder}
          <div class="recent-vault-row flex-row">
            <button 
              class="recent-vault-item flex-row" 
              class:active={appState.vaultName === folder.name}
              onclick={() => { appState.selectRecentFolder(folder.name); showRecentDropdown = false; }}
            >
              <span class="icon">📂</span>
              <span class="name">{folder.name}</span>
            </button>
            <button 
              class="remove-recent-btn" 
              onclick={(e) => handleRemoveRecent(folder.name, e)}
              title="Remove from history"
            >
              <X size={12} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Bottom Actions -->
    <div class="bottom-actions flex-col">
      <button class="footer-action-btn flex-row" onclick={handleOpenDirectory}>
        <FolderOpen size={16} />
        <span>Open Vault Folder</span>
      </button>

      <button class="footer-action-btn flex-row" onclick={toggleTheme}>
        {#if appState.theme === 'light'}
          <Sun size={16} />
          <span>Light Mode</span>
        {:else if appState.theme === 'dark'}
          <Moon size={16} />
          <span>Dark Mode</span>
        {:else}
          <span class="theme-icon">🖤</span>
          <span>AMOLED Black</span>
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .sidebar {
    width: 280px;
    background-color: var(--bg-surface);
    height: 100%;
    padding: 24px 16px;
    gap: 16px;
    border-right: 1px solid var(--border-color);
    flex-shrink: 0;
    z-index: 10;
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

  .flex-grow {
    flex-grow: 1;
  }

  /* Logo */
  .logo-section {
    padding: 0 8px 16px 8px;
    gap: 12px;
  }

  .logo-icon {
    font-size: 24px;
  }

  .logo-text {
    font-family: var(--font-sans);
    font-size: 22px;
    font-weight: 800;
    color: var(--text-primary);
    letter-spacing: -0.5px;
  }

  /* Navigation Drawer Menu */
  .navigation-menu {
    gap: 4px;
    overflow-y: auto;
  }

  .nav-item {
    width: 100%;
    height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-full);
    gap: 16px;
    color: var(--text-secondary);
    transition: var(--transition-fast);
    text-align: left;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .nav-item:hover {
    background-color: rgba(120, 120, 120, 0.08);
    color: var(--text-primary);
  }

  .nav-item.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .nav-icon {
    flex-shrink: 0;
  }

  .divider {
    height: 1px;
    background-color: var(--border-color);
    margin: 8px 0;
  }

  /* Vault Controller */
  .vault-controller {
    gap: 12px;
    position: relative;
  }

  .vault-display-card {
    width: 100%;
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-m);
    padding: 12px;
    gap: 12px;
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .vault-display-card:hover {
    border-color: var(--text-tertiary);
  }

  .vault-avatar {
    font-size: 20px;
    width: 36px;
    height: 36px;
    background-color: var(--bg-surface);
    border-radius: var(--radius-s);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .vault-meta {
    flex-grow: 1;
    text-align: left;
    overflow: hidden;
  }

  .vault-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .vault-status {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .dropdown-chevron {
    font-size: 10px;
    color: var(--text-secondary);
  }

  /* Dropdown lists */
  .recent-vaults-list {
    position: absolute;
    bottom: 120px;
    left: 0;
    right: 0;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-lvl3);
    padding: 6px;
    gap: 2px;
    z-index: 50;
    max-height: 180px;
    overflow-y: auto;
  }

  .recent-vault-row {
    position: relative;
    width: 100%;
    justify-content: space-between;
  }

  .recent-vault-item {
    flex-grow: 1;
    padding: 8px 12px;
    border-radius: var(--radius-s);
    gap: 10px;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    color: var(--text-secondary);
  }

  .recent-vault-item:hover {
    background-color: var(--bg-surface-container);
    color: var(--text-primary);
  }

  .recent-vault-item.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
    font-weight: 600;
  }

  .remove-recent-btn {
    opacity: 0;
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
    transition: var(--transition-fast);
  }

  .recent-vault-row:hover .remove-recent-btn {
    opacity: 1;
  }

  .remove-recent-btn:hover {
    color: var(--semantic-error);
    background-color: rgba(120, 120, 120, 0.1);
  }

  /* Bottom Buttons */
  .bottom-actions {
    gap: 4px;
  }

  .footer-action-btn {
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--radius-s);
    gap: 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    transition: var(--transition-fast);
  }

  .footer-action-btn:hover {
    background-color: var(--bg-surface-container);
    color: var(--text-primary);
  }

  @media (max-width: 900px) {
    /* Side rail look on tablets */
    .sidebar {
      width: 72px;
      padding: 16px 8px;
      align-items: center;
    }
    .logo-text, .nav-label, .vault-meta, .dropdown-chevron, .bottom-actions span {
      display: none;
    }
    .logo-section {
      padding: 0;
      justify-content: center;
    }
    .nav-item {
      padding: 0;
      justify-content: center;
      border-radius: var(--radius-circle);
      width: 48px;
      height: 48px;
    }
    .vault-display-card {
      padding: 8px;
      justify-content: center;
      border-radius: var(--radius-circle);
      width: 48px;
      height: 48px;
    }
    .vault-avatar {
      margin: 0;
      width: 32px;
      height: 32px;
    }
    .recent-vaults-list {
      bottom: 110px;
      width: 200px;
      left: 60px;
    }
    .footer-action-btn {
      padding: 0;
      width: 40px;
      height: 40px;
      justify-content: center;
      border-radius: var(--radius-circle);
    }
  }

  @media (max-width: 600px) {
    /* Hide sidebar completely on mobile - layout will use bottom tab bar */
    .sidebar {
      display: none;
    }
  }
</style>
