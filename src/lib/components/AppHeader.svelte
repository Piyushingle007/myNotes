<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { appState, generateHtmlNote, parseHtmlMetadata } from '../stores/appState.svelte';
  import type { Tag } from '../storage/TagSchema';
  import { 
    Search, Plus, Settings, Cloud, CloudOff, X, 
    Folder, Tag as TagIcon, Calendar, ChevronRight, FileText, Menu,
    ChevronDown, BookOpen, Star, Palette, Edit2, Trash2
  } from 'lucide-svelte';
  import GoogleLogo from './GoogleLogo.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import SyncPopover from './SyncPopover.svelte';
  import NoteList from './NoteList.svelte';

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let showSyncPopover = $state(false);
  let showCreateDropdown = $state(false);
  let dropdownEl = $state<HTMLDivElement | null>(null);

  function handleDropdownOutsideClick(e: MouseEvent) {
    if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
      const target = e.target as HTMLElement;
      if (target.closest('.quick-create-wrapper')) return;
      showCreateDropdown = false;
    }
  }

  $effect(() => {
    if (showCreateDropdown) {
      document.addEventListener('mousedown', handleDropdownOutsideClick, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleDropdownOutsideClick, true);
    };
  });

  // Global keyboard shortcut to toggle command search palette (Ctrl+K or Cmd+K)
  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      appState.showCommandPalette = !appState.showCommandPalette;
    }
    // Alt + N or Ctrl/Cmd + Alt + N for New Note
    if (e.altKey && e.key.toLowerCase() === 'n') {
      const target = e.target as HTMLElement;
      const isInput = target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable ||
        target.closest('.ProseMirror')
      );
      if (!isInput) {
        e.preventDefault();
        handleCreateNote();
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

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

  function handleCreateNotebookNote() {
    appState.showPrompt({
      title: 'New Handwriting Notebook',
      message: 'Enter name for the new notebook document:',
      value: 'Untitled Notebook',
      placeholder: 'Notebook name...',
      onConfirm: (name) => {
        const trimmed = name.trim();
        if (trimmed) {
          appState.createNotebookNote(trimmed, appState.activeNotebook);
        }
      }
    });
  }

  // New Popover Navigation States
  let activePopover = $state<'noteList' | 'favorites' | 'notebooks' | 'tags' | 'dailyLogs' | null>(null);
  let popoverContainer = $state<HTMLDivElement | null>(null);
  let popoverSubView = $state<'list' | 'notes'>('list');

  $effect(() => {
    // Reset popover subview to list whenever the active popover changes
    const _ = activePopover;
    popoverSubView = 'list';
  });

  function togglePopover(name: 'noteList' | 'favorites' | 'notebooks' | 'tags' | 'dailyLogs') {
    if (activePopover === name) {
      activePopover = null;
    } else {
      activePopover = name;
    }
  }

  function handlePopoverOutsideClick(e: MouseEvent) {
    if (activePopover && popoverContainer && !popoverContainer.contains(e.target as Node)) {
      const target = e.target as HTMLElement;
      if (target.closest('.nav-icon-btn')) return; // let the toggle button handle it
      if (target.closest('.color-picker-popover') || target.closest('.color-picker-backdrop')) return; // don't close when selecting colors
      activePopover = null;
    }
  }

  $effect(() => {
    if (activePopover) {
      document.addEventListener('mousedown', handlePopoverOutsideClick, true);
    }
    return () => {
      document.removeEventListener('mousedown', handlePopoverOutsideClick, true);
    };
  });

  // Notebook/Folder state
  let newNotebookName = $state('');
  let showCreateInput = $state(false);

  function selectNotebook(notebook: string | null) {
    appState.activeNotebook = notebook;
    appState.activeTab = 'home';
    appState.selectedTag = null;
    popoverSubView = 'notes'; // Open notes list in the same popover
  }

  async function handleCreateNotebook(e: SubmitEvent) {
    e.preventDefault();
    if (!newNotebookName.trim()) return;
    await appState.createNotebook(newNotebookName);
    newNotebookName = '';
    showCreateInput = false;
  }

  function handleDeleteNotebook(notebook: string, event: Event) {
    event.stopPropagation();
    appState.showConfirmation({
      title: 'Delete Notebook',
      message: `Do you really want to delete folder "${notebook}" and all its notes? This action is permanent.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        await appState.deleteNotebook(notebook);
      }
    });
  }

  // Tag color state and palette
  const TAG_COLOR_PALETTE = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6',
    '#ec4899', '#f43f5e', '#78716c', '#64748b',
  ];

  let colorPickerTag = $state<string | null>(null);
  let colorPickerPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let customHexValue = $state('');
  let isCustomHexValid = $derived(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(customHexValue.trim()));
  let normalizedCustomHex = $derived(isCustomHexValid ? (customHexValue.trim().startsWith('#') ? customHexValue.trim() : '#' + customHexValue.trim()) : '');

  $effect(() => {
    if (colorPickerTag) {
      customHexValue = getTagColor(colorPickerTag) || '';
    }
  });

  function openColorPicker(tagName: string, event: Event) {
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    // Position color picker offset relative to button
    colorPickerPos = { x: rect.left - 180, y: rect.top };
    colorPickerTag = tagName;
  }

  function closeColorPicker() {
    colorPickerTag = null;
  }

  async function handleSetColor(tagName: string, color: string | null) {
    try {
      await appState.setTagColor(tagName, color);
      closeColorPicker();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to set tag color.', 'error');
    }
  }

  function getTagColor(tagName: string): string | undefined {
    return appState.tagColorMap.get(tagName.toLowerCase());
  }

  // Tag list count & navigation
  const sortedTags = $derived(
    [...appState.tags].sort((a: Tag, b: Tag) => a.name.localeCompare(b.name))
  );

  function getTagCount(tag: Tag): number {
    const normalized = tag.normalizedName || tag.name.toLowerCase();
    return appState.notes.filter(note => {
      const parsed = parseHtmlMetadata(note.content);
      return (parsed.meta.tags || []).map((t: string) => t.toLowerCase()).includes(normalized);
    }).length;
  }

  function handleTagClick(tagName: string) {
    if (appState.selectedTag === tagName) {
      appState.selectedTag = null;
    } else {
      appState.selectedTag = tagName;
      appState.activeNotebook = null;
      appState.activeTab = 'home';
    }
    popoverSubView = 'notes'; // Open notes list in the same popover
  }

  function handleDeleteTag(tagName: string, event: Event) {
    event.stopPropagation();
    const count = getTagCount({ name: tagName } as Tag);
    const message = count > 0 
      ? `Do you really want to delete tag "${tagName}"? This will remove it from ${count} note(s).`
      : `Do you really want to delete tag "${tagName}"?`;
      
    appState.showConfirmation({
      title: 'Delete Tag',
      message: message,
      confirmText: 'Delete',
      onConfirm: async () => {
        await appState.deleteTag(tagName);
        if (appState.selectedTag === tagName) {
          appState.selectedTag = null;
        }
      }
    });
  }

  async function handleRenameTag(tagName: string, event: Event) {
    event.stopPropagation();
    appState.showPrompt({
      title: 'Rename Tag',
      message: `Rename tag "${tagName}" to:`,
      value: tagName,
      placeholder: 'Tag name...',
      onConfirm: async (newName) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === tagName) return;
        
        const normalizedNew = trimmed.toLowerCase();
        const alreadyExists = appState.tags.some(t => (t.normalizedName || t.name.toLowerCase()) === normalizedNew);
        
        if (alreadyExists) {
          appState.showConfirmation({
            title: 'Merge Tags',
            message: `Tag "${trimmed}" already exists. Do you want to merge "${tagName}" into "${trimmed}"?`,
            confirmText: 'Merge',
            onConfirm: async () => {
              try {
                await appState.renameTag(tagName, trimmed);
                if (appState.selectedTag === tagName) {
                  appState.selectedTag = trimmed;
                }
                appState.showToast(`Tags merged successfully!`, 'success');
              } catch (e) {
                console.error(e);
                appState.showToast(`Failed to merge tags.`, 'error');
              }
            }
          });
          return;
        }
        
        try {
          await appState.renameTag(tagName, trimmed);
          if (appState.selectedTag === tagName) {
            appState.selectedTag = trimmed;
          }
          appState.showToast(`Tag renamed successfully!`, 'success');
        } catch (e) {
          console.error(e);
          appState.showToast(`Failed to rename tag.`, 'error');
        }
      }
    });
  }

  // Daily log notes
  async function handleDesktopDailyNote() {
    const today = new Date().toISOString().split('T')[0];
    const dailyPath = `Daily Notes/${today}.html`;
    const existing = appState.notes.find(n => n.path === dailyPath);
    if (existing) {
      appState.selectNote(existing.path);
    } else {
      await appState.storage.createDirectory('Daily Notes');
      const meta = {
        id: dailyPath,
        title: `Daily Log: ${today}`,
        tags: ['journal'],
        pinned: false,
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      };
      const initialContent = `<h1>Daily Log: ${today} 🗓️</h1><h2>💼 Work</h2><ul><li></li></ul><h2>🧘 Personal</h2><ul><li></li></ul>`;
      const htmlContent = generateHtmlNote(meta, initialContent);
      await appState.storage.writeNote(dailyPath, htmlContent);
      await appState.refreshNotes();
      appState.selectNote(dailyPath);
    }
    activePopover = null; // Close popover
  }

  function handleOpenSettings(tab: 'sync' | 'styling' | 'editor' | 'calculation') {
    appState.showSettings = true;
    appState.settingsActiveTab = tab;
  }

  $effect(() => {
    // Automatically close popover when activeNotePath changes
    const _path = appState.activeNotePath;
    activePopover = null;
  });
</script>

<header class="app-header flex-row">
  <!-- Left Side: Logo & Breadcrumbs -->
  <div class="header-left flex-row">
    <div class="logo-group flex-row" onclick={() => { appState.activeNotebook = null; appState.selectedTag = null; }} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') { appState.activeNotebook = null; appState.selectedTag = null; } }}>
      <GoogleLogo size={22} />
      <span class="logo-text">MyNotes</span>
    </div>

    <!-- Panel Collapse/Expand Toggles & Nav Icons -->
    <div class="panel-toggles flex-row" style="gap: var(--spacing-xs);">
      <div class="desktop-nav-popovers flex-row" style="gap: 2px;">
        <button 
          class="panel-toggle-btn flex-row nav-icon-btn" 
          class:active={activePopover === 'noteList'} 
          onclick={() => togglePopover('noteList')}
          title="Notes List"
        >
          <FileText size={15} style={activePopover === 'noteList' ? 'fill: currentColor;' : ''} />
        </button>
        <button 
          class="panel-toggle-btn flex-row nav-icon-btn" 
          class:active={activePopover === 'favorites'} 
          onclick={() => togglePopover('favorites')}
          title="Favorites"
        >
          <Star size={15} style={activePopover === 'favorites' ? 'fill: currentColor;' : ''} />
        </button>
        <button 
          class="panel-toggle-btn flex-row nav-icon-btn" 
          class:active={activePopover === 'notebooks'} 
          onclick={() => togglePopover('notebooks')}
          title="Notebooks"
        >
          <Folder size={15} style={activePopover === 'notebooks' ? 'fill: currentColor;' : ''} />
        </button>
        <button 
          class="panel-toggle-btn flex-row nav-icon-btn" 
          class:active={activePopover === 'tags'} 
          onclick={() => togglePopover('tags')}
          title="Tags"
        >
          <TagIcon size={15} style={activePopover === 'tags' ? 'fill: currentColor;' : ''} />
        </button>
        <button 
          class="panel-toggle-btn flex-row nav-icon-btn" 
          class:active={activePopover === 'dailyLogs'} 
          onclick={() => togglePopover('dailyLogs')}
          title="Daily Logs"
        >
          <Calendar size={15} style={activePopover === 'dailyLogs' ? 'fill: currentColor;' : ''} />
        </button>
      </div>
    </div>
    
    <div class="breadcrumb-divider"></div>
    
    <div class="breadcrumbs flex-row">
      <!-- Active Context -->
      {#if appState.selectedTag}
        <div class="breadcrumb-item flex-row">
          <TagIcon size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">#{appState.selectedTag}</span>
        </div>
      {:else if appState.activeNotebook}
        <div class="breadcrumb-item flex-row">
          <Folder size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">{appState.activeNotebook}</span>
        </div>
      {:else if appState.activeNotePath?.startsWith('Daily Notes/')}
        <div class="breadcrumb-item flex-row">
          <Calendar size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">Daily Logs</span>
        </div>
      {:else}
        <div class="breadcrumb-item flex-row">
          <FileText size={14} class="breadcrumb-icon" />
          <span class="breadcrumb-label">All Notes</span>
        </div>
      {/if}

      <!-- Active Note Title -->
      {#if appState.activeNoteTitle}
        <ChevronRight size={14} class="breadcrumb-chevron" />
        <span class="breadcrumb-title" title={appState.activeNoteTitle}>
          {appState.activeNoteTitle}
        </span>
      {/if}
    </div>
  </div>

  <div class="header-center">
    <button 
      class="search-box flex-row" 
      onclick={() => appState.showCommandPalette = true}
      aria-label="Search notes"
      style="cursor: pointer; text-align: left; justify-content: space-between; align-items: center; outline: none; font-family: inherit;"
    >
      <div class="flex-row" style="gap: var(--spacing-2xs); align-items: center;">
        <Search size={14} class="search-box-icon" />
        <span style="color: var(--text-tertiary); font-size: var(--font-size-sm); font-weight: 500;">Search notes...</span>
      </div>
      <span class="search-box-shortcut">⌘K</span>
    </button>
  </div>

  <!-- Right Side: Action Controls & Status -->
  <div class="header-right flex-row">
    <!-- Quick Create Button Wrapper -->
    <div class="quick-create-wrapper" style="position: relative; display: flex; align-items: center; border-radius: var(--radius-standard); overflow: visible; background-color: var(--accent);">
      <button 
        class="quick-create-btn main-btn flex-row" 
        onclick={handleCreateNote}
        title="Create new text/sketch note"
        aria-label="Create new note"
        style="border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: 1px solid rgba(255,255,255,0.25);"
      >
        <Plus size={16} />
        <span>New Note</span>
      </button>
      <button
        class="quick-create-btn arrow-btn flex-row"
        onclick={() => showCreateDropdown = !showCreateDropdown}
        title="More creation options"
        aria-label="More creation options"
        style="border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 0 var(--spacing-xs); height: 32px;"
      >
        <ChevronDown size={14} />
      </button>

      {#if showCreateDropdown}
        <div 
          class="create-dropdown"
          bind:this={dropdownEl}
          style="position: absolute; top: 100%; right: 0; margin-top: 6px; background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-standard); box-shadow: var(--shadow-md); z-index: 1000; min-width: 260px; padding: var(--spacing-2xs) 0;"
        >
          <button 
            class="dropdown-item flex-row"
            onclick={() => { handleCreateNote(); showCreateDropdown = false; }}
            style="width: 100%; text-align: left; padding: var(--spacing-sm) var(--spacing-md); background: none; border: none; font-family: inherit; font-size: var(--font-size-sm); color: var(--text-primary); cursor: pointer; gap: var(--spacing-sm); align-items: center;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-mid-dark)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <FileText size={16} style="color: var(--text-secondary); flex-shrink: 0;" />
            <div class="flex-col" style="align-items: flex-start; gap: 2px;">
              <span style="font-weight: 600;">New HTML Note</span>
              <span style="font-size: var(--font-size-2xs); color: var(--text-tertiary); white-space: nowrap;">Rich text, checkboxes, sketch pad</span>
            </div>
          </button>
          <button 
            class="dropdown-item flex-row"
            onclick={() => { handleCreateNotebookNote(); showCreateDropdown = false; }}
            style="width: 100%; text-align: left; padding: var(--spacing-sm) var(--spacing-md); background: none; border: none; font-family: inherit; font-size: var(--font-size-sm); color: var(--text-primary); cursor: pointer; gap: var(--spacing-sm); align-items: center; border-top: 1px solid var(--border-color);"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-mid-dark)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <BookOpen size={16} style="color: var(--accent); flex-shrink: 0;" />
            <div class="flex-col" style="align-items: flex-start; gap: 2px;">
              <span style="font-weight: 600; color: var(--accent);">New Handwriting Notebook</span>
              <span style="font-size: var(--font-size-2xs); color: var(--text-tertiary); white-space: nowrap;">Multi-page vertical scroll card engine</span>
            </div>
          </button>
        </div>
      {/if}
    </div>

    <div class="right-divider"></div>

    <!-- Sync status badge + popover anchor -->
    <div class="sync-popover-anchor">
      <button 
        class="sync-status-btn flex-row" 
        onclick={() => { showSyncPopover = !showSyncPopover; }}
        title="Sync & Account"
        aria-label="Sync & Account: {appState.googleConnected && appState.syncEnabled ? appState.syncStatus : 'disabled'}"
        aria-expanded={showSyncPopover}
        aria-haspopup="dialog"
      >
        {#if appState.googleConnected && appState.syncEnabled}
          {#if appState.syncStatus === 'syncing'}
            <Cloud size={16} class="sync-icon pulse-icon" style="color: var(--accent);" />
            <span class="status-indicator syncing">Syncing</span>
          {:else if appState.syncStatus === 'error'}
            <Cloud size={16} class="sync-icon" style="color: var(--semantic-error);" />
            <span class="status-indicator error">Sync Error</span>
          {:else}
            <Cloud size={16} class="sync-icon" style="color: var(--semantic-success);" />
            <span class="status-indicator synced">Synced</span>
          {/if}
        {:else}
          <CloudOff size={16} class="sync-icon" style="color: var(--text-tertiary);" />
          <span class="status-indicator disabled">Sync Off</span>
        {/if}
        <span class="sr-only" role="status" aria-live="polite">
          Sync status changed to {appState.googleConnected && appState.syncEnabled ? appState.syncStatus : 'Sync Off'}
        </span>
      </button>

      {#if showSyncPopover}
        <SyncPopover onclose={() => { showSyncPopover = false; }} />
      {/if}
    </div>

    <!-- Global Preferences Settings button -->
    <button 
      class="settings-btn flex-row" 
      onclick={() => handleOpenSettings('styling')}
      title="Open settings"
      aria-label="Open settings"
    >
      <Settings size={18} />
    </button>
  </div>
</header>

<CommandPalette />

{#if activePopover}
  <!-- Floating Navigation Popover -->
  <div 
    class="header-navigation-popover flex-col"
    class:popover-notelist={activePopover === 'noteList' || popoverSubView === 'notes'}
    bind:this={popoverContainer}
    transition:fade={{ duration: 150 }}
  >
    {#if activePopover === 'noteList'}
      <!-- Notes List Content -->
      <div class="popover-section flex-col" style="padding: 0; width: 100%; height: 100%;">
        <NoteList isPopover={true} onNoteSelect={() => activePopover = null} />
      </div>
    {:else if activePopover === 'favorites'}
      <!-- Favorites Content -->
      <div class="popover-section flex-col">
        <span class="popover-title flex-row"><Star size={14} style="margin-right: var(--spacing-xs); fill: currentColor;" /> Favorites</span>
        <div class="popover-list flex-col scroll-y">
          {#each appState.notes.filter(n => appState.favorites.includes(n.path)) as note}
            <button 
              class="popover-item flex-row" 
              class:active={appState.activeNotePath === note.path}
              onclick={() => { appState.selectNote(note.path); appState.activeTab = 'home'; activePopover = null; }}
            >
              <span class="emoji-indicator">⭐</span>
              <span class="item-label text-ellipsis">{note.name}</span>
            </button>
          {:else}
            <div class="popover-empty flex-col">
              <Star size={18} style="opacity: 0.5; margin-bottom: 4px;" />
              <span>No favorite notes</span>
            </div>
          {/each}
        </div>
      </div>

    {:else if activePopover === 'notebooks'}
      <!-- Notebooks Content -->
      {#if popoverSubView === 'notes'}
        <div class="popover-section flex-col" style="padding: 0; width: 100%; height: 100%;">
          <NoteList isPopover={true} onNoteSelect={() => activePopover = null} showBack={true} onBack={() => popoverSubView = 'list'} />
        </div>
      {:else}
        <div class="popover-section flex-col">
          <span class="popover-title flex-row"><Folder size={14} style="margin-right: var(--spacing-xs); fill: currentColor;" /> Notebooks</span>
          
          <form onsubmit={handleCreateNotebook} class="popover-create-form flex-row">
            <input 
              type="text" 
              placeholder="New notebook name..." 
              bind:value={newNotebookName}
              class="popover-create-input"
              required
            />
            <button type="submit" class="popover-create-btn" title="Create notebook"><Plus size={14} /></button>
          </form>

          <div class="popover-list flex-col scroll-y">
            <button 
              class="popover-item flex-row" 
              class:active={appState.activeNotebook === null && !appState.activeNotePath?.startsWith('Daily Notes/')}
              onclick={() => selectNotebook(null)}
            >
              <span class="emoji-indicator">📖</span>
              <span class="item-label text-ellipsis">All Notes</span>
              <span class="count-badge">{appState.notes.length}</span>
            </button>

            {#each appState.notebooks as notebook}
              <div 
                class="popover-item flex-row" 
                class:active={appState.activeNotebook === notebook}
                role="button"
                tabindex="0"
                onclick={() => selectNotebook(notebook)}
                onkeydown={(e) => e.key === 'Enter' && selectNotebook(notebook)}
              >
                <span class="emoji-indicator">📂</span>
                <span class="item-label text-ellipsis">{notebook}</span>
                <button 
                  class="popover-action-btn delete-btn" 
                  onclick={(e) => { e.stopPropagation(); handleDeleteNotebook(notebook, e); }}
                  title="Delete Notebook"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

    {:else if activePopover === 'tags'}
      <!-- Tags Content -->
      {#if popoverSubView === 'notes'}
        <div class="popover-section flex-col" style="padding: 0; width: 100%; height: 100%;">
          <NoteList isPopover={true} onNoteSelect={() => activePopover = null} showBack={true} onBack={() => popoverSubView = 'list'} />
        </div>
      {:else}
        <div class="popover-section flex-col">
          <span class="popover-title flex-row"><TagIcon size={14} style="margin-right: var(--spacing-xs); fill: currentColor;" /> Tags</span>
          <div class="popover-list flex-col scroll-y">
            {#each sortedTags as tag}
              {@const count = getTagCount(tag)}
              {@const tagColor = getTagColor(tag.name)}
              <div 
                class="popover-item flex-row tag-item" 
                class:active={appState.selectedTag === tag.name}
                onclick={() => handleTagClick(tag.name)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && handleTagClick(tag.name)}
              >
                <span 
                  class="tag-color-indicator" 
                  style="background-color: {tagColor || 'var(--bg-mid-dark)'}; color: {tagColor ? '#ffffff' : 'inherit'};"
                >
                  #
                </span>
                <span class="item-label text-ellipsis">{tag.name}</span>
                <span class="count-badge" style={tagColor ? `background-color: ${tagColor}22; color: ${tagColor};` : ''}>{count}</span>
                
                <div class="tag-actions flex-row" onclick={(e) => e.stopPropagation()}>
                  <button 
                    class="popover-action-btn color-btn" 
                    onclick={(e) => openColorPicker(tag.name, e)}
                    title="Choose Color"
                  >
                    <Palette size={12} />
                  </button>
                  <button 
                    class="popover-action-btn edit-btn" 
                    onclick={(e) => handleRenameTag(tag.name, e)}
                    title="Rename"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button 
                    class="popover-action-btn delete-btn" 
                    onclick={(e) => handleDeleteTag(tag.name, e)}
                    title="Delete Tag"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            {:else}
              <div class="popover-empty flex-col">
                <TagIcon size={18} style="opacity: 0.5; margin-bottom: 4px;" />
                <span>No tags found</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

    {:else if activePopover === 'dailyLogs'}
      <!-- Daily Logs Content -->
      <div class="popover-section flex-col">
        <span class="popover-title flex-row"><Calendar size={14} style="margin-right: var(--spacing-xs); fill: currentColor;" /> Daily Logs</span>
        
        <button class="popover-create-action-btn flex-row" onclick={handleDesktopDailyNote}>
          <Plus size={14} style="margin-right: 6px;" />
          <span>Create/Open Today's Log</span>
        </button>

        <div class="popover-list flex-col scroll-y" style="max-height: 240px;">
          {#each appState.notes.filter(n => n.path.startsWith('Daily Notes/')).sort((a, b) => (b.name || '').localeCompare(a.name || '')) as note}
            <div 
              class="popover-item flex-row" 
              class:active={appState.activeNotePath === note.path}
              role="button"
              tabindex="0"
              onclick={() => { appState.selectNote(note.path); appState.activeTab = 'home'; activePopover = null; }}
              onkeydown={(e) => e.key === 'Enter' && (appState.selectNote(note.path), appState.activeTab = 'home', activePopover = null)}
            >
              <span class="emoji-indicator">🗓️</span>
              <span class="item-label text-ellipsis">{note.name}</span>
              <button 
                class="popover-action-btn delete-btn" 
                onclick={(e) => { 
                  e.stopPropagation(); 
                  appState.showConfirmation({
                    title: 'Delete Daily Log',
                    message: 'Do you really want to delete this daily log? This action is permanent.',
                    confirmText: 'Delete',
                    onConfirm: async () => {
                      await appState.deleteNote(note.path);
                    }
                  });
                }}
                title="Delete Log"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {:else}
            <div class="popover-empty flex-col">
              <Calendar size={18} style="opacity: 0.5; margin-bottom: 4px;" />
              <span>No daily logs found</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- Tag Color Picker Popover (drawn over main popovers if active) -->
{#if colorPickerTag}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    class="color-picker-backdrop"
    onclick={closeColorPicker}
    onkeydown={(e) => e.key === 'Escape' && closeColorPicker()}
  ></div>
  <div class="color-picker-popover" style="left: {colorPickerPos.x}px; top: {colorPickerPos.y}px;">
    <div class="color-picker-header">
      <span style="font-size: var(--font-size-xs); font-weight: 600; color: var(--text-secondary);">Tag Color</span>
    </div>
    <div class="color-picker-grid">
      {#each TAG_COLOR_PALETTE as color}
        {@const isActive = getTagColor(colorPickerTag) === color}
        <button 
          class="color-swatch" 
          class:active={isActive}
          style="background-color: {color};"
          onclick={() => handleSetColor(colorPickerTag ?? '', color)}
          aria-label="Set color to {color}"
        >
          {#if isActive}<span class="swatch-check">✓</span>{/if}
        </button>
      {/each}
    </div>
    <div class="custom-hex-container flex-row" style="margin: var(--spacing-xs) 0; gap: var(--spacing-xs); align-items: center; border-top: 1px dashed color-mix(in srgb, var(--text-primary) 8%, transparent); padding-top: var(--spacing-xs); width: 100%;">
      <div class="color-preview-circle" style="width: 14px; height: 14px; border-radius: 50%; background-color: {normalizedCustomHex || 'transparent'}; border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent); flex-shrink: 0;"></div>
      <input 
        type="text" 
        placeholder="#HEX" 
        bind:value={customHexValue}
        style="flex: 1; min-width: 50px; padding: var(--spacing-3xs) var(--spacing-xs); font-size: var(--font-size-xs); background: color-mix(in srgb, var(--text-primary) 6%, transparent); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); outline: none;"
      />
      <button 
        type="button" 
        disabled={!isCustomHexValid}
        onclick={() => handleSetColor(colorPickerTag ?? '', normalizedCustomHex)}
        style="padding: var(--spacing-3xs) var(--spacing-xs); font-size: var(--font-size-xs); cursor: pointer; opacity: {isCustomHexValid ? 1 : 0.5}; background: var(--accent); border: none; border-radius: 4px; color: var(--text-primary); font-weight: 600;"
      >
        Set
      </button>
    </div>
    <button class="color-reset-btn" onclick={() => handleSetColor(colorPickerTag ?? '', null)}>
      <X size={12} />
      <span>Reset Color</span>
    </button>
  </div>
{/if}

<style>
  .app-header {
    height: var(--header-height);
    background-color: var(--bg-surface);
    border-bottom: var(--panel-border-width) solid var(--border-color);
    padding: 0 var(--spacing-md);
    justify-content: space-between;
    box-sizing: border-box;
    z-index: var(--z-index-header);
    position: relative;
    user-select: none;
    width: 100%;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  /* Left Branding / Breadcrumbs */
  .header-left {
    gap: var(--spacing-md);
    flex: 1;
    min-width: 0;
  }

  .panel-toggles {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--spacing-2xs);
    margin-left: var(--spacing-xs);
    flex-shrink: 0;
  }

  .panel-toggle-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: var(--radius-standard);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
    justify-content: center;
    display: flex;
    align-items: center;
  }

  .panel-toggle-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  .panel-toggle-btn.collapsed {
    color: var(--text-tertiary);
  }

  .logo-group {
    gap: var(--spacing-xs);
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .logo-group:hover {
    opacity: 0.85;
  }

  .logo-text {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.2px;
    color: var(--text-primary);
  }

  .breadcrumb-divider {
    width: 1px;
    height: 16px;
    background-color: var(--border-color);
    flex-shrink: 0;
  }

  .breadcrumbs {
    gap: var(--spacing-xs);
    min-width: 0;
    flex: 1;
  }

  .breadcrumb-item {
    gap: var(--spacing-2xs);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    flex-shrink: 0;
  }

  .breadcrumb-icon {
    color: var(--text-tertiary);
  }

  .breadcrumb-chevron {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .breadcrumb-title {
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Center Search Box */
  .header-center {
    flex: 0 1 360px;
    margin: 0 var(--spacing-md);
  }

  .search-box {
    position: relative;
    background-color: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: 0 var(--spacing-xs);
    height: 32px;
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard),
                box-shadow var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .search-box:hover {
    border-color: var(--border-highlight);
  }

  .search-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .search-box-icon {
    color: var(--text-tertiary);
    margin-right: var(--spacing-2xs);
    flex-shrink: 0;
  }

  .search-box-input {
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--font-size-sm);
    outline: none;
    width: 100%;
    height: 100%;
    padding: 0;
  }

  .search-box-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-box-clear {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-2xs);
    border-radius: var(--radius-circle);
    flex-shrink: 0;
  }

  .search-box-clear:hover {
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
  }

  .search-box-shortcut {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-subtle);
    padding: var(--spacing-3xs) var(--spacing-2xs);
    flex-shrink: 0;
  }

  /* Right Action Controls */
  .header-right {
    gap: var(--spacing-md);
    flex-shrink: 0;
  }

  .quick-create-btn {
    gap: var(--spacing-xs);
    background-color: var(--accent);
    color: var(--bg-base); /* Contrast on accent color */
    border: none;
    border-radius: var(--radius-standard);
    height: 32px;
    padding: 0 var(--spacing-sm);
    font-family: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .quick-create-btn:hover {
    background-color: var(--accent-hover);
  }

  .quick-create-btn:active {
    background-color: var(--accent-active);
  }

  .right-divider {
    width: 1px;
    height: 20px;
    background-color: var(--border-color);
  }

  .sync-popover-anchor {
    position: relative;
  }

  .sync-status-btn {
    gap: var(--spacing-xs);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--spacing-2xs) var(--spacing-xs);
    border-radius: var(--radius-standard);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .sync-status-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }

  .status-indicator {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
  }

  .status-indicator.syncing {
    color: var(--accent);
  }

  .status-indicator.error {
    color: var(--semantic-error);
  }

  .status-indicator.synced {
    color: var(--semantic-success);
  }

  .status-indicator.disabled {
    color: var(--text-tertiary);
  }

  .settings-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-2xs);
    border-radius: var(--radius-standard);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
    justify-content: center;
  }

  .settings-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  /* Utility animations */
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.95); }
  }

  :global(.pulse-icon) {
    animation: pulse 1.8s infinite ease-in-out;
  }

  @media (max-width: 768px) {
    .quick-create-wrapper {
      display: none !important;
    }
  }

  /* Desktop Header Navigation Popovers Styles */
  .panel-toggle-btn.nav-icon-btn.active {
    background-color: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .header-navigation-popover {
    position: absolute;
    top: calc(var(--header-height) + 6px);
    left: 140px;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    box-shadow: var(--shadow-heavy);
    z-index: 1000;
    width: 290px;
    max-height: 420px;
    backdrop-filter: blur(20px);
    overflow: hidden;
    animation: popoverFadeIn 0.15s ease-out;
  }

  .header-navigation-popover.popover-notelist {
    width: 360px;
  }

  @keyframes popoverFadeIn {
    from { opacity: 0; transform: scale(0.97) translateY(-6px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .popover-section {
    padding: var(--spacing-md);
    width: 100%;
    box-sizing: border-box;
  }

  .popover-title {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--spacing-xs);
    align-items: center;
    width: 100%;
  }

  .popover-list {
    gap: 4px;
    overflow-y: auto;
    max-height: 300px;
    width: 100%;
  }

  .popover-item {
    display: flex;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 8px var(--spacing-sm);
    border-radius: 6px;
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    font-family: inherit;
    font-size: var(--font-size-xs);
    gap: var(--spacing-xs);
    position: relative;
    box-sizing: border-box;
  }

  .popover-item:hover {
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
  }

  .popover-item.active {
    background-color: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-weight: 600;
  }

  .emoji-indicator {
    width: 18px;
    text-align: center;
    flex-shrink: 0;
  }

  .item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count-badge {
    font-size: var(--font-size-2xs);
    font-weight: 700;
    background-color: var(--bg-mid-dark);
    color: var(--text-secondary);
    padding: 2px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .popover-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background-color 0.15s;
  }

  .popover-action-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
  }

  .popover-action-btn.delete-btn:hover {
    color: var(--semantic-error);
  }

  .popover-create-form {
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-sm);
    width: 100%;
    box-sizing: border-box;
  }

  .popover-create-input {
    flex: 1;
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    background-color: color-mix(in srgb, var(--text-primary) 4%, transparent);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    border-radius: 6px;
    outline: none;
    min-width: 0;
  }

  .popover-create-btn {
    background-color: var(--accent);
    border: none;
    color: #ffffff;
    padding: 6px var(--spacing-xs);
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .popover-create-btn:hover {
    opacity: 0.9;
  }

  .popover-create-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    background-color: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px dashed var(--accent);
    color: var(--accent);
    padding: var(--spacing-sm);
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: var(--font-size-xs);
    margin-bottom: var(--spacing-sm);
    transition: background-color 0.15s;
    box-sizing: border-box;
  }

  .popover-create-action-btn:hover {
    background-color: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .tag-actions {
    opacity: 0;
    transition: opacity 0.15s;
    gap: 2px;
    margin-left: var(--spacing-xs);
    flex-shrink: 0;
  }

  .popover-item.tag-item:hover .tag-actions {
    opacity: 1;
  }

  .tag-color-indicator {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: bold;
    flex-shrink: 0;
  }

  .popover-empty {
    padding: var(--spacing-lg) var(--spacing-md);
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    width: 100%;
    box-sizing: border-box;
  }

  /* Tag Color Picker Popover styles */
  .color-picker-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9998;
  }

  .color-picker-popover {
    position: fixed;
    z-index: 9999;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: var(--spacing-sm);
    box-shadow: var(--shadow-heavy), 0 0 0 1px color-mix(in srgb, var(--text-primary) 5%, transparent);
    min-width: 160px;
    backdrop-filter: blur(20px);
    animation: colorPickerFadeIn 0.15s ease-out;
  }

  @keyframes colorPickerFadeIn {
    from { opacity: 0; transform: scale(0.95) translateY(-4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .color-picker-header {
    margin-bottom: var(--spacing-xs);
    padding-bottom: var(--spacing-xs);
    border-bottom: 1px solid var(--border-color);
  }

  .color-picker-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-xs);
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    padding: 0;
  }

  .color-swatch:hover {
    transform: scale(1.15);
    box-shadow: var(--shadow-medium);
  }

  .color-swatch.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-primary) 20%, transparent);
  }

  .swatch-check {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 700;
    text-shadow: 0 1px 2px color-mix(in srgb, var(--bg-base) 50%, transparent);
  }

  .color-reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    width: 100%;
    padding: var(--spacing-xs);
    border: none;
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .color-reset-btn:hover {
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
  }
</style>
