<script lang="ts">
  import { appState, generateHtmlNote, parseHtmlMetadata } from '../stores/appState.svelte';
  import type { Tag } from '../storage/TagSchema';
  import { Folder, Plus, Trash2, Calendar, Settings, Library, Palette, FolderOpen, X, ChevronRight, FileText, Download, Cloud, RefreshCw, CloudOff, Tag as TagIcon, Edit2, Star, Target, Wallet, Calculator, PenTool } from 'lucide-svelte';
  import GoogleLogo from './GoogleLogo.svelte';

  let newNotebookName = $state('');
  let showCreateInput = $state(false);

  function selectNotebook(notebook: string | null) {
    appState.activeNotebook = notebook;
    appState.activeTab = 'home';
    appState.selectedTag = null;
  }

  async function handleDesktopDailyNote() {
    const today = new Date().toISOString().split('T')[0];
    const dailyPath = `Daily Notes/${today}.html`;
    
    // Check if it already exists
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
  }

  let fileInput: HTMLInputElement;

  function triggerImport() {
    fileInput?.click();
  }

  async function handleImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      
      if (!bundle.title || !bundle.content) {
        appState.showToast('Invalid .mynote file format. Missing title or content.', 'error', 4000);
        return;
      }
      
      const cleanTitle = bundle.title.trim();
      let path = `${cleanTitle}.html`;
      const folder = appState.activeNotebook;
      if (folder) {
        path = `${folder}/${cleanTitle}.html`;
      }
      
      let version = 1;
      let finalPath = path;
      while (appState.notes.some(n => n.path === finalPath)) {
        finalPath = folder 
          ? `${folder}/${cleanTitle} (${version}).html`
          : `${cleanTitle} (${version}).html`;
        version++;
      }
      
      const meta = {
        id: bundle.id || finalPath,
        title: cleanTitle,
        tags: bundle.tags || [],
        pinned: bundle.pinned || false,
        created: bundle.created ? new Date(bundle.created).toISOString() : new Date().toISOString(),
        modified: new Date().toISOString()
      };
      
      const fileContent = generateHtmlNote(meta, bundle.content);
      
      await appState.storage.writeNote(finalPath, fileContent);
      await appState.refreshNotes();
      appState.selectNote(finalPath);
      appState.showToast(`Imported note "${cleanTitle}" successfully!`, 'success');
    } catch (e) {
      console.error('Failed to import note:', e);
      appState.showToast('Failed to parse and import note file.', 'error', 4000);
    } finally {
      input.value = '';
    }
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

  let favoritesCollapsed = $state(localStorage.getItem('mynotes_sidebar_favorites_collapsed') === 'true');
  let notebooksCollapsed = $state(localStorage.getItem('mynotes_sidebar_notebooks_collapsed') === 'true');
  let tagsCollapsed = $state(localStorage.getItem('mynotes_sidebar_tags_collapsed') === 'true');
  let dailyCollapsed = $state(localStorage.getItem('mynotes_sidebar_daily_collapsed') === 'true');

  function toggleFavorites() {
    favoritesCollapsed = !favoritesCollapsed;
    localStorage.setItem('mynotes_sidebar_favorites_collapsed', String(favoritesCollapsed));
  }
  function toggleNotebooks() {
    notebooksCollapsed = !notebooksCollapsed;
    localStorage.setItem('mynotes_sidebar_notebooks_collapsed', String(notebooksCollapsed));
  }
  function toggleTags() {
    tagsCollapsed = !tagsCollapsed;
    localStorage.setItem('mynotes_sidebar_tags_collapsed', String(tagsCollapsed));
  }
  function toggleDaily() {
    dailyCollapsed = !dailyCollapsed;
    localStorage.setItem('mynotes_sidebar_daily_collapsed', String(dailyCollapsed));
  }

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

  // ST-010: Tag Color Picker
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
    colorPickerPos = { x: rect.right + 8, y: rect.top };
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
</script>

<div 
  id="sidebar-panel"
  class="sidebar flex-col" 
  class:collapsed={appState.sidebarCollapsed}
  style="width: {appState.sidebarCollapsed ? 0 : appState.sidebarWidth}px;"
  tabindex={appState.sidebarCollapsed ? -1 : 0}
