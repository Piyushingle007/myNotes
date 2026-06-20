<script lang="ts">
  import { onMount } from 'svelte';
  import { appState, parseHtmlMetadata } from '../stores/appState.svelte';
  import Modal from './Modal.svelte';
  import { Search, FileText, Folder, Tag, Sparkles } from 'lucide-svelte';

  let localQuery = $state('');
  let selectedIndex = $state(0);
  let selectedTagFilter = $state<string | null>(null);
  let selectedNotebookFilter = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  // Reset states when palette is shown
  $effect(() => {
    if (appState.showCommandPalette) {
      localQuery = '';
      selectedIndex = 0;
      selectedTagFilter = null;
      selectedNotebookFilter = null;
      setTimeout(() => {
        inputEl?.focus();
      }, 100);
    }
  });

  // Derived filtered search results
  const results = $derived.by(() => {
    const q = localQuery.trim().toLowerCase();
    
    // Split search terms
    const terms = q.split(/\s+/).filter(Boolean);

    // If query, tags, and notebooks are empty, show recents
    if (terms.length === 0 && !selectedTagFilter && !selectedNotebookFilter) {
      return appState.recentNotes.slice(0, 10);
    }

    return appState.notes.filter(note => {
      // Filter by tag if selected
      if (selectedTagFilter) {
        const parsed = parseHtmlMetadata(note.content);
        const tags = (parsed.meta.tags || []).map((t: string) => t.toLowerCase());
        if (!tags.includes(selectedTagFilter.toLowerCase())) return false;
      }

      // Filter by notebook if selected
      if (selectedNotebookFilter) {
        const prefix = selectedNotebookFilter.endsWith('/') ? selectedNotebookFilter : selectedNotebookFilter + '/';
        if (!note.path.startsWith(prefix) && note.path !== selectedNotebookFilter) return false;
      }

      if (terms.length === 0) return true;

      // Match name or content
      const nameLower = note.name.toLowerCase();
      const contentLower = note.content.toLowerCase();
      
      return terms.every(term => nameLower.includes(term) || contentLower.includes(term));
    }).slice(0, 12);
  });

  // Reset selected index when results change
  $effect(() => {
    if (results) {
      selectedIndex = 0;
    }
  });

  // Scroll active item into view
  $effect(() => {
    if (listEl && selectedIndex >= 0) {
      const activeChild = listEl.children[selectedIndex] as HTMLElement;
      if (activeChild) {
        activeChild.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  function selectNote(path: string) {
    appState.selectNote(path);
    appState.showCommandPalette = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeNote = results[selectedIndex];
      if (activeNote) {
        selectNote(activeNote.path);
      }
    }
  }

  // Text highlighting helper
  function highlightText(text: string, query: string): string {
    if (!query) return text;
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return text;

    let highlighted = text;
    terms.forEach(term => {
      const escaped = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark class="search-highlight">$1</mark>');
    });
    return highlighted;
  }

  // Content snippet extraction helper
  function getSnippet(content: string, query: string): string {
    const parsed = parseHtmlMetadata(content);
    // Strip HTML tags
    const text = parsed.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!query) return text.slice(0, 80) + (text.length > 80 ? '...' : '');

    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return text.slice(0, 80) + (text.length > 80 ? '...' : '');

    let firstIndex = -1;
    for (const term of terms) {
      const idx = text.toLowerCase().indexOf(term.toLowerCase());
      if (idx !== -1) {
        firstIndex = idx;
        break;
      }
    }

    if (firstIndex === -1) {
      return text.slice(0, 80) + (text.length > 80 ? '...' : '');
    }

    const start = Math.max(0, firstIndex - 20);
    const end = Math.min(text.length, firstIndex + 60);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    return snippet;
  }
</script>

<Modal
  show={appState.showCommandPalette}
  onClose={() => appState.showCommandPalette = false}
  title="Command Search"
  bodyStyle="padding: 0; max-height: 70vh;"
  style="max-width: 600px; border-radius: var(--radius-comfortable);"
>
  {#snippet titleIcon()}
    <Sparkles size={18} style="color: var(--accent);" />
  {/snippet}

  <div class="palette-container flex-col">
    <!-- Search Input Area -->
    <div class="palette-search-wrapper flex-row">
      <Search size={16} class="palette-search-icon" />
      <input
        bind:this={inputEl}
        type="text"
        placeholder="Type to search note titles & content..."
        bind:value={localQuery}
        onkeydown={handleKeydown}
        class="palette-search-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls="command-palette-results"
        aria-activedescendant={results.length > 0 ? `cmd-option-${selectedIndex}` : undefined}
      />
      {#if localQuery || selectedTagFilter || selectedNotebookFilter}
        <button 
          onclick={() => {
            localQuery = '';
            selectedTagFilter = null;
            selectedNotebookFilter = null;
            inputEl?.focus();
          }} 
          class="palette-clear-btn"
        >
          Clear
        </button>
      {/if}
    </div>

    <!-- Scoped Filters Chips Bar -->
    {#if appState.tags.length > 0 || appState.notebooks.length > 0}
      <div class="palette-filters-bar flex-row">
        <span class="filters-label">Scope:</span>
        <div class="filters-scroll flex-row">
          <!-- Notebook filters -->
          {#each appState.notebooks as notebook}
            <button 
              class="filter-chip flex-row" 
              class:active={selectedNotebookFilter === notebook}
              onclick={() => {
                selectedNotebookFilter = selectedNotebookFilter === notebook ? null : notebook;
                inputEl?.focus();
              }}
            >
              <Folder size={11} />
              <span>{notebook}</span>
            </button>
          {/each}

          <!-- Tag filters -->
          {#each appState.tags as tag}
            <button 
              class="filter-chip flex-row" 
              class:active={selectedTagFilter === tag.name}
              onclick={() => {
                selectedTagFilter = selectedTagFilter === tag.name ? null : tag.name;
                inputEl?.focus();
              }}
            >
              <Tag size={11} />
              <span>#{tag.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Search Results Feed -->
    <div 
      bind:this={listEl} 
      id="command-palette-results" 
      class="palette-results-list flex-col"
      role="listbox"
      aria-label="Command search results"
    >
      {#each results as note, idx}
        <div
          id="cmd-option-{idx}"
          class="palette-result-row flex-row"
          class:active={idx === selectedIndex}
          role="option"
          aria-selected={idx === selectedIndex}
          tabindex="0"
          onclick={() => selectNote(note.path)}
          onkeydown={(e) => e.key === 'Enter' && selectNote(note.path)}
        >
          <div class="result-icon flex-row select-none">
            <FileText size={16} />
          </div>

          <div class="result-details flex-col">
            <div class="result-header-line flex-row">
              <span class="result-title">
                {@html highlightText(note.name, localQuery)}
              </span>
              {#if note.path.includes('/')}
                <span class="result-notebook-badge">{note.path.split('/')[0]}</span>
              {/if}
            </div>
            <span class="result-snippet">
              {@html highlightText(getSnippet(note.content, localQuery), localQuery)}
            </span>
          </div>
        </div>
      {:else}
        <div class="palette-empty flex-col select-none">
          <span>No matching notes found</span>
          <span style="font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: var(--spacing-2xs);">Try modifying your search or scope filters</span>
        </div>
      {/each}
    </div>

    <!-- Keyboard Navigation Hints Footer -->
    <div class="palette-footer flex-row select-none">
      <div class="hint-item flex-row">
        <kbd>↑↓</kbd> <span>Navigate</span>
      </div>
      <div class="hint-item flex-row">
        <kbd>Enter</kbd> <span>Select</span>
      </div>
      <div class="hint-item flex-row">
        <kbd>Esc</kbd> <span>Close</span>
      </div>
    </div>
  </div>
</Modal>

<style>
  .palette-container {
    width: 100%;
    background-color: var(--bg-surface);
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .palette-search-wrapper {
    padding: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    align-items: center;
    gap: var(--spacing-sm);
    box-sizing: border-box;
    width: 100%;
  }

  .palette-search-icon {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .palette-search-input {
    flex-grow: 1;
    border: none;
    background: none;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: inherit;
    outline: none;
    width: 100%;
  }

  .palette-clear-btn {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: var(--spacing-2xs) var(--spacing-xs);
    border-radius: var(--radius-subtle);
    font-size: var(--font-size-xs);
    cursor: pointer;
    font-weight: var(--font-weight-medium);
  }

  .palette-clear-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
  }

  /* Scoped Filters */
  .palette-filters-bar {
    padding: var(--spacing-xs) var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    gap: var(--spacing-xs);
    align-items: center;
    background-color: color-mix(in srgb, var(--bg-base) 40%, transparent);
    box-sizing: border-box;
    width: 100%;
  }

  .filters-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .filters-scroll {
    overflow-x: auto;
    gap: var(--spacing-2xs);
    width: 100%;
    padding-bottom: var(--spacing-3xs);
    scrollbar-width: none; /* Firefox */
  }

  .filters-scroll::-webkit-scrollbar {
    display: none; /* Safari/Chrome */
  }

  .filter-chip {
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: var(--radius-pill);
    background-color: var(--bg-base);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    cursor: pointer;
    gap: var(--spacing-2xs);
    align-items: center;
    flex-shrink: 0;
    transition: all var(--motion-duration-fast) ease;
  }

  .filter-chip:hover {
    border-color: var(--border-highlight);
    color: var(--text-primary);
  }

  .filter-chip.active {
    background-color: color-mix(in srgb, var(--accent) 15%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Results List */
  .palette-results-list {
    overflow-y: auto;
    max-height: 45vh;
    padding: var(--spacing-xs) 0;
    box-sizing: border-box;
  }

  .palette-result-row {
    padding: var(--spacing-sm) var(--spacing-md);
    cursor: pointer;
    align-items: flex-start;
    gap: var(--spacing-sm);
    box-sizing: border-box;
    width: 100%;
    transition: background-color var(--motion-duration-fast) ease;
  }

  .palette-result-row.active {
    background-color: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .result-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-subtle);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-secondary);
    align-items: center;
    justify-content: center;
    margin-top: var(--spacing-3xs);
    flex-shrink: 0;
  }

  .palette-result-row.active .result-icon {
    background-color: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .result-details {
    flex-grow: 1;
    min-width: 0;
    gap: var(--spacing-2xs);
  }

  .result-header-line {
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .result-title {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-notebook-badge {
    font-size: var(--font-size-xs);
    padding: var(--spacing-3xs) var(--spacing-xs);
    background-color: color-mix(in srgb, var(--text-secondary) 10%, transparent);
    color: var(--text-secondary);
    border-radius: var(--radius-subtle);
  }

  .result-snippet {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: var(--line-height-tight);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    white-space: normal;
  }

  .palette-result-row.active .result-snippet {
    color: var(--text-primary);
  }

  .palette-empty {
    padding: var(--spacing-xl) 0;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  /* Keyboard Hints Footer */
  .palette-footer {
    padding: var(--spacing-xs) var(--spacing-md);
    background-color: color-mix(in srgb, var(--bg-base) 60%, transparent);
    border-top: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    justify-content: flex-end;
    gap: var(--spacing-md);
    box-sizing: border-box;
    width: 100%;
  }

  .hint-item {
    gap: var(--spacing-2xs);
    align-items: center;
  }

  .hint-item kbd {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    font-size: var(--font-size-xs);
  }

  :global(.search-highlight) {
    background-color: color-mix(in srgb, var(--accent) 35%, transparent);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
    font-weight: 700;
  }
</style>
