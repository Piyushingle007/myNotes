<script lang="ts">
  import { fade } from 'svelte/transition';
  import { Search, X, FileText, Folder, Clock, CornerDownLeft } from 'lucide-svelte';
  import { appState, parseHtmlMetadata } from '../stores/appState.svelte';
  import { mobileNav } from '../stores/mobileNav.svelte';

  interface Props {
    show: boolean;
    onClose: () => void;
  }

  let { show, onClose }: Props = $props();

  const RECENTS_KEY = 'mynotes_recent_searches';
  const MAX_RECENTS = 6;
  const MAX_RESULTS = 40;

  let query = $state('');
  let scope = $state<string | null>(null); // null = All Notes, else notebook prefix
  let inputEl = $state<HTMLInputElement | null>(null);
  let recents = $state<string[]>(loadRecents());

  function loadRecents(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function rememberQuery(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    recents = [trimmed, ...recents.filter((r) => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  }

  function clearRecents() {
    recents = [];
    localStorage.removeItem(RECENTS_KEY);
  }

  // Register with the navigation model and focus the input when opened.
  $effect(() => {
    if (!show) return;
    query = '';
    scope = null;
    const unregister = mobileNav.registerOverlay(onClose);
    const t = setTimeout(() => inputEl?.focus(), 60);
    return () => {
      clearTimeout(t);
      unregister();
    };
  });

  // Top-level notebooks for scope chips.
  let scopeChips = $derived(['__all__', ...appState.notebooks]);

  function stripHtml(html: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  interface Result {
    path: string;
    name: string;
    notebook: string;
    before: string;
    match: string;
    after: string;
  }

  function buildSnippet(text: string, q: string): { before: string; match: string; after: string } {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return { before: text.slice(0, 90), match: '', after: '' };
    const start = Math.max(0, idx - 30);
    const before = (start > 0 ? '…' : '') + text.slice(start, idx);
    const match = text.slice(idx, idx + q.length);
    const after = text.slice(idx + q.length, idx + q.length + 60);
    return { before, match, after };
  }

  let results = $derived.by<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    let notes = appState.notes;
    if (scope) {
      const prefix = scope.endsWith('/') ? scope : scope + '/';
      notes = notes.filter((n) => n.path.startsWith(prefix));
    }
    const out: Result[] = [];
    for (const n of notes) {
      const nameMatch = n.name.toLowerCase().includes(q);
      const body = stripHtml(parseHtmlMetadata(n.content).content);
      const bodyMatch = body.toLowerCase().includes(q);
      if (!nameMatch && !bodyMatch) continue;
      const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : '';
      const snippet = bodyMatch ? buildSnippet(body, q) : { before: body.slice(0, 90), match: '', after: '' };
      out.push({ path: n.path, name: n.name, notebook: folder, ...snippet });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  });

  function openResult(path: string) {
    rememberQuery(query);
    onClose();
    appState.selectNote(path);
  }

  function useRecent(q: string) {
    query = q;
    inputEl?.focus();
  }

  function scopeLabel(chip: string): string {
    if (chip === '__all__') return 'All Notes';
    const parts = chip.split('/');
    return parts[parts.length - 1];
  }
</script>

{#if show}
  <div class="ms-overlay flex-col" transition:fade={{ duration: 160 }}>
    <!-- Search bar -->
    <div class="ms-header flex-row">
      <button class="ms-back" onclick={onClose} aria-label="Close search"><X size={22} /></button>
      <div class="ms-input-wrap flex-row">
        <Search size={18} style="color: var(--text-tertiary); flex-shrink: 0;" />
        <input
          bind:this={inputEl}
          bind:value={query}
          class="ms-input"
          type="search"
          inputmode="search"
          enterkeyhint="search"
          placeholder="Search all notes…"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          onkeydown={(e) => { if (e.key === 'Enter' && results.length > 0) openResult(results[0].path); }}
        />
        {#if query}
          <button class="ms-clear" onclick={() => { query = ''; inputEl?.focus(); }} aria-label="Clear"><X size={16} /></button>
        {/if}
      </div>
    </div>

    <!-- Scope chips -->
    <div class="ms-chips flex-row">
      {#each scopeChips as chip}
        <button
          class="ms-chip"
          class:active={chip === '__all__' ? scope === null : scope === chip}
          onclick={() => (scope = chip === '__all__' ? null : chip)}
        >
          {scopeLabel(chip)}
        </button>
      {/each}
    </div>

    <!-- Body -->
    <div class="ms-body flex-col">
      {#if !query.trim()}
        {#if recents.length > 0}
          <div class="ms-recents-head flex-row">
            <span class="ms-section-label">Recent searches</span>
            <button class="ms-clear-recents" onclick={clearRecents}>Clear</button>
          </div>
          {#each recents as r}
            <button class="ms-recent-row flex-row" onclick={() => useRecent(r)}>
              <Clock size={15} style="color: var(--text-tertiary); flex-shrink: 0;" />
              <span class="ms-recent-text">{r}</span>
              <CornerDownLeft size={14} style="color: var(--text-tertiary); flex-shrink: 0;" />
            </button>
          {/each}
        {:else}
          <div class="ms-empty flex-col">
            <Search size={32} style="color: var(--text-tertiary); opacity: 0.6;" />
            <span>Search across every note by title or content.</span>
          </div>
        {/if}
      {:else if results.length === 0}
        <div class="ms-empty flex-col">
          <Search size={32} style="color: var(--text-tertiary); opacity: 0.6;" />
          <span>No notes match “{query.trim()}”.</span>
        </div>
      {:else}
        <span class="ms-section-label" style="padding: 0 var(--spacing-md);">{results.length} result{results.length === 1 ? '' : 's'}</span>
        {#each results as r (r.path)}
          <button class="ms-result flex-col" onclick={() => openResult(r.path)}>
            <span class="ms-result-top flex-row">
              <FileText size={15} style="color: var(--accent); flex-shrink: 0;" />
              <span class="ms-result-title">{r.name}</span>
            </span>
            {#if r.match || r.before}
              <span class="ms-result-snippet">
                {r.before}<mark>{r.match}</mark>{r.after}
              </span>
            {/if}
            {#if r.notebook}
              <span class="ms-result-badge flex-row"><Folder size={11} /> {r.notebook}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .flex-row { display: flex; flex-direction: row; align-items: center; }
  .flex-col { display: flex; flex-direction: column; }

  .ms-overlay {
    position: fixed;
    inset: 0;
    z-index: 9997;
    background: var(--bg-base);
    padding-top: env(safe-area-inset-top, 0px);
  }

  .ms-header {
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .ms-back {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ms-input-wrap {
    flex: 1;
    gap: var(--spacing-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    padding: 0 var(--spacing-sm);
    height: 44px;
  }

  .ms-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 16px; /* prevents iOS zoom */
    min-width: 0;
  }

  .ms-clear {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex;
    padding: 4px;
  }

  .ms-chips {
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .ms-chips::-webkit-scrollbar { display: none; }

  .ms-chip {
    flex-shrink: 0;
    padding: var(--spacing-2xs) var(--spacing-sm);
    border-radius: var(--radius-pill);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    min-height: 32px;
  }

  .ms-chip.active {
    background: var(--accent);
    color: var(--bg-base);
    border-color: var(--accent);
  }

  .ms-body {
    flex: 1;
    overflow-y: auto;
    padding-bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom, 0px));
    gap: 2px;
  }

  .ms-section-label {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: var(--spacing-sm) var(--spacing-md) var(--spacing-2xs);
  }

  .ms-recents-head {
    justify-content: space-between;
    padding-right: var(--spacing-md);
  }
  .ms-clear-recents {
    background: none;
    border: none;
    color: var(--accent);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
  }

  .ms-recent-row {
    gap: var(--spacing-sm);
    width: 100%;
    min-height: 48px;
    padding: var(--spacing-xs) var(--spacing-md);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .ms-recent-row:active { background: var(--bg-surface); }
  .ms-recent-text { flex: 1; color: var(--text-primary); font-size: var(--font-size-sm); }

  .ms-result {
    width: 100%;
    align-items: flex-start;
    gap: var(--spacing-2xs);
    padding: var(--spacing-sm) var(--spacing-md);
    background: none;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
    cursor: pointer;
    text-align: left;
    min-height: 56px;
  }
  .ms-result:active { background: var(--bg-surface); }

  .ms-result-top { gap: var(--spacing-xs); width: 100%; }
  .ms-result-title {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ms-result-snippet {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ms-result-snippet mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--text-primary);
    border-radius: 2px;
    padding: 0 1px;
  }

  .ms-result-badge {
    gap: var(--spacing-3xs);
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: var(--radius-pill);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ms-empty {
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-xl) var(--spacing-lg);
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    text-align: center;
    margin-top: var(--spacing-xl);
  }
</style>


