<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from './lib/stores/appState.svelte';
  import AppLayout from './lib/components/AppLayout.svelte';
  import { FolderOpen, Play } from 'lucide-svelte';

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
    <div class="loader-logo">📓</div>
    <div class="spinner"></div>
    <span class="loader-text">Initializing workspace...</span>
  </div>
{:else if appState.vaultReady}
  <AppLayout />
{:else}
  <div class="welcome-screen flex-col">
    <div class="welcome-card md3-card-outlined flex-col">
      <div class="welcome-logo">📓</div>
      <h1 class="welcome-title">myNotes</h1>
      <p class="welcome-sub">Premium Material Design 3 local-first markdown note-taking vault. Fully offline & secure.</p>
      
      <div class="welcome-actions flex-col">
        <button class="md3-btn welcome-btn" onclick={() => appState.initSandbox()}>
          <Play size={16} />
          <span>Launch Local Sandbox</span>
        </button>

        <button class="md3-btn md3-btn-outlined welcome-btn" onclick={() => appState.openDirectory()}>
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
    background-color: var(--bg-base);
    color: var(--text-primary);
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .loader-logo {
    font-size: 64px;
    animation: pulse 1.5s infinite ease-in-out;
  }

  .loader-text {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
      opacity: 0.8;
    }
    50% {
      transform: scale(1.08);
      opacity: 1;
    }
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-color);
    border-top-color: var(--primary);
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
    background-color: var(--bg-base);
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .welcome-card {
    align-items: center;
    text-align: center;
    gap: 20px;
    max-width: 420px;
    padding: 40px;
    background-color: var(--bg-surface);
  }

  .welcome-logo {
    font-size: 72px;
  }

  .welcome-title {
    font-family: var(--font-sans);
    font-size: 36px;
    font-weight: 850;
    letter-spacing: -1px;
    color: var(--text-primary);
  }

  .welcome-sub {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 8px;
  }

  .welcome-actions {
    gap: 12px;
    width: 100%;
  }

  .welcome-btn {
    width: 100%;
    height: 48px;
    justify-content: center;
  }
</style>
