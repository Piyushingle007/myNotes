<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';
  import { Search, X, Loader2 } from 'lucide-svelte';

  let inputQuery = $state<string>(epubReader.searchQuery);

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (inputQuery.trim()) {
      epubReader.performSearch(inputQuery.trim());
    }
  }

  function handleResultClick(cfi: string) {
    epubReader.pushJumpHistory();
    epubReader.goTo(cfi);
    epubReader.isSearchOpen = false;
  }
</script>

<div class="search-backdrop" onclick={() => epubReader.isSearchOpen = false} role="presentation">
  <div class="search-drawer" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Book Search">
    <div class="search-header">
      <form class="search-form" onsubmit={handleSubmit}>
        <Search size={16} class="search-icon" />
        <input 
          type="text" 
          placeholder="Search in book..." 
          bind:value={inputQuery}
          class="search-input"
          autofocus
        />
        {#if inputQuery}
          <button 
            type="button" 
            class="clear-btn" 
            onclick={() => { inputQuery = ''; epubReader.cancelSearch(); }}
            aria-label="Clear query"
          >
            <X size={14} />
          </button>
        {/if}
      </form>
      <button 
        class="icon-btn" 
        onclick={() => epubReader.isSearchOpen = false} 
        aria-label="Close search"
      >
        <X size={18} />
      </button>
    </div>

    {#if epubReader.isSearching}
      <div class="search-progress-bar">
        <div class="progress-fill" style="width: {Math.round(epubReader.searchProgress * 100)}%;"></div>
      </div>
    {/if}

    <div class="search-body">
      {#if epubReader.isSearching && epubReader.searchResults.length === 0}
        <div class="search-status">
          <Loader2 size={18} class="spin" />
          <span>Searching book...</span>
        </div>
      {:else if !epubReader.isSearching && inputQuery && epubReader.searchResults.length === 0}
        <div class="search-status">
          <span>No matches found for "{inputQuery}"</span>
        </div>
      {:else}
        <div class="results-list">
          {#each epubReader.searchResults as group (group.label)}
            <div class="result-group">
              <div class="group-header">{group.label}</div>
              {#each group.subitems as item (item.cfi)}
                <div 
                  class="result-item" 
                  onclick={() => handleResultClick(item.cfi)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && handleResultClick(item.cfi)}
                >
                  <span class="excerpt">{item.excerpt}</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .search-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    z-index: 9999;
    display: flex;
    justify-content: flex-end;
    animation: fadeIn 0.15s ease-out;
  }

  .search-drawer {
    width: 360px;
    max-width: 90vw;
    height: 100%;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    color: var(--text-primary, #111827);
    border-left: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
    animation: slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .search-header {
    height: 56px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  }

  .search-form {
    flex: 1;
    display: flex;
    align-items: center;
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 8px;
    padding: 0 10px;
    height: 38px;
    gap: 8px;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 0.88rem;
    color: var(--text-primary, #111827);
  }

  .clear-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    padding: 2px;
    display: flex;
    align-items: center;
  }

  .search-progress-bar {
    height: 2px;
    width: 100%;
    background: var(--border-color, rgba(0, 0, 0, 0.08));
  }

  .progress-fill {
    height: 100%;
    background: var(--accent, #3b82f6);
    transition: width 0.15s ease;
  }

  .search-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .search-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-secondary, #6b7280);
    font-size: 0.88rem;
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .result-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .group-header {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary, #6b7280);
    padding: 4px 6px;
  }

  .result-item {
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    background: var(--hover-bg, rgba(0, 0, 0, 0.02));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.05));
    transition: background 0.1s ease;
  }

  .result-item:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  }

  .excerpt {
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--text-primary, #374151);
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

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes slideInRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
