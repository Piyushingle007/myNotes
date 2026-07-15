<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Plus, Trash2, Edit3, MoreVertical, X, PenTool, Check, Save } from 'lucide-svelte';
  import { fade } from 'svelte/transition';
  import { appState } from '../stores/appState.svelte';
  import { DrawFileManager, type DrawDocument } from '../services/DrawFileManager';
  import TldrawWrapper from './TldrawWrapper.svelte';

  let drawFiles = $state<{ path: string; name: string; created: number; modified: number }[]>([]);
  let activeFilePath = $state<string | null>(null);
  let activeTitle = $state('');
  
  let showMenu = $state(false);
  let isRenamingFile = $state(false);
  let newFileNameVal = $state('');
  let renameInputEl = $state<HTMLInputElement | null>(null);
  let saveStatus = $state<'clean' | 'saving'>('clean');
  
  let editorInstance: any = $state(null);
  let activeSnapshot: any = $state(null);
  let saveTimeout: any = null;

  let activeFile = $derived(drawFiles.find(f => f.path === activeFilePath));

  onMount(async () => {
    await DrawFileManager.ensureDrawFolder();
    refreshFileList();

    if (drawFiles.length === 0) {
      await handleCreateFile();
    } else {
      await selectFile(drawFiles[0].path);
    }
  });

  function refreshFileList() {
    drawFiles = DrawFileManager.listDrawFiles();
  }

  async function selectFile(path: string) {
    if (activeFilePath === path) return;
    
    // Save current before switching
    if (activeFilePath && editorInstance) {
      const snap = editorInstance.store.getSnapshot();
      await saveCurrentDocument(snap);
    }
    
    activeFilePath = null; // Unmount current
    await tick();
    
    try {
      const doc = DrawFileManager.loadDrawFile(path);
      activeFilePath = path;
      activeTitle = doc.title;
      activeSnapshot = doc.snapshot;
    } catch (e) {
      appState.showToast('Failed to load drawing.', 'error');
    }
  }

  async function handleCreateFile() {
    try {
      const path = await DrawFileManager.createDrawFile('Whiteboard');
      refreshFileList();
      await selectFile(path);
    } catch (e) {
      appState.showToast('Failed to create whiteboard.', 'error');
    }
  }

  async function handleRenameActiveFile() {
    if (!activeFilePath || !newFileNameVal.trim()) {
      isRenamingFile = false;
      return;
    }
    const cleanTitle = newFileNameVal.trim();
    
    try {
      const newPath = await DrawFileManager.renameDrawFile(activeFilePath, cleanTitle);
      refreshFileList();
      activeFilePath = newPath;
      activeTitle = cleanTitle;
      isRenamingFile = false;
    } catch (e) {
      appState.showToast('Rename failed', 'error');
    }
  }

  async function handleDeleteFile(path: string) {
    const fileToDelete = drawFiles.find(f => f.path === path);
    if (!fileToDelete) return;
    
    if (confirm(`Delete whiteboard "${fileToDelete.name}"?`)) {
      try {
        await DrawFileManager.deleteDrawFile(path);
        refreshFileList();
        if (activeFilePath === path) {
          activeFilePath = null;
          if (drawFiles.length > 0) {
            await selectFile(drawFiles[0].path);
          } else {
            await handleCreateFile();
          }
        }
      } catch (e) {
        appState.showToast('Failed to delete', 'error');
      }
    }
  }

  function startRenaming() {
    newFileNameVal = activeTitle;
    isRenamingFile = true;
    showMenu = false;
    tick().then(() => renameInputEl?.focus());
  }

  function clickOutside(node: HTMLElement, callback: () => void) {
    const handleClick = (e: MouseEvent) => {
      if (node && !node.contains(e.target as Node)) callback();
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy() { document.removeEventListener('click', handleClick, true); }
    };
  }

  function handleEditorChange(snapshot: any) {
    if (!activeFilePath) return;
    saveStatus = 'saving';
    clearTimeout(saveTimeout);
    
    // Debounce saves to prevent blocking the UI
    saveTimeout = setTimeout(() => {
      saveCurrentDocument(snapshot).then(() => {
        saveStatus = 'clean';
      });
    }, 1000);
  }

  async function saveCurrentDocument(snapshot: any) {
    if (!activeFilePath || !activeFile) return;
    
    const doc: DrawDocument = {
      version: 1,
      title: activeTitle,
      snapshot: snapshot,
      createdAt: new Date(activeFile.created).toISOString(),
      modifiedAt: new Date().toISOString()
    };
    
    await DrawFileManager.saveDrawFile(activeFilePath, doc);
  }

