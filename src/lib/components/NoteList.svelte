<script lang="ts">
  import { appState, parseHtmlMetadata } from '../stores/appState.svelte';
  import { FileText, Plus, Trash2, Edit2, Search, Clock, CalendarDays, X, Menu, FolderInput, CheckSquare } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  let searchInput = $state('');
  
  // Set query store reactively when typing
  $effect(() => {
    appState.searchQuery = searchInput;
  });

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
    const title = prompt('Enter note title:', 'Untitled Note');
    if (title === null) return; // Cancelled
    appState.createNote(title, appState.activeNotebook);
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
    const newTitle = prompt('Rename note title & file name:', currentName);
    if (!newTitle) return;
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
  function handleMoveCopyNote(path: string, currentName: string, event: Event) {
    event.stopPropagation();
    appState.moveCopyNotePath = path;
    appState.moveCopyNoteName = currentName;
    appState.showMoveCopyModal = true;
  }
  function clearFilters() {
    appState.activeNotebook = null;
    appState.selectedTag = null;
    searchInput = '';
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
  class="note-list flex-col" 
  class:collapsed={appState.notelistCollapsed}
  style="width: {appState.notelistCollapsed ? 0 : appState.notelistWidth}px;"
>
  <!-- Top Playlist Header -->
  <div class="list-header flex-col" style="position: relative;">
    <div class="flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
      <div class="flex-row" style="gap: 8px; align-items: center;">
        {#if appState.sidebarCollapsed}
          <button 
            onclick={() => appState.setSidebarCollapsed(false)} 
            title="Expand Sidebar"
            aria-label="Expand sidebar"
            style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
            onmouseover={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
          >
            <Menu size={16} />
          </button>
        {/if}
        <div class="meta-label">
          {#if appState.vaultName}
            DIRECTORY: {appState.vaultName.toUpperCase()}
          {:else}
            NOTEBOOK
          {/if}
        </div>
      </div>
      <button 
        class="close-panel-btn flex-row" 
        onclick={() => appState.setNotelistCollapsed(true)} 
        aria-label="Collapse note list"
        style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;"
        onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
        onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <X size={16} />
      </button>
    </div>
    <div class="flex-row" style="align-items: center; gap: 8px; max-width: 100%;">
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
      {#if appState.selectedTag}
        <button 
          onclick={clearFilters}
          title="Clear tag filter"
          aria-label="Clear tag filter"
          style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; flex-shrink: 0; transition: background-color 0.2s, color 0.2s;"
          onmouseover={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onmouseout={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <X size={16} />
        </button>
      {/if}
    </div>
    
    <div class="header-actions flex-row">
      <span class="count-indicator">
        {appState.filteredNotes.length} notes
        {#if appState.activeNotebook || appState.selectedTag}
          <button class="clear-btn" onclick={clearFilters}>• Clear Filter</button>
        {/if}
        {#if appState.googleConnected && appState.syncEnabled}
          • ☁️ {appState.customDriveFolderName || 'MyNotes'}
        {/if}
      </span>
      
      <div class="flex-row" style="gap: 8px; align-items: center;">
        {#if appState.editorCollapsed}
          <button 
            class="btn-pill btn-pill-outline" 
            style="font-size: 11px; padding: 6px 12px; height: 32px;" 
            onclick={() => appState.setEditorCollapsed(false)}
          >
            Show Editor
          </button>
        {/if}
        <button 
          class="btn-pill btn-pill-outline" 
          class:active={appState.selectMode}
          style="font-size: 11px; padding: 6px 12px; height: 32px; gap: 4px; display: inline-flex; align-items: center;" 
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
  </div>

  <!-- Search Filter -->
  <div class="search-container flex-row">
    <div class="search-wrapper">
      <Search size={16} class="search-icon" />
      <input 
        type="text" 
        placeholder="Search notes..." 
        bind:value={searchInput}
        class="search-input"
      />
    </div>
  </div>

  <!-- Note Playlist Headers -->
  <div class="playlist-columns flex-row">
    <span class="col-index">#</span>
    <span class="col-title">TITLE</span>
    <span class="col-modified flex-row"><Clock size={14} style="margin-right: 4px;" /> MODIFIED</span>
    <span class="col-actions"></span>
  </div>

  <!-- Notes Grid -->
  <div class="playlist-rows">
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
              onclick={(e) => { e.stopPropagation(); appState.toggleNoteSelection(note.path); }}
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
            {#if note.path.includes('/')}
              <span class="track-folder">{note.path.split('/').slice(0, -1).join(' / ')}</span>
            {/if}
          </div>
        </div>

        <div class="col-modified text-secondary">
          {formatModified(note.modified)}
        </div>

        <div class="col-actions flex-row" style="gap: 6px; align-items: center;">
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
          <span class="empty-icon">🏷️</span>
          <span class="empty-title">No notes tagged with #{appState.selectedTag}</span>
          <span class="empty-subtitle">Create a new note or tag an existing one to see it here.</span>
        {:else if appState.activeNotebook}
          <span class="empty-icon">📂</span>
          <span class="empty-title">This notebook is empty</span>
          <span class="empty-subtitle">Click "Add Note" to create a note in this notebook.</span>
        {:else}
          <span class="empty-icon">📄</span>
          <span class="empty-title">Your library is empty</span>
          <span class="empty-subtitle">Click "Add Note" to write your first note.</span>
        {/if}
      </div>
    {/each}
  </div>

  <!-- ST-011: Bulk Action Bar -->
  {#if appState.selectMode}
    <div class="bulk-action-bar flex-row" transition:fly={{ y: 50, duration: 250, easing: cubicOut }}>
      <span class="selected-count">{appState.selectedNotes.size} selected</span>
      <div class="bulk-actions flex-row" style="gap: 8px;">
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
          style="color: var(--semantic-error, #ff4d4d); border-color: rgba(255, 77, 77, 0.2);"
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
        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
          Move to Notebook
        </span>
        <button 
          class="icon-circle-btn flex-row" 
          onclick={closeBulkNotebookPicker}
          aria-label="Close"
          style="width: 20px; height: 20px; min-width: 20px; border: none; background: rgba(255, 255, 255, 0.08);"
        >
          <X size={10} />
        </button>
      </div>

      <div class="picker-list flex-col" style="max-height: 180px; overflow-y: auto; width: 100%; gap: 4px; margin-top: 8px;">
        <button 
          class="picker-item flex-row" 
          onclick={() => handleBulkMove(null)}
          style="background: transparent; border: none; padding: 6px 8px; border-radius: 4px; color: var(--text-primary); cursor: pointer; text-align: left; justify-content: flex-start; font-size: 12px; width: 100%;"
          onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'}
          onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <span style="margin-right: 6px;">📂</span> [Root Folder]
        </button>
        {#each appState.notebooks as notebook}
          <button 
            class="picker-item flex-row" 
            onclick={() => handleBulkMove(notebook)}
            style="background: transparent; border: none; padding: 6px 8px; border-radius: 4px; color: var(--text-primary); cursor: pointer; text-align: left; justify-content: flex-start; font-size: 12px; width: 100%;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span style="margin-right: 6px;">📂</span> {notebook}
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
        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
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
          style="width: 100%; padding: 6px 10px; background-color: var(--bg-mid-dark); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--text-primary); font-size: 12px; outline: none;"
        />
      </div>
      <div class="picker-list flex-col" style="max-height: 180px; overflow-y: auto; margin-top: 8px; gap: 4px;">
        {#each filteredTagsForPicker as tag}
          {@const tagColor = appState.tagColorMap.get(tag.normalizedName || tag.name.toLowerCase())}
          <button 
            class="picker-item flex-row" 
            onclick={() => handleBulkAction(tag.name)}
            style="width: 100%; padding: 6px 8px; border: none; background: none; color: var(--text-primary); text-align: left; cursor: pointer; border-radius: 4px; gap: 8px; align-items: center;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span class="picker-tag-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: {tagColor || 'var(--text-secondary)'};"></span>
            <span style="font-size: 12px; font-weight: 600;">#{tag.name}</span>
          </button>
        {:else}
          <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; text-align: center;">No matching tags</div>
        {/each}
        
        {#if bulkTagPickerMode === 'tag' && bulkTagSearch.trim() && !filteredTagsForPicker.some(t => t.name.toLowerCase() === bulkTagSearch.toLowerCase().trim())}
          <button 
            class="picker-item create-item flex-row" 
            onclick={() => handleBulkCreateAndAdd(bulkTagSearch)}
            style="width: 100%; padding: 6px 8px; border: none; background: rgba(255,255,255,0.04); color: var(--accent); text-align: left; cursor: pointer; border-radius: 4px; gap: 8px; align-items: center; margin-top: 4px;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'}
          >
            <span style="font-size: 12px; font-weight: 700;">+ Create & Apply "{bulkTagSearch.trim()}"</span>
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
    padding: 20px 12px 12px;
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
    gap: 4px;
    margin-bottom: 16px;
    padding: 0 4px;
  }

  .meta-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.8px;
  }

  .list-title {
    font-size: 28px;
    font-weight: 850;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.5px;
  }

  .header-actions {
    justify-content: space-between;
    margin-top: 8px;
  }

  .count-indicator {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .clear-btn {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
    margin-left: 6px;
    transition: opacity 0.2s;
  }

  .clear-btn:hover {
    text-decoration: underline;
  }

  .add-note-btn {
    font-size: 11px;
    padding: 6px 12px;
  }

  .search-container {
    padding: 0 4px;
    margin-bottom: 16px;
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
    padding: 8px 12px 8px 38px;
    font-size: 13px;
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

  .playlist-columns {
    border-bottom: 1px solid var(--border-color);
    padding: 0 12px 8px;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.8px;
  }

  .col-index {
    width: 24px;
    text-align: right;
    margin-right: 12px;
    flex-shrink: 0;
  }

  .col-title {
    flex-grow: 1;
    overflow: hidden;
    gap: 12px;
  }

  .col-modified {
    width: 70px;
    text-align: right;
    flex-shrink: 0;
    justify-content: flex-end;
  }

  .col-actions {
    width: 28px;
    flex-shrink: 0;
  }

  .playlist-rows {
    overflow-y: auto;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    padding-top: 8px;
    gap: 2px;
  }

  .note-row {
    padding: 8px 12px;
    border-radius: var(--radius-standard);
    width: 100%;
    text-align: left;
    transition: background-color 0.2s, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
    animation: list-item-fade-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) calc(var(--index, 0) * 0.04s) both;
    will-change: transform, opacity;
  }

  .note-row:hover {
    background-color: rgba(255, 255, 255, 0.05);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  .note-row.active {
    background-color: rgba(255, 255, 255, 0.1);
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
  }

  .note-row:hover .track-icon {
    background-color: var(--bg-mid-dark);
    color: var(--text-primary);
  }

  .track-info {
    overflow: hidden;
  }

  .track-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-folder {
    font-size: 10px;
    color: var(--text-secondary);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-modified {
    font-size: 12px;
    white-space: nowrap;
  }

  .row-delete-btn, .row-edit-btn, .row-move-btn {
    opacity: 0;
    color: var(--text-secondary);
    transition: opacity 0.2s, color 0.2s, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s;
    padding: 4px;
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
  .note-row:hover .row-move-btn {
    opacity: 1;
  }

  .row-delete-btn:hover {
    color: var(--semantic-error);
    background-color: rgba(255, 255, 255, 0.05);
    transform: scale(1.15) rotate(5deg);
  }

  .row-edit-btn:hover {
    color: var(--accent);
    background-color: rgba(255, 255, 255, 0.05);
    transform: scale(1.15) rotate(-5deg);
  }

  .row-move-btn:hover {
    color: var(--accent);
    background-color: rgba(255, 255, 255, 0.05);
    transform: scale(1.15) translateY(-2px);
  }

  .empty-state {
    align-items: center;
    justify-content: center;
    flex-grow: 1;
    padding: 40px 16px;
    text-align: center;
    gap: 8px;
  }

  .empty-icon {
    font-size: 40px;
    margin-bottom: 8px;
    opacity: 0.5;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .empty-subtitle {
    font-size: 12px;
    color: var(--text-secondary);
    max-width: 200px;
  }

  @media (max-width: 768px) {
    .row-delete-btn {
      opacity: 1;
    }
  }

  .note-row.selected {
    background-color: rgba(255, 255, 255, 0.08);
    box-shadow: inset 3px 0 0 0 var(--accent);
  }

  .note-row.selected .track-name {
    color: var(--accent);
  }

  .selection-checkbox-wrapper {
    width: 24px;
    margin-right: 12px;
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
    font-size: 10px;
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
    background: #1e1e1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 12px 16px;
    justify-content: space-between;
    align-items: center;
    z-index: 100;
  }

  .selected-count {
    font-size: 13px;
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
    background: #1e1e1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    min-width: 200px;
    backdrop-filter: blur(20px);
    animation: pickerFadeIn 0.15s ease-out;
  }

  @keyframes pickerFadeIn {
    from { opacity: 0; transform: scale(0.95) translateY(4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .picker-header {
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .picker-item {
    transition: background-color 0.15s ease, color 0.15s ease;
  }
</style>
