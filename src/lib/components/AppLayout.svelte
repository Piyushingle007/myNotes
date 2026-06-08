<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../stores/appState.svelte';
  import Sidebar from './Sidebar.svelte';
  import Editor from './Editor.svelte';
  import GraphView from './GraphView.svelte';

  import DashboardView from './DashboardView.svelte';
  import DocumentsView from './DocumentsView.svelte';
  import SettingsView from './SettingsView.svelte';

  import { 
    Home, 
    FileText, 
    Settings,
    Cloud
  } from 'lucide-svelte';

  // Responsive state
  let isMobile = $state(false);
  let showGraph = $state(false);

  // Handle window resizing
  function handleResize() {
    isMobile = window.innerWidth < 768;
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
  <!-- MOBILE VIEW (MATERIAL 3 INSPIRED)              -->
  <!-- ============================================== -->
  <div class="mobile-app flex-col">
    {#if appState.activeNotePath}
      <!-- Fullscreen Editor Overlay for Mobile -->
      <div class="mobile-editor-container flex-col">
        <!-- Back header for mobile editor -->
        <div class="mobile-editor-header flex-row">
          <button class="back-btn" onclick={() => appState.activeNotePath = null}>
            ◀ Back to {appState.activeTab}
          </button>
          <span class="editing-title">{appState.activeNoteTitle}</span>
        </div>
        <div class="mobile-editor-wrapper">
          <Editor bind:showGraph={showGraph} />
        </div>
      </div>
    {:else}
      <!-- Header bar -->
      <div class="mobile-app-header flex-row">
        <div class="logo-group flex-row">
          <span class="logo-emoji">📓</span>
          <span class="logo-text">myNotes</span>
        </div>
        <div class="sync-indicator-group flex-row">
          <span class="vault-badge">{appState.vaultName || 'Sandbox'}</span>
          {#if appState.googleConnected}
            <Cloud size={16} class="sync-icon connected" />
          {:else}
            <Cloud size={16} class="sync-icon offline" />
          {/if}
        </div>
      </div>

      <!-- Main Mobile Content Area -->
      <div class="mobile-content-area flex-grow">
        {#if appState.activeTab === 'dashboard'}
          <DashboardView />
        {:else if appState.activeTab === 'documents'}
          <DocumentsView />
        {:else if appState.activeTab === 'settings'}
          <SettingsView />
        {/if}
      </div>

      <!-- Bottom Navigation Bar (MD3 styled) -->
      <div class="mobile-bottom-nav flex-row">
        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'dashboard'}
          onclick={() => appState.activeTab = 'dashboard'}
        >
          <Home size={20} />
          <span>Home</span>
        </button>

        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'documents'}
          onclick={() => appState.activeTab = 'documents'}
        >
          <FileText size={20} />
          <span>Files</span>
        </button>

        <button 
          class="nav-tab flex-col" 
          class:active={appState.activeTab === 'settings'}
          onclick={() => appState.activeTab = 'settings'}
        >
          <Settings size={20} />
          <span>Settings</span>
        </button>
      </div>
    {/if}
  </div>
{:else}
  <!-- ============================================== -->
  <!-- DESKTOP VIEW                                   -->
  <!-- ============================================== -->
  <div class="desktop-app flex-row">
    <!-- Left Navigation Drawer / Rail -->
    <Sidebar />

    <!-- Main Content Canvas -->
    <div class="desktop-main-canvas flex-col flex-grow">
      {#if appState.activeNotePath !== null}
        <!-- Centered Document Editor Canvas -->
        <div class="editor-view-container flex-row flex-grow">
          <!-- Back to previous view button on top left of editor -->
          <div class="editor-wrapper flex-grow flex-col">
            <div class="editor-header-bar flex-row">
              <button class="close-doc-btn flex-row" onclick={() => appState.activeNotePath = null}>
                ◀ Close Document
              </button>
              <span class="active-doc-path">{appState.activeNotePath}</span>
            </div>
            
            <div class="editor-canvas-wrapper flex-grow">
              <Editor bind:showGraph={showGraph} />
            </div>
          </div>

          <!-- Far Right Graph visualizer (Collapsible) -->
          {#if showGraph}
            <div class="desktop-graph-panel">
              <GraphView />
            </div>
          {/if}
        </div>
      {:else}
        <!-- Tab views -->
        <div class="tab-view-container flex-grow">
          {#if appState.activeTab === 'dashboard'}
            <DashboardView />
          {:else if appState.activeTab === 'documents'}
            <DocumentsView />
          {:else if appState.activeTab === 'settings'}
            <SettingsView />
          {/if}
        </div>
      {/if}
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

  .flex-grow {
    flex-grow: 1;
  }

  /* Desktop Shell styling */
  .desktop-app {
    width: 100vw;
    height: 100vh;
    background-color: var(--bg-base);
    overflow: hidden;
  }

  .desktop-main-canvas {
    height: 100%;
    overflow: hidden;
    background-color: var(--bg-base);
  }

  .tab-view-container {
    height: 100%;
    overflow: hidden;
  }

  /* Desktop Editor Wrapper Layout */
  .editor-view-container {
    height: 100%;
    overflow: hidden;
  }

  .editor-wrapper {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-header-bar {
    height: 48px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-surface-container);
    padding: 0 24px;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .close-doc-btn {
    font-size: 13px;
    font-weight: 700;
    color: var(--primary);
    cursor: pointer;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--radius-s);
  }

  .close-doc-btn:hover {
    background-color: rgba(120, 120, 120, 0.08);
  }

  .active-doc-path {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }

  .editor-canvas-wrapper {
    overflow: hidden;
  }

  .desktop-graph-panel {
    width: 320px;
    border-left: 1px solid var(--border-color);
    background-color: var(--bg-surface);
    height: 100%;
    flex-shrink: 0;
  }

  /* ============================================== */
  /* MOBILE SHELL STYLING                           */
  /* ============================================== */
  .mobile-app {
    width: 100vw;
    height: 100vh;
    background-color: var(--bg-base);
    overflow: hidden;
    position: relative;
  }

  .mobile-app-header {
    height: 56px;
    padding: 0 16px;
    justify-content: space-between;
    background-color: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .logo-group {
    gap: 8px;
  }

  .logo-emoji {
    font-size: 20px;
  }

  .logo-text {
    font-family: var(--font-sans);
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }

  .sync-indicator-group {
    gap: 10px;
  }

  .vault-badge {
    font-size: 11px;
    font-weight: 700;
    background-color: var(--primary-container);
    color: var(--on-primary-container);
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }

  .sync-icon.connected {
    color: var(--semantic-success);
  }

  .sync-icon.offline {
    color: var(--text-tertiary);
  }

  .mobile-content-area {
    overflow: hidden;
  }

  /* Mobile bottom bar */
  .mobile-bottom-nav {
    height: 64px;
    background-color: var(--bg-surface);
    border-top: 1px solid var(--border-color);
    justify-content: space-around;
    padding-bottom: env(safe-area-inset-bottom);
    flex-shrink: 0;
  }

  .nav-tab {
    flex: 1;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    gap: 4px;
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
  }

  .nav-tab.active {
    color: var(--primary);
  }

  /* Mobile Fullscreen Editor */
  .mobile-editor-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-base);
    z-index: 200;
  }

  .mobile-editor-header {
    height: 56px;
    padding: 0 16px;
    background-color: var(--bg-surface-container);
    border-bottom: 1px solid var(--border-color);
    justify-content: space-between;
    flex-shrink: 0;
  }

  .back-btn {
    font-size: 13px;
    font-weight: 700;
    color: var(--primary);
    cursor: pointer;
  }

  .editing-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60%;
  }

  .mobile-editor-wrapper {
    flex-grow: 1;
    overflow: hidden;
  }
</style>