</script>

<div class="workspace-root flex-col">
  <!-- 1. Minimal Top Header -->
  <header class="app-header flex-row">
    <div class="tabs-scroll flex-row">
      {#each drawFiles as file}
        <div 
          class="file-tab flex-row" 
          class:active={activeFilePath === file.path}
          onclick={() => selectFile(file.path)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && selectFile(file.path)}
        >
          <PenTool size={14} class="tab-icon" />
          <span class="tab-name">{file.name}</span>
          {#if drawFiles.length > 1}
            <button 
              class="tab-close-btn flex-row" 
              onclick={(e) => { e.stopPropagation(); handleDeleteFile(file.path); }}
              aria-label="Delete whiteboard"
            >
              <X size={12} />
            </button>
          {/if}
        </div>
      {/each}
      <button class="add-tab-btn flex-row" onclick={handleCreateFile} title="New Whiteboard">
        <Plus size={14} />
      </button>
    </div>

    <div class="header-actions flex-row">
      <div class="menu-wrapper">
        <button class="hdr-icon-btn" onclick={(e) => { e.stopPropagation(); showMenu = !showMenu; }} title="More Options">
          <MoreVertical size={15} />
        </button>
        {#if showMenu}
          <div class="glass-menu flex-col" use:clickOutside={() => showMenu = false} transition:fade={{duration: 150}}>
            <button onclick={startRenaming}>
              <Edit3 size={14} /> Rename Whiteboard
            </button>
            <div class="menu-divider"></div>
            {#if activeFilePath}
              <button onclick={() => handleDeleteFile(activeFilePath!)} class="destructive-action">
                <Trash2 size={14} /> Delete Whiteboard
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </header>

  <!-- 2. Main Canvas Area -->
  <main class="main-scroll flex-col" style="overflow: hidden; padding: 0;">
    <div class="content-wrapper flex-col" style="height: 100%; max-width: none; padding: 0;">
      <!-- Top Bar inside Canvas -->
      <div class="session-title-area flex-row" style="position: absolute; top: 16px; left: 16px; z-index: 500; pointer-events: none;">
        <div style="pointer-events: auto; display: flex; align-items: center; gap: 12px;">
          {#if isRenamingFile}
            <input 
              type="text" 
              bind:value={newFileNameVal} 
              onkeydown={(e) => e.key === 'Enter' && handleRenameActiveFile()}
              onblur={handleRenameActiveFile}
              class="title-input"
              placeholder="Whiteboard name..."
              bind:this={renameInputEl}
            />
          {:else}
            <h1 class="title-display" ondblclick={startRenaming} style="margin: 0; font-size: 1.2rem; background: var(--bg-surface); padding: 4px 12px; border-radius: 8px; box-shadow: var(--shadow-sm);">{activeTitle || 'Whiteboard'}</h1>
          {/if}

          <!-- Sync status -->
          <span class="status-badge save-status {saveStatus}" style="background: var(--bg-surface); padding: 4px 8px; border-radius: 8px; box-shadow: var(--shadow-sm); display: flex; align-items: center; gap: 4px; font-size: 0.75rem;">
            {#if saveStatus === 'clean'}
              <Check size={12} /> Saved
            {:else}
              <Save size={12} /> Saving...
            {/if}
          </span>
        </div>
      </div>
      
      <!-- Tldraw Canvas -->
      <div class="tldraw-container" style="flex: 1; width: 100%; height: 100%; position: relative;">
        {#if activeFilePath}
          <!-- Use keyed block to completely destroy and re-mount tldraw when changing files, 
               preventing state bleed and ensuring fresh loadSnapshot -->
          {#key activeFilePath}
            <TldrawWrapper 
              initialSnapshot={activeSnapshot}
              onChange={handleEditorChange}
              onMountCb={(editor) => { editorInstance = editor; }}
            />
          {/key}
        {:else}
          <div class="empty-state">No whiteboard selected.</div>
        {/if}
      </div>
    </div>
  </main>
</div>

<style>
  /* Import styling similar to NumbatView */
  .workspace-root {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-main);
  }
  
  .app-header {
    flex: 0 0 44px;
    background: var(--bg-surface-elevated, #1e2227);
    border-bottom: 1px solid var(--border-color);
    padding: 0 12px;
    justify-content: space-between;
    align-items: center;
  }
  
  .tabs-scroll {
    overflow-x: auto;
    overflow-y: hidden;
    height: 100%;
    align-items: center;
    gap: 4px;
  }
  .tabs-scroll::-webkit-scrollbar { display: none; }
  
  .file-tab {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
    background: transparent;
    max-width: 150px;
  }
  .file-tab:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-normal);
  }
  .file-tab.active {
    background: var(--bg-card-hover, #2c313a);
    color: var(--text-heading);
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  .tab-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-close-btn {
    opacity: 0;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    justify-content: center;
    transition: all 0.15s;
  }
  .file-tab:hover .tab-close-btn {
    opacity: 1;
  }
  .tab-close-btn:hover {
    background: rgba(255,50,50,0.2);
    color: #ff5555;
  }
  .add-tab-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    justify-content: center;
    transition: all 0.2s;
  }
  .add-tab-btn:hover {
    background: rgba(255,255,255,0.05);
    color: var(--text-normal);
  }
  
  .header-actions {
    gap: 8px;
  }
  .hdr-icon-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  .hdr-icon-btn:hover, .hdr-icon-btn.active {
    background: var(--bg-card-hover, #2c313a);
    color: var(--text-heading);
  }
  
  .menu-wrapper {
    position: relative;
  }
  .glass-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--bg-surface-elevated, #1e2227);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 6px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    z-index: 100;
    min-width: 160px;
    backdrop-filter: blur(10px);
  }
  .glass-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--text-normal);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    text-align: left;
    transition: all 0.15s;
  }
  .glass-menu button:hover {
    background: var(--bg-card-hover, #2c313a);
    color: var(--text-heading);
  }
  .glass-menu button.destructive-action {
    color: #ff5555;
  }
  .glass-menu button.destructive-action:hover {
    background: rgba(255,50,50,0.1);
  }
  .menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }
  
  .main-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .content-wrapper {
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
    padding: 32px 16px 80px 16px;
    position: relative;
  }
  
  .empty-state {
    padding: 40px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .title-display {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-heading);
    margin: 0;
    cursor: text;
    border: 1px solid transparent;
    padding: 2px 4px;
    border-radius: 4px;
    transition: background 0.2s;
  }
  .title-display:hover {
    background: var(--bg-card-hover, #2c313a);
  }
  .title-input {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-heading);
    margin: 0;
    background: var(--bg-card, #25282e);
    border: 1px solid var(--accent-primary);
    padding: 2px 4px;
    border-radius: 4px;
    outline: none;
    width: 100%;
    font-family: inherit;
  }
  .status-badge {
    color: var(--text-muted);
  }
  .status-badge.saving {
    color: var(--semantic-warning, #f59e0b);
  }
</style>
