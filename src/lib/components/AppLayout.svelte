<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { appState, generateHtmlNote, parseHtmlMetadata } from '../stores/appState.svelte';
  import type { Tag } from '../storage/TagSchema';
  import Sidebar from './Sidebar.svelte';
  import NoteList from './NoteList.svelte';
  import Editor from './Editor.svelte';
  import AppHeader from './AppHeader.svelte';
  import { 
    Search, ChevronLeft, Plus,
    FileText, FolderPlus, Compass, ArrowRight, Settings,
    X, Cloud, RefreshCw, LogOut, Palette, ChevronRight, Menu, Folder,
    Trash2, FolderOpen, Edit3, BookOpen, FileDown, Download, FolderInput, Code,
    Star, Calendar
  } from 'lucide-svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import Modal from './Modal.svelte';
  import ToastItem from './ToastItem.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import MobileSettings from './MobileSettings.svelte';
  import MobileTabBar from './MobileTabBar.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import MobileSearch from './MobileSearch.svelte';
  import { mobileNav } from '../stores/mobileNav.svelte';
  import { LONG_PRESS_MS, TOUCH_MOVE_TOLERANCE, edgeSwipeBack } from '../actions/touch';

  // Responsive state
  let isMobile = $state(false);
  let mobileSearchInput = $state('');
  let newMobileFolder = $state('');
  let showMobileFolderForm = $state(false);
  let showMobileMoreMenu = $state(false);

  // UI-M-012: track whether an editable field inside the mobile editor is focused
  // so the header can surface a context-aware "Done" (dismiss keyboard) action.
  let editorFocused = $state(false);

  function handleEditorFocusIn(e: FocusEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      editorFocused = true;
    }
  }

  function handleEditorFocusOut() {
    // Re-check after the focus settles so switching between editable fields
    // doesn't flicker the Done button.
    queueMicrotask(() => {
      const a = document.activeElement as HTMLElement | null;
      editorFocused = !!(a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
    });
  }

  // UI-M-012: "Done" dismisses the soft keyboard (and persists the note) without
  // leaving the editor — the common mobile editing affordance.
  function dismissMobileKeyboard() {
    const el = document.activeElement as HTMLElement | null;
    el?.blur();
    editorFocused = false;
    if (appState.editorDirty) void appState.saveActiveNote();
  }

  // UI-M-011: hardware/edge back closes the editor "More Actions" sheet first.
  $effect(() => {
    if (!showMobileMoreMenu) return;
    return mobileNav.registerOverlay(() => (showMobileMoreMenu = false));
  });

  // Custom Sync Folder and Theme Selectors
  let showFolderPicker = $state(false);
  let newDriveFolderName = $state('');
  let mobilePastedToken = $state('');

  let activeThemeCategory = $state<'all' | 'light' | 'dark' | 'vivid'>('all');
  let displayedThemes = $derived(
    activeThemeCategory === 'all' 
      ? appState.themes 
      : appState.themes.filter((t: any) => t.category === activeThemeCategory)
  );



  // Time-based greeting helper
  let greeting = $derived.by(() => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good morning';
    if (hours < 17) return 'Good afternoon';
    return 'Good evening';
  });

  // Handle window resizing
  function handleResize() {
    isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent) || window.innerWidth < 768;
  }

  // Mobile Folder Creation
  async function createMobileFolder(e: SubmitEvent) {
    e.preventDefault();
    if (!newMobileFolder.trim()) return;
    await appState.createNotebook(newMobileFolder);
    newMobileFolder = '';
    showMobileFolderForm = false;
  }

  // Create standard daily note
  async function handleMobileDailyNote() {
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

  let selectedTargetNotebook = $state<string | null>(null);
  let newNotebookName = $state<string>('');

  $effect(() => {
    if (appState.showMoveCopyModal && appState.moveCopyNotePath) {
      const parts = appState.moveCopyNotePath.split('/');
      if (parts.length > 1) {
        selectedTargetNotebook = parts.slice(0, -1).join('/');
      } else {
        selectedTargetNotebook = null;
      }
      newNotebookName = '';
    }
  });

  async function handleCreateNotebookInModal() {
    const name = newNotebookName.trim();
    if (!name) return;
    try {
      await appState.createNotebook(name);
      selectedTargetNotebook = name;
      newNotebookName = '';
      appState.showToast(`Notebook "${name}" created.`, 'success', 3000);
    } catch (e) {
      console.error('Failed to create notebook in modal:', e);
    }
  }

  async function handleMoveNoteInModal() {
    if (!appState.moveCopyNotePath) return;
    await appState.moveNote(appState.moveCopyNotePath, selectedTargetNotebook);
    appState.showMoveCopyModal = false;
  }

  async function handleCopyNoteInModal() {
    if (!appState.moveCopyNotePath) return;
    await appState.copyNote(appState.moveCopyNotePath, selectedTargetNotebook);
    appState.showMoveCopyModal = false;
  }

  let fileInput = $state<HTMLInputElement>();

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

  function handleLayoutKeydown(e: KeyboardEvent) {
    if (e.key === 'F6') {
      e.preventDefault();
      
      const sidebar = document.getElementById('sidebar-panel');
      const notelist = document.getElementById('notelist-panel');
      const editor = document.querySelector('.ProseMirror') as HTMLElement;
      
      const activeEl = document.activeElement;
      
      let currentFocus: 'sidebar' | 'notelist' | 'editor' | 'none' = 'none';
      if (sidebar && sidebar.contains(activeEl)) {
        currentFocus = 'sidebar';
      } else if (notelist && notelist.contains(activeEl)) {
        currentFocus = 'notelist';
      } else if (editor && (editor === activeEl || editor.contains(activeEl))) {
        currentFocus = 'editor';
      }
      
      const visibleSequence: { name: 'sidebar' | 'notelist' | 'editor'; el: HTMLElement | null }[] = [];
      if (!appState.sidebarCollapsed && sidebar) {
        visibleSequence.push({ name: 'sidebar', el: sidebar });
      }
      if (!appState.notelistCollapsed && notelist) {
        visibleSequence.push({ name: 'notelist', el: notelist });
      }
      if (!appState.editorCollapsed && editor) {
        visibleSequence.push({ name: 'editor', el: editor });
      }
      
      if (visibleSequence.length === 0) return;
      
      let nextIndex = 0;
      const currentIndex = visibleSequence.findIndex(p => p.name === currentFocus);
      if (currentIndex !== -1) {
        nextIndex = (currentIndex + 1) % visibleSequence.length;
      }
      
      const targetPanel = visibleSequence[nextIndex];
      if (targetPanel && targetPanel.el) {
        targetPanel.el.focus();
      }
    }
  }

  onMount(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleLayoutKeydown);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleLayoutKeydown);
    };
  });

  // Mobile Tags State & Methods
  let mobileTagsCollapsed = $state(false);

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
      appState.searchQuery = '';
      mobileSearchInput = '';
    }
  }

  function handleRenameNote(path: string, currentName: string) {
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
          console.error(err);
          appState.showToast('Failed to rename note', 'error');
        }
      }
    });
  }

  function handleCreateNote(notebook: string | null = null) {
    appState.showPrompt({
      title: 'New Note',
      message: 'Enter title for the new note:',
      value: 'Untitled Note',
      placeholder: 'Note title...',
      onConfirm: (title) => {
        const trimmed = title.trim();
        if (trimmed) {
          appState.createNote(trimmed, notebook || appState.activeNotebook);
        }
      }
    });
  }

  // ── UI-M-004: Favorites for the mobile Home dashboard ──
  let favoriteNotes = $derived(
    appState.favorites
      .map((p) => appState.notes.find((n) => n.path === p))
      .filter((n): n is (typeof appState.notes)[number] => !!n)
  );

  // ── UI-M-004: Pull-to-refresh on the mobile content scroll area ──
  let mobileContentEl = $state<HTMLElement | null>(null);
  let ptrStartY = 0;
  let ptrActive = false;
  let ptrDistance = $state(0);
  let ptrRefreshing = $state(false);
  const PTR_THRESHOLD = 64;
  const PTR_MAX = 96;

  function ptrTouchStart(e: TouchEvent) {
    if (appState.selectMode || ptrRefreshing) { ptrActive = false; return; }
    if (mobileContentEl && mobileContentEl.scrollTop <= 0) {
      ptrStartY = e.touches[0].clientY;
      ptrActive = true;
    } else {
      ptrActive = false;
    }
  }

  function ptrTouchMove(e: TouchEvent) {
    if (!ptrActive || ptrRefreshing) return;
    const dy = e.touches[0].clientY - ptrStartY;
    if (dy > 0 && mobileContentEl && mobileContentEl.scrollTop <= 0) {
      // Apply resistance so the gesture feels weighted.
      ptrDistance = Math.min(dy * 0.5, PTR_MAX);
    } else {
      ptrDistance = 0;
      ptrActive = false;
    }
  }

  async function ptrTouchEnd() {
    if (!ptrActive) { ptrDistance = 0; return; }
    ptrActive = false;
    if (ptrDistance >= PTR_THRESHOLD && !ptrRefreshing) {
      ptrRefreshing = true;
      ptrDistance = 48;
      try {
        await appState.refreshNotes();
        if (appState.googleConnected && appState.syncEnabled) {
          await appState.syncNotes();
        }
      } catch (err) {
        console.error('Pull-to-refresh failed:', err);
      } finally {
        ptrRefreshing = false;
        ptrDistance = 0;
      }
    } else {
      ptrDistance = 0;
    }
  }

  // ── UI-M-003: Quick Create speed-dial sheet ──
  let showQuickCreate = $state(false);

  // ── UI-M-009: Full-screen mobile search overlay ──
  let showMobileSearch = $state(false);
  function quickCreateNote() {
    showQuickCreate = false;
    handleCreateNote(appState.activeNotebook);
  }

  function quickCreateDaily() {
    showQuickCreate = false;
    handleMobileDailyNote();
  }

  function quickCreateNotebook() {
    showQuickCreate = false;
    appState.showPrompt({
      title: 'New Notebook',
      message: 'Enter a name for the new notebook:',
      value: '',
      placeholder: 'Notebook name...',
      onConfirm: async (name) => {
        const trimmed = name.trim();
        if (trimmed) {
          await appState.createNotebook(trimmed);
        }
      }
    });
  }

  function confirmDeleteNote(path: string, clearActive: boolean = false) {
    appState.showConfirmation({
      title: 'Delete Note',
      message: 'Do you really want to delete this note? This action is permanent.',
      confirmText: 'Delete',
      onConfirm: async () => {
        if (clearActive) {
          appState.activeNotePath = null;
        }
        await appState.deleteNote(path);
      }
    });
  }

  function confirmDeleteNotebook(notebook: string) {
    appState.showConfirmation({
      title: 'Delete Notebook',
      message: `Do you really want to delete folder "${notebook}" and all its notes? This action is permanent.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        await appState.deleteNotebook(notebook);
      }
    });
  }

  function handleDeleteTag(tagName: string) {
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

  async function handleRenameTag(tagName: string) {
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

  // ST-011: Touch movement detection to separate swipe/scroll from taps
  let mobileTouchStartX = 0;
  let mobileTouchStartY = 0;
  let mobileTouchMoved = false;

  // ST-011: Note Long Press simulation for Select Mode
  let noteLongPressTimeout: any;
  let isNoteLongPressActive = false;

  // UI-M-008: Horizontal swipe-action state for note rows
  let noteSwipeEl: HTMLElement | null = null;
  let noteSwipeDx = 0;
  let noteSwipeHorizontal = false;
  const NOTE_SWIPE_THRESHOLD = 80;

  function resetNoteSwipe(animate: boolean) {
    const el = noteSwipeEl;
    if (!el) return;
    if (animate) {
      el.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = 'translateX(0)';
      setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 220);
    } else {
      el.style.transition = '';
      el.style.transform = '';
    }
  }

  function swipeToggleFavorite(path: string) {
    const wasFav = appState.favorites.includes(path);
    appState.toggleFavorite(path);
    appState.showToast(wasFav ? 'Removed from Favorites' : 'Added to Favorites', 'info', 1500);
  }

  function handleNoteTouchStart(notePath: string, event: TouchEvent) {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      mobileTouchStartX = touch.clientX;
      mobileTouchStartY = touch.clientY;
    }
    mobileTouchMoved = false;
    isNoteLongPressActive = false;
    noteSwipeEl = event.currentTarget as HTMLElement;
    noteSwipeDx = 0;
    noteSwipeHorizontal = false;

    noteLongPressTimeout = setTimeout(() => {
      isNoteLongPressActive = true;
      if (!appState.selectMode) {
        appState.toggleSelectMode();
      }
      appState.toggleNoteSelection(notePath);
    }, LONG_PRESS_MS);
  }

  function handleNoteTouchEnd(notePath: string, event: TouchEvent) {
    if (noteLongPressTimeout) {
      clearTimeout(noteLongPressTimeout);
      noteLongPressTimeout = null;
    }
    // UI-M-008: complete a horizontal swipe action (favorite / delete)
    if (noteSwipeHorizontal && !appState.selectMode) {
      event.preventDefault();
      const dx = noteSwipeDx;
      resetNoteSwipe(true);
      noteSwipeHorizontal = false;
      noteSwipeEl = null;
      if (dx >= NOTE_SWIPE_THRESHOLD) {
        swipeToggleFavorite(notePath);
      } else if (dx <= -NOTE_SWIPE_THRESHOLD) {
        confirmDeleteNote(notePath);
      }
      return;
    }
    noteSwipeHorizontal = false;
    noteSwipeEl = null;
    if (isNoteLongPressActive) {
      event.preventDefault();
    } else {
      if (mobileTouchMoved) {
        event.preventDefault();
      } else {
        event.preventDefault(); // Prevent duplicate click action
        if (appState.selectMode) {
          appState.toggleNoteSelection(notePath);
        } else {
          appState.selectNote(notePath);
        }
      }
    }
  }

  function handleNoteTouchMove(event: TouchEvent) {
    if (event.touches.length === 0) return;
    const touch = event.touches[0];
    const dx = touch.clientX - mobileTouchStartX;
    const dy = touch.clientY - mobileTouchStartY;
    if (Math.abs(dx) > TOUCH_MOVE_TOLERANCE || Math.abs(dy) > TOUCH_MOVE_TOLERANCE) {
      mobileTouchMoved = true;
      if (noteLongPressTimeout) {
        clearTimeout(noteLongPressTimeout);
        noteLongPressTimeout = null;
      }
    }
    // Decide gesture direction once past a small deadzone.
    if (!noteSwipeHorizontal && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      noteSwipeHorizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (noteSwipeHorizontal && !appState.selectMode && noteSwipeEl) {
      noteSwipeDx = dx;
      noteSwipeEl.style.transition = 'none';
      noteSwipeEl.style.transform = `translateX(${dx}px)`;
    }
  }

  // ST-011: Mobile Bulk Tag Picker State
  let showMobileBulkPicker = $state(false);
  let mobileBulkPickerMode = $state<'tag' | 'untag'>('tag');
  let mobileBulkSearch = $state('');

  let filteredMobileTagsForPicker = $derived.by(() => {
    const query = mobileBulkSearch.trim().toLowerCase();
    let availableTags = appState.tags;

    if (mobileBulkPickerMode === 'untag') {
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

  function openMobileBulkTagPicker(mode: 'tag' | 'untag') {
    mobileBulkPickerMode = mode;
    mobileBulkSearch = '';
    showMobileBulkPicker = true;
  }

  function closeMobileBulkPicker() {
    showMobileBulkPicker = false;
  }

  let showMobileBulkNotebookPicker = $state(false);

  async function handleMobileBulkMove(notebook: string | null) {
    try {
      const notePaths = Array.from(appState.selectedNotes);
      await appState.bulkMoveNotes(notePaths, notebook);
      showMobileBulkNotebookPicker = false;
      appState.toggleSelectMode();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to move notes', 'error');
    }
  }

  function handleMobileBulkDelete() {
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

  async function handleMobileBulkCreateAndAdd(tagName: string) {
    try {
      const cleanName = tagName.trim();
      const normalized = cleanName.toLowerCase();
      let existing = appState.tags.find(t => t.normalizedName === normalized);
      if (!existing) {
        await appState.createTag(cleanName);
      }
      await appState.bulkAddTag(cleanName);
      appState.showToast(`Tag #${cleanName} applied in bulk`, 'success');
      closeMobileBulkPicker();
      appState.toggleSelectMode();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to perform bulk operation', 'error');
    }
  }

  async function handleMobileBulkAction(tagName: string) {
    try {
      if (mobileBulkPickerMode === 'tag') {
        await appState.bulkAddTag(tagName);
        appState.showToast(`Tag #${tagName} applied in bulk`, 'success');
      } else {
        await appState.bulkRemoveTag(tagName);
        appState.showToast(`Tag #${tagName} removed in bulk`, 'success');
      }
      closeMobileBulkPicker();
      appState.toggleSelectMode();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to perform bulk operation', 'error');
    }
  }

  // Mobile Long Press simulation
  let longPressTimeout: any;
  let isLongPressActive = false;

  function handleTagTouchStart(tagName: string, event: TouchEvent) {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      mobileTouchStartX = touch.clientX;
      mobileTouchStartY = touch.clientY;
    }
    mobileTouchMoved = false;
    isLongPressActive = false;
    
    longPressTimeout = setTimeout(() => {
      isLongPressActive = true;
      handleMobileTagLongPress(tagName);
    }, LONG_PRESS_MS);
  }

  function handleTagTouchEnd(tagName: string, event: TouchEvent) {
    if (longPressTimeout) {
      clearTimeout(longPressTimeout);
      longPressTimeout = null;
    }
    if (isLongPressActive) {
      event.preventDefault();
    } else {
      if (mobileTouchMoved) {
        event.preventDefault();
      } else {
        // It was a tap
        event.preventDefault(); // Prevent simulated click
        handleTagClick(tagName);
      }
    }
  }

  function handleTagTouchMove(event: TouchEvent) {
    if (longPressTimeout) {
      clearTimeout(longPressTimeout);
      longPressTimeout = null;
    }
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      const dx = touch.clientX - mobileTouchStartX;
      const dy = touch.clientY - mobileTouchStartY;
      if (Math.abs(dx) > TOUCH_MOVE_TOLERANCE || Math.abs(dy) > TOUCH_MOVE_TOLERANCE) {
        mobileTouchMoved = true;
      }
    }
  }

  // ST-010: Tag Color Picker (Mobile)
  const TAG_COLOR_PALETTE = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6',
    '#ec4899', '#f43f5e', '#78716c', '#64748b',
  ];
  let mobileColorPickerTag = $state<string | null>(null);

  function getTagColor(tagName: string): string | undefined {
    return appState.tagColorMap.get(tagName.toLowerCase());
  }

  async function handleSetMobileColor(tagName: string, color: string | null) {
    try {
      await appState.setTagColor(tagName, color);
      mobileColorPickerTag = null;
      appState.showToast(`Tag color updated!`, 'success');
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to set tag color.', 'error');
    }
  }

  let showMobileTagActions = $state(false);
  let mobileTagActionsTag = $state<string | null>(null);
  let mobileCustomHexValue = $state('');
  let isMobileCustomHexValid = $derived(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(mobileCustomHexValue.trim()));
  let normalizedMobileCustomHex = $derived(isMobileCustomHexValid ? (mobileCustomHexValue.trim().startsWith('#') ? mobileCustomHexValue.trim() : '#' + mobileCustomHexValue.trim()) : '');

  $effect(() => {
    if (mobileColorPickerTag) {
      mobileCustomHexValue = getTagColor(mobileColorPickerTag) || '';
    }
  });

  async function handleMobileTagLongPress(tagName: string) {
    mobileTagActionsTag = tagName;
    showMobileTagActions = true;
  }

  async function triggerMobileTagRename() {
    if (!mobileTagActionsTag) return;
    const tagName = mobileTagActionsTag;
    showMobileTagActions = false;
    await handleRenameTag(tagName);
  }

  function triggerMobileTagColor() {
    if (!mobileTagActionsTag) return;
    const tagName = mobileTagActionsTag;
    mobileColorPickerTag = tagName;
    showMobileTagActions = false;
  }

  async function triggerMobileTagDelete() {
    if (!mobileTagActionsTag) return;
    const tagName = mobileTagActionsTag;
    showMobileTagActions = false;
    await handleDeleteTag(tagName);
  }