>
  <!-- Collapsible Section Lists -->

  <!-- Favorites Section -->
  <div class="section-container flex-col starred-container" style="flex: 0.6; margin-bottom: var(--spacing-sm); max-height: 200px;">
    <div 
      class="section-header flex-row"
      role="button"
      tabindex="0"
      onclick={toggleFavorites}
      onkeydown={(e) => e.key === 'Enter' && toggleFavorites()}
      style="cursor: pointer; justify-content: space-between; width: 100%;"
    >
      <div class="flex-row" style="flex-grow: 1;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="sec-icon" style="color: var(--accent); margin-right: var(--spacing-xs);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        <span class="section-title">Favorites</span>
      </div>
      <div class="section-header-arrow" class:collapsed={favoritesCollapsed} style="display: flex; align-items: center; color: var(--text-secondary);">
        <ChevronRight size={16} />
      </div>
    </div>
    
    {#if !favoritesCollapsed}
      <div class="list-scroll">
        {#each appState.notes.filter(n => appState.favorites.includes(n.path)) as note}
          <div 
            class="nav-item flex-row" 
            class:active={appState.activeNotePath === note.path}
            role="button"
            tabindex="0"
            onclick={() => { appState.selectNote(note.path); appState.activeTab = 'home'; }}
            onkeydown={(e) => e.key === 'Enter' && (appState.selectNote(note.path), appState.activeTab = 'home')}
            style="padding: var(--spacing-xs) var(--spacing-xs); gap: var(--spacing-xs);"
          >
            <div class="playlist-art" style="width: 28px; height: 28px; font-size: var(--font-size-sm);">⭐</div>
            <div class="nav-text flex-col">
              <span class="title" style="font-size: var(--font-size-xs);">{note.name}</span>
            </div>
          </div>
        {:else}
          <div class="empty-sidebar-section">
            <Star size={14} class="empty-icon" />
            <span>No favorite notes</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>


  <!-- Main Library Section -->
  <div class="section-container flex-col">
    <div 
      class="section-header flex-row"
      style="justify-content: space-between; width: 100%;"
    >
      <div 
        class="flex-row" 
        style="flex-grow: 1; cursor: pointer;"
        onclick={toggleNotebooks}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && toggleNotebooks()}
      >
        <Library size={18} class="sec-icon" />
        <span class="section-title">Notebooks</span>
      </div>
      <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; color: var(--text-secondary);">
        <button class="add-btn flex-row" onclick={(e) => { e.stopPropagation(); showCreateInput = !showCreateInput; }} aria-label="Add notebook">
          <Plus size={16} />
        </button>
        <div 
          class="section-header-arrow" 
          class:collapsed={notebooksCollapsed} 
          onclick={toggleNotebooks}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && toggleNotebooks()}
          style="display: flex; align-items: center; cursor: pointer;"
        >
          <ChevronRight size={16} />
        </div>
      </div>
    </div>

    {#if !notebooksCollapsed}
      {#if showCreateInput}
        <form onsubmit={handleCreateNotebook} class="create-form">
          <input 
            type="text" 
            placeholder="New Notebook..." 
            bind:value={newNotebookName}
            class="create-input"
            required
            autofocus
          />
        </form>
      {/if}

      <div class="list-scroll">
        <div 
          class="nav-item flex-row" 
          class:active={appState.activeNotebook === null && !appState.activeNotePath?.startsWith('Daily Notes/')}
          role="button"
          tabindex="0"
          onclick={() => selectNotebook(null)}
          onkeydown={(e) => e.key === 'Enter' && selectNotebook(null)}
        >
          <div class="playlist-art">⭐</div>
          <div class="nav-text flex-col">
            <span class="title">All Notes</span>
            <span class="subtitle">{appState.notes.length} notes</span>
          </div>
        </div>

        {#each appState.notebooks as notebook}
          <div 
            class="nav-item flex-row" 
            class:active={appState.activeNotebook === notebook}
            role="button"
            tabindex="0"
            onclick={() => selectNotebook(notebook)}
            onkeydown={(e) => e.key === 'Enter' && selectNotebook(notebook)}
          >
            <div class="playlist-art">📂</div>
            <div class="nav-text flex-col">
              <span class="title">{notebook}</span>
              <span class="subtitle">Notebook</span>
            </div>
            <button 
              class="item-delete-btn" 
              onclick={(e) => handleDeleteNotebook(notebook, e)}
              aria-label="Delete notebook"
            >
              <Trash2 size={14} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Tags Section -->
  <div class="section-container flex-col tags-container" style="flex: 0.8; margin-bottom: var(--spacing-sm);">
    <div 
      class="section-header flex-row" 
      role="button"
      tabindex="0"
      onclick={() => tagsCollapsed = !tagsCollapsed}
      onkeydown={(e) => e.key === 'Enter' && (tagsCollapsed = !tagsCollapsed)}
      style="cursor: pointer; justify-content: space-between; width: 100%;"
    >
      <div class="flex-row" style="flex-grow: 1;">
        <TagIcon size={18} class="sec-icon" />
        <span class="section-title">Tags</span>
      </div>
      <div class="section-header-arrow" class:collapsed={tagsCollapsed} style="display: flex; align-items: center; color: var(--text-secondary);">
        <ChevronRight size={16} />
      </div>
    </div>

    {#if !tagsCollapsed}
      <div class="list-scroll">
        {#each sortedTags as tag}
          {@const count = getTagCount(tag)}
          {@const tagColor = getTagColor(tag.name)}
          <div 
            class="nav-item flex-row" 
            class:active={appState.selectedTag === tag.name}
            role="button"
            tabindex="0"
            onclick={() => handleTagClick(tag.name)}
            onkeydown={(e) => e.key === 'Enter' && handleTagClick(tag.name)}
            style="padding: var(--spacing-xs) var(--spacing-xs); gap: var(--spacing-xs); cursor: pointer;"
          >
            <div class="playlist-art" style="width: 28px; height: 28px; font-size: var(--font-size-sm); background-color: {tagColor ? tagColor + '33' : 'var(--bg-mid-dark)'}; color: {tagColor || 'inherit'};">#</div>
            <div class="nav-text flex-col">
              <span class="title" style="font-size: var(--font-size-xs); font-weight: 600;">{tag.name}</span>
            </div>
            <span class="tag-count-badge" style={tagColor ? `background-color: ${tagColor}33; color: ${tagColor}` : ''}>{count}</span>
            <button 
              class="tag-color-btn" 
              onclick={(e) => openColorPicker(tag.name, e)}
              aria-label="Set tag color"
              title="Set tag color"
            >
              <Palette size={13} />
            </button>
            <button 
              class="tag-rename-btn" 
              onclick={(e) => handleRenameTag(tag.name, e)}
              aria-label="Rename tag"
              title="Rename tag"
            >
              <Edit2 size={13} />
            </button>
            <button 
              class="tag-delete-btn" 
              onclick={(e) => handleDeleteTag(tag.name, e)}
              aria-label="Delete tag"
              title="Delete tag"
            >
              <Trash2 size={13} />
            </button>
          </div>
        {:else}
          <div class="empty-sidebar-section">
            <TagIcon size={14} class="empty-icon" />
            <span>No tags found</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ST-010: Tag Color Picker Popover -->
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

  <!-- Daily Logs Section -->
  <div class="section-container flex-col daily-container">
    <div 
      class="section-header flex-row"
      style="justify-content: space-between; width: 100%;"
    >
      <div 
        class="flex-row" 
        style="flex-grow: 1; cursor: pointer;"
        onclick={toggleDaily}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && toggleDaily()}
      >
        <Calendar size={18} class="sec-icon" />
        <span class="section-title">Daily Logs</span>
      </div>
      <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; color: var(--text-secondary);">
        <button class="add-btn flex-row" onclick={(e) => { e.stopPropagation(); handleDesktopDailyNote(); }} aria-label="Create/Open today's note">
          <Plus size={16} />
        </button>
        <div 
          class="section-header-arrow" 
          class:collapsed={dailyCollapsed} 
          onclick={toggleDaily}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && toggleDaily()}
          style="display: flex; align-items: center; cursor: pointer;"
        >
          <ChevronRight size={16} />
        </div>
      </div>
    </div>
    
    {#if !dailyCollapsed}
      <div class="list-scroll">
        {#each appState.notes.filter(n => n.path.startsWith('Daily Notes/')).sort((a, b) => (b.name || '').localeCompare(a.name || '')) as note}
          <div 
            class="nav-item flex-row" 
            class:active={appState.activeNotePath === note.path}
            role="button"
            tabindex="0"
            onclick={() => { appState.selectNote(note.path); appState.activeTab = 'home'; }}
            onkeydown={(e) => e.key === 'Enter' && (appState.selectNote(note.path), appState.activeTab = 'home')}
            style="padding: var(--spacing-xs) var(--spacing-xs); gap: var(--spacing-xs);"
          >
            <div class="playlist-art" style="width: 28px; height: 28px; font-size: var(--font-size-sm);">🗓️</div>
            <div class="nav-text flex-col">
              <span class="title" style="font-size: var(--font-size-xs);">{note.name}</span>
            </div>
            <button 
              class="item-delete-btn" 
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
              aria-label="Delete daily note"
              style="right: 4px;"
            >
              <Trash2 size={12} />
            </button>
          </div>
        {:else}
          <div class="empty-sidebar-section">
            <Calendar size={14} class="empty-icon" />
            <span>No daily logs found</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Focus (Swipe Planner) Section -->
  <div class="section-container flex-col">
    <div class="section-header flex-row" style="justify-content: space-between; width: 100%;">
      <button
        class="flex-row"
        style="flex-grow: 1; cursor: pointer; background: none; border: none; color: inherit; padding: 0; align-items: center; gap: var(--spacing-xs);"
        onclick={() => { appState.activeTab = 'focus'; }}
      >
        <Target size={18} class="sec-icon" />
        <span class="section-title">Focus</span>
      </button>
    </div>
  </div>

  <!-- Budget Dashboard Section -->
  <div class="section-container flex-col" class:active={appState.activeTab === 'budget'}>
    <div class="section-header flex-row" style="justify-content: space-between; width: 100%;">
      <button
        class="flex-row"
        style="flex-grow: 1; cursor: pointer; background: none; border: none; color: inherit; padding: 0; align-items: center; gap: var(--spacing-xs);"
        onclick={() => { appState.activeTab = 'budget'; }}
      >
        <Wallet size={18} class="sec-icon" />
        <span class="section-title">Budget</span>
      </button>
    </div>
  </div>

  <!-- Num Calculator Section -->
  <div class="section-container flex-col" class:active={appState.activeTab === 'num'}>
    <div class="section-header flex-row" style="justify-content: space-between; width: 100%;">
      <button
        class="flex-row"
        style="flex-grow: 1; cursor: pointer; background: none; border: none; color: inherit; padding: 0; align-items: center; gap: var(--spacing-xs);"
        onclick={() => { appState.activeTab = 'num'; }}
      >
        <Calculator size={18} class="sec-icon" />
        <span class="section-title">Num</span>
      </button>
    </div>
  </div>

  <!-- Draw Whiteboard Section (Disabled temporarily)
  <div class="section-container flex-col" class:active={appState.activeTab === 'draw'}>
    <div class="section-header flex-row" style="justify-content: space-between; width: 100%;">
      <button
        class="flex-row"
        style="flex-grow: 1; cursor: pointer; background: none; border: none; color: inherit; padding: 0; align-items: center; gap: var(--spacing-xs);"
        onclick={() => { appState.activeTab = 'draw'; }}
      >
        <PenTool size={18} class="sec-icon" />
        <span class="section-title">Draw</span>
      </button>
    </div>
  </div>
  -->

  <!-- Footer Actions -->
  <div class="footer-actions flex-col">
    <input 
      type="file" 
      accept=".mynote" 
      bind:this={fileInput} 
      onchange={handleImportFile} 
      style="display: none;" 
    />
    
    <button class="footer-btn flex-row" onclick={triggerImport}>
      <Download size={16} />
      <span>Import Note (.mynote)</span>
    </button>

    <button class="footer-btn flex-row" onclick={appState.openDirectory.bind(appState)}>
      <FolderOpen size={16} />
      <span>Open Local Directory</span>
    </button>
    
    <button class="footer-btn flex-row" onclick={() => { appState.showSettings = true; appState.settingsActiveTab = 'styling'; }}>
      <Palette size={16} />
      <span>Preferences & Themes</span>
    </button>

    <button 
      class="footer-btn flex-row" 
      onclick={() => { appState.showSettings = true; appState.settingsActiveTab = 'sync'; }}
      style="justify-content: space-between; width: 100%;"
    >
      <div class="flex-row" style="gap: var(--spacing-sm);">
        {#if appState.googleConnected && appState.syncEnabled}
          <Cloud size={16} class={appState.syncStatus === 'syncing' ? 'pulse-icon' : ''} />
        {:else}
          <CloudOff size={16} />
        {/if}
        <span>Google Drive Sync</span>
      </div>
      {#if appState.googleConnected && appState.syncEnabled}
        {#if appState.syncStatus === 'syncing'}
          <span class="sync-badge syncing flex-row" style="gap: var(--spacing-2xs); font-size: var(--font-size-xs); background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); padding: var(--spacing-3xs) var(--spacing-xs); border-radius: 9999px; font-weight: 700;">
            <span class="sync-dot pulsing" style="width: 6px; height: 6px; background-color: var(--accent); border-radius: 50%; display: inline-block;"></span>
            Syncing
          </span>
        {:else if appState.syncStatus === 'error'}
          <span class="sync-badge error flex-row" style="gap: var(--spacing-2xs); font-size: var(--font-size-xs); background: color-mix(in srgb, var(--semantic-error) 15%, transparent); color: var(--semantic-error); padding: var(--spacing-3xs) var(--spacing-xs); border-radius: 9999px; font-weight: 700;">
            Error
          </span>
        {:else}
          <span class="sync-badge idle flex-row" style="gap: var(--spacing-2xs); font-size: var(--font-size-xs); background: color-mix(in srgb, var(--semantic-success) 15%, transparent); color: var(--semantic-success); padding: var(--spacing-3xs) var(--spacing-xs); border-radius: 9999px; font-weight: 700;">
            Synced
          </span>
        {/if}
      {:else}
        <span class="sync-badge offline flex-row" style="gap: var(--spacing-2xs); font-size: var(--font-size-xs); background: color-mix(in srgb, var(--text-primary) 8%, transparent); color: var(--text-tertiary); padding: var(--spacing-3xs) var(--spacing-xs); border-radius: 9999px; font-weight: 700;">
          Disabled
        </span>
      {/if}
    </button>

    <div class="vault-info flex-col">
      <span class="info-label">Active Directory</span>
      <span class="info-value">{appState.vaultName || 'Unknown'}</span>
      {#if appState.googleConnected && appState.syncEnabled}
        <span class="info-label" style="margin-top: var(--spacing-xs);">Drive Sync Folder</span>
        <span class="info-value">☁️ {appState.customDriveFolderName || 'MyNotes'}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .sidebar {
    background-color: var(--bg-base);
    height: 100%;
    padding: var(--spacing-md) var(--spacing-xs);
    gap: var(--spacing-sm);
    border-right: 1px solid var(--border-color);
    overflow: hidden;
    flex-shrink: 0;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-right-color 0.3s ease;
    will-change: width, padding;
  }

  .sidebar.collapsed {
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

  .logo-section {
    padding: var(--spacing-xs) var(--spacing-md) var(--spacing-md);
    gap: var(--spacing-sm);
  }

  .logo-icon {
    font-size: var(--font-size-xl);
  }

  .logo-text {
    font-size: var(--font-size-lg);
    font-weight: 800;
    letter-spacing: -0.5px;
  }

  .section-container {
    background-color: var(--bg-surface);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-sm);
    flex: 1.2;
    overflow: hidden;
  }

  .daily-container {
    flex: 0.8;
  }

  .starred-container {
    flex: 0.6;
  }

  .section-header {
    justify-content: space-between;
    padding: var(--spacing-2xs) var(--spacing-xs) var(--spacing-sm);
    color: var(--text-secondary);
  }

  .sec-icon {
    margin-right: var(--spacing-xs);
  }

  .section-title {
    font-weight: 700;
    font-size: var(--font-size-sm);
    flex-grow: 1;
  }

  .add-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    justify-content: center;
    color: var(--text-secondary);
    transition: background-color 0.2s, color 0.2s, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .add-btn:hover {
    background-color: var(--bg-mid-dark);
    color: var(--text-primary);
  }

  .create-form {
    padding: 0 var(--spacing-xs) var(--spacing-xs);
  }

  .create-input {
    background-color: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    padding: var(--spacing-xs) var(--spacing-sm);
    width: 100%;
    border-radius: var(--radius-subtle);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .create-input:focus {
    border-color: var(--accent);
  }

  .list-scroll {
    overflow-y: auto;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2xs);
  }

  .nav-item {
    padding: var(--spacing-xs);
    border-radius: var(--radius-standard);
    gap: var(--spacing-sm);
    text-align: left;
    width: 100%;
    position: relative;
    transition: background-color 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), padding-left 0.2s ease, box-shadow 0.2s ease;
  }

  .nav-item:hover {
    background-color: var(--bg-mid-dark);
    transform: scale(1.02) translateX(4px);
  }

  .nav-item:active {
    transform: scale(0.98);
  }

  .nav-item.active {
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    box-shadow: inset 3px 0 0 0 var(--accent);
  }

  .playlist-art {
    width: 44px;
    height: 44px;
    background-color: var(--bg-mid-dark);
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-lg);
    flex-shrink: 0;
  }

  .nav-text {
    flex-grow: 1;
    overflow: hidden;
  }

  .nav-text .title {
    font-weight: 600;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-text .subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: var(--spacing-3xs);
  }

  .item-delete-btn {
    opacity: 0;
    transition: opacity 0.2s, color 0.2s;
    color: var(--text-secondary);
    padding: var(--spacing-2xs);
    border-radius: 4px;
    position: absolute;
    right: 8px;
  }

  .nav-item:hover .item-delete-btn,
  .nav-item:focus-within .item-delete-btn {
    opacity: 1;
  }

  .item-delete-btn:hover {
    color: var(--semantic-error);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }



  .empty-text {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    padding: var(--spacing-xs);
  }

  .empty-sidebar-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-secondary-translucent, rgba(255, 255, 255, 0.02));
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-standard);
    margin: var(--spacing-2xs) var(--spacing-xs);
    transition: all var(--motion-duration-standard) var(--motion-ease-standard);
    cursor: default;
  }

  .empty-sidebar-section :global(svg) {
    color: var(--text-tertiary);
    opacity: 0.6;
    flex-shrink: 0;
    transition: transform var(--motion-duration-standard) var(--motion-ease-standard), opacity var(--motion-duration-standard) var(--motion-ease-standard), color var(--motion-duration-standard) var(--motion-ease-standard);
  }

  .empty-sidebar-section:hover {
    background: var(--bg-secondary-translucent-hover, rgba(255, 255, 255, 0.04));
    color: var(--text-secondary);
    border-color: var(--text-tertiary);
  }

  .empty-sidebar-section:hover :global(svg) {
    opacity: 0.9;
    color: var(--accent);
    transform: scale(1.1) rotate(5deg);
  }

  .footer-actions {
    gap: var(--spacing-xs);
    padding: var(--spacing-xs);
    border-top: 1px solid var(--border-color);
  }

  .footer-btn {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-pill);
    gap: var(--spacing-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    transition: background-color 0.2s, color 0.2s, transform 0.2s ease;
    width: 100%;
    text-align: left;
    justify-content: flex-start;
  }

  .footer-btn:hover {
    background-color: var(--bg-surface);
    color: var(--text-primary);
  }

  .vault-info {
    padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-2xs);
    gap: var(--spacing-3xs);
    border-top: 1px dashed var(--border-color);
    margin-top: var(--spacing-2xs);
  }

  .info-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .info-value {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    .item-delete-btn, .tag-rename-btn, .tag-delete-btn {
      opacity: 1;
    }
    .tag-count-badge {
      display: none;
    }
  }

  /* Sync status animations and layout */
  .pulsing {
    animation: sync-pulse-dot 1.5s infinite;
  }
  @keyframes sync-pulse-dot {
    0% { transform: scale(0.8); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0.5; }
  }
  .pulse-icon {
    animation: sync-pulse-icon 2s infinite ease-in-out;
  }
  @keyframes sync-pulse-icon {
    0% { opacity: 0.6; }
    50% { opacity: 1; }
    100% { opacity: 0.6; }
  }

  .tags-container {
    flex: 0.8;
  }

  .tag-count-badge {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-secondary);
    background-color: var(--bg-mid-dark);
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: 999px;
    transition: opacity 0.2s, background-color 0.2s, color 0.2s;
  }

  .nav-item:hover .tag-count-badge {
    opacity: 0;
  }

  .tag-rename-btn, .tag-delete-btn, .tag-color-btn {
    opacity: 0;
    transition: opacity 0.2s, color 0.2s, background-color 0.2s;
    color: var(--text-secondary);
    padding: var(--spacing-2xs);
    border-radius: 4px;
    position: absolute;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tag-delete-btn {
    right: 8px;
  }

  .tag-rename-btn {
    right: 32px;
  }

  .tag-color-btn {
    right: 56px;
  }

  .nav-item:hover .tag-rename-btn,
  .nav-item:hover .tag-delete-btn,
  .nav-item:hover .tag-color-btn,
  .nav-item:focus-within .tag-rename-btn,
  .nav-item:focus-within .tag-delete-btn,
  .nav-item:focus-within .tag-color-btn {
    opacity: 1;
  }

  .tag-delete-btn:hover {
    color: var(--semantic-error);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  .tag-rename-btn:hover {
    color: var(--accent);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  .tag-color-btn:hover {
    color: var(--accent);
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  /* ST-010: Color Picker Popover */
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
    gap: var(--spacing-xs);
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-xs);
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

  .section-header-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(90deg); /* Expanded by default */
  }

  .section-header-arrow.collapsed {
    transform: rotate(0deg); /* Collapsed */
  }
</style>
