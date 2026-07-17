<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Writable } from 'svelte/store';
  import { Maximize2, Trash2, Minimize2 } from 'lucide-svelte';
  import TldrawWrapper from './TldrawWrapper.svelte';

  interface Props {
    nodeStore: Writable<any>;
    getPos: () => number | null | undefined;
    editor: any;
    updateAttributes: (attrs: any) => void;
  }
  let { nodeStore, getPos, editor, updateAttributes }: Props = $props();

  let snapshot = $state($nodeStore.attrs.snapshot || null);
  let isFullscreen = $state(false);
  let excalidrawApi: any = $state(null);
  let container: HTMLDivElement;

  // Build initialData from stored snapshot (Excalidraw format)
  let initialData = $derived(snapshot ? {
    elements: snapshot.elements || [],
    appState: snapshot.appState || {},
    files: snapshot.files || {}
  } : undefined);

  function onChange(elements: any[], appState: any, files: any) {
    const newSnapshot = { elements, appState: { ...appState, collaborators: undefined }, files };
    snapshot = newSnapshot;
    updateAttributes({ snapshot: newSnapshot });
  }

  function deleteBlock() {
    const pos = getPos();
    if (typeof pos === 'number') {
      editor.chain().focus().deleteRange({ from: pos, to: pos + $nodeStore.node.nodeSize }).run();
    }
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    
    tick().then(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  bind:this={container}
  class="tldraw-block-container" 
  class:fullscreen={isFullscreen}
  contenteditable="false"
>
  <div class="block-header flex-row">
    <span class="block-title">Sketch / Draw</span>
    <div class="actions flex-row">
      <button class="action-btn" onclick={toggleFullscreen} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
        {#if isFullscreen}
          <Minimize2 size={14} />
        {:else}
          <Maximize2 size={14} />
        {/if}
      </button>
      <button class="action-btn delete-btn" onclick={deleteBlock} title="Delete">
        <Trash2 size={14} />
      </button>
    </div>
  </div>
  
  <div class="canvas-wrapper">
    <div 
      class="canvas-inner" 
      onpointerdown={(e) => e.stopPropagation()}
      onmousedown={(e) => e.stopPropagation()}
    >
      <TldrawWrapper 
        {initialData}
        {onChange}
        onMountCb={(api) => { excalidrawApi = api; }}
      />
    </div>
  </div>
</div>

<style>
  .tldraw-block-container {
    margin: 1.5rem 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-surface);
    overflow: hidden;
    position: relative;
    user-select: none;
    transition: all 0.2s ease;
  }
  
  .tldraw-block-container.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    z-index: 9999;
    margin: 0;
    border: none;
    border-radius: 0;
    display: flex;
    flex-direction: column;
  }

  .block-header {
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-surface-elevated, #1e2227);
    border-bottom: 1px solid var(--border-color);
  }

  .block-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .actions {
    gap: 4px;
  }

  .action-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-normal);
  }
  
  .delete-btn:hover {
    background: rgba(255, 50, 50, 0.2);
    color: #ff5555;
  }

  .canvas-wrapper {
    height: 400px; /* Default inline height */
    width: 100%;
    position: relative;
  }
  
  .fullscreen .canvas-wrapper {
    flex: 1;
    height: auto;
  }
  
  .canvas-inner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }
  
  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
</style>