</script>

{#if isMobile}
  <!-- ============================================== -->
  <!-- ANDROID MOBILE VIEW                            -->
  <!-- ============================================== -->
  <div class="mobile-app flex-col">
    {#if appState.activeNotePath}
      <!-- Fullscreen Editor Overlay for Mobile -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mobile-editor-container flex-col"
        onfocusin={handleEditorFocusIn}
        onfocusout={handleEditorFocusOut}
      >
        <div class="mobile-editor-top flex-row" style="justify-content: space-between; width: 100%;">
          <button 
            class="back-btn flex-row" 
            onclick={() => {
              void mobileNav.back();
              showMobileMoreMenu = false;
            }}
            aria-label="Back"
          >
            <ChevronLeft size={24} />
          </button>
          
          <!-- UI-M-012: cleaner breadcrumb — notebook ▸ note title -->
          <span class="mobile-note-breadcrumb flex-row">
            <Folder size={13} style="color: var(--accent); flex-shrink: 0;" />
            <span class="crumb-folder">{appState.activeNotePath.includes('/') ? appState.activeNotePath.split('/')[0] : 'All Notes'}</span>
            {#if appState.activeNote?.name}
              <ChevronRight size={12} style="color: var(--text-tertiary); flex-shrink: 0;" />
              <span class="crumb-note">{appState.activeNote.name}</span>
            {/if}
          </span>
          
          <!-- Save state, context-aware Done, and overflow -->
          <div class="flex-row" style="gap: var(--spacing-sm); align-items: center; position: relative;">
            {#if appState.editorDirty}
              <button 
                class="mobile-save-check-btn flex-row" 
                onclick={() => appState.saveActiveNote()}
                aria-label="Save note"
                style="background: none; border: none; color: var(--accent); padding: var(--spacing-2xs); cursor: pointer;"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            {/if}

            {#if editorFocused}
              <!-- UI-M-012: "Done" dismisses the keyboard (and saves) -->
              <button
                class="mobile-done-btn"
                onclick={dismissMobileKeyboard}
                aria-label="Dismiss keyboard"
              >
                Done
              </button>
            {/if}

            <!-- More Options Three-Dot Button (overflow) -->
            <button
              class="mobile-more-btn flex-row" 
              onclick={() => showMobileMoreMenu = !showMobileMoreMenu}
              aria-label="More options"
              style="background: none; border: none; color: var(--text-primary); padding: var(--spacing-2xs); cursor: pointer;"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="mobile-editor-wrapper">
          <Editor />
        </div>

        {#if showMobileMoreMenu}
          <!-- Backdrop to close the menu on click-outside -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="mobile-more-menu-backdrop" onclick={() => showMobileMoreMenu = false}></div>

          <!-- Chrome-style Modern Dropdown Menu -->
          <div 
            class="mobile-more-menu flex-col" 
            onclick={(e) => e.stopPropagation()} 
            transition:fly={{ y: -6, duration: 150, easing: cubicOut }}
          >
            <div class="mobile-more-menu-content flex-col">
              <!-- UI-M-012: quick toggles relocated from the header into the overflow -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  appState.toggleFavorite(appState.activeNotePath || '');
                  showMobileMoreMenu = false;
                }}
              >
                <Star
                  size={15}
                  class="menu-item-icon"
                  fill={appState.favorites.includes(appState.activeNotePath || '') ? 'var(--accent)' : 'none'}
                  color={appState.favorites.includes(appState.activeNotePath || '') ? 'var(--accent)' : 'currentColor'}
                />
                <span>{appState.favorites.includes(appState.activeNotePath || '') ? 'Remove from Favorites' : 'Add to Favorites'}</span>
              </button>

              {#if !appState.isReadOnly}
                <button
                  class="menu-item flex-row"
                  onclick={() => {
                    appState.setFocusMode(!appState.focusModeEnabled);
                    showMobileMoreMenu = false;
                  }}
                >
                  <svg width="15" height="15" class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke={appState.focusModeEnabled ? 'var(--accent)' : 'currentColor'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  </svg>
                  <span>{appState.focusModeEnabled ? 'Disable Focus Mode' : 'Enable Focus Mode'}</span>
                </button>

                <button
                  class="menu-item flex-row"
                  onclick={() => {
                    appState.setTypewriterScroll(!appState.typewriterScrollEnabled);
                    showMobileMoreMenu = false;
                  }}
                >
                  <svg width="15" height="15" class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke={appState.typewriterScrollEnabled ? 'var(--accent)' : 'currentColor'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="4" y1="12" x2="20" y2="12" stroke-dasharray="3,3"/><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/>
                  </svg>
                  <span>{appState.typewriterScrollEnabled ? 'Disable Typewriter Scroll' : 'Enable Typewriter Scroll'}</span>
                </button>
              {/if}

              <div class="menu-divider"></div>

              <!-- 1. Edit/Read Toggle -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  appState.toggleReadMode();
                  showMobileMoreMenu = false;
                }}
              >
                {#if appState.isReadOnly}
                  <Edit3 size={15} class="menu-item-icon" />
                  <span>Switch to Edit Mode</span>
                {:else}
                  <BookOpen size={15} class="menu-item-icon" />
                  <span>Switch to Read Mode</span>
                {/if}
              </button>

              <!-- 2. Code Mode Toggle -->
              {#if !appState.isReadOnly}
                <button
                  class="menu-item flex-row"
                  onclick={() => {
                    appState.setSourceMode(!appState.sourceMode);
                    showMobileMoreMenu = false;
                  }}
                >
                  <Code size={15} class="menu-item-icon" style="color: {appState.sourceMode ? 'var(--accent)' : 'var(--text-secondary)'}" />
                  <span>Code Mode (Markdown)</span>
                </button>
              {/if}

              <div class="menu-divider"></div>

              <!-- 3. Export HTML -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  window.dispatchEvent(new CustomEvent('trigger-export-html'));
                }}
              >
                <FileDown size={15} class="menu-item-icon" />
                <span>Export as HTML</span>
              </button>

              <!-- 4. Export Markdown -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  window.dispatchEvent(new CustomEvent('trigger-export-markdown'));
                }}
              >
                <FileText size={15} class="menu-item-icon" />
                <span>Export as Markdown</span>
              </button>

              <!-- 5. Export PDF -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  window.dispatchEvent(new CustomEvent('trigger-export-pdf'));
                }}
              >
                <Download size={15} class="menu-item-icon" />
                <span>Export as PDF (Print)</span>
              </button>

              <div class="menu-divider"></div>

              <!-- 6. Move / Copy Note -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  if (appState.activeNotePath) {
                    appState.moveCopyNotePath = appState.activeNotePath;
                    appState.moveCopyNoteName = appState.activeNote?.name || '';
                    appState.showMoveCopyModal = true;
                  }
                }}
              >
                <FolderInput size={15} class="menu-item-icon" />
                <span>Move or Copy Note</span>
              </button>

              <!-- Rename Note -->
              <button
                class="menu-item flex-row"
                onclick={() => {
                  showMobileMoreMenu = false;
                  if (appState.activeNotePath) {
                    const currentName = appState.activeNote?.name || '';
                    appState.showPrompt({
                      title: 'Rename Note',
                      message: 'Enter new title & file name:',
                      value: currentName,
                      placeholder: 'Note name...',
                      onConfirm: async (newTitle) => {
                        const trimmed = newTitle.trim();
                        if (!trimmed || trimmed === currentName) return;
                        try {
                          await appState.renameNote(appState.activeNotePath!, trimmed);
                          appState.showToast('Note renamed successfully', 'success');
                        } catch (err) {
                          console.error(err);
                          appState.showToast('Failed to rename note', 'error');
                        }
                      }
                    });
                  }
                }}
              >
                <Edit3 size={15} class="menu-item-icon" />
                <span>Rename Note</span>
              </button>

              <!-- 7. Delete Note -->
              <button
                class="menu-item flex-row delete-item"
                onclick={() => {
                  showMobileMoreMenu = false;
                  if (appState.activeNotePath) {
                    confirmDeleteNote(appState.activeNotePath, true);
                  }
                }}
              >
                <Trash2 size={15} class="menu-item-icon" />
                <span>Delete Note</span>
              </button>
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Main Mobile Navigation Tabs -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mobile-content flex-grow"
        bind:this={mobileContentEl}
        ontouchstart={ptrTouchStart}
        ontouchmove={ptrTouchMove}
        ontouchend={ptrTouchEnd}
        ontouchcancel={ptrTouchEnd}
        use:edgeSwipeBack={{ onBack: () => mobileNav.back() }}
      >
        <!-- Pull-to-refresh indicator -->
        {#if ptrDistance > 0 || ptrRefreshing}
          <div class="ptr-indicator flex-row" style="height: {ptrDistance}px; opacity: {ptrRefreshing ? 1 : Math.min(ptrDistance / PTR_THRESHOLD, 1)};" aria-hidden="true">
            <span class="ptr-spinner flex-row" class:spin={ptrRefreshing} style="transform: rotate({ptrRefreshing ? 0 : Math.min(ptrDistance / PTR_THRESHOLD, 1) * 270}deg);">
              <RefreshCw size={18} />
            </span>
          </div>
        {/if}
        <!-- 1. HOME TAB -->
        {#if appState.activeTab === 'home'}
          <div class="mobile-tab-view flex-col">
            {#if !appState.selectMode}
              <div class="mobile-header flex-row" style="justify-content: space-between; width: 100%;">
                <div class="flex-col">
                  <h1>{greeting}</h1>
                  <span class="mobile-vault-stat" style="font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: var(--spacing-2xs);">{appState.notes.length} notes in your vault</span>
                </div>
                <div class="flex-row" style="gap: var(--spacing-xs); align-items: center;">
                  {#if appState.googleConnected && appState.syncEnabled}
                    {#if appState.syncStatus === 'syncing'}
                      <span class="sync-indicator spin" style="color: var(--accent); display: flex;" title="Syncing...">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                        </svg>
                      </span>
                    {:else if appState.syncStatus === 'error'}
                      <span class="sync-indicator" style="color: var(--semantic-error); display: flex;" title="Sync Error">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                      </span>
                    {/if}
                  {/if}
                  <button
                    class="icon-circle-btn flex-row"
                    onclick={() => (showMobileSearch = true)}
                    aria-label="Search notes"
                  >
                    <Search size={20} />
                  </button>
                  <button
                    class="icon-circle-btn flex-row" 
                    onclick={() => appState.showSettings = true}
                    aria-label="Settings"
                  >
                    <Settings size={20} />
                  </button>
                </div>
              </div>
            {:else}
              <div class="mobile-header bulk-select-header flex-row" style="justify-content: space-between; width: 100%; align-items: center; border-bottom: 1px dashed var(--border-color); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);">
                <div class="flex-row" style="gap: var(--spacing-sm); align-items: center;">
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => appState.toggleSelectMode()}
                    aria-label="Exit selection mode"
                    style="width: 32px; height: 32px;"
                  >
                    <X size={18} />
                  </button>
                  <span style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary);">
                    {appState.selectedNotes.size} selected
                  </span>
                </div>
                <button 
                  class="btn-pill btn-pill-outline" 
                  onclick={() => appState.selectAllNotes(appState.filteredNotes.map(n => n.path))}
                  style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm);"
                >
                  Select All
                </button>
              </div>
            {/if}
            {#if favoriteNotes.length > 0 && !appState.selectMode}
              <div class="home-section">
                <h2 class="section-title">Favorites</h2>
                <div class="fav-carousel">
                  {#each favoriteNotes as note (note.path)}
                    <button
                      type="button"
                      class="fav-card flex-col"
                      onclick={() => appState.selectNote(note.path)}
                      aria-label={`Open favorite note ${note.name}`}
                    >
                      <span class="fav-card-icon flex-row">
                        <Star size={16} fill="var(--accent)" color="var(--accent)" />
                      </span>
                      <span class="fav-card-title">{note.name}</span>
                      {#if note.path.includes('/')}
                        <span class="card-notebook-badge">{note.path.split('/')[0]}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            <div class="home-section">
              <h2 class="section-title">Recent Notes</h2>
              <div class="recent-cards-list flex-col" style="gap: var(--spacing-sm);">
                {#if appState.loadingNotes}
                  {#each Array(3) as _, idx}
                    <div 
                      class="recent-note-card flex-row" 
                      style="pointer-events: none; background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-comfortable); padding: var(--spacing-md) var(--spacing-md); text-align: left; width: 100%; gap: var(--spacing-sm); align-items: center; height: 68px;"
                    >
                      <div class="flex-col" style="flex-grow: 1; min-width: 0; gap: var(--spacing-xs);">
                        <div class="skeleton-block skeleton-pulse" style="width: 60%; height: 14px; border-radius: 4px;"></div>
                        <div class="skeleton-block skeleton-pulse" style="width: 30%; height: 10px; border-radius: 4px;"></div>
                      </div>
                    </div>
                  {/each}
                {:else}
                  {#each appState.recentNotes as note}
                    <div 
                      class="recent-note-card flex-row" 
                      class:selected={appState.selectedNotes.has(note.path)}
                      onclick={(e) => {
                        if (appState.selectMode) {
                          e.preventDefault();
                          e.stopPropagation();
                          appState.toggleNoteSelection(note.path);
                        } else {
                          appState.selectNote(note.path);
                        }
                      }}
                      ontouchstart={(e) => handleNoteTouchStart(note.path, e)}
                      ontouchend={(e) => handleNoteTouchEnd(note.path, e)}
                      ontouchmove={handleNoteTouchMove}
                      role="button"
                      tabindex="0"
                      onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
                      style="cursor: pointer; background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-comfortable); padding: var(--spacing-md) var(--spacing-md); text-align: left; width: 100%; gap: var(--spacing-sm); align-items: center;"
                    >
                      {#if appState.selectMode}
                        <div class="selection-checkbox-wrapper">
                          <div class="selection-checkbox" class:checked={appState.selectedNotes.has(note.path)}>
                            {#if appState.selectedNotes.has(note.path)}
                              ✓
                            {/if}
                          </div>
                        </div>
                      {/if}
                      
                      <div class="flex-col" style="flex-grow: 1; min-width: 0; gap: var(--spacing-xs);">
                        <div class="card-header-row flex-row" style="justify-content: space-between; width: 100%; align-items: center;">
                          <span class="card-note-title" style="flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--spacing-xs);">{note.name}</span>
                          <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; flex-shrink: 0;">
                            <span class="card-note-time">{new Date(note.modified).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                            {#if !appState.selectMode}
                              <!-- Rename button -->
                              <button 
                                class="card-action-btn flex-row" 
                                onclick={(e) => {
                                  e.stopPropagation();
                                  appState.showPrompt({
                                    title: 'Rename Note',
                                    message: 'Enter new title & file name:',
                                    value: note.name,
                                    placeholder: 'Note name...',
                                    onConfirm: async (newTitle) => {
                                      const trimmed = newTitle.trim();
                                      if (!trimmed || trimmed === note.name) return;
                                      try {
                                        await appState.renameNote(note.path, trimmed);
                                        appState.showToast('Note renamed successfully', 'success');
                                      } catch (err) {
                                        console.error(err);
                                        appState.showToast('Failed to rename note', 'error');
                                      }
                                    }
                                  });
                                }}
                                aria-label="Rename note"
                                title="Rename note"
                                style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                              >
                                <Edit3 size={14} />
                              </button>
                              <!-- Delete button -->
                              <button 
                                class="card-action-btn flex-row" 
                                onclick={(e) => {
                                  e.stopPropagation();
                                  confirmDeleteNote(note.path);
                                }}
                                aria-label="Delete note"
                                title="Delete note"
                                style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                              >
                                <Trash2 size={14} />
                              </button>
                            {/if}
                          </div>
                        </div>
                        {#if note.path.includes('/')}
                          <span class="card-notebook-badge">{note.path.split('/')[0]}</span>
                        {/if}
                      </div>
                    </div>
                  {:else}
                    <div class="empty-cards" style="font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: var(--spacing-lg) 0;">No notes found. Click the + button below to create one!</div>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Quick Daily Journal Prompt -->
            <div class="home-section">
              <div class="daily-prompt-card card-dark flex-row" onclick={handleMobileDailyNote}>
                <div class="card-art flex-row">🗓️</div>
                <div class="card-text flex-col">
                  <span class="card-headline">Write Daily Log</span>
                  <span class="card-sub">Record today's ideas & logs</span>
                </div>
                <ArrowRight size={20} class="arrow-accent" />
              </div>
            </div>
          </div>

        <!-- 3. LIBRARY TAB (Unified Search & Library) -->
        {:else if appState.activeTab === 'library'}
          <div class="mobile-tab-view flex-col">
            {#if appState.activeNotebook === null}
              <!-- Library Home / Search View -->
            {#if !appState.selectMode}
              <div class="mobile-header mobile-library-header flex-row" style="justify-content: space-between; width: 100%; align-items: center;">
                <h1>Your Library</h1>
                <div class="flex-row" style="gap: var(--spacing-sm); align-items: center;">
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => appState.showSettings = true}
                    aria-label="Settings"
                  >
                    <Settings size={20} />
                  </button>
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => showMobileFolderForm = !showMobileFolderForm}
                    aria-label="Add folder"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
            {:else}
              <div class="mobile-header bulk-select-header flex-row" style="justify-content: space-between; width: 100%; align-items: center; border-bottom: 1px dashed var(--border-color); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);">
                <div class="flex-row" style="gap: var(--spacing-sm); align-items: center;">
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => appState.toggleSelectMode()}
                    aria-label="Exit selection mode"
                    style="width: 32px; height: 32px;"
                  >
                    <X size={18} />
                  </button>
                  <span style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary);">
                    {appState.selectedNotes.size} selected
                  </span>
                </div>
                <button 
                  class="btn-pill btn-pill-outline" 
                  onclick={() => appState.selectAllNotes(appState.filteredNotes.map(n => n.path))}
                  style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm);"
                >
                  Select All
                </button>
              </div>
            {/if}

              {#if showMobileFolderForm}
                <form onsubmit={createMobileFolder} class="mobile-folder-form" style="width: 100%; margin-bottom: var(--spacing-xs);">
                  <input 
                    type="text" 
                    placeholder="New Notebook Name..." 
                    bind:value={newMobileFolder}
                    class="mobile-folder-input"
                    style="width: 100%; padding: var(--spacing-sm) var(--spacing-md); background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-standard); color: var(--text-primary); outline: none;"
                    required
                    autofocus
                  />
                </form>
              {/if}

              <!-- Search Bar -->
              <div class="mobile-search-bar flex-row">
                <Search size={20} class="search-icon" />
                <input 
                  type="text" 
                  placeholder="Search notes, content..." 
                  bind:value={mobileSearchInput}
                  oninput={() => appState.searchQuery = mobileSearchInput}
                  class="mobile-search-input"
                />
              </div>

              {#if appState.searchQuery.trim()}
                <!-- Search Results -->
                <div class="search-results flex-col" style="width: 100%; margin-top: var(--spacing-xs);">
                  <span class="section-title">Notes</span>
                  {#each appState.filteredNotes as note}
                    <button 
                      class="search-result-row flex-row" 
                      class:selected={appState.selectedNotes.has(note.path)}
                      onclick={(e) => {
                        if (appState.selectMode) {
                          e.preventDefault();
                          e.stopPropagation();
                          appState.toggleNoteSelection(note.path);
                        } else {
                          appState.selectNote(note.path);
                        }
                      }}
                      ontouchstart={(e) => handleNoteTouchStart(note.path, e)}
                      ontouchend={(e) => handleNoteTouchEnd(note.path, e)}
                      ontouchmove={handleNoteTouchMove}
                      style="width: 100%; text-align: left; align-items: center; gap: var(--spacing-sm); border: none; background: none; cursor: pointer;"
                    >
                      {#if appState.selectMode}
                        <div class="selection-checkbox-wrapper">
                          <div class="selection-checkbox" class:checked={appState.selectedNotes.has(note.path)}>
                            {#if appState.selectedNotes.has(note.path)}
                              ✓
                            {/if}
                          </div>
                        </div>
                      {/if}
                      <div class="row-art">📄</div>
                      <div class="row-info flex-col">
                        <span class="row-title">{note.name}</span>
                        <span class="row-sub">{note.path}</span>
                      </div>
                    </button>
                  {:else}
                    <div class="empty-list" style="font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: var(--spacing-lg) 0;">No matching notes found.</div>
                  {/each}
                </div>
              {:else}
                <!-- Notebooks List -->
                <div class="search-section flex-col" style="gap: var(--spacing-xs); width: 100%; margin-top: var(--spacing-xs);">
                  <span class="section-title">Notebooks</span>
                  <div class="notebook-list flex-col" style="gap: var(--spacing-xs);">
                    {#each appState.notebooks as notebook}
                      <div class="notebook-card-wrapper" style="position: relative; width: 100%;">
                        <button 
                          class="notebook-row flex-row" 
                          onclick={() => {
                            appState.activeNotebook = notebook;
                          }}
                          style="width: 100%; padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-comfortable); border: 1px solid var(--border-color); background-color: var(--bg-surface); gap: var(--spacing-sm); text-align: left; align-items: center;"
                        >
                          <Folder size={18} style="color: var(--accent); flex-shrink: 0;" />
                          <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-primary);">{notebook}</span>
                        </button>
                        <!-- Notebook Delete Button -->
                        <button
                          onclick={(e) => {
                            e.stopPropagation();
                            confirmDeleteNotebook(notebook);
                          }}
                          style="position: absolute; top: 50%; transform: translateY(-50%); right: 12px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: var(--spacing-xs); z-index: 2; display: flex; align-items: center; justify-content: center;"
                          aria-label="Delete notebook"
                          onmouseover={(e) => e.currentTarget.style.color = 'var(--semantic-error)'}
                          onmouseout={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    {:else}
                      <div class="empty-list" style="font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: var(--spacing-sm) 0; border: 1px dashed var(--border-color); border-radius: var(--radius-standard);">No notebooks created yet.</div>
                    {/each}
                  </div>
                </div>

                <!-- Recent Notes -->
                <div class="search-section flex-col" style="gap: var(--spacing-xs); width: 100%; margin-top: var(--spacing-md);">
                  <span class="section-title">Recent Notes</span>
                  <div class="recent-list flex-col" style="gap: var(--spacing-xs); width: 100%;">
                    {#each appState.recentNotes.slice(0, 8) as note}
                      <div 
                        class="search-result-row flex-row" 
                        class:selected={appState.selectedNotes.has(note.path)}
                        onclick={(e) => {
                          if (appState.selectMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            appState.toggleNoteSelection(note.path);
                          } else {
                            appState.selectNote(note.path);
                          }
                        }}
                        ontouchstart={(e) => handleNoteTouchStart(note.path, e)}
                        ontouchend={(e) => handleNoteTouchEnd(note.path, e)}
                        ontouchmove={handleNoteTouchMove}
                        style="width: 100%; text-align: left; align-items: center; justify-content: space-between; cursor: pointer;"
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
                      >
                        <div class="flex-row" style="gap: var(--spacing-sm); align-items: center; flex-grow: 1; min-width: 0;">
                          {#if appState.selectMode}
                            <div class="selection-checkbox-wrapper">
                              <div class="selection-checkbox" class:checked={appState.selectedNotes.has(note.path)}>
                                {#if appState.selectedNotes.has(note.path)}
                                  ✓
                                {/if}
                              </div>
                            </div>
                          {/if}
                          <div class="row-art">📄</div>
                          <div class="row-info flex-col" style="min-width: 0; flex-grow: 1;">
                            <span class="row-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{note.name}</span>
                            <span class="row-sub" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{note.path}</span>
                          </div>
                        </div>
                        <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; flex-shrink: 0; margin-left: var(--spacing-xs);">
                          {#if !appState.selectMode}
                            <!-- Rename button -->
                            <button 
                              class="row-action-btn flex-row" 
                              onclick={(e) => {
                                e.stopPropagation();
                                handleRenameNote(note.path, note.name);
                              }}
                              aria-label="Rename note"
                              title="Rename note"
                              style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                            >
                              <Edit3 size={14} />
                            </button>
                            <!-- Delete button -->
                            <button 
                              class="row-action-btn flex-row" 
                              onclick={(e) => {
                                e.stopPropagation();
                                confirmDeleteNote(note.path);
                              }}
                              aria-label="Delete note"
                              title="Delete note"
                              style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                            >
                              <Trash2 size={14} />
                            </button>
                          {/if}
                        </div>
                      </div>
                    {:else}
                      <div class="empty-list" style="font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: var(--spacing-sm) 0;">No notes found.</div>
                    {/each}
                  </div>
                </div>
              {/if}
            {:else}
              <!-- Folder Notes List View (Sub-view inside active notebook) -->
              {#if !appState.selectMode}
                <div class="mobile-header flex-row" style="justify-content: space-between; width: 100%; border-bottom: 1px dashed var(--border-color); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);">
                  <div class="flex-row" style="gap: var(--spacing-xs); max-width: 70%; align-items: center;">
                    <button 
                      class="icon-circle-btn flex-row" 
                      onclick={() => mobileNav.closeNotebook()}
                      aria-label="Back to Library"
                      style="width: 32px; height: 32px;"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: calc(100% - 40px);">
                      {appState.activeNotebook}
                    </span>
                  </div>
                  
                  <button 
                    class="btn-pill btn-pill-primary flex-row" 
                    onclick={() => {
                      handleCreateNote(appState.activeNotebook);
                    }}
                    style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm);"
                  >
                    <Plus size={12} style="margin-right: var(--spacing-2xs);" /> Add Note
                  </button>
                </div>
              {:else}
                <div class="mobile-header bulk-select-header flex-row" style="justify-content: space-between; width: 100%; align-items: center; border-bottom: 1px dashed var(--border-color); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);">
                  <div class="flex-row" style="gap: var(--spacing-sm); align-items: center;">
                    <button 
                      class="icon-circle-btn flex-row" 
                      onclick={() => appState.toggleSelectMode()}
                      aria-label="Exit selection mode"
                      style="width: 32px; height: 32px;"
                    >
                      <X size={18} />
                    </button>
                    <span style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary);">
                      {appState.selectedNotes.size} selected
                    </span>
                  </div>
                  <button 
                    class="btn-pill btn-pill-outline" 
                    onclick={() => appState.selectAllNotes(appState.filteredNotes.map(n => n.path))}
                    style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm);"
                  >
                    Select All
                  </button>
                </div>
              {/if}

              <!-- Search inside notebook -->
              <div class="mobile-search-bar flex-row" style="margin-bottom: var(--spacing-sm);">
                <Search size={18} class="search-icon" />
                <input 
                  type="text" 
                  placeholder="Search in this folder..." 
                  bind:value={mobileSearchInput}
                  oninput={() => appState.searchQuery = mobileSearchInput}
                  class="mobile-search-input"
                />
              </div>

              <!-- Notes list inside selected folder -->
              <div class="mobile-notes-list flex-col" style="width: 100%; gap: var(--spacing-sm);">
                {#each appState.filteredNotes as note}
                  <div 
                    class="recent-note-card flex-row" 
                    class:selected={appState.selectedNotes.has(note.path)}
                    onclick={(e) => {
                      if (appState.selectMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        appState.toggleNoteSelection(note.path);
                      } else {
                        appState.selectNote(note.path);
                      }
                    }}
                    ontouchstart={(e) => handleNoteTouchStart(note.path, e)}
                    ontouchend={(e) => handleNoteTouchEnd(note.path, e)}
                    ontouchmove={handleNoteTouchMove}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
                    style="background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-comfortable); padding: var(--spacing-md) var(--spacing-md); text-align: left; width: 100%; gap: var(--spacing-sm); cursor: pointer; align-items: center;"
                  >
                    {#if appState.selectMode}
                      <div class="selection-checkbox-wrapper">
                        <div class="selection-checkbox" class:checked={appState.selectedNotes.has(note.path)}>
                          {#if appState.selectedNotes.has(note.path)}
                            ✓
                          {/if}
                        </div>
                      </div>
                    {/if}
                    
                    <div class="flex-col" style="flex-grow: 1; min-width: 0; gap: var(--spacing-xs);">
                      <div class="card-header-row flex-row" style="justify-content: space-between; width: 100%; align-items: center;">
                        <span class="card-note-title" style="font-weight: 700; font-size: var(--font-size-sm); color: var(--text-primary); flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--spacing-xs);">{note.name}</span>
                        <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; flex-shrink: 0;">
                          <span class="card-note-time" style="font-size: var(--font-size-xs); color: var(--text-tertiary);">{new Date(note.modified).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                          {#if !appState.selectMode}
                            <!-- Rename button -->
                            <button 
                              class="card-action-btn flex-row" 
                              onclick={(e) => {
                                e.stopPropagation();
                                handleRenameNote(note.path, note.name);
                              }}
                              aria-label="Rename note"
                              title="Rename note"
                              style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                            >
                              <Edit3 size={14} />
                            </button>
                            <!-- Delete button -->
                            <button 
                              class="card-action-btn flex-row" 
                              onclick={(e) => {
                                e.stopPropagation();
                                confirmDeleteNote(note.path);
                              }}
                              aria-label="Delete note"
                              title="Delete note"
                              style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                            >
                              <Trash2 size={14} />
                            </button>
                          {/if}
                        </div>
                      </div>
                    </div>
                  </div>
                {:else}
                  <div class="empty-lib flex-col" style="align-items: center; justify-content: center; gap: var(--spacing-xs); padding: var(--spacing-xl) 0; color: var(--text-tertiary);">
                    <span style="font-size: var(--font-size-3xl);">📂</span>
                    <span class="title" style="font-weight: 600; font-size: var(--font-size-xs);">No notes found</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- 4. TAGS TAB -->
        {:else if appState.activeTab === 'tags'}
          <div class="mobile-tab-view flex-col">
            {#if appState.selectedTag === null}
              <!-- Tags list view (Root) -->
              <div class="mobile-header mobile-library-header flex-row" style="justify-content: space-between; width: 100%; align-items: center;">
                <h1>Tags</h1>
                <div class="flex-row" style="gap: var(--spacing-sm); align-items: center;">
                  <button 
                    class="icon-circle-btn flex-row" 
                    onclick={() => appState.showSettings = true}
                    aria-label="Settings"
                  >
                    <Settings size={20} />
                  </button>
                </div>
              </div>

              <!-- Search/filter tags bar -->
              <div class="mobile-search-bar flex-row" style="margin-bottom: var(--spacing-sm);">
                <Search size={18} class="search-icon" />
                <input 
                  type="text" 
                  placeholder="Search tags..." 
                  bind:value={mobileSearchInput}
                  oninput={() => appState.searchQuery = mobileSearchInput}
                  class="mobile-search-input"
                />
              </div>

              <div class="mobile-tags-list flex-col" style="gap: var(--spacing-xs); width: 100%; margin-top: var(--spacing-xs);">
                {#each sortedTags.filter(t => t.name.toLowerCase().includes(appState.searchQuery.toLowerCase())) as tag}
                  {@const count = getTagCount(tag)}
                  {@const tagColor = getTagColor(tag.name)}
                  <button 
                    class="mobile-tag-row flex-row" 
                    ontouchstart={(e) => handleTagTouchStart(tag.name, e)}
                    ontouchend={(e) => handleTagTouchEnd(tag.name, e)}
                    ontouchmove={handleTagTouchMove}
                    onclick={() => handleTagClick(tag.name)}
                    oncontextmenu={(e) => { e.preventDefault(); handleMobileTagLongPress(tag.name); }}
                    style="width: 100%; padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-comfortable); border: 1px solid var(--border-color); background-color: var(--bg-surface); gap: var(--spacing-sm); text-align: left; align-items: center; position: relative; cursor: pointer;"
                  >
                    <div class="tag-hash-icon" style="font-size: var(--font-size-sm); font-weight: 700; color: {tagColor || 'var(--accent)'}; opacity: 0.8; width: 16px; text-align: center;">#</div>
                    <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-primary); flex-grow: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">{tag.name}</span>
                    <span class="mobile-tag-badge" style="font-size: var(--font-size-xs); font-weight: 700; color: {tagColor || 'var(--text-secondary)'}; background-color: {tagColor ? tagColor + '33' : 'var(--bg-mid-dark)'}; padding: var(--spacing-3xs) var(--spacing-xs); border-radius: 999px;">{count}</span>
                  </button>
                {:else}
                  <div class="empty-list" style="font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: var(--spacing-lg) 0; border: 1px dashed var(--border-color); border-radius: var(--radius-standard);">No tags found.</div>
                {/each}
              </div>
            {:else}
              <!-- Tag Notes List View (Sub-view inside active tag) -->
              {#if !appState.selectMode}
                <div class="mobile-header flex-row" style="justify-content: space-between; width: 100%; border-bottom: 1px dashed var(--border-color); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);">
                  <div class="flex-row" style="gap: var(--spacing-xs); max-width: 70%; align-items: center;">
                    <button 
                      class="icon-circle-btn flex-row" 
                      onclick={() => mobileNav.closeTag()}
                      aria-label="Back to Tags"
                      style="width: 32px; height: 32px;"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: calc(100% - 40px);">
                      Tagged: {appState.selectedTag}
                    </span>
                  </div>
                  
                  <button 
                    class="btn-pill btn-pill-primary flex-row" 
                    onclick={() => {
                      handleCreateNote(appState.activeNotebook);
                    }}
                    style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm);"
                  >
                    <Plus size={12} style="margin-right: var(--spacing-2xs);" /> Add Note
                  </button>
                </div>
              {:else}
                <div class="mobile-header bulk-select-header flex-row" style="justify-content: space-between; width: 100%; align-items: center; border-bottom: 1px dashed var(--border-color); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);">
                  <div class="flex-row" style="gap: var(--spacing-sm); align-items: center;">
                    <button 
                      class="icon-circle-btn flex-row" 
                      onclick={() => appState.toggleSelectMode()}
                      aria-label="Exit selection mode"
                      style="width: 32px; height: 32px;"
                    >
                      <X size={18} />
                    </button>
                    <span style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary);">
                      {appState.selectedNotes.size} selected
                    </span>
                  </div>
                  <button 
                    class="btn-pill btn-pill-outline" 
                    onclick={() => appState.selectAllNotes(appState.filteredNotes.map(n => n.path))}
                    style="font-size: var(--font-size-xs); padding: var(--spacing-xs) var(--spacing-sm);"
                  >
                    Select All
                  </button>
                </div>
              {/if}

              <!-- Search inside selected tag -->
              <div class="mobile-search-bar flex-row" style="margin-bottom: var(--spacing-sm);">
                <Search size={18} class="search-icon" />
                <input 
                  type="text" 
                  placeholder="Search in this tag..." 
                  bind:value={mobileSearchInput}
                  oninput={() => appState.searchQuery = mobileSearchInput}
                  class="mobile-search-input"
                />
              </div>

              <!-- Notes list inside selected tag -->
              <div class="mobile-notes-list flex-col" style="width: 100%; gap: var(--spacing-sm);">
                {#each appState.filteredNotes as note}
                  <div 
                    class="recent-note-card flex-row" 
                    class:selected={appState.selectedNotes.has(note.path)}
                    onclick={(e) => {
                      if (appState.selectMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        appState.toggleNoteSelection(note.path);
                      } else {
                        appState.selectNote(note.path);
                      }
                    }}
                    ontouchstart={(e) => handleNoteTouchStart(note.path, e)}
                    ontouchend={(e) => handleNoteTouchEnd(note.path, e)}
                    ontouchmove={handleNoteTouchMove}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
                    style="background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-comfortable); padding: var(--spacing-md) var(--spacing-md); text-align: left; width: 100%; gap: var(--spacing-sm); cursor: pointer; align-items: center;"
                  >
                    {#if appState.selectMode}
                      <div class="selection-checkbox-wrapper">
                        <div class="selection-checkbox" class:checked={appState.selectedNotes.has(note.path)}>
                          {#if appState.selectedNotes.has(note.path)}
                            ✓
                          {/if}
                        </div>
                      </div>
                    {/if}
                    
                    <div class="flex-col" style="flex-grow: 1; min-width: 0; gap: var(--spacing-xs);">
                      <div class="card-header-row flex-row" style="justify-content: space-between; width: 100%; align-items: center;">
                        <span class="card-note-title" style="font-weight: 700; font-size: var(--font-size-sm); color: var(--text-primary); flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--spacing-xs);">{note.name}</span>
                        <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; flex-shrink: 0;">
                          <span class="card-note-time" style="font-size: var(--font-size-xs); color: var(--text-tertiary);">{new Date(note.modified).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                          {#if !appState.selectMode}
                            <!-- Rename button -->
                            <button 
                              class="card-action-btn flex-row" 
                              onclick={(e) => {
                                e.stopPropagation();
                                handleRenameNote(note.path, note.name);
                              }}
                              aria-label="Rename note"
                              title="Rename note"
                              style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                            >
                              <Edit3 size={14} />
                            </button>
                            <!-- Delete button -->
                            <button 
                              class="card-action-btn flex-row" 
                              onclick={(e) => {
                                e.stopPropagation();
                                confirmDeleteNote(note.path);
                              }}
                              aria-label="Delete note"
                              title="Delete note"
                              style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                            >
                              <Trash2 size={14} />
                            </button>
                          {/if}
                        </div>
                      </div>
                      {#if note.path.includes('/')}
                        <span class="card-notebook-badge" style="align-self: flex-start; font-size: var(--font-size-xs); background: rgba(255,255,255,0.05); padding: var(--spacing-3xs) var(--spacing-xs); border-radius: 4px; color: var(--text-secondary); font-weight: 600;">{note.path.split('/')[0]}</span>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <div class="empty-lib flex-col" style="align-items: center; justify-content: center; gap: var(--spacing-xs); padding: var(--spacing-xl) 0; color: var(--text-tertiary);">
                    <span style="font-size: var(--font-size-3xl);">🏷️</span>
                    <span class="title" style="font-weight: 600; font-size: var(--font-size-xs);">No notes found with this tag</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- 5. DAILY TAB -->
        {:else if appState.activeTab === 'daily'}
          <div class="mobile-tab-view flex-col">
            <div class="mobile-header">
              <h1>Daily Logs</h1>
            </div>
            
            <div class="daily-view flex-col">
              <div class="daily-hero card-dark flex-col">
                <div class="hero-art">🗓️</div>
                <h2>Keep a Daily Log</h2>
                <p>Journal thoughts, logs, and notes organized automatically by date.</p>
                <button class="btn-pill btn-pill-primary hero-btn" onclick={handleMobileDailyNote}>
                  Create/Open Today's Log
                </button>
              </div>

              <div class="daily-history flex-col">
                <span class="section-title">Past Logs</span>
                {#each appState.notes.filter(n => n.path.startsWith('Daily Notes/')) as note}
                  <div 
                    class="search-result-row flex-row" 
                    onclick={() => appState.selectNote(note.path)}
                    style="width: 100%; text-align: left; align-items: center; justify-content: space-between; cursor: pointer;"
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === 'Enter' && appState.selectNote(note.path)}
                  >
                    <div class="flex-row" style="gap: var(--spacing-sm); align-items: center; flex-grow: 1; min-width: 0;">
                      <div class="row-art">📅</div>
                      <div class="row-info flex-col" style="min-width: 0; flex-grow: 1;">
                        <span class="row-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{note.name}</span>
                        <span class="row-sub" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Daily Log</span>
                      </div>
                    </div>
                    <div class="flex-row" style="gap: var(--spacing-xs); align-items: center; flex-shrink: 0; margin-left: var(--spacing-xs);">
                      <!-- Rename button -->
                      <button 
                        class="row-action-btn flex-row" 
                        onclick={(e) => {
                          e.stopPropagation();
                          handleRenameNote(note.path, note.name);
                        }}
                        aria-label="Rename note"
                        title="Rename note"
                        style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                      >
                        <Edit3 size={14} />
                      </button>
                      <!-- Delete button -->
                      <button 
                        class="row-action-btn flex-row" 
                        onclick={(e) => {
                          e.stopPropagation();
                          confirmDeleteNote(note.path);
                        }}
                        aria-label="Delete note"
                        title="Delete note"
                        style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-2xs); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;"
                        onmouseover={(e) => e.currentTarget.style.color = 'var(--semantic-error)'}
                        onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                {:else}
                  <span class="empty-text">No daily notes written yet</span>
                {/each}
              </div>
            </div>
          </div>


        {/if}
      </div>

      <!-- Floating Action Button (FAB) on Mobile -->
      {#if appState.activeTab === 'library' || appState.activeTab === 'home' || appState.activeTab === 'tags'}
        <button 
          class="mobile-fab flex-row" 
          class:open={showQuickCreate}
          onclick={() => (showQuickCreate = !showQuickCreate)}
          aria-label="Quick create"
          aria-haspopup="menu"
          aria-expanded={showQuickCreate}
        >
          <span class="fab-icon flex-row"><Plus size={24} /></span>
        </button>
      {/if}

      <!-- UI-M-003: Quick Create speed-dial bottom sheet -->
      <BottomSheet show={showQuickCreate} onClose={() => (showQuickCreate = false)} title="Create new">
        {#if appState.activeNotebook}
          <span class="quick-create-context flex-row">
            <Folder size={12} style="color: var(--accent);" /> in “{appState.activeNotebook}”
          </span>
        {/if}

        <button type="button" class="quick-create-row flex-row" onclick={quickCreateNote}>
          <span class="quick-create-icon flex-row" style="background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent);"><FileText size={18} /></span>
          <span class="flex-col" style="align-items: flex-start; gap: 1px;">
            <span class="quick-create-label">New Note</span>
            <span class="quick-create-desc">Start a blank note{appState.activeNotebook ? ' in this notebook' : ''}</span>
          </span>
        </button>

        <button type="button" class="quick-create-row flex-row" onclick={quickCreateDaily}>
          <span class="quick-create-icon flex-row" style="background: color-mix(in srgb, var(--semantic-info, #539df5) 16%, transparent); color: var(--semantic-info, #539df5);"><Calendar size={18} /></span>
          <span class="flex-col" style="align-items: flex-start; gap: 1px;">
            <span class="quick-create-label">Daily Log</span>
            <span class="quick-create-desc">Open or create today’s log</span>
          </span>
        </button>

        <button type="button" class="quick-create-row flex-row" onclick={quickCreateNotebook}>
          <span class="quick-create-icon flex-row" style="background: color-mix(in srgb, var(--semantic-warning, #ffa42b) 16%, transparent); color: var(--semantic-warning, #ffa42b);"><FolderPlus size={18} /></span>
          <span class="flex-col" style="align-items: flex-start; gap: 1px;">
            <span class="quick-create-label">New Notebook</span>
            <span class="quick-create-desc">Create a folder to organize notes</span>
          </span>
        </button>
      </BottomSheet>

      <!-- Android Bottom Navigation Bar (Spotify Style) -->
      <MobileTabBar onNavigate={() => (mobileSearchInput = '')} />
    {/if}

    <!-- ST-013: Mobile Tag Actions Menu Bottom Sheet -->
    <BottomSheet
      show={showMobileTagActions && !!mobileTagActionsTag}
      onClose={() => showMobileTagActions = false}
      title={mobileTagActionsTag ? `Tag Options: #${mobileTagActionsTag}` : 'Tag Options'}
    >
      <div class="mobile-tag-options-list flex-col" style="width: 100%; gap: var(--spacing-sm); margin-top: var(--spacing-2xs);">
        <button
          class="btn-pill flex-row"
          onclick={triggerMobileTagRename}
          style="background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid var(--border-color); padding: var(--spacing-sm) var(--spacing-md); border-radius: 8px; justify-content: flex-start; gap: var(--spacing-sm); color: var(--text-primary); cursor: pointer;"
        >
          <Edit3 size={16} style="color: var(--accent);" />
          <span style="font-size: var(--font-size-sm); font-weight: 600;">Rename Tag</span>
        </button>

        <button
          class="btn-pill flex-row"
          onclick={triggerMobileTagColor}
          style="background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid var(--border-color); padding: var(--spacing-sm) var(--spacing-md); border-radius: 8px; justify-content: flex-start; gap: var(--spacing-sm); color: var(--text-primary); cursor: pointer;"
        >
          <Palette size={16} style="color: var(--accent);" />
          <span style="font-size: var(--font-size-sm); font-weight: 600;">Change Color</span>
        </button>

        <button
          class="btn-pill flex-row"
          onclick={triggerMobileTagDelete}
          style="background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid var(--border-color); padding: var(--spacing-sm) var(--spacing-md); border-radius: 8px; justify-content: flex-start; gap: var(--spacing-sm); color: var(--semantic-error); cursor: pointer;"
        >
          <Trash2 size={16} style="color: var(--semantic-error);" />
          <span style="font-size: var(--font-size-sm); font-weight: 600;">Delete Tag</span>
        </button>
      </div>
    </BottomSheet>

    <!-- ST-010: Mobile Tag Color Picker Bottom Sheet -->
    <BottomSheet
      show={!!mobileColorPickerTag}
      onClose={() => mobileColorPickerTag = null}
      title={mobileColorPickerTag ? `Color for #${mobileColorPickerTag}` : 'Tag Color'}
    >
      <div class="color-picker-grid">
        {#each TAG_COLOR_PALETTE as color}
          {@const isActive = getTagColor(mobileColorPickerTag ?? '') === color}
          <button
            class="color-swatch"
            class:active={isActive}
            style="background-color: {color};"
            onclick={() => handleSetMobileColor(mobileColorPickerTag ?? '', color)}
            aria-label="Set color to {color}"
          >
            {#if isActive}<span class="swatch-check">✓</span>{/if}
          </button>
        {/each}
      </div>
      <div class="custom-hex-container flex-row" style="margin: var(--spacing-sm) 0; gap: var(--spacing-sm); align-items: center; border-top: 1px dashed color-mix(in srgb, var(--text-primary) 8%, transparent); padding-top: var(--spacing-sm); width: 100%;">
        <div class="color-preview-circle" style="width: 20px; height: 20px; border-radius: 50%; background-color: {normalizedMobileCustomHex || 'transparent'}; border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent); flex-shrink: 0;"></div>
        <input
          type="text"
          placeholder="Custom Hex (e.g. #ff0055)"
          bind:value={mobileCustomHexValue}
          style="flex: 1; padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-size-xs); background: color-mix(in srgb, var(--text-primary) 6%, transparent); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-primary); outline: none;"
        />
        <button
          type="button"
          disabled={!isMobileCustomHexValid}
          onclick={() => handleSetMobileColor(mobileColorPickerTag ?? '', normalizedMobileCustomHex)}
          style="padding: var(--spacing-xs) var(--spacing-md); font-size: var(--font-size-xs); cursor: pointer; opacity: {isMobileCustomHexValid ? 1 : 0.5}; background: var(--accent); border: none; border-radius: 6px; color: var(--text-primary); font-weight: 600;"
        >
          Apply
        </button>
      </div>
      <button class="color-reset-btn" onclick={() => handleSetMobileColor(mobileColorPickerTag ?? '', null)} style="margin-top: var(--spacing-xs);">
        <X size={12} />
        <span>Reset Color</span>
      </button>
    </BottomSheet>

    <!-- UI-M-009: Full-screen mobile search overlay -->
    <MobileSearch show={showMobileSearch} onClose={() => (showMobileSearch = false)} />
    <!-- ST-011: Mobile Bulk Action Bar -->
    {#if appState.selectMode}
      <div class="mobile-bulk-action-bar" transition:fly={{ y: 80, duration: 250, easing: cubicOut }}>
        <!-- Header row -->
        <div class="flex-row" style="justify-content: space-between; align-items: center; width: 100%; border-bottom: 1px solid var(--border-color); padding-bottom: var(--spacing-xs);">
          <span class="selected-count" style="font-weight: 700; font-size: var(--font-size-xs); color: var(--text-primary);">
            {appState.selectedNotes.size} {appState.selectedNotes.size === 1 ? 'note' : 'notes'} selected
          </span>
          <button 
            class="flex-row" 
            onclick={() => appState.toggleSelectMode()}
            style="background: transparent; border: none; color: var(--text-secondary); font-size: var(--font-size-xs); font-weight: 600; cursor: pointer; padding: var(--spacing-2xs);"
          >
            Cancel
          </button>
        </div>
        <!-- Actions row -->
        <div class="flex-row" style="gap: var(--spacing-xs); width: 100%; justify-content: space-between;">
          <button 
            class="btn-pill btn-pill-primary flex-row" 
            disabled={appState.selectedNotes.size === 0}
            onclick={() => openMobileBulkTagPicker('tag')}
            style="flex: 1; gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-2xs); align-items: center; justify-content: center; font-size: var(--font-size-xs); text-transform: uppercase; font-weight: 700; border-radius: 20px;"
          >
            <Plus size={12} />
            <span>Tag</span>
          </button>
          <button 
            class="btn-pill btn-pill-outline flex-row" 
            disabled={appState.selectedNotes.size === 0}
            onclick={() => openMobileBulkTagPicker('untag')}
            style="flex: 1; gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-2xs); align-items: center; justify-content: center; font-size: var(--font-size-xs); text-transform: uppercase; font-weight: 700; border-radius: 20px;"
          >
            <X size={12} />
            <span>Untag</span>
          </button>
          <button 
            class="btn-pill btn-pill-outline flex-row" 
            disabled={appState.selectedNotes.size === 0}
            onclick={() => showMobileBulkNotebookPicker = true}
            style="flex: 1; gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-2xs); align-items: center; justify-content: center; font-size: var(--font-size-xs); text-transform: uppercase; font-weight: 700; border-radius: 20px;"
          >
            <Folder size={12} />
            <span>Move</span>
          </button>
          <button 
            class="btn-pill btn-pill-outline flex-row" 
            disabled={appState.selectedNotes.size === 0}
            onclick={handleMobileBulkDelete}
            style="flex: 1; gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-2xs); align-items: center; justify-content: center; font-size: var(--font-size-xs); text-transform: uppercase; font-weight: 700; border-radius: 20px; color: var(--semantic-error); border-color: color-mix(in srgb, var(--semantic-error) 20%, transparent);"
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- ST-011: Mobile Bulk Tag Picker Bottom Sheet -->
    {#if showMobileBulkPicker}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="picker-backdrop"
        onclick={closeMobileBulkPicker}
        onkeydown={(e) => e.key === 'Escape' && closeMobileBulkPicker()}
      ></div>
      <div class="mobile-color-picker-popover flex-col" transition:fly={{ y: 200, duration: 200, easing: cubicOut }}>
        <div class="color-picker-header flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
          <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-primary);">
            {mobileBulkPickerMode === 'tag' ? 'Apply Tag in Bulk' : 'Remove Tag in Bulk'}
          </span>
          <button 
            class="icon-circle-btn flex-row" 
            onclick={closeMobileBulkPicker}
            aria-label="Close"
            style="width: 24px; height: 24px; min-width: 24px; border: none; background: color-mix(in srgb, var(--text-primary) 8%, transparent);"
          >
            <X size={14} />
          </button>
        </div>
        
        <div style="margin-bottom: var(--spacing-sm); width: 100%;">
          <input 
            type="text" 
            placeholder="Search tags..." 
            bind:value={mobileBulkSearch}
            style="width: 100%; padding: var(--spacing-sm) var(--spacing-md); background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-standard); color: var(--text-primary); outline: none;"
          />
        </div>

        <div class="mobile-picker-list flex-col" style="max-height: 240px; overflow-y: auto; width: 100%; gap: var(--spacing-xs);">
          {#each filteredMobileTagsForPicker as tag}
            {@const tagColor = getTagColor(tag.name)}
            <button 
              class="mobile-tag-row flex-row" 
              onclick={() => handleMobileBulkAction(tag.name)}
              style="width: 100%; padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-comfortable); border: 1px solid var(--border-color); background-color: var(--bg-surface); gap: var(--spacing-sm); text-align: left; align-items: center; cursor: pointer;"
            >
              <div class="tag-hash-icon" style="font-size: var(--font-size-sm); font-weight: 700; color: {tagColor || 'var(--accent)'}; opacity: 0.8; width: 16px; text-align: center;">#</div>
              <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-primary); flex-grow: 1;">{tag.name}</span>
            </button>
          {:else}
            <div style="font-size: var(--font-size-xs); color: var(--text-secondary); text-align: center; padding: var(--spacing-md);">No matching tags.</div>
          {/each}

          {#if mobileBulkPickerMode === 'tag' && mobileBulkSearch.trim() && !filteredMobileTagsForPicker.some(t => t.name.toLowerCase() === mobileBulkSearch.toLowerCase().trim())}
            <button 
              class="mobile-tag-row flex-row" 
              onclick={() => handleMobileBulkCreateAndAdd(mobileBulkSearch)}
              style="width: 100%; padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-comfortable); border: 1px solid var(--accent); background-color: color-mix(in srgb, var(--accent) 10%, transparent); gap: var(--spacing-sm); text-align: left; align-items: center; cursor: pointer; color: var(--accent);"
            >
              <span style="font-size: var(--font-size-xs); font-weight: 700;">+ Create & Apply "{mobileBulkSearch.trim()}"</span>
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <!-- ST-014: Mobile Bulk Move Notebook Picker Bottom Sheet -->
    {#if showMobileBulkNotebookPicker}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="picker-backdrop"
        onclick={() => showMobileBulkNotebookPicker = false}
        onkeydown={(e) => e.key === 'Escape' && (showMobileBulkNotebookPicker = false)}
      ></div>
      <div class="mobile-color-picker-popover flex-col" transition:fly={{ y: 200, duration: 200, easing: cubicOut }}>
        <div class="color-picker-header flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
          <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-primary);">
            Move to Notebook
          </span>
          <button 
            class="icon-circle-btn flex-row" 
            onclick={() => showMobileBulkNotebookPicker = false}
            aria-label="Close"
            style="width: 24px; height: 24px; min-width: 24px; border: none; background: color-mix(in srgb, var(--text-primary) 8%, transparent);"
          >
            <X size={14} />
          </button>
        </div>
        
        <div class="mobile-picker-list flex-col" style="max-height: 240px; overflow-y: auto; width: 100%; gap: var(--spacing-xs);">
          <button 
            class="btn-pill flex-row" 
            onclick={() => handleMobileBulkMove(null)}
            style="background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid var(--border-color); padding: var(--spacing-sm) var(--spacing-md); border-radius: 8px; justify-content: flex-start; gap: var(--spacing-sm); color: var(--text-primary); cursor: pointer;"
          >
            <FolderOpen size={16} style="color: var(--accent);" />
            <span style="font-size: var(--font-size-sm); font-weight: 600;">[Root Folder]</span>
          </button>
          {#each appState.notebooks as notebook}
            <button 
              class="btn-pill flex-row" 
              onclick={() => handleMobileBulkMove(notebook)}
              style="background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid var(--border-color); padding: var(--spacing-sm) var(--spacing-md); border-radius: 8px; justify-content: flex-start; gap: var(--spacing-sm); color: var(--text-primary); cursor: pointer;"
            >
              <Folder size={16} style="color: var(--accent);" />
              <span style="font-size: var(--font-size-sm); font-weight: 600;">{notebook}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{:else}
  <!-- ============================================== -->
  <!-- DESKTOP VIEW                                   -->
  <!-- ============================================== -->
  <div class="desktop-layout flex-col">
    <!-- Application Header / Top Bar (UI-D-003) -->
    <AppHeader />

    <div class="desktop-app flex-row" style="position: relative;">
      <!-- Left Sidebar (Notebook / Tag Selection) -->
      <Sidebar />

      {#if !appState.sidebarCollapsed && !appState.notelistCollapsed}
        <ResizeHandle onResize={(delta) => appState.resizeSidebar(delta)} />
      {/if}

      <!-- Middle Panel (Note list) -->
      <NoteList />

      {#if !appState.notelistCollapsed && !appState.editorCollapsed}
        <ResizeHandle onResize={(delta) => appState.resizeNotelist(delta)} />
      {/if}

      <!-- Right Panel (Editor) -->
      <div class="editor-panel flex-row" style="display: {appState.editorCollapsed ? 'none' : 'flex'}; min-width: 0;">
        <Editor />
      </div>

      {#if appState.sidebarCollapsed && appState.notelistCollapsed && appState.editorCollapsed}
        <div class="all-collapsed-placeholder flex-col" style="flex-grow: 1; align-items: center; justify-content: center; gap: var(--spacing-md); color: var(--text-secondary); background-color: var(--bg-base); height: 100%;">
          <span>All sections are collapsed.</span>
          <button 
            class="btn-pill btn-pill-primary" 
            onclick={() => {
              appState.setSidebarCollapsed(false);
              appState.setNotelistCollapsed(false);
              appState.setEditorCollapsed(false);
            }}
          >
            Restore All Sections
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Move / Copy Note Modal Overlay -->
<Modal
  show={appState.showMoveCopyModal && !!appState.moveCopyNotePath}
  title="Move or Copy Note"
  onClose={() => appState.showMoveCopyModal = false}
  bodyStyle="padding: var(--spacing-lg) var(--spacing-lg); gap: var(--spacing-md);"
>
  {#snippet titleIcon()}
    <FolderOpen size={20} class="sync-icon-accent" style="color: var(--accent);" />
  {/snippet}

  <div class="move-copy-body flex-col" style="gap: var(--spacing-md);">
    <div class="flex-col" style="gap: var(--spacing-2xs);">
      <span style="font-size: var(--font-size-xs); text-transform: uppercase; color: var(--text-tertiary); font-weight: 700; letter-spacing: 0.5px;">Note to organize</span>
      <span style="font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary);">{appState.moveCopyNoteName}</span>
      <span style="font-size: var(--font-size-xs); color: var(--text-secondary); word-break: break-all; opacity: 0.7;">Current path: {appState.moveCopyNotePath}</span>
    </div>

    <div class="flex-col" style="gap: var(--spacing-xs);">
      <span style="font-size: var(--font-size-xs); text-transform: uppercase; color: var(--text-tertiary); font-weight: 700; letter-spacing: 0.5px;">Select Destination Notebook</span>
      
      <div class="notebook-select-list flex-col" style="max-height: 200px; overflow-y: auto; gap: var(--spacing-2xs); border: 1px solid var(--border-color); border-radius: 6px; padding: var(--spacing-2xs);">
        <!-- Root Folder Option -->
        <button 
          class="notebook-select-row flex-row"
          class:selected={selectedTargetNotebook === null}
          onclick={() => selectedTargetNotebook = null}
        >
          <span class="folder-icon">📂</span>
          <span class="folder-name">Root / (No notebook)</span>
          {#if selectedTargetNotebook === null}
            <span class="selected-checkmark">✓</span>
          {/if}
        </button>

        <!-- Available Notebooks -->
        {#each appState.notebooks as notebook}
          <button 
            class="notebook-select-row flex-row"
            class:selected={selectedTargetNotebook === notebook}
            onclick={() => selectedTargetNotebook = notebook}
          >
            <span class="folder-icon">📁</span>
            <span class="folder-name">{notebook}</span>
            {#if selectedTargetNotebook === notebook}
              <span class="selected-checkmark">✓</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Create New Notebook Section -->
    <div class="flex-col" style="gap: var(--spacing-xs); border-top: 1px dashed var(--border-color); padding-top: var(--spacing-md);">
      <span style="font-size: var(--font-size-xs); text-transform: uppercase; color: var(--text-tertiary); font-weight: 700; letter-spacing: 0.5px;">Or Create New Notebook</span>
      <div class="flex-row" style="gap: var(--spacing-xs);">
        <input 
          type="text" 
          placeholder="New notebook name..." 
          bind:value={newNotebookName}
          style="flex-grow: 1; background: var(--bg-base); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-size-xs); outline: none;"
          onkeydown={(e) => { if (e.key === 'Enter') handleCreateNotebookInModal(); }}
        />
        <button 
          class="btn-pill btn-pill-outline" 
          style="padding: 0 var(--spacing-md); font-size: var(--font-size-xs); height: 36px;"
          onclick={handleCreateNotebookInModal}
        >
          Create
        </button>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <button 
      class="btn-pill btn-pill-outline" 
      style="padding: var(--spacing-xs) var(--spacing-md); height: 38px;"
      onclick={() => appState.showMoveCopyModal = false}
    >
      Cancel
    </button>
    <button 
      class="btn-pill btn-pill-outline" 
      style="padding: var(--spacing-xs) var(--spacing-md); height: 38px; color: var(--accent); border-color: var(--accent);"
      onclick={handleCopyNoteInModal}
    >
      Copy Note
    </button>
    <button 
      class="btn-pill btn-pill-primary" 
      style="padding: var(--spacing-xs) var(--spacing-lg); height: 38px;"
      onclick={handleMoveNoteInModal}
    >
      Move Note
    </button>
  {/snippet}
</Modal>

<!-- Settings Modal (Extracted Component) -->
{#if isMobile}
  <!-- UI-M-013: full-screen sectioned mobile settings -->
  <MobileSettings />
{:else}
  <SettingsModal />
{/if}

<!-- Toast Notifications Container -->
<div class="toast-container flex-col">
  {#each appState.toasts as toast (toast.id)}
    <ToastItem {toast} />
  {/each}
</div>

<!-- ST-016: Global Custom Delete Confirmation Modal -->
<!-- ST-016: Global Custom Delete Confirmation Modal -->
<Modal
  show={appState.showConfirmModal}
  title={appState.confirmTitle}
  onClose={() => appState.closeConfirmation()}
  style="max-width: 400px;"
  bodyStyle="padding: var(--spacing-md) var(--spacing-lg);"
>
  {#snippet titleIcon()}
    <div class="custom-confirm-warning-icon flex-row" style="color: var(--semantic-error); background: rgba(255, 77, 77, 0.1); padding: var(--spacing-xs); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    </div>
  {/snippet}

  <p class="custom-confirm-message" style="margin: 0; font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.5;">{appState.confirmMessage}</p>

  {#snippet footer()}
    <button 
      type="button" 
      class="btn-pill btn-pill-outline custom-confirm-cancel-btn"
      onclick={() => appState.closeConfirmation()}
    >
      Cancel
    </button>
    <button 
      type="button" 
      class="btn-pill custom-confirm-danger-btn"
      onclick={() => appState.confirmOnConfirm?.()}
      style="background: var(--semantic-error); color: var(--text-primary); border: none; font-weight: 600; padding: var(--spacing-xs) var(--spacing-md); border-radius: 999px; cursor: pointer;"
    >
      {appState.confirmButtonText}
    </button>
  {/snippet}
</Modal>

<!-- Global Custom Prompt Modal (UI-D-007, UI-D-010) -->
<Modal
  show={appState.showPromptModal}
  title={appState.promptTitle}
  onClose={() => appState.closePrompt()}
  style="max-width: 400px;"
  bodyStyle="padding: var(--spacing-md) var(--spacing-lg);"
>
  <form 
    onsubmit={(e) => {
      e.preventDefault();
      appState.promptOnConfirm?.(appState.promptValue);
      appState.closePrompt();
    }}
    style="display: flex; flex-direction: column; width: 100%; gap: var(--spacing-sm);"
  >
    {#if appState.promptMessage}
      <p class="custom-confirm-message" style="margin: 0; font-size: var(--font-size-xs); color: var(--text-secondary); opacity: 0.8; line-height: 1.4;">
        {appState.promptMessage}
      </p>
    {/if}
    
    <input 
      type="text"
      class="create-input"
      placeholder={appState.promptPlaceholder}
      bind:value={appState.promptValue}
      required
      style="width: 100%; box-sizing: border-box; background: var(--bg-base); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-size-xs); outline: none;"
    />
    
    <div class="custom-confirm-actions flex-row" style="justify-content: flex-end; gap: var(--spacing-sm); width: 100%; margin-top: var(--spacing-sm);">
      <button 
        type="button" 
        class="btn-pill btn-pill-outline custom-confirm-cancel-btn"
        onclick={() => appState.closePrompt()}
      >
        Cancel
      </button>
      <button 
        type="submit" 
        class="btn-pill btn-pill-primary"
      >
        Confirm
      </button>
    </div>
  </form>
</Modal>

<style>
  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .desktop-layout {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg-base);
    overflow: hidden;
  }

  .desktop-app {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: calc(100% - var(--header-height));
    background-color: var(--bg-base);
    overflow: hidden;
  }

  .editor-panel {
    flex-grow: 1;
    height: 100%;
    overflow: hidden;
  }

  /* ============================================== */
  /* Mobile Android Layout Styles                   */
  /* ============================================== */
  .mobile-app {
    width: 100%;
    height: 100%;
    background-color: var(--bg-base);
    overflow: hidden;
    position: relative;
  }

  .mobile-content {
    flex-grow: 1;
    overflow-y: auto;
    padding-bottom: 90px; /* space for bottom nav and FAB */
    min-height: 0;
    -webkit-overflow-scrolling: touch;
  }

  .mobile-tab-view {
    padding: var(--spacing-lg) var(--spacing-md);
    gap: var(--spacing-lg);
    min-height: 100%;
  }

  .mobile-header {
    justify-content: space-between;
  }

  .mobile-header h1 {
    font-size: var(--font-size-xl);
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }

  .home-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .section-title {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  /* Recent Note Cards List */
  .recent-cards-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .recent-note-card {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md) var(--spacing-md);
    text-align: left;
    width: 100%;
    gap: var(--spacing-xs);
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
  }

  .recent-note-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--bg-base) 25%, transparent);
    border-color: var(--border-highlight);
  }

  .recent-note-card:active {
    transform: translateY(0) scale(0.98);
    background-color: var(--bg-mid-dark);
  }

  .card-header-row {
    justify-content: space-between;
    width: 100%;
  }

  .card-note-title {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-note-time {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }



  .card-notebook-badge {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--accent);
    background-color: color-mix(in srgb, var(--accent) 8%, transparent);
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: var(--radius-pill);
    align-self: flex-start;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Cards */
  .daily-prompt-card {
    padding: var(--spacing-sm) var(--spacing-md);
    gap: var(--spacing-sm);
    border-radius: var(--radius-comfortable);
    cursor: pointer;
  }

  .card-art {
    font-size: var(--font-size-3xl);
  }

  .card-text {
    flex-grow: 1;
  }

  .card-headline {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-sub {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: var(--spacing-3xs);
  }

  .arrow-accent {
    color: var(--accent);
  }

  /* Search Input Mobile */
  .mobile-search-bar {
    background-color: var(--bg-surface);
    border-radius: var(--radius-subtle);
    padding: var(--spacing-xs) var(--spacing-sm);
    gap: var(--spacing-xs);
    width: 100%;
  }

  .mobile-search-input {
    width: 100%;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
  }

  .mobile-search-input::placeholder {
    color: var(--text-tertiary);
  }

  /* Notebook search lists */
  .notebook-row {
    transition: transform 0.15s ease, background-color 0.2s ease;
  }

  .notebook-row:active {
    transform: scale(0.98);
    background-color: var(--bg-mid-dark) !important;
  }

  /* Search Result List */
  .search-results, .mobile-notes-list {
    gap: var(--spacing-xs);
  }

  .search-result-row {
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-2xs);
    gap: var(--spacing-sm);
    text-align: left;
    border-radius: var(--radius-standard);
    transition: background-color 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .search-result-row:hover {
    background-color: var(--bg-surface);
    transform: translateX(4px);
  }

  .search-result-row:active {
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    transform: scale(0.98);
  }

  .row-art {
    width: 38px;
    height: 38px;
    background-color: var(--bg-surface);
    border-radius: var(--radius-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-md);
    flex-shrink: 0;
  }

  .row-info {
    overflow: hidden;
  }

  .row-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-sub {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: var(--spacing-3xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Library Tab */
  .mobile-library-header {
    justify-content: space-between;
  }

  .icon-circle-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    justify-content: center;
  }

  .mobile-folder-form {
    width: 100%;
  }

  .mobile-folder-input {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-subtle);
    width: 100%;
    font-size: var(--font-size-xs);
  }

  .mobile-folder-input:focus {
    border-color: var(--accent);
  }

  .lib-filters {
    gap: var(--spacing-xs);
    overflow-x: auto;
    padding-bottom: var(--spacing-3xs);
    -webkit-overflow-scrolling: touch;
  }

  .lib-filters::-webkit-scrollbar {
    display: none;
  }

  .lib-filter-pill {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-full-pill);
    background-color: var(--bg-surface);
    font-size: var(--font-size-xs);
    font-weight: 600;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .lib-filter-pill.active {
    background-color: var(--accent);
    color: var(--bg-base);
  }

  .list-meta {
    justify-content: space-between;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    padding: var(--spacing-2xs);
  }

  .add-note-mobile {
    padding: var(--spacing-2xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
  }

  .empty-lib {
    padding: var(--spacing-xl) 0;
    align-items: center;
    gap: var(--spacing-xs);
    color: var(--text-tertiary);
  }

  .empty-lib span {
    font-size: var(--font-size-3xl);
  }

  .empty-lib .title {
    font-size: var(--font-size-xs);
  }

  /* Daily Tab */
  .daily-view {
    gap: var(--spacing-lg);
  }

  .daily-hero {
    align-items: center;
    text-align: center;
    padding: var(--spacing-lg) var(--spacing-md);
    gap: var(--spacing-sm);
  }

  .hero-art {
    font-size: 3rem;
  }

  .daily-hero h2 {
    font-size: var(--font-size-base);
    font-weight: 700;
  }

  .daily-hero p {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    max-width: 240px;
    line-height: 1.5;
  }

  .hero-btn {
    margin-top: var(--spacing-xs);
    font-size: var(--font-size-xs);
  }

  .daily-history {
    gap: var(--spacing-xs);
  }

  /* Mobile Bottom Navigation Bar - Floating Pill */

  /* Floating Action Button (FAB) */
  .mobile-fab {
    position: absolute;
    bottom: calc(92px + env(safe-area-inset-bottom, 0px)); /* sits above floating bottom nav + safe area */
    right: calc(20px + env(safe-area-inset-right, 0px));
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background-color: var(--accent);
    color: var(--bg-base);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 35%, transparent);
    justify-content: center;
    z-index: 10000; /* above the quick-create backdrop (9998) and sheet (9999) */
    transition: transform 0.15s ease, background-color 0.2s;
    touch-action: manipulation;
  }

  .mobile-fab:active {
    transform: scale(0.9);
  }

  .fab-icon {
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .mobile-fab.open .fab-icon {
    transform: rotate(45deg);
  }

  /* UI-M-003: Quick Create speed-dial sheet (rendered via BottomSheet) */
  .quick-create-context {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    gap: var(--spacing-3xs);
    padding: 0 var(--spacing-2xs);
    margin-bottom: var(--spacing-2xs);
  }

  .quick-create-row {
    gap: var(--spacing-md);
    align-items: center;
    width: 100%;
    min-height: 56px;
    padding: var(--spacing-xs) var(--spacing-2xs);
    background: none;
    border: none;
    border-radius: var(--radius-comfortable);
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .quick-create-row:active {
    background-color: var(--bg-mid-dark);
  }

  .quick-create-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-standard);
    justify-content: center;
    flex-shrink: 0;
  }

  .quick-create-label {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .quick-create-desc {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  /* UI-M-004: Favorites carousel */
  .fav-carousel {
    display: flex;
    flex-direction: row;
    gap: var(--spacing-sm);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding-bottom: var(--spacing-3xs);
  }

  .fav-carousel::-webkit-scrollbar {
    display: none;
  }

  .fav-card {
    scroll-snap-align: start;
    flex: 0 0 auto;
    width: 150px;
    min-height: 92px;
    gap: var(--spacing-xs);
    align-items: flex-start;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
    cursor: pointer;
    text-align: left;
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .fav-card:active {
    transform: scale(0.97);
    border-color: var(--border-highlight);
  }

  .fav-card-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-standard);
    background-color: color-mix(in srgb, var(--accent) 12%, transparent);
    justify-content: center;
  }

  .fav-card-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.3;
  }

  /* UI-M-004: Pull-to-refresh indicator */
  .ptr-indicator {
    width: 100%;
    justify-content: center;
    align-items: flex-end;
    overflow: hidden;
    color: var(--accent);
  }

  .ptr-spinner {
    justify-content: center;
    align-items: center;
    margin-bottom: var(--spacing-xs);
  }

  /* Full-Screen Mobile Editor Overlay */
  .mobile-editor-container {
    width: 100%;
    height: 100%;
    background-color: var(--bg-base);
    z-index: 50;
    position: absolute;
    top: 0;
    left: 0;
  }

  .mobile-editor-top {
    height: 56px;
    background-color: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
    padding: 0 var(--spacing-md);
    justify-content: space-between;
    flex-shrink: 0;
  }

  .back-btn {
    color: var(--text-primary);
    font-weight: 700;
    gap: var(--spacing-2xs);
  }

  .back-text {
    font-size: var(--font-size-sm);
  }

  .editor-note-meta {
    align-items: center;
    max-width: 50%;
  }

  .small-tag {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
  }

  .note-name-header {
    font-size: var(--font-size-xs);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
    margin-top: var(--spacing-3xs);
  }

  .save-icon-btn {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-secondary);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-pill);
    background-color: var(--bg-mid-dark);
  }

  .save-icon-btn.dirty {
    background-color: var(--accent);
    color: var(--bg-base);
  }

  .mobile-editor-wrapper {
    flex-grow: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* ============================================== */
  /* Settings Modal Styles                          */
  /* ============================================== */
  .settings-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: color-mix(in srgb, var(--bg-base) 85%, transparent);
    backdrop-filter: blur(12px);
    z-index: 1000;
    justify-content: center;
    align-items: center;
  }

  .settings-modal {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    width: 90%;
    max-width: 480px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-heavy);
    overflow: hidden;
  }

  @keyframes settings-slide-up {
    from {
      transform: translateY(20px) scale(0.95);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  .settings-header {
    padding: var(--spacing-md) var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    justify-content: space-between;
  }

  .settings-title {
    font-size: var(--font-size-base);
    font-weight: 800;
    gap: var(--spacing-sm);
    color: var(--text-primary);
  }

  .sync-icon-accent {
    color: var(--accent);
  }

  .close-btn {
    color: var(--text-secondary);
    transition: color 0.2s;
    background: transparent;
    padding: var(--spacing-2xs);
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .settings-content {
    padding: var(--spacing-lg);
    gap: var(--spacing-lg);
    overflow-y: auto;
    flex-grow: 1;
    min-height: 0;
    -webkit-overflow-scrolling: touch;
  }

  .form-group {
    gap: var(--spacing-xs);
  }

  .form-label {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .client-id-input {
    font-size: var(--font-size-xs);
    border: 1px solid var(--border-color);
  }

  .client-id-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .connect-btn {
    width: 100%;
    justify-content: center;
    padding: var(--spacing-sm);
    font-size: var(--font-size-xs);
    margin-bottom: var(--spacing-sm);
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .helper-card {
    background-color: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-md);
    gap: var(--spacing-xs);
  }

  .helper-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-primary);
  }

  .helper-steps {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.6;
    padding-left: var(--spacing-md);
  }

  .helper-steps li {
    margin-bottom: var(--spacing-xs);
  }

  .helper-steps li::marker {
    color: var(--accent);
    font-weight: bold;
  }

  .link-accent {
    color: var(--accent);
    text-decoration: underline;
  }

  .link-accent:hover {
    color: var(--accent-hover);
  }

  /* Connected Card Styles */
  .connected-card {
    background-color: var(--bg-mid-dark);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: var(--spacing-lg);
    gap: var(--spacing-lg);
  }

  .status-row {
    gap: var(--spacing-md);
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--accent);
    position: relative;
  }

  .status-dot.syncing {
    background-color: var(--semantic-info);
    animation: status-pulse 1s infinite alternate;
  }

  .status-dot.error {
    background-color: var(--semantic-error);
  }

  @keyframes status-pulse {
    from { opacity: 0.4; }
    to { opacity: 1; }
  }

  .email-text {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .status-text {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: var(--spacing-3xs);
  }

  .sync-stats {
    border-top: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    padding: var(--spacing-sm) 0;
    gap: var(--spacing-xs);
  }

  .stat-row {
    justify-content: space-between;
    font-size: var(--font-size-xs);
  }

  .stat-label {
    color: var(--text-secondary);
  }

  .stat-val {
    font-weight: 600;
    color: var(--text-primary);
  }

  .sync-actions {
    gap: var(--spacing-sm);
  }

  .sync-now-btn {
    flex-grow: 1;
    justify-content: center;
    padding: var(--spacing-sm);
  }

  .btn-logout {
    border: 1px solid var(--semantic-error);
    color: var(--semantic-error);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-pill);
    font-weight: 750;
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: background-color 0.2s, color 0.2s;
  }

  .btn-logout:hover {
    background-color: color-mix(in srgb, var(--semantic-error) 10%, transparent);
  }

  .spin {
    animation: sync-spin 1s linear infinite;
  }

  @keyframes sync-spin {
    to { transform: rotate(360deg); }
  }

  /* ============================================== */
  /* Toast Notification System Styles               */
  /* ============================================== */
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    gap: var(--spacing-sm);
    max-width: 380px;
    width: calc(100vw - 48px);
    pointer-events: none;
  }

  @keyframes toast-slide-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Responsive Rules for Mobile viewports */
  @media (max-width: 768px) {
    .toast-container {
      bottom: 16px;
      right: 16px;
      width: calc(100% - 32px);
    }
    .toast-item {
      width: 100%;
      box-shadow: 0 4px 20px color-mix(in srgb, var(--bg-base) 40%, transparent);
    }
  }

  /* Switch / Toggle styling */
  .switch-container {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 20px;
    flex-shrink: 0;
  }
  .switch-container input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color);
    transition: .2s;
    border-radius: 20px;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .2s;
    border-radius: 50%;
  }
  input:checked + .slider {
    background-color: var(--accent);
  }
  input:checked + .slider:before {
    transform: translateX(18px);
  }

  /* Mobile Dropdown Menu (Chrome style) */
  .mobile-more-menu-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: transparent;
    z-index: 999;
  }

  .mobile-more-menu {
    position: absolute;
    right: 16px;
    top: 48px;
    width: 220px;
    background: color-mix(in srgb, var(--bg-surface) 95%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: var(--shadow-heavy), 0 1px 3px color-mix(in srgb, var(--text-primary) 5%, transparent);
    z-index: 1000;
    padding: var(--spacing-xs) 0;
    overflow: hidden;
  }

  .mobile-more-menu-content {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .mobile-more-menu .menu-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    background: transparent;
    border: none;
    text-align: left;
    width: 100%;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .mobile-more-menu .menu-item:hover,
  .mobile-more-menu .menu-item:active {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .mobile-more-menu .menu-item :global(.menu-item-icon) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .mobile-more-menu .menu-item:hover :global(.menu-item-icon) {
    color: var(--text-primary);
  }

  .mobile-more-menu .menu-divider {
    height: 1px;
    background-color: var(--border-color);
    margin: var(--spacing-xs) 0;
    width: 100%;
  }

  .mobile-more-menu .menu-item.delete-item {
    color: var(--semantic-error);
  }

  .mobile-more-menu .menu-item.delete-item:hover {
    background-color: color-mix(in srgb, var(--semantic-error) 10%, transparent);
    color: var(--semantic-error);
  }

  .mobile-more-menu .menu-item.delete-item :global(.menu-item-icon) {
    color: var(--semantic-error);
  }

  /* UI-M-012: clean editor header — breadcrumb + Done */
  .mobile-note-breadcrumb {
    gap: var(--spacing-2xs);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    flex: 1;
    min-width: 0;
    justify-content: center;
    overflow: hidden;
    white-space: nowrap;
    padding: 0 var(--spacing-xs);
  }

  .mobile-note-breadcrumb .crumb-folder {
    color: var(--text-tertiary);
    flex-shrink: 0;
    max-width: 38%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mobile-note-breadcrumb .crumb-note {
    color: var(--text-primary);
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mobile-done-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-family: inherit;
    font-size: var(--font-size-sm);
    font-weight: 700;
    padding: var(--spacing-2xs) var(--spacing-xs);
    cursor: pointer;
    border-radius: var(--radius-subtle);
    transition: background-color 0.15s, transform 0.1s;
  }
  .mobile-done-btn:active {
    transform: scale(0.94);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .notebook-select-list {
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
  }

  .notebook-select-row {
    background: transparent;
    border: none;
    padding: var(--spacing-sm) var(--spacing-md);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    cursor: pointer;
    text-align: left;
    width: 100%;
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    transition: background-color 0.15s;
    border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 3%, transparent);
    box-sizing: border-box;
  }

  .notebook-select-row:last-child {
    border-bottom: none;
  }

  .notebook-select-row:hover {
    background: var(--bg-hover);
  }

  .notebook-select-row.selected {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
  }

  .folder-icon {
    font-size: var(--font-size-base);
  }

  .folder-name {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-checkmark {
    color: var(--accent);
    font-weight: bold;
    font-size: var(--font-size-sm);
  }

  /* Mobile Tags Styles */
  .mobile-tags-section {
    margin-top: var(--spacing-md);
  }
  .mobile-section-header {
    padding: var(--spacing-2xs) var(--spacing-xs) var(--spacing-sm);
    color: var(--text-secondary);
    user-select: none;
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
  .mobile-tags-list {
    margin-top: var(--spacing-2xs);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  .mobile-tag-row {
    transition: background-color 0.2s, transform 0.1s;
    user-select: none;
    -webkit-user-select: none;
  }
  .mobile-tag-row:active {
    background-color: var(--bg-hover);
    transform: scale(0.98);
  }
  .mobile-tag-badge {
    transition: background-color 0.2s;
  }

  /* ST-010: Mobile Color Picker Popover/Bottom Sheet */

  .mobile-color-picker-popover {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-color);
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg) var(--spacing-lg);
    box-shadow: var(--shadow-heavy);
  }

  .color-picker-header {
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-xs);
    border-bottom: 1px solid var(--border-color);
  }

  .color-picker-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
    justify-items: center;
  }

  .color-swatch {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s ease, border-color 0.1s ease;
  }

  .color-swatch:active {
    transform: scale(0.9);
  }

  .color-swatch.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-primary) 20%, transparent);
  }

  .swatch-check {
    color: var(--text-primary);
    font-size: var(--font-size-base);
    font-weight: 700;
    text-shadow: 0 1px 2px color-mix(in srgb, var(--bg-base) 50%, transparent);
  }

  .color-reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    width: 100%;
    padding: var(--spacing-sm);
    border: none;
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .color-reset-btn:active {
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
  }

  /* ST-011: Mobile Selection & Bulk Action Bar */
  .recent-note-card.selected, .search-result-row.selected {
    border-color: var(--accent) !important;
    background-color: color-mix(in srgb, var(--accent) 8%, transparent) !important;
  }

  .selection-checkbox-wrapper {
    width: 24px;
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
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs);
    font-weight: bold;
    color: white;
    transition: all 0.2s ease;
  }

  .selection-checkbox.checked {
    background-color: var(--accent);
    border-color: var(--accent);
  }

  .mobile-bulk-action-bar {
    position: fixed;
    bottom: 84px;
    left: 16px;
    right: 16px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-medium);
    border-radius: 14px;
    padding: var(--spacing-sm) var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    z-index: 100;
  }

  .mobile-picker-list::-webkit-scrollbar {
    width: 4px;
  }
  .mobile-picker-list::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
    border-radius: 2px;
  }
  .bulk-actions::-webkit-scrollbar {
    display: none;
  }

  /* ST-016: Global Custom Delete Confirmation Modal */
  .custom-confirm-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--bg-base) 60%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
    padding: var(--spacing-lg);
  }

  .custom-confirm-card {
    background: color-mix(in srgb, var(--bg-surface) 95%, transparent);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-heavy), 0 0 0 1px color-mix(in srgb, var(--text-primary) 3%, transparent);
    border-radius: 16px;
    padding: var(--spacing-lg);
    max-width: 400px;
    width: 100%;
    gap: var(--spacing-sm);
    color: var(--text-primary);
  }

  .custom-confirm-warning-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
    color: var(--semantic-error);
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .custom-confirm-title {
    font-size: var(--font-size-base);
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .custom-confirm-message {
    font-size: var(--font-size-xs);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: var(--spacing-2xs) 0 var(--spacing-xs) 0;
  }

  .custom-confirm-cancel-btn {
    border-color: var(--border-color);
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    font-size: var(--font-size-xs);
    padding: var(--spacing-xs) var(--spacing-md);
    height: 38px;
    border-radius: 20px;
    transition: all 0.2s ease;
  }

  .custom-confirm-cancel-btn:hover {
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--text-primary) 20%, transparent);
  }

  .custom-confirm-danger-btn {
    background: var(--semantic-error);
    border: 1px solid var(--border-color);
    color: white;
    cursor: pointer;
    font-size: var(--font-size-xs);
    font-weight: 600;
    padding: var(--spacing-xs) var(--spacing-md);
    height: 38px;
    border-radius: 20px;
    transition: all 0.2s ease;
  }

  .custom-confirm-danger-btn:hover {
    background: var(--semantic-error);
    box-shadow: 0 0 12px color-mix(in srgb, var(--semantic-error) 40%, transparent);
  }

  .custom-confirm-danger-btn:active {
    transform: scale(0.95);
  }
</style>
