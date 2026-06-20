<script lang="ts">
  import { appState, parseHtmlMetadata } from '../stores/appState.svelte';
  import { FileText, Plus, Trash2, Edit2, Search, Clock, CalendarDays, X, Menu, FolderInput, CheckSquare } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import ErrorBanner from './ErrorBanner.svelte';



  function formatModified(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    return new Date(timestamp).toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric' 
    });
  }

  function handleCreateNote() {
    appState.showPrompt({
      title: 'New Note',
      message: 'Enter title for the new note:',
      value: 'Untitled Note',
      placeholder: 'Note title...',
      onConfirm: (title) => {
        const trimmed = title.trim();
        if (trimmed) {
          appState.createNote(trimmed, appState.activeNotebook);
        }
      }
    });
  }

  function handleDeleteNote(path: string, event: Event) {
    event.stopPropagation();
    appState.showConfirmation({
      title: 'Delete Note',
      message: 'Do you really want to delete this note? This action is permanent.',
      confirmText: 'Delete',
      onConfirm: async () => {
        await appState.deleteNote(path);
      }
    });
  }

  async function handleRenameNote(path: string, currentName: string, event: Event) {
    event.stopPropagation();
    appState.showPrompt({
      title: 'Rename Note',
      message: 'Enter new title & file name:',
      value: currentName,
      placeholder: 'Note name...',
      onConfirm: async (newTitle) => {
        const trimmed = newTitle.trim();
        if (!trimmed || trimmed === currentName) return;
        try {
          await appState.renameNote(path, trimmed);
          appState.showToast('Note renamed successfully', 'success');
        } catch (err) {
          console.error('Failed to rename note:', err);
          appState.showToast('Failed to rename note', 'error');
        }
      }
    });
  }
  function handleMoveCopyNote(path: string, currentName: string, event: Event) {
    event.stopPropagation();
    appState.moveCopyNotePath = path;
    appState.moveCopyNoteName = currentName;
    appState.showMoveCopyModal = true;
  }
  function clearFilters() {
    appState.activeNotebook = null;
    appState.selectedTag = null;
    appState.searchQuery = '';
  }

  // ST-011: Bulk Tag Picker State
  let showBulkTagPicker = $state(false);
  let bulkTagPickerMode = $state<'tag' | 'untag'>('tag');
  let bulkPickerPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let bulkTagSearch = $state('');

  let filteredTagsForPicker = $derived.by(() => {
    const query = bulkTagSearch.trim().toLowerCase();
    let availableTags = appState.tags;
    
    if (bulkTagPickerMode === 'untag') {
      const selectedNotesList = appState.notes.filter(n => appState.selectedNotes.has(n.path));
      const tagsInSelectedNotes = new Set<string>();
      for (const note of selectedNotesList) {
        const parsed = parseHtmlMetadata(note.content);
        if (parsed.meta.tags) {
          parsed.meta.tags.forEach((t: string) => tagsInSelectedNotes.add(t.trim().toLowerCase()));
        }
      }
      availableTags = appState.tags.filter(t => tagsInSelectedNotes.has(t.normalizedName || t.name.toLowerCase()));
    }
    
    if (!query) return availableTags;
    return availableTags.filter(t => t.name.toLowerCase().includes(query));
  });

  function openBulkTagPicker(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Position above/near the button
    bulkPickerPos = { x: rect.left, y: Math.max(10, rect.top - 240) };
    bulkTagPickerMode = 'tag';
    showBulkTagPicker = true;
    bulkTagSearch = '';
  }

  function openBulkUntagPicker(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    bulkPickerPos = { x: rect.left, y: Math.max(10, rect.top - 240) };
    bulkTagPickerMode = 'untag';
    showBulkTagPicker = true;
    bulkTagSearch = '';
  }

  function closeBulkTagPicker() {
    showBulkTagPicker = false;
  }

  let showBulkNotebookPicker = $state(false);
  let bulkNotebookPickerPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  function openBulkNotebookPicker(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    bulkNotebookPickerPos = { x: rect.left, y: Math.max(10, rect.top - 200) };
    showBulkNotebookPicker = true;
  }

  function closeBulkNotebookPicker() {
    showBulkNotebookPicker = false;
  }

  async function handleBulkMove(notebook: string | null) {
    try {
      const notePaths = Array.from(appState.selectedNotes);
      await appState.bulkMoveNotes(notePaths, notebook);
      closeBulkNotebookPicker();
      appState.toggleSelectMode();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to move notes', 'error');
    }
  }

  function handleBulkDelete() {
    const notePaths = Array.from(appState.selectedNotes);
    if (notePaths.length === 0) return;
    appState.showConfirmation({
      title: 'Delete Multiple Notes',
      message: `Do you really want to delete the ${notePaths.length} selected note(s)? This action is permanent and cannot be undone.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await appState.bulkDeleteNotes(notePaths);
          appState.showToast(`Deleted ${notePaths.length} note(s)`, 'success');
          appState.toggleSelectMode();
        } catch (e) {
          console.error(e);
          appState.showToast('Failed to delete notes', 'error');
        }
      }
    });
  }

  async function handleBulkCreateAndAdd(tagName: string) {
    try {
      const cleanName = tagName.trim();
      const normalized = cleanName.toLowerCase();
      let existing = appState.tags.find(t => t.normalizedName === normalized);
      if (!existing) {
        await appState.createTag(cleanName);
      }
      await appState.bulkAddTag(cleanName);
      appState.showToast(`Tag #${cleanName} added in bulk`, 'success');
      closeBulkTagPicker();
      appState.toggleSelectMode();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to perform bulk operation', 'error');
    }
  }

  async function handleBulkAction(tagName: string) {
    try {
      if (bulkTagPickerMode === 'tag') {
        await appState.bulkAddTag(tagName);
        appState.showToast(`Tag #${tagName} added in bulk`, 'success');
      } else {
        await appState.bulkRemoveTag(tagName);
        appState.showToast(`Tag #${tagName} removed in bulk`, 'success');
      }
      closeBulkTagPicker();
      appState.toggleSelectMode();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to perform bulk operation', 'error');
    }
  }
</script>

<div 
  id="notelist-panel"
  class="note-list flex-col density-{appState.uiDensity}" 
  class:collapsed={appState.notelistCollapsed}
  style="width: {appState.notelistCollapsed ? 0 : appState.notelistWidth}px;"
  tabindex={appState.notelistCollapsed ? -1 : 0}
>
  <!-- Top Playlist Header -->
  <div class="list-header flex-col" style="position: relative;">
    <div class="flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
      <div class="meta-label">
        {#if appState.vaultName}
          DIRECTORY: {appState.vaultName.toUpperCase()}
        {:else}
          NOTEBOOK
        {/if}
      </div>
    </div>
    <div class="flex-row" style="align-items: center; gap: var(--spacing-xs); max-width: 100%;">
      <h1 class="list-title">
        {#if appState.selectedTag}
          Tagged: {appState.selectedTag}
        {:else if appState.activeNotebook}
          {appState.activeNotebook}
        {:else if appState.activeNotePath?.startsWith('Daily Notes/')}
          Daily Logs
        {:else}
          All Notes
        {/if}
      </h1>
    </div>
    
    <div class="header-actions flex-row">
      <span class="count-indicator">
        {appState.filteredNotes.length} notes
        {#if appState.googleConnected && appState.syncEnabled}
          • ☁️ {appState.customDriveFolderName || 'MyNotes'}
        {/if}
      </span>
      
      <div class="flex-row" style="gap: var(--spacing-xs); align-items: center;">
        <button 
          class="btn-pill btn-pill-outline" 
          onclick={() => appState.toggleUiDensity()}
          title="Toggle density (Comfortable / Compact)"
          style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm); height: 32px;"
        >
          {appState.uiDensity === 'comfortable' ? 'Comfortable' : 'Compact'}
        </button>
        {#if appState.editorCollapsed}
          <button 
            class="btn-pill btn-pill-outline" 
            style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm); height: 32px;" 
            onclick={() => appState.setEditorCollapsed(false)}
          >
            Show Editor
          </button>
        {/if}
        <button 
          class="btn-pill btn-pill-outline" 
          class:active={appState.selectMode}
          style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm); height: 32px; gap: var(--spacing-2xs); display: inline-flex; align-items: center;" 
          onclick={() => appState.toggleSelectMode()}
          title="Toggle Select Mode"
        >
          <CheckSquare size={14} />
          <span>{appState.selectMode ? 'Cancel' : 'Select'}</span>
        </button>
        <button class="btn-pill btn-pill-primary add-note-btn" onclick={handleCreateNote}>
          <Plus size={16} />
          <span>Add Note</span>
        </button>
      </div>
    </div>

    <!-- Active Filter Chips Bar (UI-D-009) -->
    {#if appState.activeNotebook || appState.selectedTag || appState.searchQuery}
      <div class="filter-chips-bar flex-row">
        {#if appState.activeNotebook}
          <div class="active-filter-chip flex-row">
            <span>Folder: {appState.activeNotebook}</span>
            <button 
              class="filter-chip-remove flex-row" 
              onclick={() => appState.activeNotebook = null}
              aria-label="Remove folder filter"
            >
              <X size={11} />
            </button>
          </div>
        {/if}

        {#if appState.selectedTag}
          <div class="active-filter-chip flex-row">
            <span>Tag: #{appState.selectedTag}</span>
            <button 
              class="filter-chip-remove flex-row" 
              onclick={() => appState.selectedTag = null}
              aria-label="Remove tag filter"
            >
              <X size={11} />
            </button>
          </div>
        {/if}

        {#if appState.searchQuery}
          <div class="active-filter-chip flex-row">
            <span>Search: "{appState.searchQuery}"</span>
            <button 
              class="filter-chip-remove flex-row" 
              onclick={() => appState.searchQuery = ''}
              aria-label="Remove search filter"
            >
              <X size={11} />
            </button>
          </div>
        {/if}

        {#if (appState.activeNotebook ? 1 : 0) + (appState.selectedTag ? 1 : 0) + (appState.searchQuery ? 1 : 0) > 1}
          <button class="filter-clear-all" onclick={clearFilters}>
            Clear All
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if appState.googleConnected && appState.syncEnabled && appState.syncStatus === 'error'}
    <div style="padding: 0 var(--spacing-md) var(--spacing-sm);">
      <ErrorBanner
        title="Sync Error"
        message={appState.syncErrorMessage || "Failed to synchronize notes with Google Drive."}
        severity="error"
        retryAction={() => appState.syncNotes()}
        retryLabel="Retry Sync"
        dismissAction={() => appState.syncStatus = 'idle'}
      />
    </div>
  {/if}

  <!-- Note Playlist Headers -->
  <div class="playlist-columns flex-row">
    {#if appState.selectMode}
      <span class="col-index" style="display: flex; align-items: center; justify-content: center;">
        <input 
          type="checkbox"
          checked={appState.selectedNotes.size > 0 && appState.selectedNotes.size === appState.filteredNotes.length}
          aria-label="Select all notes"
          onclick={(e) => {
            e.stopPropagation();
            if (appState.selectedNotes.size === appState.filteredNotes.length) {
              appState.selectedNotes.clear();
            } else {
              appState.selectAllNotes(appState.filteredNotes.map(n => n.path));
            }
          }}
          style="cursor: pointer; width: 14px; height: 14px;"
        />
      </span>
    {:else}
      <span class="col-index">#</span>
    {/if}
    
    <button 
      class="col-title flex-row sort-header-btn" 
      class:active={appState.sortField === 'title'}
      onclick={() => appState.setSort('title')}
      aria-label="Sort by title"
      style="background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; padding: 0;"
    >
      <span>TITLE</span>
      {#if appState.sortField === 'title'}
        <span class="sort-arrow">{appState.sortDirection === 'asc' ? '↑' : '↓'}</span>
      {/if}
    </button>

    <button 
      class="col-notebook flex-row sort-header-btn" 
      class:active={appState.sortField === 'notebook'}
      onclick={() => appState.setSort('notebook')}
      aria-label="Sort by notebook path"
      style="background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; padding: 0;"
    >
      <span>NOTEBOOK</span>
      {#if appState.sortField === 'notebook'}
        <span class="sort-arrow">{appState.sortDirection === 'asc' ? '↑' : '↓'}</span>
      {/if}
    </button>
    
    <button 
      class="col-modified flex-row sort-header-btn" 
      class:active={appState.sortField === 'modified'}
      onclick={() => appState.setSort('modified')}
      aria-label="Sort by modified time"
      style="background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; padding: 0;"
    >
      <span>MODIFIED</span>
      {#if appState.sortField === 'modified'}
        <span class="sort-arrow">{appState.sortDirection === 'asc' ? '↑' : '↓'}</span>
      {/if}
    </button>
    
    <span class="col-actions"></span>
  </div>

  <!-- Notes Grid -->
  <div class="playlist-rows">
    {#if appState.loadingNotes}
      {#each Array(5) as _, idx}
        <div class="note-row flex-row skeleton-row" style="--index: {idx}; pointer-events: none;">
          {#if appState.selectMode}
            <div class="selection-checkbox-wrapper">
              <div class="selection-checkbox skeleton-pulse" style="border: none; width: 16px; height: 16px; border-radius: 4px;"></div>
            </div>
          {:else}
            <div class="col-index"><div class="skeleton-block index skeleton-pulse"></div></div>
          {/if}
          <div class="col-title flex-row" style="align-items: center; width: 100%;">
            <div class="track-icon"><div class="skeleton-block icon skeleton-pulse"></div></div>
            <div class="track-info flex-col" style="flex-grow: 1; gap: var(--spacing-3xs);">
              <div class="skeleton-block title skeleton-pulse"></div>
            </div>
          </div>
          <div class="col-notebook"><div class="skeleton-block notebook skeleton-pulse"></div></div>
          <div class="col-modified"><div class="skeleton-block modified skeleton-pulse"></div></div>
          <div class="col-actions"></div>
        </div>
      {/each}
    {:else}
      {#each appState.filteredNotes as note, index}
        <div 
          class="note-row flex-row"
          class:active={appState.activeNotePath === note.path}
          class:selected={appState.selectedNotes.has(note.path)}
          style="--index: {index};"
          role="button"
          tabindex="0"
          onclick={(e) => {
            if (appState.selectMode) {
              e.stopPropagation();
              appState.toggleNoteSelection(note.path);
            } else {
              appState.selectNote(note.path);
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              if (appState.selectMode) {
                appState.toggleNoteSelection(note.path);
              } else {
                appState.selectNote(note.path);
              }
            }
          }}
        >
          {#if appState.selectMode}
            <div class="selection-checkbox-wrapper">
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="selection-checkbox" 
                class:checked={appState.selectedNotes.has(note.path)}
                role="checkbox"
                aria-checked={appState.selectedNotes.has(note.path)}
                tabindex="0"
                aria-label="Select note {note.name}"
                onclick={(e) => { e.stopPropagation(); appState.toggleNoteSelection(note.path); }}
                onkeydown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    appState.toggleNoteSelection(note.path);
                  }
                }}
              >
                {#if appState.selectedNotes.has(note.path)}
                  ✓
                {/if}
              </div>
            </div>
          {:else}
            <div class="col-index font-mono">{index + 1}</div>
          {/if}
          
          <div class="col-title flex-row">
            <div class="track-icon">
              <FileText size={18} />
            </div>
            <div class="track-info flex-col">
              <span class="track-name">{note.name}</span>
            </div>
          </div>

          <div class="col-notebook text-secondary">
            {#if note.path.includes('/')}
              <span class="notebook-path">{note.path.split('/').slice(0, -1).join(' / ')}</span>
            {:else}
              <span class="notebook-path" style="opacity: 0.3;">—</span>
            {/if}
          </div>

          <div class="col-modified text-secondary">
            {formatModified(note.modified)}
          </div>

          <div class="col-actions flex-row" style="gap: var(--spacing-xs); align-items: center; justify-content: flex-end;">
            {#if !appState.selectMode}
              <button 
                class="row-move-btn" 
                onclick={(e) => handleMoveCopyNote(note.path, note.name, e)}
                aria-label="Move or copy note"
                title="Move or copy note"
              >
                <FolderInput size={16} />
              </button>
              <button 
                class="row-edit-btn" 
                onclick={(e) => handleRenameNote(note.path, note.name, e)}
                aria-label="Rename note"
                title="Rename note"
              >
                <Edit2 size={16} />
              </button>
              <button 
                class="row-delete-btn" 
                onclick={(e) => handleDeleteNote(note.path, e)}
                aria-label="Delete note"
                title="Delete note"
              >
                <Trash2 size={16} />
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="empty-state flex-col">
          {#if appState.selectedTag}
            <div class="empty-illustration">
              <svg class="empty-visual-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
            </div>
            <span class="empty-title">No notes tagged with #{appState.selectedTag}</span>
            <span class="empty-subtitle">Create a new note or tag an existing one to see it here.</span>
            <button class="btn-pill btn-pill-primary flex-row" onclick={handleCreateNote} style="gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-md); cursor: pointer; border: none; margin-top: var(--spacing-2xs);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Add Note</span>
            </button>
          {:else if appState.activeNotebook}
            <div class="empty-illustration">
              <svg class="empty-visual-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <span class="empty-title">This notebook is empty</span>
            <span class="empty-subtitle">Click "Add Note" to create a note in this notebook.</span>
            <button class="btn-pill btn-pill-primary flex-row" onclick={handleCreateNote} style="gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-md); cursor: pointer; border: none; margin-top: var(--spacing-2xs);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Add Note</span>
            </button>
          {:else}
            <div class="empty-illustration">
              <svg class="empty-visual-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <span class="empty-title">Your library is empty</span>
            <span class="empty-subtitle">Click "Add Note" to write your first note.</span>
            <button class="btn-pill btn-pill-primary flex-row" onclick={handleCreateNote} style="gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-md); cursor: pointer; border: none; margin-top: var(--spacing-2xs);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Add Note</span>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- ST-011: Bulk Action Bar -->
  {#if appState.selectMode}
    <div class="bulk-action-bar flex-row" transition:fly={{ y: 50, duration: 250, easing: cubicOut }}>
      <span class="selected-count">{appState.selectedNotes.size} selected</span>
      <div class="bulk-actions flex-row" style="gap: var(--spacing-xs);">
        <button 
          class="btn-pill btn-pill-outline" 
          onclick={() => appState.selectAllNotes(appState.filteredNotes.map(n => n.path))}
          title="Select all visible notes"
        >
          All
        </button>
        <button 
          class="btn-pill btn-pill-primary tag-btn" 
          disabled={appState.selectedNotes.size === 0}
          onclick={(e) => openBulkTagPicker(e)}
          title="Tag selected notes"
        >
          Tag
        </button>
        <button 
          class="btn-pill btn-pill-outline untag-btn" 
          disabled={appState.selectedNotes.size === 0}
          onclick={(e) => openBulkUntagPicker(e)}
          title="Untag selected notes"
        >
          Untag
        </button>
        <button 
          class="btn-pill btn-pill-outline move-btn" 
          disabled={appState.selectedNotes.size === 0}
          onclick={(e) => openBulkNotebookPicker(e)}
          title="Move selected notes to a notebook"
        >
          Move
        </button>
        <button 
          class="btn-pill btn-pill-outline delete-btn" 
          disabled={appState.selectedNotes.size === 0}
          onclick={handleBulkDelete}
          style="color: var(--semantic-error); border-color: color-mix(in srgb, var(--semantic-error) 20%, transparent);"
          title="Delete selected notes"
        >
          Delete
        </button>
        <button 
          class="btn-pill btn-pill-outline cancel-btn" 
          onclick={() => appState.toggleSelectMode()}
          title="Cancel selection"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- ST-014: Bulk Notebook Picker Popover -->
  {#if showBulkNotebookPicker}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      class="picker-backdrop"
      onclick={closeBulkNotebookPicker}
      onkeydown={(e) => e.key === 'Escape' && closeBulkNotebookPicker()}
    ></div>
    <div class="bulk-tag-picker-popover" style="left: {bulkNotebookPickerPos.x}px; top: {bulkNotebookPickerPos.y}px;">
      <div class="picker-header flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
        <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
          Move to Notebook
        </span>
        <button 
          class="icon-circle-btn flex-row" 
          onclick={closeBulkNotebookPicker}
          aria-label="Close"
          style="width: 20px; height: 20px; min-width: 20px; border: none; background: color-mix(in srgb, var(--text-primary) 8%, transparent);"
        >
          <X size={10} />
        </button>
      </div>

      <div class="picker-list flex-col" style="max-height: 180px; overflow-y: auto; width: 100%; gap: var(--spacing-2xs); margin-top: var(--spacing-xs);">
        <button 
          class="picker-item flex-row" 
          onclick={() => handleBulkMove(null)}
          style="background: transparent; border: none; padding: var(--spacing-xs) var(--spacing-xs); border-radius: 4px; color: var(--text-primary); cursor: pointer; text-align: left; justify-content: flex-start; font-size: var(--font-size-xs); width: 100%;"
          onmouseover={(e) => e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--text-primary) 6%, transparent)'}
          onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <span style="margin-right: var(--spacing-xs);">📂</span> [Root Folder]
        </button>
        {#each appState.notebooks as notebook}
          <button 
            class="picker-item flex-row" 
            onclick={() => handleBulkMove(notebook)}
            style="background: transparent; border: none; padding: var(--spacing-xs) var(--spacing-xs); border-radius: 4px; color: var(--text-primary); cursor: pointer; text-align: left; justify-content: flex-start; font-size: var(--font-size-xs); width: 100%;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--text-primary) 6%, transparent)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span style="margin-right: var(--spacing-xs);">📂</span> {notebook}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- ST-011: Bulk Tag Picker Popover -->
  {#if showBulkTagPicker}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      class="picker-backdrop"
      onclick={closeBulkTagPicker}
      onkeydown={(e) => e.key === 'Escape' && closeBulkTagPicker()}
    ></div>
    <div class="bulk-tag-picker-popover" style="left: {bulkPickerPos.x}px; top: {bulkPickerPos.y}px;">
      <div class="picker-header flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
        <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
          {bulkTagPickerMode === 'tag' ? 'Apply Tag' : 'Remove Tag'}
        </span>
        <button 
          class="close-picker-btn" 
          onclick={closeBulkTagPicker}
          style="background: none; border: none; color: var(--text-secondary); cursor: pointer;"
        >
          <X size={12} />
        </button>
      </div>
      <div class="picker-search">
        <input 
          type="text" 
          placeholder="Search tags..." 
          bind:value={bulkTagSearch}
          autofocus
          style="width: 100%; padding: var(--spacing-xs) var(--spacing-sm); background-color: var(--bg-mid-dark); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); font-size: var(--font-size-xs); outline: none;"
        />
      </div>
      <div class="picker-list flex-col" style="max-height: 180px; overflow-y: auto; margin-top: var(--spacing-xs); gap: var(--spacing-2xs);">
        {#each filteredTagsForPicker as tag}
          {@const tagColor = appState.tagColorMap.get(tag.normalizedName || tag.name.toLowerCase())}
          <button 
            class="picker-item flex-row" 
            onclick={() => handleBulkAction(tag.name)}
            style="width: 100%; padding: var(--spacing-xs) var(--spacing-xs); border: none; background: none; color: var(--text-primary); text-align: left; cursor: pointer; border-radius: 4px; gap: var(--spacing-xs); align-items: center;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--text-primary) 4%, transparent)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span class="picker-tag-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: {tagColor || 'var(--text-secondary)'};"></span>
            <span style="font-size: var(--font-size-xs); font-weight: 600;">#{tag.name}</span>
          </button>
        {:else}
          <div style="font-size: var(--font-size-xs); color: var(--text-secondary); padding: var(--spacing-xs); text-align: center;">No matching tags</div>
        {/each}
        
        {#if bulkTagPickerMode === 'tag' && bulkTagSearch.trim() && !filteredTagsForPicker.some(t => t.name.toLowerCase() === bulkTagSearch.toLowerCase().trim())}
          <button 
            class="picker-item create-item flex-row" 
            onclick={() => handleBulkCreateAndAdd(bulkTagSearch)}
            style="width: 100%; padding: var(--spacing-xs) var(--spacing-xs); border: none; background: color-mix(in srgb, var(--text-primary) 4%, transparent); color: var(--accent); text-align: left; cursor: pointer; border-radius: 4px; gap: var(--spacing-xs); align-items: center; margin-top: var(--spacing-2xs);"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--text-primary) 8%, transparent)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--text-primary) 4%, transparent)'}
          >
            <span style="font-size: var(--font-size-xs); font-weight: 700;">+ Create & Apply "{bulkTagSearch.trim()}"</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .note-list {
    background-color: var(--bg-base);
    height: 100%;
    padding: var(--spacing-lg) var(--spacing-sm) var(--spacing-sm);
    border-right: 1px solid var(--border-color);
    overflow: hidden;
    flex-shrink: 0;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-right-color 0.3s ease;
    will-change: width, padding;
  }

  .note-list.collapsed {
    padding-left: 0;
    padding-right: 0;
    border-right-color: transparent;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .list-header {
    gap: var(--spacing-2xs);
    margin-bottom: var(--spacing-md);
    padding: 0 var(--spacing-2xs);
  }

  .meta-label {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.8px;
  }

  .list-title {
    font-size: var(--font-size-2xl);
    font-weight: 850;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.5px;
  }

  .header-actions {
    justify-content: space-between;
    margin-top: var(--spacing-xs);
  }

  .count-indicator {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .clear-btn {
    font-size: var(--font-size-xs);
    color: var(--accent);
    font-weight: 600;
    margin-left: var(--spacing-xs);
    transition: opacity 0.2s;
  }

  .clear-btn:hover {
    text-decoration: underline;
  }

  .add-note-btn {
    font-size: var(--font-size-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
  }

  .search-container {
    padding: 0 var(--spacing-2xs);
    margin-bottom: var(--spacing-md);
  }

  .search-wrapper {
    position: relative;
    width: 100%;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-secondary);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    background-color: var(--bg-surface);
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    padding: var(--spacing-xs) var(--spacing-sm) var(--spacing-xs) 38px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    transition: all 0.2s;
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-input:focus {
    background-color: var(--bg-mid-dark);
    border-color: var(--border-highlight);
  }

  .note-list.density-comfortable {
    --row-padding-y: var(--spacing-xs);
  }

  .note-list.density-compact {
    --row-padding-y: var(--spacing-2xs);
  }

  .playlist-columns {
    border-bottom: 1px solid var(--border-color);
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-secondary);
    letter-spacing: 0.8px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .sort-header-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-3xs);
    transition: color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .sort-header-btn:hover {
    color: var(--text-primary);
  }
  .sort-arrow {
    font-size: var(--font-size-xs);
    font-weight: bold;
    color: var(--accent);
  }

  .col-index {
    width: 24px;
    text-align: center;
    flex-shrink: 0;
  }

  .col-title {
    flex: 1.8;
    min-width: 0;
    overflow: hidden;
    gap: var(--spacing-xs);
  }

  .col-notebook {
    flex: 1.2;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-xs);
  }

  .col-modified {
    width: 85px;
    flex-shrink: 0;
    text-align: left;
    white-space: nowrap;
  }

  .col-actions {
    width: 80px;
    flex-shrink: 0;
    text-align: right;
    justify-content: flex-end;
  }

  .playlist-rows {
    overflow-y: auto;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    padding-top: var(--spacing-xs);
    gap: var(--spacing-3xs);
  }

  .note-row {
    padding: var(--row-padding-y, var(--spacing-xs)) var(--spacing-sm);
    border-radius: var(--radius-standard);
    width: 100%;
    text-align: left;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--spacing-sm);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard), 
                transform var(--motion-duration-fast) var(--motion-ease-standard), 
                box-shadow var(--motion-duration-fast) var(--motion-ease-standard);
    animation: list-item-fade-in var(--motion-duration-slow) var(--motion-ease-out) calc(var(--index, 0) * 0.04s) both;
    will-change: transform, opacity;
  }

  .note-row:hover {
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    transform: translateY(-2px);
    box-shadow: var(--elevation-3), 0 0 0 1px color-mix(in srgb, var(--text-primary) 4%, transparent);
  }

  .note-row.active {
    background-color: color-mix(in srgb, var(--text-primary) 10%, transparent);
    box-shadow: inset 3px 0 0 0 var(--accent);
  }

  .note-row.active .track-name {
    color: var(--accent);
  }

  @keyframes list-item-fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .track-icon {
    width: 32px;
    height: 32px;
    background-color: var(--bg-surface);
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .note-row:hover .track-icon {
    background-color: var(--bg-mid-dark);
    color: var(--text-primary);
  }

  .track-info {
    overflow: hidden;
    min-width: 0;
  }

  .track-name {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notebook-path {
    font-size: var(--font-size-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-delete-btn, .row-edit-btn, .row-move-btn {
    opacity: 0.4;
    color: var(--text-secondary);
    transition: opacity var(--motion-duration-fast) var(--motion-ease-standard), 
                color var(--motion-duration-fast) var(--motion-ease-standard), 
                transform var(--motion-duration-fast) var(--motion-ease-standard), 
                background-color var(--motion-duration-fast) var(--motion-ease-standard);
    padding: var(--spacing-2xs);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
  }

  .note-row:hover .row-delete-btn,
  .note-row:hover .row-edit-btn,
  .note-row:hover .row-move-btn,
  .note-row:focus-within .row-delete-btn,
  .note-row:focus-within .row-edit-btn,
  .note-row:focus-within .row-move-btn {
    opacity: 1;
  }

  .row-delete-btn:hover {
    color: var(--semantic-error);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    transform: scale(1.15) rotate(5deg);
  }

  .row-edit-btn:hover {
    color: var(--accent);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    transform: scale(1.15) rotate(-5deg);
  }

  .row-move-btn:hover {
    color: var(--accent);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    transform: scale(1.15) translateY(-2px);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex-grow: 1;
    padding: var(--spacing-xl) var(--spacing-md);
    text-align: center;
    gap: var(--spacing-sm);
    animation: note-empty-fade 0.3s ease-out;
  }

  @keyframes note-empty-fade {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .empty-illustration {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text-primary) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--text-primary) 5%, transparent);
    margin-bottom: var(--spacing-2xs);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s;
  }

  .empty-illustration:hover {
    transform: scale(1.06) rotate(3deg);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .empty-visual-icon {
    filter: drop-shadow(0 4px 8px color-mix(in srgb, var(--accent) 15%, transparent));
  }

  .empty-title {
    font-size: var(--font-size-base);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.2px;
  }

  .empty-subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    max-width: 240px;
    line-height: 1.5;
    margin: 0;
  }

  @media (max-width: 768px) {
    .row-delete-btn {
      opacity: 1;
    }
  }

  .note-row.selected {
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    box-shadow: inset 3px 0 0 0 var(--accent);
  }

  .note-row.selected .track-name {
    color: var(--accent);
  }

  .selection-checkbox-wrapper {
    width: 24px;
    margin-right: var(--spacing-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .selection-checkbox {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs);
    font-weight: bold;
    color: white;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .selection-checkbox.checked {
    background-color: var(--accent);
    border-color: var(--accent);
  }

  /* ST-011: Bulk Action Bar */
  .bulk-action-bar {
    position: absolute;
    bottom: 16px;
    left: 16px;
    right: 16px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-heavy), 0 0 0 1px color-mix(in srgb, var(--text-primary) 5%, transparent);
    border-radius: 12px;
    padding: var(--spacing-sm) var(--spacing-md);
    justify-content: space-between;
    align-items: center;
    z-index: 100;
  }

  .selected-count {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  /* ST-011: Bulk Tag Picker */
  .picker-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9998;
  }

  .bulk-tag-picker-popover {
    position: fixed;
    z-index: 9999;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: var(--spacing-sm);
    box-shadow: var(--shadow-heavy), 0 0 0 1px color-mix(in srgb, var(--text-primary) 5%, transparent);
    min-width: 200px;
    backdrop-filter: blur(20px);
    animation: pickerFadeIn 0.15s ease-out;
  }

  @keyframes pickerFadeIn {
    from { opacity: 0; transform: scale(0.95) translateY(4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .picker-header {
    margin-bottom: var(--spacing-xs);
    padding-bottom: var(--spacing-xs);
    border-bottom: 1px solid var(--border-color);
  }

  .picker-item {
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  /* Filter Chips styling (UI-D-009) */
  .filter-chips-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-2xs);
    align-items: center;
    margin-top: var(--spacing-xs);
    width: 100%;
  }

  .active-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-2xs);
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: var(--radius-pill);
    background-color: color-mix(in srgb, var(--accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-size: var(--font-size-xs);
    font-weight: 500;
  }

  .filter-chip-remove {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: var(--spacing-3xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color 0.15s;
  }

  .filter-chip-remove:hover {
    background-color: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--text-primary);
  }

  .filter-clear-all {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    font-weight: 600;
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: var(--radius-subtle);
    transition: color 0.15s, background-color 0.15s;
  }

  .filter-clear-all:hover {
    color: var(--text-primary);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  /* NoteList Loading Skeleton Styles */
  .skeleton-block {
    background-color: var(--bg-mid-dark, rgba(255, 255, 255, 0.05));
    border-radius: var(--radius-subtle);
    height: 12px;
  }
  .skeleton-block.index {
    width: 14px;
    height: 12px;
    margin: 0 auto;
  }
  .skeleton-block.icon {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-subtle);
  }
  .skeleton-block.title {
    width: 60%;
    height: 14px;
  }
  .skeleton-block.notebook {
    width: 40%;
    height: 12px;
  }
  .skeleton-block.modified {
    width: 50px;
    height: 12px;
  }
</style>
