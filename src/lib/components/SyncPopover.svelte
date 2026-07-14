<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import {
    Cloud, CloudOff, RefreshCw, LogOut, Settings
  } from 'lucide-svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let popoverEl = $state<HTMLDivElement | null>(null);

  // Relative time formatter
  function formatRelativeTime(timestamp: number | null): string {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Avatar initial from email
  function getInitial(email: string | null): string {
    if (!email) return '?';
    return email.charAt(0).toUpperCase();
  }

  // Derived status values
  let isConnected = $derived(appState.googleConnected);
  let isSyncEnabled = $derived(appState.syncEnabled);
  let isSyncing = $derived(appState.syncStatus === 'syncing');
  let isError = $derived(appState.syncStatus === 'error');
  let statusText = $derived.by(() => {
    if (!isConnected) return 'Not connected';
    if (!isSyncEnabled) return 'Sync disabled';
    if (isSyncing) return 'Syncing…';
    if (isError) return appState.syncErrorMessage || 'Sync error';
    return 'Synced';
  });
  let statusColor = $derived.by(() => {
    if (!isConnected || !isSyncEnabled) return 'var(--text-tertiary)';
    if (isSyncing) return 'var(--accent)';
    if (isError) return 'var(--semantic-error)';
    return 'var(--semantic-success)';
  });

  // Close on Escape
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }

  // Close on outside click
  function handleOutsideClick(e: MouseEvent) {
    if (popoverEl && !popoverEl.contains(e.target as Node)) {
      const target = e.target as HTMLElement;
      if (target.closest('.sync-popover-anchor')) return;
      onclose();
    }
  }

  $effect(() => {
    document.addEventListener('mousedown', handleOutsideClick, true);
    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
      document.removeEventListener('keydown', handleKeydown, true);
    };
  });

  async function handleSyncNow() {
    await appState.syncNotes();
  }

  function handleDisconnect() {
    appState.disconnectGoogleDrive();
    onclose();
  }

  function handleConnect() {
    appState.connectGoogleDrive();
  }

  function handleToggleSync(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    appState.setSyncEnabled(checked);
    if (checked) {
      appState.syncNotes();
    }
  }

  function handleOpenSettings() {
    appState.showSettings = true;
    appState.settingsActiveTab = 'sync';
    onclose();
  }
</script>

