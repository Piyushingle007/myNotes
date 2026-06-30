<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { appState } from './lib/stores/appState.svelte';
  import { mobileNav } from './lib/stores/mobileNav.svelte';
  import AppLayout from './lib/components/AppLayout.svelte';
  import { FolderOpen, Play } from 'lucide-svelte';
  import GoogleLogo from './lib/components/GoogleLogo.svelte';
  import { runTagDbTest } from './lib/storage/test_tag_db';

  let initializing = $state(true);

  // Browser/Android navigation history synchronization
  function syncStateToHash() {
    let newHash = '';
    if (appState.activeNotePath) {
      newHash = `#/note/${encodeURIComponent(appState.activeNotePath)}`;
      if (__FEATURE_CANVAS__ && appState.editorMode === 'canvas') {
        newHash += '?mode=canvas';
      } else if (__FEATURE_CANVAS__ && appState.editorMode === 'notebook') {
        newHash += '?mode=notebook';
      }
    } else if (appState.activeTab === 'daily') {
      newHash = `#/daily`;
    } else if (appState.activeTab === 'focus') {
      newHash = `#/focus`;
    } else if (appState.activeTab === 'library') {
      if (appState.activeNotebook) {
        newHash = `#/library/${encodeURIComponent(appState.activeNotebook)}`;
      } else {
        newHash = `#/library`;
      }
    } else if (appState.activeTab === 'tags') {
      if (appState.selectedTag) {
        newHash = `#/tags/${encodeURIComponent(appState.selectedTag)}`;
      } else {
        newHash = `#/tags`;
      }
    } else {
      newHash = `#/home`;
    }

    if (window.location.hash !== newHash) {
      window.location.hash = newHash;
    }
  }

  function syncHashToState() {
    const hash = window.location.hash;

    if (hash.startsWith('#/note/')) {
      const queryIdx = hash.indexOf('?');
      let notePathPart = hash;
      let modeParam = 'text';

      if (queryIdx !== -1) {
        notePathPart = hash.substring(0, queryIdx);
        const queryStr = hash.substring(queryIdx + 1);
        const params = new URLSearchParams(queryStr);
        if (__FEATURE_CANVAS__ && params.get('mode') === 'canvas') {
          modeParam = 'canvas';
        } else if (__FEATURE_CANVAS__ && params.get('mode') === 'notebook') {
          modeParam = 'notebook';
        }
      }

      const notePath = decodeURIComponent(notePathPart.slice('#/note/'.length));
      if (appState.activeNotePath !== notePath) {
        appState.selectNote(notePath);
      }

      if (__FEATURE_CANVAS__ && appState.editorMode !== modeParam) {
        appState.editorMode = modeParam as 'text' | 'canvas' | 'notebook';
      }
    } else {
      if (appState.activeNotePath !== null) {
        // Leaving an open note via browser/gesture back — persist edits first
        // so unsaved changes are never lost (UI-M-001).
        void mobileNav.flushPendingSave();
        appState.activeNotePath = null;
      }

      if (hash.startsWith('#/library/')) {
        const notebook = decodeURIComponent(hash.slice('#/library/'.length));
        appState.activeTab = 'library';
        appState.activeNotebook = notebook;
      } else if (hash === '#/library') {
        appState.activeTab = 'library';
        appState.activeNotebook = null;
      } else if (hash.startsWith('#/tags/')) {
        const tag = decodeURIComponent(hash.slice('#/tags/'.length));
        appState.activeTab = 'tags';
        appState.selectedTag = tag;
      } else if (hash === '#/tags') {
        appState.activeTab = 'tags';
        appState.selectedTag = null;
      } else if (hash === '#/daily') {
        appState.activeTab = 'daily';
        appState.activeNotebook = null;
      } else if (hash === '#/focus') {
        appState.activeTab = 'focus';
        appState.activeNotebook = null;
      } else {
        appState.activeTab = 'home';
        appState.activeNotebook = null;
      }
    }
  }

  // 1. Event listener registration effect (runs exactly once when vaultReady transitions to true)
  $effect(() => {
    if (appState.vaultReady) {
      window.addEventListener('hashchange', syncHashToState);
      
      // Perform initial routing on load (untracked to prevent dynamic dependency collection)
      untrack(() => {
        if (window.location.hash) {
          syncHashToState();
        } else {
          syncStateToHash();
        }
      });

      return () => {
        window.removeEventListener('hashchange', syncHashToState);
      };
    }
  });

  // 2. Reactive state-to-hash update effect (runs when tab/note/notebook state changes)
  $effect(() => {
    if (appState.vaultReady) {
      // Establish Svelte 5 reactive dependencies
      const _tab = appState.activeTab;
      const _notePath = appState.activeNotePath;
      const _notebook = appState.activeNotebook;
      const _tag = appState.selectedTag;
      const _editorMode = appState.editorMode;

      syncStateToHash();
    }
  });

  onMount(async () => {
    // Check if we can auto-init sandbox or check active vault
    try {
      await appState.initSandbox();
      // Execute the TagDatabase schema and constraint test
      await runTagDbTest();
    } catch (e) {
      console.warn('Sandbox init failed, user will select folder manually', e);
    } finally {
      initializing = false;
    }
  });

  // Register the Android hardware back button (Capacitor) so it follows the
  // mobile navigation hierarchy and never loses unsaved edits (UI-M-001).
  onMount(() => {
    let cleanup: (() => void) | undefined;
    mobileNav.registerBackHandlers().then((c) => { cleanup = c; });
    return () => cleanup?.();
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
    width: 100%;
    height: 100%;
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
    width: 100%;
    height: 100%;
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
