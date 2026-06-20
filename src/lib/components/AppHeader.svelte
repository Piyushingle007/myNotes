<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../stores/appState.svelte';
  import { 
    Search, Plus, Settings, Cloud, CloudOff, X, 
    Folder, Tag, Calendar, ChevronRight, FileText, Menu
  } from 'lucide-svelte';
  import GoogleLogo from './GoogleLogo.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import SyncPopover from './SyncPopover.svelte';

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let showSyncPopover = $state(false);

  // Global keyboard shortcut to toggle command search palette (Ctrl+K or Cmd+K)
  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      appState.showCommandPalette = !appState.showCommandPalette;
    }
    // Alt + N or Ctrl/Cmd + Alt + N for New Note
    if (e.altKey && e.key.toLowerCase() === 'n') {
      const target = e.target as HTMLElement;
      const isInput = target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable ||
        target.closest('.ProseMirror')
      );
      if (!isInput) {
        e.preventDefault();
        handleCreateNote();
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

  function handleCreateNote() {
    appState.showPrompt({
      title: 'New Note',
      message: 'Enter title for the new note:',
      value: 'Untitled Note',
      placeholder: 'Note title...',
      onConfirm: (title) => {
        const trimmed = title.trim();
        if (trimmed) {
          appState.createNote(trimmed, appState.activeNotebook);
        }
      }
    });
  }

  function handleOpenSettings(tab: 'sync' | 'styling' | 'editor' | 'calculation') {
    appState.showSettings = true;
    appState.settingsActiveTab = tab;
  }
</script>

<header class="app-header flex-row">
  <!-- Left Side: Logo & Breadcrumbs -->
  <div class="header-left flex-row">
    <div class="logo-group flex-row" onclick={() => { appState.activeNotebook = null; appState.selectedTag = null; }} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') { appState.activeNotebook = null; appState.selectedTag = null; } }}>
      <GoogleLogo size={22} />
      <span class="logo-text">MyNotes</span>
    </div>

    <!-- Panel Collapse/Expand Toggles (UI-D-002) -->
    <div class="panel-toggles flex-row">
      <button 
        class="panel-toggle-btn flex-row" 
        class:collapsed={appState.sidebarCollapsed}
        onclick={() => appState.setSidebarCollapsed(!appState.sidebarCollapsed)} 
        title={appState.sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        aria-label={appState.sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        <Menu size={15} />
      </button>
      <button 
        class="panel-toggle-btn flex-row" 
        class:collapsed={appState.notelistCollapsed}
        onclick={() => appState.setNotelistCollapsed(!appState.notelistCollapsed)} 
        title={appState.notelistCollapsed ? "Expand Note List" : "Collapse Note List"}
        aria-label={appState.notelistCollapsed ? "Expand Note List" : "Collapse Note List"}
      >
        <FileText size={15} />
      </button>
    </div>
    
    <div class="breadcrumb-divider"></div>
    
    <div class="breadcrumbs flex-row">
      <!-- Active Context -->
      {#if appState.selectedTag}
        <div class="breadcrumb-item flex-row">
          <Tag size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">#{appState.selectedTag}</span>
        </div>
      {:else if appState.activeNotebook}
        <div class="breadcrumb-item flex-row">
          <Folder size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">{appState.activeNotebook}</span>
        </div>
      {:else if appState.activeNotePath?.startsWith('Daily Notes/')}
        <div class="breadcrumb-item flex-row">
          <Calendar size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">Daily Logs</span>
        </div>
      {:else}
        <div class="breadcrumb-item flex-row">
          <FileText size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">All Notes</span>
        </div>
      {/if}

      <!-- Active Note Title -->
      {#if appState.activeNoteTitle}
        <ChevronRight size={14} class="breadcrumb-chevron" />
        <span class="breadcrumb-title" title={appState.activeNoteTitle}>
          {appState.activeNoteTitle}
        </span>
      {/if}
    </div>
  </div>

  <div class="header-center">
    <button 
      class="search-box flex-row" 
      onclick={() => appState.showCommandPalette = true}
      aria-label="Search notes"
      style="cursor: pointer; text-align: left; justify-content: space-between; align-items: center; outline: none; font-family: inherit;"
    >
      <div class="flex-row" style="gap: var(--spacing-2xs); align-items: center;">
        <Search size={14} class="search-box-icon" />
        <span style="color: var(--text-tertiary); font-size: var(--font-size-sm); font-weight: 500;">Search notes...</span>
      </div>
      <span class="search-box-shortcut">⌘K</span>
    </button>
  </div>

  <!-- Right Side: Action Controls & Status -->
  <div class="header-right flex-row">
    <!-- Quick Create Button -->
    <button 
      class="quick-create-btn flex-row" 
      onclick={handleCreateNote}
      title="Create new note"
      aria-label="Create new note"
    >
      <Plus size={16} />
      <span>New Note</span>
    </button>

    <div class="right-divider"></div>

    <!-- Sync status badge + popover anchor -->
    <div class="sync-popover-anchor">
      <button 
        class="sync-status-btn flex-row" 
        onclick={() => { showSyncPopover = !showSyncPopover; }}
        title="Sync & Account"
        aria-label="Sync & Account: {appState.googleConnected && appState.syncEnabled ? appState.syncStatus : 'disabled'}"
        aria-expanded={showSyncPopover}
        aria-haspopup="dialog"
      >
        {#if appState.googleConnected && appState.syncEnabled}
          {#if appState.syncStatus === 'syncing'}
            <Cloud size={16} class="sync-icon pulse-icon" style="color: var(--accent);" />
            <span class="status-indicator syncing">Syncing</span>
          {:else if appState.syncStatus === 'error'}
            <Cloud size={16} class="sync-icon" style="color: var(--semantic-error);" />
            <span class="status-indicator error">Sync Error</span>
          {:else}
            <Cloud size={16} class="sync-icon" style="color: var(--semantic-success);" />
            <span class="status-indicator synced">Synced</span>
          {/if}
        {:else}
          <CloudOff size={16} class="sync-icon" style="color: var(--text-tertiary);" />
          <span class="status-indicator disabled">Sync Off</span>
        {/if}
        <span class="sr-only" role="status" aria-live="polite">
          Sync status changed to {appState.googleConnected && appState.syncEnabled ? appState.syncStatus : 'Sync Off'}
        </span>
      </button>

      {#if showSyncPopover}
        <SyncPopover onclose={() => { showSyncPopover = false; }} />
      {/if}
    </div>

    <!-- Global Preferences Settings button -->
    <button 
      class="settings-btn flex-row" 
      onclick={() => handleOpenSettings('styling')}
      title="Open settings"
      aria-label="Open settings"
    >
      <Settings size={18} />
    </button>
  </div>
</header>

<CommandPalette />

<style>
  .app-header {
    height: var(--header-height);
    background-color: var(--bg-surface);
    border-bottom: var(--panel-border-width) solid var(--border-color);
    padding: 0 var(--spacing-md);
    justify-content: space-between;
    box-sizing: border-box;
    z-index: var(--z-index-header);
    position: relative;
    user-select: none;
    width: 100%;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  /* Left Branding / Breadcrumbs */
  .header-left {
    gap: var(--spacing-md);
    flex: 1;
    min-width: 0;
  }

  .panel-toggles {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--spacing-2xs);
    margin-left: var(--spacing-xs);
    flex-shrink: 0;
  }

  .panel-toggle-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: var(--radius-standard);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
    justify-content: center;
    display: flex;
    align-items: center;
  }

  .panel-toggle-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  .panel-toggle-btn.collapsed {
    color: var(--text-tertiary);
  }

  .logo-group {
    gap: var(--spacing-xs);
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .logo-group:hover {
    opacity: 0.85;
  }

  .logo-text {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.2px;
    color: var(--text-primary);
  }

  .breadcrumb-divider {
    width: 1px;
    height: 16px;
    background-color: var(--border-color);
    flex-shrink: 0;
  }

  .breadcrumbs {
    gap: var(--spacing-xs);
    min-width: 0;
    flex: 1;
  }

  .breadcrumb-item {
    gap: var(--spacing-2xs);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    flex-shrink: 0;
  }

  .breadcrumb-icon {
    color: var(--text-tertiary);
  }

  .breadcrumb-chevron {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .breadcrumb-title {
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Center Search Box */
  .header-center {
    flex: 0 1 360px;
    margin: 0 var(--spacing-md);
  }

  .search-box {
    position: relative;
    background-color: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: 0 var(--spacing-xs);
    height: 32px;
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard),
                box-shadow var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .search-box:hover {
    border-color: var(--border-highlight);
  }

  .search-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .search-box-icon {
    color: var(--text-tertiary);
    margin-right: var(--spacing-2xs);
    flex-shrink: 0;
  }

  .search-box-input {
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--font-size-sm);
    outline: none;
    width: 100%;
    height: 100%;
    padding: 0;
  }

  .search-box-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-box-clear {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-2xs);
    border-radius: var(--radius-circle);
    flex-shrink: 0;
  }

  .search-box-clear:hover {
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
  }

  .search-box-shortcut {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-subtle);
    padding: var(--spacing-3xs) var(--spacing-2xs);
    flex-shrink: 0;
  }

  /* Right Action Controls */
  .header-right {
    gap: var(--spacing-md);
    flex-shrink: 0;
  }

  .quick-create-btn {
    gap: var(--spacing-xs);
    background-color: var(--accent);
    color: var(--bg-base); /* Contrast on accent color */
    border: none;
    border-radius: var(--radius-standard);
    height: 32px;
    padding: 0 var(--spacing-sm);
    font-family: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .quick-create-btn:hover {
    background-color: var(--accent-hover);
  }

  .quick-create-btn:active {
    background-color: var(--accent-active);
  }

  .right-divider {
    width: 1px;
    height: 20px;
    background-color: var(--border-color);
  }

  .sync-popover-anchor {
    position: relative;
  }

  .sync-status-btn {
    gap: var(--spacing-xs);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--spacing-2xs) var(--spacing-xs);
    border-radius: var(--radius-standard);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .sync-status-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }

  .status-indicator {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
  }

  .status-indicator.syncing {
    color: var(--accent);
  }

  .status-indicator.error {
    color: var(--semantic-error);
  }

  .status-indicator.synced {
    color: var(--semantic-success);
  }

  .status-indicator.disabled {
    color: var(--text-tertiary);
  }

  .settings-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-2xs);
    border-radius: var(--radius-standard);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
    justify-content: center;
  }

  .settings-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  /* Utility animations */
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.95); }
  }

  :global(.pulse-icon) {
    animation: pulse 1.8s infinite ease-in-out;
  }
</style>
