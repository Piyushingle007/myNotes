<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { 
    Cloud, 
    RefreshCw, 
    Folder, 
    Trash2, 
    Settings,
    User,
    Info
  } from 'lucide-svelte';

  let syncClientId = $state(appState.googleClientId);

  const colors = [
    { name: 'Emerald', hue: 142 },
    { name: 'Ocean', hue: 200 },
    { name: 'Royal', hue: 230 },
    { name: 'Amethyst', hue: 280 },
    { name: 'Ruby', hue: 350 },
    { name: 'Amber', hue: 35 }
  ];

  function handleSaveClientId() {
    appState.setClientId(syncClientId);
    alert('Google Client ID saved successfully.');
  }

  async function handleConnectDrive() {
    try {
      await appState.connectGoogleDrive();
      alert('Connected to Google Drive successfully!');
    } catch (e: any) {
      alert('Connection failed: ' + e.message);
    }
  }

  async function handleSyncNow() {
    await appState.syncNotes();
  }

  async function handleDisconnectDrive() {
    await appState.disconnectGoogleDrive();
  }
</script>

<div class="settings-container">
  <div class="header-section">
    <h1 class="title">Settings & Sync</h1>
    <p class="subtitle">Personalize your editor workspace, theme parameters, and configure Google Drive cloud synchronization.</p>
  </div>

  <div class="settings-grid">
    <!-- Workspace Customization Card -->
    <div class="md3-card-outlined settings-card">
      <h3 class="card-title">Appearance & Workspace</h3>
      <p class="card-desc">Configure design parameters, scaling factors, and workspace spacing densities.</p>

      <div class="setting-item flex-col">
        <label class="setting-label">Accent Theme Color</label>
        <div class="color-picker-grid">
          {#each colors as c}
            <button 
              class="color-chip" 
              style={`background-color: hsl(${c.hue}, 70%, 50%);`}
              class:selected={appState.accentHue === c.hue}
              onclick={() => appState.setAccentHue(c.hue)}
              title={c.name}
            ></button>
          {/each}
        </div>
        <!-- Custom range picker -->
        <div class="hue-slider-row flex-row">
          <input 
            type="range" 
            min="0" 
            max="360" 
            bind:value={appState.accentHue} 
            oninput={() => appState.setAccentHue(appState.accentHue)}
            class="hue-range"
          />
          <span class="hue-val">{appState.accentHue}°</span>
        </div>
      </div>

      <div class="setting-item flex-col">
        <label class="setting-label">Interface Theme</label>
        <div class="btn-group flex-row">
          <button 
            class="btn-option" 
            class:active={appState.theme === 'light'} 
            onclick={() => appState.setTheme('light')}
          >
            ☀️ Light
          </button>
          <button 
            class="btn-option" 
            class:active={appState.theme === 'dark'} 
            onclick={() => appState.setTheme('dark')}
          >
            🌙 Dark
          </button>
          <button 
            class="btn-option" 
            class:active={appState.theme === 'black'} 
            onclick={() => appState.setTheme('black')}
          >
            🖤 AMOLED
          </button>
        </div>
      </div>

      <div class="setting-item flex-col">
        <label class="setting-label">Spacing Density</label>
        <div class="btn-group flex-row">
          <button 
            class="btn-option" 
            class:active={appState.density === 'comfortable'} 
            onclick={() => appState.setDensity('comfortable')}
          >
            Comfortable
          </button>
          <button 
            class="btn-option" 
            class:active={appState.density === 'compact'} 
            onclick={() => appState.setDensity('compact')}
          >
            Compact (8px padding)
          </button>
        </div>
      </div>

      <div class="setting-item flex-col">
        <label class="setting-label">Text Font Scaling</label>
        <div class="btn-group flex-row">
          <button 
            class="btn-option" 
            class:active={appState.fontSizeScale === 'small'} 
            onclick={() => appState.setFontSizeScale('small')}
          >
            Small (85%)
          </button>
          <button 
            class="btn-option" 
            class:active={appState.fontSizeScale === 'medium'} 
            onclick={() => appState.setFontSizeScale('medium')}
          >
            Medium (100%)
          </button>
          <button 
            class="btn-option" 
            class:active={appState.fontSizeScale === 'large'} 
            onclick={() => appState.setFontSizeScale('large')}
          >
            Large (120%)
          </button>
        </div>
      </div>
    </div>

    <!-- Google Drive Sync Setup Card -->
    <div class="md3-card-outlined settings-card">
      <div class="card-title-row flex-row">
        <Cloud size={24} class="sync-title-icon" />
        <h3 class="card-title">Google Drive Sync</h3>
      </div>
      <p class="card-desc">Sync your active folders securely to Google Drive. Keep your notes in sync across devices.</p>

      <div class="setting-item flex-col">
        <label for="client-id-input" class="setting-label">Google OAuth Client ID</label>
        <div class="client-id-row flex-row">
          <input 
            type="text" 
            id="client-id-input"
            placeholder="Enter client ID here..." 
            bind:value={syncClientId} 
            class="client-id-input"
          />
          <button class="md3-btn" onclick={handleSaveClientId}>Save ID</button>
        </div>
        <p class="input-help">Find or configure your OAuth credentials in the Google Cloud Console.</p>
      </div>

      <!-- Sync actions and details -->
      {#if appState.googleConnected}
        <div class="sync-details-box md3-card-filled">
          <div class="details-row flex-row">
            <User size={16} />
            <span class="user-email">{appState.googleUserEmail}</span>
            <span class="status-indicator connected">Connected</span>
          </div>

          <div class="details-row flex-row">
            <RefreshCw size={16} />
            <span class="sync-time">
              Last synced: {appState.lastSyncedTime ? new Date(appState.lastSyncedTime).toLocaleString() : 'Never'}
            </span>
          </div>

          <div class="action-row flex-row">
            <button class="md3-btn" onclick={handleSyncNow} disabled={appState.syncStatus === 'syncing'}>
              {#if appState.syncStatus === 'syncing'}
                Syncing...
              {:else}
                🔄 Sync Now
              {/if}
            </button>
            <button class="md3-btn md3-btn-outlined" style="color: var(--semantic-error);" onclick={handleDisconnectDrive}>
              Disconnect Account
            </button>
          </div>
        </div>
      {:else}
        <div class="sync-connect-prompt md3-card-filled flex-col">
          <span class="prompt-text">Google Drive account is currently disconnected. Save Client ID to activate login options.</span>
          <button 
            class="md3-btn connect-btn" 
            onclick={handleConnectDrive} 
            disabled={!appState.googleClientId}
          >
            🔑 Log In & Connect Drive
          </button>
        </div>
      {/if}

      <!-- Drive Synced Folders Rule Help -->
      <div class="sync-help-note md3-card-filled flex-row">
        <Info size={20} class="info-icon" />
        <div class="help-text-block">
          <strong>Vault Isolation Rule:</strong> Every vault creates a distinct subfolder in the Google Drive `myNotes` path. Switching vaults downloads files from the respective Drive folder automatically.
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-container {
    padding: 32px;
    max-width: 1200px;
    margin: 0 auto;
    overflow-y: auto;
    height: 100%;
    animation: fadeIn 0.3s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .header-section {
    margin-bottom: 32px;
  }

  .title {
    font-family: var(--font-sans);
    font-size: 32px;
    font-weight: 800;
    margin-bottom: 6px;
    letter-spacing: -0.5px;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 15px;
  }

  /* Grid layout */
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    align-items: start;
  }

  .settings-card {
    padding: 28px;
    border-radius: var(--radius-l);
    display: flex;
    flex-direction: column;
    gap: 20px;
    background-color: var(--bg-surface);
  }

  .card-title-row {
    gap: 10px;
  }

  .sync-title-icon {
    color: var(--primary);
  }

  .card-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-desc {
    font-size: 13px;
    color: var(--text-tertiary);
    line-height: 1.4;
    margin-top: -12px;
    margin-bottom: 8px;
  }

  .setting-item {
    gap: 8px;
  }

  .setting-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Custom Color Picker */
  .color-picker-grid {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .color-chip {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-circle);
    cursor: pointer;
    border: 3px solid transparent;
    transition: var(--transition-fast);
  }

  .color-chip:hover {
    transform: scale(1.1);
  }

  .color-chip.selected {
    border-color: var(--text-primary);
  }

  .hue-slider-row {
    gap: 12px;
    margin-top: 8px;
  }

  .hue-range {
    flex-grow: 1;
    cursor: pointer;
    accent-color: var(--primary);
  }

  .hue-val {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  /* Button options groups */
  .btn-group {
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
    padding: 3px;
    width: 100%;
  }

  .btn-option {
    flex-grow: 1;
    padding: 10px 14px;
    text-align: center;
    border-radius: var(--radius-xs);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .btn-option:hover {
    color: var(--text-primary);
  }

  .btn-option.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  /* Client ID row */
  .client-id-row {
    gap: 12px;
  }

  .client-id-input {
    flex-grow: 1;
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
    padding: 10px 14px;
    color: var(--text-primary);
    font-size: 13px;
  }

  .client-id-input:focus {
    border-color: var(--primary);
  }

  .input-help {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* Sync details box */
  .sync-details-box {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: var(--radius-m);
  }

  .details-row {
    gap: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .user-email {
    font-weight: 600;
  }

  .status-indicator {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }

  .status-indicator.connected {
    background-color: rgba(26, 139, 60, 0.15);
    color: var(--semantic-success);
  }

  .action-row {
    gap: 12px;
    margin-top: 6px;
  }

  .sync-connect-prompt {
    padding: 16px;
    border-radius: var(--radius-m);
    gap: 12px;
  }

  .prompt-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .connect-btn {
    width: 100%;
  }

  /* Sync helper note */
  .sync-help-note {
    padding: 16px;
    border-radius: var(--radius-m);
    gap: 12px;
    align-items: flex-start;
  }

  .info-icon {
    color: var(--primary);
    flex-shrink: 0;
  }

  .help-text-block {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  @media (max-width: 900px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .settings-container {
      padding: 16px;
    }
    .title {
      font-size: 26px;
    }
  }
</style>