<div class="sync-popover" bind:this={popoverEl} role="dialog" aria-label="Sync & Account">
  <!-- Zone 1: Account Card -->
  <div class="popover-zone account-zone">
    {#if isConnected}
      <div class="account-row">
        <div class="avatar" style="background: {statusColor};">
          {getInitial(appState.googleUserEmail)}
        </div>
        <div class="account-details">
          <span class="account-email">{appState.googleUserEmail || 'Unknown'}</span>
          <span class="account-folder">
            <Cloud size={12} style="flex-shrink: 0;" />
            {appState.customDriveFolderName || 'MyNotes'}
          </span>
        </div>
      </div>
    {:else}
      <div class="disconnected-state">
        <div class="disconnected-icon-wrap">
          <CloudOff size={28} style="color: var(--text-tertiary);" />
        </div>
        <span class="disconnected-title">Not Connected</span>
        <span class="disconnected-desc">Connect Google Drive to sync your notes across devices.</span>
        {#if appState.googleClientId}
          <button class="btn-connect" onclick={handleConnect}>
            <Cloud size={14} />
            Connect Google Drive
          </button>
        {:else}
          <button class="btn-connect btn-connect-settings" onclick={handleOpenSettings}>
            <Settings size={14} />
            Configure in Settings
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if isConnected}
    <!-- Zone 2: Live Status -->
    <div class="popover-zone status-zone">
      <div class="status-live-row">
        <div class="status-dot-wrap">
          <span
            class="status-dot"
            class:syncing={isSyncing}
            class:error={isError}
            class:synced={!isSyncing && !isError && isSyncEnabled}
            class:disabled={!isSyncEnabled}
          ></span>
        </div>
        <div class="status-text-col">
          <span class="status-label" style="color: {statusColor};">{statusText}</span>
          <span class="status-time">
            Last synced: {formatRelativeTime(appState.lastSyncedTime)}
          </span>
        </div>
      </div>

      <div class="sync-toggle-row">
        <span class="toggle-label">Auto-sync</span>
        <label class="toggle-switch">
          <input
            type="checkbox"
            checked={isSyncEnabled}
            onchange={handleToggleSync}
          />
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
        </label>
      </div>
    </div>

    <!-- Zone 3: Actions -->
    <div class="popover-zone actions-zone">
      <button
        class="action-btn sync-now-btn"
        onclick={handleSyncNow}
        disabled={isSyncing}
      >
        <RefreshCw size={14} class={isSyncing ? 'spin-icon' : ''} />
        <span>{isSyncing ? 'Syncing…' : 'Sync Now'}</span>
      </button>

      <button class="action-btn disconnect-btn" onclick={handleDisconnect}>
        <LogOut size={14} />
        <span>Disconnect</span>
      </button>

      <div class="actions-divider"></div>

      <button class="action-btn settings-link" onclick={handleOpenSettings}>
        <Settings size={14} />
        <span>Sync Settings</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .sync-popover {
    position: absolute;
    top: calc(100% + var(--spacing-xs));
    right: 0;
    width: 300px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    box-shadow: var(--elevation-3);
    z-index: var(--z-index-popover, 1100);
    overflow: hidden;
    animation: popover-enter 0.18s var(--motion-ease-standard);
  }

  @keyframes popover-enter {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Zones */
  .popover-zone {
    padding: var(--spacing-md);
  }

  .popover-zone + .popover-zone {
    border-top: 1px solid var(--border-color);
  }

  /* Zone 1: Account */
  .account-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    color: var(--bg-base);
    flex-shrink: 0;
    letter-spacing: -0.3px;
  }

  .account-details {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
    min-width: 0;
  }

  .account-email {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-folder {
    display: flex;
    align-items: center;
    gap: var(--spacing-2xs);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  /* Disconnected State */
  .disconnected-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) 0;
  }

  .disconnected-icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full-pill);
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--spacing-2xs);
  }

  .disconnected-title {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .disconnected-desc {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    max-width: 220px;
  }

  .btn-connect {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-top: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-md);
    background: var(--accent);
    color: var(--bg-base);
    border: none;
    border-radius: var(--radius-pill);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .btn-connect:hover {
    background: var(--accent-hover);
  }

  .btn-connect-settings {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  }

  .btn-connect-settings:hover {
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
    border-color: var(--border-highlight);
  }

  /* Zone 2: Status */
  .status-live-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .status-dot-wrap {
    flex-shrink: 0;
  }

  .status-dot {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition: background-color var(--motion-duration-standard) var(--motion-ease-standard);
  }

  .status-dot.synced {
    background: var(--semantic-success);
    box-shadow: 0 0 6px color-mix(in srgb, var(--semantic-success) 40%, transparent);
  }

  .status-dot.syncing {
    background: var(--accent);
    animation: dot-pulse 1.4s infinite ease-in-out;
  }

  .status-dot.error {
    background: var(--semantic-error);
    box-shadow: 0 0 6px color-mix(in srgb, var(--semantic-error) 40%, transparent);
  }

  .status-dot.disabled {
    background: var(--text-tertiary);
  }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
  }

  .status-text-col {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
  }

  .status-label {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  .status-time {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .sync-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--spacing-sm);
    padding-top: var(--spacing-sm);
    border-top: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
  }

  .toggle-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
  }

  /* Custom toggle switch */
  .toggle-switch {
    position: relative;
    cursor: pointer;
  }

  .toggle-switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-track {
    display: block;
    width: 36px;
    height: 20px;
    background: color-mix(in srgb, var(--text-primary) 15%, transparent);
    border-radius: var(--radius-full-pill);
    position: relative;
    transition: background-color var(--motion-duration-standard) var(--motion-ease-standard);
  }

  .toggle-switch input:checked + .toggle-track {
    background: var(--accent);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--text-primary);
    border-radius: 50%;
    transition: transform var(--motion-duration-standard) var(--motion-ease-standard);
  }

  .toggle-switch input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
  }

  /* Zone 3: Actions */
  .actions-zone {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3xs);
    padding: var(--spacing-xs) var(--spacing-md);
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-xs);
    background: transparent;
    border: none;
    border-radius: var(--radius-standard);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .action-btn:hover {
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
  }

  .sync-now-btn {
    color: var(--accent);
  }

  .sync-now-btn:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
  }

  .disconnect-btn {
    color: var(--semantic-error);
  }

  .disconnect-btn:hover {
    background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
    color: var(--semantic-error);
  }

  .actions-divider {
    height: 1px;
    background: var(--border-color);
    margin: var(--spacing-3xs) 0;
  }

  .settings-link {
    color: var(--text-tertiary);
  }

  /* Spin animation for sync icon */
  :global(.spin-icon) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
