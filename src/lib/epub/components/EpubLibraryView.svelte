<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../../stores/appState.svelte';
  import { epubManager } from '../services/EpubManager';
  import type { EpubBook, ReadingProgress } from '../types';
  import EpubCard from './EpubCard.svelte';
  import EpubImportButton from './EpubImportButton.svelte';
  import { 
    BookOpen, Search, LayoutGrid, List, ArrowUpDown, 
    Filter, Clock, CheckCircle2, Bookmark, UploadCloud, X
  } from 'lucide-svelte';

  let books = $state<EpubBook[]>([]);
  let progressMap = $state<Record<string, ReadingProgress>>({});
  let isLoading = $state<boolean>(true);

  // Filters & Sorting
  let searchQuery = $state<string>('');
  let activeFilter = $state<'all' | 'reading' | 'unread' | 'finished'>('all');
  let sortBy = $state<'recent' | 'title' | 'author' | 'added' | 'progress'>(
    (localStorage.getItem('mynotes_epub_sort_by') as any) || 'recent'
  );
  let layout = $state<'grid' | 'list'>(
    (localStorage.getItem('mynotes_epub_layout') as any) || 'grid'
  );

  let isDragOver = $state<boolean>(false);
  let importStatus = $state<string | null>(null);

  async function loadLibrary() {
    isLoading = true;
    try {
      const libStore = epubManager.getLibraryStore();
      let allBooks = await libStore.getAllBooks();

      // Auto-reconcile any .epub notes currently in vault/storage that aren't indexed yet
      const epubNotes = appState.notes.filter(n => n.path.toLowerCase().endsWith('.epub'));
      if (epubNotes.length > 0 && appState.storage.readBlob) {
        const existingPaths = new Set(allBooks.map(b => b.filePath));
        let reconciledCount = 0;
        for (const note of epubNotes) {
          if (!existingPaths.has(note.path)) {
            try {
              const blob = await appState.storage.readBlob(note.path);
              if (blob && blob.size > 0) {
                const name = note.path.split('/').pop() || 'book.epub';
                await epubManager.registerExistingEpub(note.path, blob, name);
                reconciledCount++;
              }
            } catch (rErr) {
              console.warn('[EpubLibraryView] Failed to reconcile epub note:', note.path, rErr);
            }
          }
        }
        if (reconciledCount > 0) {
          allBooks = await libStore.getAllBooks();
        }
      }

      books = allBooks;

      const progStore = epubManager.getProgressStore();
      const allProg = await progStore.getAllProgress();
      progressMap = allProg || {};
    } catch (e) {
      console.error('[EpubLibraryView] Failed to load library:', e);
    } finally {
      isLoading = false;
    }
  }

  function setLayout(newLayout: 'grid' | 'list') {
    layout = newLayout;
    localStorage.setItem('mynotes_epub_layout', newLayout);
  }

  function setSort(newSort: typeof sortBy) {
    sortBy = newSort;
    localStorage.setItem('mynotes_epub_sort_by', newSort);
  }

  // Continue reading shelf items
  let continueReadingBooks = $derived.by(() => {
    return books
      .filter((b) => {
        const prog = progressMap[b.bookId];
        const isFin = prog?.finishedAt || (prog?.percentage && prog.percentage >= 0.98);
        return prog && prog.percentage > 0 && !isFin;
      })
      .sort((a, b) => {
        const progA = progressMap[a.bookId]?.lastReadAt || 0;
        const progB = progressMap[b.bookId]?.lastReadAt || 0;
        return progB - progA;
      })
      .slice(0, 6);
  });

  // Filtered & sorted book collection
  let displayedBooks = $derived.by(() => {
    let result = [...books];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((b) => 
        b.title.toLowerCase().includes(q) ||
        b.authors.some((a) => a.toLowerCase().includes(q))
      );
    }

    // Filter status
    if (activeFilter === 'reading') {
      result = result.filter((b) => {
        const prog = progressMap[b.bookId];
        const isFin = prog?.finishedAt || (prog?.percentage && prog.percentage >= 0.98);
        return prog && prog.percentage > 0 && !isFin;
      });
    } else if (activeFilter === 'finished') {
      result = result.filter((b) => {
        const prog = progressMap[b.bookId];
        return prog?.finishedAt || (prog?.percentage && prog.percentage >= 0.98);
      });
    } else if (activeFilter === 'unread') {
      result = result.filter((b) => {
        const prog = progressMap[b.bookId];
        return !prog || (!prog.finishedAt && (!prog.percentage || prog.percentage === 0));
      });
    }

    // Sort order
    result.sort((a, b) => {
      if (sortBy === 'recent') {
        const timeA = progressMap[a.bookId]?.lastReadAt || a.addedAt || 0;
        const timeB = progressMap[b.bookId]?.lastReadAt || b.addedAt || 0;
        return timeB - timeA;
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'author') {
        const authA = a.authors[0] || '';
        const authB = b.authors[0] || '';
        return authA.localeCompare(authB, undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'added') {
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      if (sortBy === 'progress') {
        const progA = progressMap[a.bookId]?.percentage || 0;
        const progB = progressMap[b.bookId]?.percentage || 0;
        return progB - progA;
      }
      return 0;
    });

    return result;
  });

  // Drag and Drop handlers
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      isDragOver = true;
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const epubFiles = Array.from(files).filter((f) => 
      f.name.toLowerCase().endsWith('.epub')
    );

    if (epubFiles.length === 0) {
      importStatus = 'Please drop valid .epub book files.';
      setTimeout(() => { importStatus = null; }, 3500);
      return;
    }

    importStatus = `Importing ${epubFiles.length} book(s)...`;
    try {
      const items = epubFiles.map((f) => ({ file: f, name: f.name }));
      const results = await epubManager.importEpubFiles(items);
      const added = results.filter((r: any) => r.success).length;
      const dupes = results.filter((r: any) => r.duplicate).length;
      importStatus = `Added ${added} book(s)${dupes > 0 ? ` (${dupes} duplicate)` : ''}.`;
      await loadLibrary();
    } catch (err: any) {
      console.error('[EpubLibraryView] Drop import failed:', err);
      importStatus = err?.message || 'Failed to import dropped books.';
    } finally {
      setTimeout(() => { importStatus = null; }, 4000);
    }
  }

  onMount(() => {
    loadLibrary();
  });
