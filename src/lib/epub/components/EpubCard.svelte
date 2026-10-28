<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../../stores/appState.svelte';
  import { epubManager } from '../services/EpubManager';
  import type { EpubBook, ReadingProgress } from '../types';
  import { BookOpen, CheckCircle2, Clock, MoreVertical, Trash2, RotateCcw } from 'lucide-svelte';

  interface Props {
    book: EpubBook;
    progress?: ReadingProgress | null;
    layout?: 'grid' | 'list';
    onBookUpdated?: () => void;
  }

  let { book, progress = null, layout = 'grid', onBookUpdated }: Props = $props();

  let coverUrl = $state<string | null>(null);
  let showMenu = $state<boolean>(false);
  let showDeleteConfirm = $state<boolean>(false);
  let deleteProgressRecord = $state<boolean>(false);

  let percent = $derived(
    progress ? Math.round((progress.percentage || 0) * 100) : 0
  );

  let isFinished = $derived(
    !!(progress?.finishedAt || percent >= 98)
  );

  let authorsText = $derived(
    book.authors && book.authors.length > 0 ? book.authors.join(', ') : 'Unknown Author'
  );

  let estMinutesLeft = $derived.by(() => {
    if (!progress || isFinished) return 0;
    const activeSec = progress.totalActiveSeconds || 0;
    const frac = Math.max(0.01, progress.percentage);
    if (activeSec > 30 && frac > 0.02) {
      const remainingSec = Math.max(0, (1 - frac) * (activeSec / frac));
      return Math.max(1, Math.round(remainingSec / 60));
    }
    const remainingSections = Math.max(1, Math.round((book.spineLength || 20) * (1 - frac)));
    return Math.round(remainingSections * 3);
  });

  async function loadCover() {
    coverUrl = (await epubManager.getCoverUrl(book)) || null;
  }

  function handleOpen() {
    appState.openEpubReader(book.bookId);
  }

  async function handleToggleFinished(e: MouseEvent) {
    e.stopPropagation();
    showMenu = false;
    const progStore = epubManager.getProgressStore();
    const current = await progStore.getProgress(book.bookId) || {
      bookId: book.bookId,
      cfi: null,
      percentage: 0,
      chapterHref: '',
      chapterTitle: '',
      lastReadAt: Date.now(),
      firstOpenedAt: Date.now(),
      finishedAt: null,
      totalActiveSeconds: 0,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: Date.now(),
      recentPagesPerMinute: 1.0,
      avgWordsPerPage: 250,
    };

    if (isFinished) {
      // Mark as unread / reset
      current.finishedAt = null;
      current.percentage = 0;
      current.cfi = null;
      current.updatedAt = Date.now();
    } else {
      // Mark as finished
      current.finishedAt = Date.now();
      current.percentage = 1.0;
      current.updatedAt = Date.now();
    }

    await progStore.saveProgress(current);
    onBookUpdated?.();
  }

  async function handleDeleteConfirm(e: MouseEvent) {
    e.stopPropagation();
    try {
      await epubManager.deleteBook(book.bookId, deleteProgressRecord);
      showDeleteConfirm = false;
      showMenu = false;
      onBookUpdated?.();
    } catch (err) {
      console.error('[EpubCard] Failed to delete book:', err);
    }
  }

  onMount(() => {
    loadCover();
  });
</script>

