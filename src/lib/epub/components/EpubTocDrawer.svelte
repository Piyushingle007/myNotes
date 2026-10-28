<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';
  import type { TocItem } from '../types';
  import { X, ChevronRight, ChevronDown, BookOpen } from 'lucide-svelte';

  let expanded = $state<Record<string, boolean>>({});

  function toggleExpand(id: string, e: MouseEvent) {
    e.stopPropagation();
    expanded[id] = !expanded[id];
  }

  function handleSelect(item: TocItem) {
    epubReader.pushJumpHistory();
    if (item.href) {
      epubReader.goTo(item.href);
    }
    epubReader.isTocOpen = false;
  }
</script>

{#snippet tocNode(item: TocItem, depth: number)}
  {@const hasChildren = item.children && item.children.length > 0}
  {@const isExpanded = expanded[item.id] !== false}
  {@const isCurrent = epubReader.chapterTitle === item.label}

  <div class="toc-item-wrapper" style="--depth: {depth};">
    <div 
      class="toc-row {isCurrent ? 'active' : ''}"
      onclick={() => handleSelect(item)}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && handleSelect(item)}
    >
      {#if hasChildren}
        <button 
          class="expand-btn" 
          onclick={(e) => toggleExpand(item.id, e)}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {#if isExpanded}
            <ChevronDown size={15} />
          {:else}
            <ChevronRight size={15} />
          {/if}
        </button>
      {:else}
        <span class="expand-spacer"></span>
      {/if}
      <span class="toc-label" title={item.label}>{item.label}</span>
    </div>

    {#if hasChildren && isExpanded}
      <div class="toc-children">
        {#each item.children || [] as child (child.id)}
          {@render tocNode(child, depth + 1)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="toc-drawer-backdrop" onclick={() => epubReader.isTocOpen = false} role="presentation">
  <div class="toc-drawer" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Table of Contents">
    <div class="toc-header">
      <div class="toc-title flex-row items-center gap-2">
        <BookOpen size={18} />
        <span>Contents</span>
      </div>
      <button 
        class="icon-btn" 
        onclick={() => epubReader.isTocOpen = false} 
        aria-label="Close contents"
      >
        <X size={18} />
      </button>
    </div>

    <div class="toc-body">
      {#if epubReader.toc.length === 0}
        <div class="toc-empty">
          <p>No table of contents available.</p>
        </div>
      {:else}
        <div class="toc-list">
          {#each epubReader.toc as item (item.id)}
            {@render tocNode(item, 0)}
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .toc-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    z-index: 9999;
    display: flex;
    justify-content: flex-start;
    animation: fadeIn 0.15s ease-out;
  }

  .toc-drawer {
    width: 340px;
    max-width: 85vw;
    height: 100%;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    color: var(--text-primary, #111827);
    border-right: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    display: flex;
    flex-direction: column;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .toc-header {
    height: 52px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    font-weight: 600;
    font-size: 0.95rem;
  }

  .toc-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .toc-list {
    display: flex;
    flex-direction: column;
  }

  .toc-item-wrapper {
    display: flex;
    flex-direction: column;
  }

  .toc-row {
    display: flex;
    align-items: center;
    padding: 9px 12px;
    padding-left: calc(12px + var(--depth) * 16px);
    cursor: pointer;
    font-size: 0.88rem;
    color: var(--text-secondary, #4b5563);
    border-radius: 6px;
    margin: 1px 6px;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  .toc-row:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
    color: var(--text-primary, #111827);
  }

  .toc-row.active {
    background: var(--active-bg, rgba(59, 130, 246, 0.12));
    color: var(--accent, #3b82f6);
    font-weight: 600;
  }

  .expand-btn {
    background: none;
    border: none;
    padding: 2px 4px;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .expand-spacer {
    width: 23px;
    flex-shrink: 0;
  }

  .toc-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toc-empty {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-secondary, #6b7280);
    font-size: 0.88rem;
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-primary, #111827);
  }

  @keyframes slideIn {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
