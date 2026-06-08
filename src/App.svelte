<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from './lib/stores/appState.svelte';
  import AppLayout from './lib/components/AppLayout.svelte';
  import { FolderOpen, Play } from 'lucide-svelte';
  import GoogleLogo from './lib/components/GoogleLogo.svelte';

  let initializing = $state(true);

  onMount(async () => {
    // Check if we can auto-init sandbox or check active vault
    try {
      await appState.initSandbox();
    } catch (e) {
      console.warn('Sandbox init failed, user will select folder manually', e);
    } finally {
      initializing = false;
    }
  });

  // Global key bindings for shortcuts (Save, Wikilink)
  function handleKeyDown(e: KeyboardEvent) {
    // Ctrl+S / Cmd+S to Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (appState.editorDirty) {
        appState.saveActiveNote(true);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if initializing}
  <div class="loader flex-col">
    <div class="loader-logo flex-row" style="justify-content: center;"><GoogleLogo size={64} /></div>
    <div class="spinner"></div>
  </div>
{:else if appState.vaultReady}
  <AppLayout />
{:else}
  <div class="welcome-screen flex-col">
    <div class="welcome-content flex-col">
      <div class="welcome-logo flex-row" style="justify-content: center;"><GoogleLogo size={80} /></div>
      <h1 class="welcome-title">MyNotes</h1>
      <p class="welcome-sub">Local-first markdown notes. Beautiful color themes, clean design, fully offline.</p>
      
      <div class="welcome-actions flex-col">
        <button class="btn-pill btn-pill-primary flex-row welcome-btn" onclick={() => appState.initSandbox()}>
          <Play size={16} />
          <span>Launch Local Sandbox</span>
        </button>

        <button class="btn-pill btn-pill-outline flex-row welcome-btn" onclick={() => appState.openDirectory()}>
          <FolderOpen size={16} />
          <span>Open Folder on Device</span>
        </button>
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

  .loader {
    width: 100vw;
    height: 100vh;
    background-color: #000000;
    align-items: center;
    justify-content: center;
    gap: 24px;
  }

  .loader-logo {
    font-size: 64px;
    animation: pulse 1.5s infinite ease-in-out;
  }

  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
      opacity: 0.8;
    }
    50% {
      transform: scale(1.1);
      opacity: 1;
    }
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .welcome-screen {
    width: 100vw;
    height: 100vh;
    background-color: #000000;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .welcome-content {
    align-items: center;
    text-align: center;
    gap: 16px;
    max-width: 380px;
  }

  .welcome-logo {
    font-size: 80px;
  }

  .welcome-title {
    font-size: 36px;
    font-weight: 850;
    letter-spacing: -1px;
    color: var(--text-primary);
  }

  .welcome-sub {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 16px;
  }

  .welcome-actions {
    gap: 12px;
    width: 100%;
  }

  .welcome-btn {
    width: 100%;
    justify-content: center;
    padding: 12px 24px;
    font-size: 13px;
  }
</style>