{#if layout === 'grid'}
  <div 
    class="epub-card-grid" 
    onclick={handleOpen}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && handleOpen()}
  >
    <div class="card-cover-wrapper">
      {#if coverUrl}
        <img src={coverUrl} alt={book.title} class="card-cover-img" loading="lazy" />
      {:else}
        <div class="card-cover-placeholder">
          <BookOpen size={32} class="placeholder-icon" />
          <span class="placeholder-title">{book.title}</span>
        </div>
      {/if}

      {#if isFinished}
        <div class="badge-finished">
          <CheckCircle2 size={13} />
          <span>Finished</span>
        </div>
      {:else if percent > 0}
        <div class="badge-percent">{percent}%</div>
      {/if}

      <button 
        class="menu-trigger-btn" 
        onclick={(e) => { e.stopPropagation(); showMenu = !showMenu; }}
        aria-label="Book actions"
      >
        <MoreVertical size={16} />
      </button>

      {#if showMenu}
        <div class="card-menu-dropdown" onclick={(e) => e.stopPropagation()} role="menu">
          <button class="menu-item" onclick={handleToggleFinished}>
            {#if isFinished}
              <RotateCcw size={14} />
              <span>Mark as Unread</span>
            {:else}
              <CheckCircle2 size={14} />
              <span>Mark as Finished</span>
            {/if}
          </button>
          <button 
            class="menu-item danger" 
            onclick={(e) => { e.stopPropagation(); showDeleteConfirm = true; showMenu = false; }}
          >
            <Trash2 size={14} />
            <span>Delete Book...</span>
          </button>
        </div>
      {/if}
    </div>

    <!-- Progress bar under cover -->
    {#if percent > 0 && !isFinished}
      <div class="card-progress-track">
        <div class="card-progress-fill" style="width: {percent}%;"></div>
      </div>
    {/if}

    <div class="card-info">
      <div class="card-title" title={book.title}>{book.title}</div>
      <div class="card-author" title={authorsText}>{authorsText}</div>
      {#if !isFinished && percent > 0 && estMinutesLeft > 0}
        <div class="card-eta">
          <Clock size={11} />
          <span>~{estMinutesLeft}m left</span>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <!-- Compact List Layout -->
  <div 
    class="epub-card-list" 
    onclick={handleOpen}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && handleOpen()}
  >
    <div class="list-cover">
      {#if coverUrl}
        <img src={coverUrl} alt={book.title} class="list-cover-img" loading="lazy" />
      {:else}
        <div class="list-cover-placeholder">
          <BookOpen size={16} />
        </div>
      {/if}
    </div>

    <div class="list-info">
      <div class="list-title" title={book.title}>{book.title}</div>
      <div class="list-author" title={authorsText}>{authorsText}</div>
    </div>

    <div class="list-progress-section">
      {#if isFinished}
        <span class="badge-finished-list">
          <CheckCircle2 size={13} />
          <span>Finished</span>
        </span>
      {:else if percent > 0}
        <div class="list-progress-row">
          <div class="card-progress-track list-track">
            <div class="card-progress-fill" style="width: {percent}%;"></div>
          </div>
          <span class="list-percent">{percent}%</span>
        </div>
        {#if estMinutesLeft > 0}
          <div class="card-eta list-eta">~{estMinutesLeft}m left</div>
        {/if}
      {:else}
        <span class="list-unread">Unread</span>
      {/if}
    </div>

    <div class="list-actions" onclick={(e) => e.stopPropagation()} role="presentation">
      <button 
        class="icon-btn" 
        onclick={() => showMenu = !showMenu}
        aria-label="Book actions"
      >
        <MoreVertical size={16} />
      </button>

      {#if showMenu}
        <div class="card-menu-dropdown list-dropdown" role="menu">
          <button class="menu-item" onclick={handleToggleFinished}>
            {#if isFinished}
              <RotateCcw size={14} />
              <span>Mark as Unread</span>
            {:else}
              <CheckCircle2 size={14} />
              <span>Mark as Finished</span>
            {/if}
          </button>
          <button 
            class="menu-item danger" 
            onclick={() => { showDeleteConfirm = true; showMenu = false; }}
          >
            <Trash2 size={14} />
            <span>Delete Book...</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Delete Confirmation Dialog -->
{#if showDeleteConfirm}
  <div class="modal-backdrop" onclick={(e) => { e.stopPropagation(); showDeleteConfirm = false; }} role="presentation">
    <div class="delete-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm Deletion">
      <div class="dialog-title">Remove Book</div>
      <div class="dialog-body">
        Are you sure you want to remove <strong>{book.title}</strong> from your library?
        <label class="delete-progress-toggle">
          <input type="checkbox" bind:checked={deleteProgressRecord} />
          <span>Also delete my reading progress for this book</span>
        </label>
      </div>
      <div class="dialog-footer">
        <button class="btn-cancel" onclick={() => showDeleteConfirm = false}>Cancel</button>
        <button class="btn-danger" onclick={handleDeleteConfirm}>Remove</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .epub-card-grid {
    display: flex;
    flex-direction: column;
    cursor: pointer;
    border-radius: 10px;
    padding: 8px;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    user-select: none;
    position: relative;
  }

  .epub-card-grid:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
  }

  .card-cover-wrapper {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 3;
    border-radius: 6px;
    overflow: hidden;
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .card-cover-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    text-align: center;
    background: linear-gradient(135deg, var(--hover-bg, #f3f4f6), var(--border-color, #e5e7eb));
    color: var(--text-secondary, #6b7280);
    gap: 8px;
  }

  .placeholder-title {
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .badge-finished {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(34, 197, 94, 0.92);
    color: #ffffff;
    padding: 3px 7px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(2px);
  }

  .badge-percent {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(0, 0, 0, 0.75);
    color: #ffffff;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 600;
    backdrop-filter: blur(2px);
  }

  .menu-trigger-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.55);
    color: #ffffff;
    border: none;
    border-radius: 50%;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, background 0.15s ease;
  }

  .epub-card-grid:hover .menu-trigger-btn {
    opacity: 1;
  }

  .menu-trigger-btn:hover {
    background: rgba(0, 0, 0, 0.85);
  }

  .card-menu-dropdown {
    position: absolute;
    top: 36px;
    right: 6px;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    padding: 4px;
    z-index: 20;
    min-width: 160px;
    animation: fadeIn 0.15s ease-out;
  }

  .menu-item {
    background: none;
    border: none;
    padding: 8px 12px;
    font-size: 0.82rem;
    color: var(--text-primary, #374151);
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }

  .menu-item:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
  }

  .menu-item.danger {
    color: #ef4444;
  }

  .menu-item.danger:hover {
    background: rgba(239, 68, 68, 0.08);
  }

  .card-progress-track {
    width: 100%;
    height: 3px;
    background: var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 2px;
    margin-top: 6px;
    overflow: hidden;
  }

  .card-progress-fill {
    height: 100%;
    background: var(--accent, #3b82f6);
  }

  .card-info {
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .card-title {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text-primary, #111827);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-author {
    font-size: 0.78rem;
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-eta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.74rem;
    color: var(--accent, #3b82f6);
    font-weight: 500;
    margin-top: 2px;
  }

  /* List layout */
  .epub-card-list {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
    border-radius: 8px;
    gap: 12px;
    cursor: pointer;
    transition: background-color 0.1s ease;
    position: relative;
  }

  .epub-card-list:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.03));
  }

  .list-cover {
    width: 38px;
    height: 52px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--hover-bg, #f3f4f6);
  }

  .list-cover-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .list-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #9ca3af);
  }

  .list-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .list-title {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .list-author {
    font-size: 0.78rem;
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .list-progress-section {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    min-width: 90px;
  }

  .list-progress-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .list-track {
    width: 60px;
    margin: 0;
  }

  .list-percent {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--accent, #3b82f6);
  }

  .list-eta {
    font-size: 0.72rem;
  }

  .badge-finished-list {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #22c55e;
    font-size: 0.76rem;
    font-weight: 600;
  }

  .list-unread {
    font-size: 0.76rem;
    color: var(--text-secondary, #9ca3af);
  }

  .list-actions {
    position: relative;
  }

  .list-dropdown {
    top: 30px;
    right: 0;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #6b7280);
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-primary, #111827);
  }

  /* Delete Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    z-index: 10002;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  .delete-dialog {
    background: var(--bg-surface, var(--bg-base, #ffffff));
    color: var(--text-primary, #111827);
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 12px;
    width: 100%;
    max-width: 400px;
    padding: 18px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog-title {
    font-size: 1.05rem;
    font-weight: 600;
  }

  .dialog-body {
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text-secondary, #4b5563);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .delete-progress-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-cancel {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    color: var(--text-primary, #374151);
  }

  .btn-danger {
    background: #ef4444;
    color: #ffffff;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