</script>

<div 
  class="epub-library-root"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="region"
  aria-label="EPUB Book Library"
>
  <!-- Drag-and-drop visual dropzone indicator -->
  {#if isDragOver}
    <div class="drop-overlay">
      <UploadCloud size={48} class="drop-icon" />
      <span class="drop-text">Drop EPUB books to add to library</span>
    </div>
  {/if}

  <!-- Header toolbar -->
  <div class="library-header">
    <div class="header-left">
      <div class="header-title flex-row items-center gap-2">
        <BookOpen size={22} class="header-book-icon" />
        <h2>E-Books</h2>
        {#if books.length > 0}
          <span class="book-count-badge">{books.length}</span>
        {/if}
      </div>
    </div>

    <div class="header-right">
      <!-- Search input -->
      <div class="search-box">
        <Search size={15} class="search-icon" />
        <input 
          type="text" 
          placeholder="Search books or authors..." 
          bind:value={searchQuery}
          class="search-input"
        />
        {#if searchQuery}
          <button class="clear-search-btn" onclick={() => searchQuery = ''} aria-label="Clear search">
            <X size={13} />
          </button>
        {/if}
      </div>

      <!-- Add book button -->
      <EpubImportButton onImportComplete={loadLibrary} />
    </div>
  </div>

  <!-- Status alert / Toast -->
  {#if importStatus}
    <div class="import-status-banner">
      <span>{importStatus}</span>
    </div>
  {/if}

  <!-- Filter & Sort controls row -->
  <div class="controls-bar">
    <div class="filter-pills">
      <button 
        class="filter-pill {activeFilter === 'all' ? 'active' : ''}" 
        onclick={() => activeFilter = 'all'}
      >
        All
      </button>
      <button 
        class="filter-pill {activeFilter === 'reading' ? 'active' : ''}" 
        onclick={() => activeFilter = 'reading'}
      >
        Reading
      </button>
      <button 
        class="filter-pill {activeFilter === 'unread' ? 'active' : ''}" 
        onclick={() => activeFilter = 'unread'}
      >
        Unread
      </button>
      <button 
        class="filter-pill {activeFilter === 'finished' ? 'active' : ''}" 
        onclick={() => activeFilter = 'finished'}
      >
        Finished
      </button>
    </div>

    <div class="view-and-sort-controls">
      <!-- Sort dropdown -->
      <div class="sort-select-wrapper">
        <ArrowUpDown size={14} class="sort-icon" />
        <select 
          class="sort-select" 
          value={sortBy} 
          onchange={(e) => setSort((e.target as HTMLSelectElement).value as any)}
          aria-label="Sort books by"
        >
          <option value="recent">Recently Read</option>
          <option value="title">Title (A-Z)</option>
          <option value="author">Author (A-Z)</option>
          <option value="added">Date Added</option>
          <option value="progress">Reading Progress</option>
        </select>
      </div>

      <!-- Layout toggle -->
      <div class="layout-toggle-group">
        <button 
          class="layout-btn {layout === 'grid' ? 'active' : ''}" 
          onclick={() => setLayout('grid')}
          aria-label="Grid layout"
          title="Grid view"
        >
          <LayoutGrid size={16} />
        </button>
        <button 
          class="layout-btn {layout === 'list' ? 'active' : ''}" 
          onclick={() => setLayout('list')}
          aria-label="List layout"
          title="List view"
        >
          <List size={16} />
        </button>
      </div>
    </div>
  </div>

  <div class="library-scroll-body">
    <!-- "Continue Reading" shelf -->
    {#if !searchQuery && activeFilter === 'all' && continueReadingBooks.length > 0}
      <div class="shelf-section">
        <div class="shelf-header">
          <Clock size={16} class="shelf-icon" />
          <h3 class="shelf-title">Continue Reading</h3>
        </div>
        <div class="shelf-grid">
          {#each continueReadingBooks as book (book.bookId)}
            <div class="shelf-card-item">
              <EpubCard 
                {book} 
                progress={progressMap[book.bookId]} 
                layout="grid" 
                onBookUpdated={loadLibrary} 
              />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Main books collection -->
    <div class="books-section">
      {#if !searchQuery && activeFilter === 'all' && continueReadingBooks.length > 0}
        <h3 class="all-books-header">All Books ({displayedBooks.length})</h3>
      {/if}

      {#if isLoading}
        <div class="loading-state">
          <BookOpen size={36} class="spin" />
          <span>Loading your library...</span>
        </div>
      {:else if books.length === 0}
        <!-- Library empty state -->
        <div class="empty-library">
          <div class="empty-icon-box">
            <BookOpen size={48} />
          </div>
          <h3>Your Library is Empty</h3>
          <p>Import EPUB books to read them offline with automatic progress tracking and customizable themes.</p>
          <EpubImportButton onImportComplete={loadLibrary} />
        </div>
      {:else if displayedBooks.length === 0}
        <!-- Filter empty state -->
        <div class="empty-filter">
          <p>No books match your current search or filter.</p>
          <button class="btn-clear-filter" onclick={() => { searchQuery = ''; activeFilter = 'all'; }}>
            Reset Filters
          </button>
        </div>
      {:else if layout === 'grid'}
        <div class="books-grid">
          {#each displayedBooks as book (book.bookId)}
            <EpubCard 
              {book} 
              progress={progressMap[book.bookId]} 
              layout="grid" 
              onBookUpdated={loadLibrary} 
            />
          {/each}
        </div>
      {:else}
        <div class="books-list">
          {#each displayedBooks as book (book.bookId)}
            <EpubCard 
              {book} 
              progress={progressMap[book.bookId]} 
              layout="list" 
              onBookUpdated={loadLibrary} 
            />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .epub-library-root {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-base, #ffffff);
    color: var(--text-primary, #111827);
    position: relative;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(59, 130, 246, 0.15);
    border: 3px dashed var(--accent, #3b82f6);
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    backdrop-filter: blur(2px);
    pointer-events: none;
  }

  .drop-icon {
    color: var(--accent, #3b82f6);
  }

  .drop-text {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--accent, #3b82f6);
  }

  .library-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
    gap: 12px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .header-title {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .header-title h2 {
    font-size: 1.3rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary, #111827);
    white-space: nowrap;
  }

  .header-book-icon {
    color: var(--accent, #3b82f6);
    flex-shrink: 0;
  }

  .book-count-badge {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-secondary, #6b7280);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.78rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    justify-content: flex-end;
    min-width: 0;
  }

  .search-box {
    display: flex;
    align-items: center;
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 8px;
    padding: 0 10px;
    height: 36px;
    gap: 8px;
    width: 260px;
    max-width: 100%;
  }

  @media (max-width: 640px) {
    .library-header {
      padding: 12px 16px;
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }

    .header-left {
      width: 100%;
      justify-content: flex-start;
    }

    .header-right {
      width: 100%;
      justify-content: space-between;
      gap: 8px;
    }

    .search-box {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .search-input {
      width: 100%;
      min-width: 0;
    }

    .controls-bar {
      padding: 8px 16px !important;
      gap: 8px !important;
    }
  }

  .search-icon {
    color: var(--text-secondary, #9ca3af);
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 0.85rem;
    color: var(--text-primary, #111827);
  }

  .clear-search-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #9ca3af);
    padding: 2px;
    cursor: pointer;
    display: flex;
  }

  .import-status-banner {
    padding: 8px 24px;
    background: var(--hover-bg, rgba(59, 130, 246, 0.1));
    color: var(--accent, #3b82f6);
    font-size: 0.85rem;
    font-weight: 500;
    text-align: center;
    animation: fadeIn 0.2s ease;
  }

  .controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 24px;
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
    gap: 12px;
    flex-wrap: wrap;
  }

  .filter-pills {
    display: flex;
    gap: 6px;
  }

  .filter-pill {
    background: none;
    border: 1px solid transparent;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-secondary, #6b7280);
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .filter-pill:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    color: var(--text-primary, #111827);
  }

  .filter-pill.active {
    background: var(--accent, #3b82f6);
    color: #ffffff;
    font-weight: 600;
  }

  .view-and-sort-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sort-select-wrapper {
    display: flex;
    align-items: center;
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    padding: 0 8px;
    height: 32px;
    gap: 6px;
  }

  .sort-icon {
    color: var(--text-secondary, #9ca3af);
  }

  .sort-select {
    background: none;
    border: none;
    outline: none;
    font-size: 0.8rem;
    color: var(--text-primary, #374151);
    cursor: pointer;
  }

  .layout-toggle-group {
    display: flex;
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    padding: 2px;
  }

  .layout-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #6b7280);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .layout-btn.active {
    background: var(--bg-surface, #ffffff);
    color: var(--accent, #3b82f6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .library-scroll-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .shelf-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .shelf-header {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-primary, #111827);
  }

  .shelf-icon {
    color: var(--accent, #3b82f6);
  }

  .shelf-title {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0;
  }

  .shelf-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .all-books-header {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0 0 14px 0;
    color: var(--text-primary, #111827);
  }

  .books-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 18px;
  }

  .books-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-library {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
    max-width: 440px;
    margin: 0 auto;
    gap: 12px;
  }

  .empty-icon-box {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: var(--hover-bg, rgba(59, 130, 246, 0.1));
    color: var(--accent, #3b82f6);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }

  .empty-library h3 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
  }

  .empty-library p {
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-secondary, #6b7280);
    margin: 0 0 8px 0;
  }

  .empty-filter {
    text-align: center;
    padding: 48px 16px;
    color: var(--text-secondary, #6b7280);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .btn-clear-filter {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.82rem;
    cursor: pointer;
    color: var(--text-primary, #111827);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px;
    gap: 12px;
    color: var(--text-secondary, #6b7280);
  }

  .spin {
    animation: spin 1.2s linear infinite;
    color: var(--accent, #3b82f6);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
