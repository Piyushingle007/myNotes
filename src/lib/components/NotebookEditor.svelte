<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { scale, slide, fade, fly } from 'svelte/transition';
  import { 
    Pen, 
    Highlighter, 
    Eraser, 
    Hand,
    Minus,
    RotateCcw, 
    RotateCw, 
    Trash2, 
    Sliders,
    BookOpen,
    Settings,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Plus,
    Download,
    Copy,
    ChevronUp,
    Maximize,
    Minimize
  } from 'lucide-svelte';
  import { getStroke } from 'perfect-freehand';
  import { appState } from '../stores/appState.svelte';
  import { deserializeNotebook, serializeNotebook, createEmptyNotebook, createEmptyPage } from '../utils/notebookStorage';
  import type { NotebookDocument, NotebookPage, Stroke, StrokePoint, NotebookTool, PageBackground, InputMode } from '../utils/notebookTypes';
  import NotebookPageComp from './NotebookPage.svelte';

  // Component Props
  interface Props {
    notePath: string;
    initialContent: string;
    onSave: (content: string, thumbnail: string) => void;
  }

  let { notePath, initialContent, onSave }: Props = $props();

  // Document state
  let notebook = $state<NotebookDocument | null>(null);
  let activePageId = $state<string>('');

  // Toolbar settings
  let currentTool = $state<NotebookTool>('pen');
  let currentSize = $state(4);
  let currentColor = $state('#ffffff');
  let inputMode = $state<InputMode>('auto');
  let hasStylus = $state(false);
  let zoom = $state(1.0);
  let showZoomMenu = $state(false);

  // Mobile specific settings
  let mobileToolbarPosition = $state<'top' | 'bottom' | 'left' | 'right'>('top');
  let fullscreenMode = $state(false);

  // Panning state
  let isPanning = $state(false);
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  // Drawing-in-progress guard — prevents save from blocking the main thread
  let isActivelyDrawing = false;
  let lastStrokeTime = 0;

  // Touch tracking for two-finger pan & zoom
  let touchStartDist = 0;
  let touchStartZoom = 1.0;
  let isPinching = false;
  let touchStartMidX = 0;
  let touchStartMidY = 0;
  let touchStartScrollLeft = 0;
  let touchStartScrollTop = 0;

  // Separate settings per tool
  let toolSettings = $state({
    pen: { size: 4, color: '#ffffff' },
    highlighter: { size: 16, color: '#ffe066' },
    eraser: { size: 24, color: '' }
  });

  // Undo / Redo history stack
  interface HistoryEntry {
    pageId: string;
    action: 'add' | 'erase' | 'clear';
    strokes: Stroke[];
    timestamp: number;
  }

  let undoStack = $state<HistoryEntry[]>([]);
  let redoStack = $state<HistoryEntry[]>([]);

  // Virtualization state
  let scrollContainer = $state<HTMLDivElement | null>(null);
  let visiblePages = $state<Set<string>>(new Set());
  let pageElements = new Map<string, HTMLDivElement>();
  let observer: IntersectionObserver | null = null;

  // UI layouts & popovers
  const isMobile = $derived(appState.isMobile);
  let showSettingsDropdown = $state(false);
  let showToolOptions = $state(false);
  let showJumpPagePopover = $state(false);
  let jumpPageInputVal = $state('');
  let showMobileMoreMenu = $state(false);
  let showMobilePageIndicatorPopover = $state(false);

  // Epic 3 States: Thumbnails & Context Menus
  let cachedThumbnails = $state<Record<string, string>>({});
  let showThumbnailsSidePanel = $state(localStorage.getItem('mynotes_notebook_show_thumbnails') === 'true');
  let showMobileThumbnailsSheet = $state(false);
  let contextMenuState = $state<{ show: boolean; x: number; y: number; pageId: string }>({
    show: false,
    x: 0,
    y: 0,
    pageId: ''
  });

  // Epic 4 States: PDF & PNG Export
  let showExportModal = $state(false);
  let exportOptions = $state({
    includeBackground: true,
    quality: 'standard' as 'standard' | 'high',
    range: 'all' as 'all' | 'current' | 'custom',
    customRangeText: '',
    forceWhite: false
  });
  let exportProgress = $state({
    exporting: false,
    current: 0,
    total: 0
  });

  // Active theme
  const activeThemeObj = $derived(appState.themes.find(t => t.id === appState.theme));
  const isLight = $derived(activeThemeObj?.category === 'light');
  const workspaceBg = $derived(isLight ? '#eef0f3' : (activeThemeObj?.bg || '#111317'));
  const pageBg = $derived(isLight ? '#ffffff' : (appState.theme === 'black' ? '#121212' : '#1c1c1e'));
  const borderCol = $derived(isLight ? '#d1d5db' : '#2d333b');
  const shadowCol = $derived(isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 0, 0, 0.4)');

  const presetColors = [
    '#ffffff', // White/Light
    '#000000', // Black/Dark
    '#ff5c5c', // Red
    '#ffc83b', // Yellow
    '#55f055', // Green
    '#3ba3ff', // Blue
    '#a25cff', // Purple
    '#ff7bf0'  // Pink
  ];
  let lastSavedContent = $state<string>('');
  let currentLoadedPath = $state<string>('');

  // Initialize and reload document on path change
  $effect(() => {
    const content = initialContent;
    const path = notePath;
    
    // Skip reload if this update is from our own internal save or the content hasn't changed
    if (path === currentLoadedPath && (content === lastSavedContent || (notebook && content === serializeNotebook(notebook)))) {
      return;
    }
    
    // Clear state
    undoStack = [];
    redoStack = [];
    visiblePages = new Set();
    currentLoadedPath = path;
    lastSavedContent = content;
    
    if (content) {
      try {
        notebook = deserializeNotebook(content);
        if (notebook && notebook.pages.length > 0) {
          activePageId = notebook.pages[0].id;
        }
      } catch (e) {
        console.error('Failed to parse notebook JSON:', e);
        notebook = createEmptyNotebook(path.split('/').pop()?.replace(/\.notebook\.json$/, '') || 'Notebook');
        activePageId = notebook.pages[0].id;
      }
    } else {
      notebook = createEmptyNotebook(path.split('/').pop()?.replace(/\.notebook\.json$/, '') || 'Notebook');
      activePageId = notebook.pages[0].id;
    }

    // Generate thumbnails for all pages after notebook updates
    tick().then(() => {
      cachedThumbnails = {};
      if (notebook) {
        notebook.pages.forEach(p => {
          generatePageThumbnailImmediate(p.id);
        });
      }
    });
  });

  // Track tool changes to update local color & size settings
  $effect(() => {
    if (currentTool === 'hand') return;
    const settings = toolSettings[currentTool];
    if (settings) {
      currentSize = settings.size;
      if (currentTool !== 'eraser') {
        currentColor = settings.color;
      }
    }
  });

  // Keep toolSettings in sync when user edits size/color
  function updateToolSettings() {
    if (currentTool === 'hand') return;
    if (toolSettings[currentTool]) {
      const oldSize = toolSettings[currentTool].size;
      toolSettings[currentTool].size = currentSize;
      if (currentTool !== 'eraser') {
        toolSettings[currentTool].color = currentColor;
      }
      if (oldSize !== currentSize) {
        triggerHaptic(5);
      }
    }
  }

  // Select a tool with haptic feedback
  function selectTool(toolName: NotebookTool) {
    currentTool = toolName;
    if (toolName === 'hand') {
      showToolOptions = false;
    } else {
      showToolOptions = true;
    }
    
    triggerHaptic(10);
  }

  // Trigger vibration haptic feedback
  function triggerHaptic(duration = 10) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(duration);
    }
  }

  function toggleFullscreen() {
    fullscreenMode = !fullscreenMode;
    if (typeof document !== 'undefined') {
      if (fullscreenMode) {
        document.body.classList.add('handwriting-fullscreen');
      } else {
        document.body.classList.remove('handwriting-fullscreen');
      }
    }
    triggerHaptic(15);
  }

  // Intercept touchstart near screen edges to block swipe-to-go-back/forward on mobile
  function handleTouchStartEdgeBlock(e: TouchEvent) {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const edgeThreshold = 25; // pixels from edge
      const isNearLeftEdge = touch.clientX < edgeThreshold;
      const isNearRightEdge = touch.clientX > window.innerWidth - edgeThreshold;
      
      if ((isNearLeftEdge || isNearRightEdge) && currentTool !== 'hand') {
        const activeDrawingMode = inputMode === 'touchDraw' || (inputMode === 'auto' && !hasStylus);
        if (activeDrawingMode) {
          e.preventDefault();
        }
      }
    }
  }

  // Restore preferences and settings from localStorage
  onMount(() => {
    const savedMode = localStorage.getItem('mynotes_notebook_input_mode') as InputMode;
    if (savedMode && ['auto', 'penOnly', 'touchDraw'].includes(savedMode)) {
      inputMode = savedMode;
    }

    const savedSettings = localStorage.getItem('mynotes_notebook_tool_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (parsed.pen) toolSettings.pen = parsed.pen;
        if (parsed.highlighter) toolSettings.highlighter = parsed.highlighter;
        if (parsed.eraser) toolSettings.eraser = parsed.eraser;
      } catch (err) {
        console.warn('Failed to parse saved notebook tool settings', err);
      }
    }

    const savedToolbarPos = localStorage.getItem('mynotes_notebook_mobile_toolbar_position') as any;
    if (savedToolbarPos && ['top', 'bottom', 'left', 'right'].includes(savedToolbarPos)) {
      mobileToolbarPosition = savedToolbarPos;
    }

    const handleBlurOrUnload = () => {
      if (appState.editorDirty) {
        performSaveImmediate();
      }
    };

    window.addEventListener('blur', handleBlurOrUnload);
    window.addEventListener('beforeunload', handleBlurOrUnload);
    window.addEventListener('touchstart', handleTouchStartEdgeBlock, { passive: false });

    if (scrollContainer) {
      scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
      scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
      scrollContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
      scrollContainer.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    }

    return () => {
      window.removeEventListener('blur', handleBlurOrUnload);
      window.removeEventListener('beforeunload', handleBlurOrUnload);
      window.removeEventListener('touchstart', handleTouchStartEdgeBlock);
      if (scrollContainer) {
        scrollContainer.removeEventListener('touchstart', handleTouchStart);
        scrollContainer.removeEventListener('touchmove', handleTouchMove);
        scrollContainer.removeEventListener('touchend', handleTouchEnd);
        scrollContainer.removeEventListener('touchcancel', handleTouchEnd);
      }
    };
  });

  $effect(() => {
    localStorage.setItem('mynotes_notebook_input_mode', inputMode);
  });

  $effect(() => {
    localStorage.setItem('mynotes_notebook_mobile_toolbar_position', mobileToolbarPosition);
  });

  $effect(() => {
    localStorage.setItem('mynotes_notebook_tool_settings', JSON.stringify({
      pen: toolSettings.pen,
      highlighter: toolSettings.highlighter,
      eraser: toolSettings.eraser
    }));
  });

  // Register page elements for IntersectionObserver virtualization
  function observePage(node: HTMLDivElement, pageId: string) {
    pageElements.set(pageId, node);
    observer?.observe(node);

    // Initial pre-fill to avoid white flash
    visiblePages.add(pageId);
    visiblePages = new Set(visiblePages);

    return {
      destroy() {
        observer?.unobserve(node);
        pageElements.delete(pageId);
        visiblePages.delete(pageId);
        visiblePages = new Set(visiblePages);
      }
    };
  }

  // Intersection observer setup
  onMount(() => {
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = entry.target.getAttribute('data-page-id');
        if (id) {
          if (entry.isIntersecting) {
            visiblePages.add(id);
          } else {
            visiblePages.delete(id);
          }
        }
      });
      // Force trigger reactivity
      visiblePages = new Set(visiblePages);
    }, {
      root: scrollContainer,
      rootMargin: '300px'
    });

    pageElements.forEach(el => {
      observer?.observe(el);
    });

    return () => {
      observer?.disconnect();
      observer = null;
    };
  });

  // Thumbnail generation functions
  let thumbnailDebounceTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

  function triggerPageThumbnailUpdate(pageId: string) {
    if (thumbnailDebounceTimeouts[pageId]) {
      clearTimeout(thumbnailDebounceTimeouts[pageId]);
    }
    thumbnailDebounceTimeouts[pageId] = setTimeout(() => {
      generatePageThumbnailImmediate(pageId);
      delete thumbnailDebounceTimeouts[pageId];
    }, 500);
  }

  function generatePageThumbnailImmediate(pageId: string) {
    if (!notebook) return;
    const page = notebook.pages.find(p => p.id === pageId);
    if (!page) return;

    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 170;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw background
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, 120, 170);

    const scale = 170 / 1130;
    ctx.save();
    ctx.scale(scale, scale);

    // Draw background template pattern
    if (page.background !== 'blank') {
      const patternCol = isLight ? '#e5e7eb' : '#2a2f38';
      ctx.strokeStyle = patternCol;
      ctx.fillStyle = patternCol;
      ctx.lineWidth = 1;

      if (page.background === 'lined') {
        const lineGap = 28;
        ctx.beginPath();
        for (let y = lineGap; y < page.height; y += lineGap) {
          ctx.moveTo(0, y);
          ctx.lineTo(page.width, y);
        }
        ctx.stroke();
      } else if (page.background === 'grid') {
        const gridGap = 30;
        ctx.beginPath();
        for (let x = gridGap; x < page.width; x += gridGap) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, page.height);
        }
        for (let y = gridGap; y < page.height; y += gridGap) {
          ctx.moveTo(0, y);
          ctx.lineTo(page.width, y);
        }
        ctx.stroke();
      } else if (page.background === 'dotted') {
        const dotGap = 24;
        const dotRadius = 1.25;
        for (let x = dotGap; x < page.width; x += dotGap) {
          for (let y = dotGap; y < page.height; y += dotGap) {
            ctx.beginPath();
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // Draw strokes
    for (const stroke of page.strokes) {
      if (stroke.points.length === 0) continue;
      if (stroke.tool === 'eraser') continue;

      const isStylusStroke = stroke.points.some(p => p.pressure !== 0.5 && p.pressure !== 0 && p.pressure !== 1);
      const simulate = !isStylusStroke;

      const pointsArray = stroke.points.map(p => [p.x, p.y, p.pressure]);
      const strokeOutlinePoints = getStroke(pointsArray, {
        size: stroke.size,
        thinning: stroke.tool === 'highlighter' ? 0.05 : 0.6,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: simulate,
        last: true
      });

      if (strokeOutlinePoints.length === 0) continue;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(strokeOutlinePoints[0][0], strokeOutlinePoints[0][1]);
      for (let i = 1; i < strokeOutlinePoints.length; i++) {
        ctx.lineTo(strokeOutlinePoints[i][0], strokeOutlinePoints[i][1]);
      }
      ctx.closePath();

      ctx.fillStyle = stroke.color;
      ctx.globalAlpha = stroke.opacity;
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // Restore context scale
    cachedThumbnails[pageId] = canvas.toDataURL('image/jpeg', 0.7);
  }

  // Scroll to a specific page card
  function scrollToPage(pageId: string) {
    if (activePageId !== pageId && appState.editorDirty) {
      performSaveImmediate();
    }
    activePageId = pageId;
    const pageEl = pageElements.get(pageId);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Navigate relative pages (Next/Prev)
  function navigatePage(direction: 'prev' | 'next') {
    if (!notebook) return;
    const currentIdx = notebook.pages.findIndex(p => p.id === activePageId);
    if (currentIdx === -1) return;

    let targetIdx = currentIdx;
    if (direction === 'prev' && currentIdx > 0) {
      targetIdx--;
    } else if (direction === 'next' && currentIdx < notebook.pages.length - 1) {
      targetIdx++;
    }

    if (targetIdx !== currentIdx) {
      scrollToPage(notebook.pages[targetIdx].id);
    }
  }

  // Jump to specific page number
  function handleJumpPageSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!notebook) return;
    const pageNum = parseInt(jumpPageInputVal, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= notebook.pages.length) {
      scrollToPage(notebook.pages[pageNum - 1].id);
      showJumpPagePopover = false;
      showMobilePageIndicatorPopover = false;
      jumpPageInputVal = '';
    } else {
      appState.showToast(`Invalid page number. Please enter 1 to ${notebook.pages.length}.`, 'warning', 3000);
    }
  }

  // Drag and drop state
  let draggingIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  // Drag and drop handlers
  function handleDragStart(e: DragEvent, index: number) {
    draggingIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    dragOverIndex = index;
  }

  function handleDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === targetIndex || !notebook) return;

    const newPages = [...notebook.pages];
    const [draggedPage] = newPages.splice(draggingIndex, 1);
    newPages.splice(targetIndex, 0, draggedPage);

    // Re-index
    newPages.forEach((p, idx) => {
      p.index = idx;
    });

    notebook.pages = newPages;
    
    // Regenerate thumbnails for moved pages
    tick().then(() => {
      notebook?.pages.forEach(p => {
        generatePageThumbnailImmediate(p.id);
      });
    });

    triggerSave();
    draggingIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggingIndex = null;
    dragOverIndex = null;
  }

  // Page Operations
  function addPageAfter(pageId: string) {
    if (!notebook) return;
    if (notebook.pages.length >= 100) {
      appState.showToast('Maximum page limit (100) reached.', 'warning', 3000);
      return;
    }
    const currentIdx = notebook.pages.findIndex(p => p.id === pageId);
    if (currentIdx === -1) return;

    const newPage = createEmptyPage(notebook.pages.length, notebook.defaultBackground);
    
    const newPages = [...notebook.pages];
    newPages.splice(currentIdx + 1, 0, newPage);
    
    newPages.forEach((p, idx) => {
      p.index = idx;
    });
    
    notebook.pages = newPages;
    generatePageThumbnailImmediate(newPage.id);
    triggerSave();
    
    tick().then(() => {
      scrollToPage(newPage.id);
    });
  }

  function addPageAtEnd() {
    if (!notebook || notebook.pages.length === 0) return;
    addPageAfter(notebook.pages[notebook.pages.length - 1].id);
  }

  function duplicatePage(pageId: string) {
    if (!notebook) return;
    if (notebook.pages.length >= 100) {
      appState.showToast('Maximum page limit (100) reached.', 'warning', 3000);
      return;
    }
    const currentIdx = notebook.pages.findIndex(p => p.id === pageId);
    if (currentIdx === -1) return;

    const targetPage = notebook.pages[currentIdx];
    
    const duplicatedStrokes: Stroke[] = targetPage.strokes.map(stroke => ({
      ...stroke,
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      points: stroke.points.map(p => ({ ...p }))
    }));

    const newPage: NotebookPage = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      index: currentIdx + 1,
      background: targetPage.background,
      width: targetPage.width,
      height: targetPage.height,
      strokes: duplicatedStrokes
    };

    const newPages = [...notebook.pages];
    newPages.splice(currentIdx + 1, 0, newPage);
    
    newPages.forEach((p, idx) => {
      p.index = idx;
    });

    notebook.pages = newPages;
    generatePageThumbnailImmediate(newPage.id);
    triggerSave();

    tick().then(() => {
      scrollToPage(newPage.id);
    });
  }

  function deletePage(pageId: string) {
    if (!notebook) return;
    if (notebook.pages.length <= 1) {
      appState.showToast('A notebook must have at least 1 page.', 'warning', 3000);
      return;
    }

    if (confirm('Are you sure you want to delete this page? This will erase all drawings on it.')) {
      undoStack = undoStack.filter(entry => entry.pageId !== pageId);
      redoStack = redoStack.filter(entry => entry.pageId !== pageId);
      const currentIdx = notebook.pages.findIndex(p => p.id === pageId);
      if (currentIdx === -1) return;

      const newPages = notebook.pages.filter(p => p.id !== pageId);
      
      newPages.forEach((p, idx) => {
        p.index = idx;
      });

      notebook.pages = newPages;

      if (activePageId === pageId) {
        const nextActiveIdx = Math.min(currentIdx, newPages.length - 1);
        activePageId = newPages[nextActiveIdx].id;
      }

      if (cachedThumbnails[pageId]) {
        delete cachedThumbnails[pageId];
      }

      triggerSave();
      
      tick().then(() => {
        scrollToPage(activePageId);
      });
    }
  }

  function deleteCurrentPage() {
    deletePage(activePageId);
    showSettingsDropdown = false;
  }

  function movePage(pageId: string, direction: -1 | 1) {
    if (!notebook) return;
    const index = notebook.pages.findIndex(p => p.id === pageId);
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= notebook.pages.length) return;

    const newPages = [...notebook.pages];
    const temp = newPages[index];
    newPages[index] = newPages[targetIndex];
    newPages[targetIndex] = temp;

    newPages.forEach((p, idx) => {
      p.index = idx;
    });

    notebook.pages = newPages;
    
    // Regenerate thumbnails for moved pages
    generatePageThumbnailImmediate(pageId);
    generatePageThumbnailImmediate(notebook.pages[index].id);

    triggerSave();

    tick().then(() => {
      scrollToPage(pageId);
    });
  }

  // Context Menu trigger handlers
  function handlePageContextMenu(pageId: string, clientX: number, clientY: number) {
    contextMenuState = {
      show: true,
      x: clientX,
      y: clientY,
      pageId
    };
  }

  function handlePageLongPress(pageId: string, clientX: number, clientY: number) {
    contextMenuState = {
      show: true,
      x: clientX,
      y: clientY,
      pageId
    };
  }

  // Action-based history stack tracking
  function pushToUndo(actionEntry: { pageId: string; action: 'add' | 'erase' | 'clear'; strokes: Stroke[] }) {
    undoStack.push({
      ...actionEntry,
      timestamp: Date.now()
    });
    if (undoStack.length > 100) {
      undoStack.shift();
    }
    redoStack = [];
  }

  function handleUndo() {
    if (!notebook || undoStack.length === 0) return;
    const entry = undoStack.pop()!;
    
    const page = notebook.pages.find(p => p.id === entry.pageId);
    if (!page) return;
    
    if (entry.action === 'add') {
      // Remove the added strokes
      page.strokes = page.strokes.filter(s => !entry.strokes.some(es => es.id === s.id));
    } else if (entry.action === 'erase') {
      // Re-add the erased strokes
      page.strokes = [...page.strokes, ...entry.strokes];
    } else if (entry.action === 'clear') {
      // Re-add the cleared strokes
      page.strokes = entry.strokes;
    }
    
    redoStack.push(entry);
    scrollToPage(entry.pageId);
    triggerPageThumbnailUpdate(entry.pageId);
    triggerSave();
  }

  function handleRedo() {
    if (!notebook || redoStack.length === 0) return;
    const entry = redoStack.pop()!;
    
    const page = notebook.pages.find(p => p.id === entry.pageId);
    if (!page) return;
    
    if (entry.action === 'add') {
      // Re-add the strokes
      page.strokes = [...page.strokes, ...entry.strokes];
    } else if (entry.action === 'erase') {
      // Remove the strokes
      page.strokes = page.strokes.filter(s => !entry.strokes.some(es => es.id === s.id));
    } else if (entry.action === 'clear') {
      // Clear the strokes again
      page.strokes = [];
    }
    
    undoStack.push(entry);
    scrollToPage(entry.pageId);
    triggerPageThumbnailUpdate(entry.pageId);
    triggerSave();
  }

  // Saving debounced — uses longer debounce during active drawing
  // and requestIdleCallback to yield to pointer event processing
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingIdleCallback: number | null = null;
  
  function triggerSave() {
    appState.editorDirty = true;
    if (saveTimeout) clearTimeout(saveTimeout);

    // Use a longer debounce during active drawing to avoid blocking strokes.
    // After drawing stops, the shorter debounce kicks in.
    const recentlyDrawing = Date.now() - lastStrokeTime < 1000;
    const debounceMs = recentlyDrawing ? 2000 : 500;

    saveTimeout = setTimeout(() => {
      // Use requestIdleCallback so the save yields to any pending
      // pointer events / RAF rendering. Falls back to setTimeout.
      if (typeof requestIdleCallback === 'function') {
        if (pendingIdleCallback !== null) cancelIdleCallback(pendingIdleCallback);
        pendingIdleCallback = requestIdleCallback(() => {
          pendingIdleCallback = null;
          performSaveImmediate();
        }, { timeout: 3000 });
      } else {
        performSaveImmediate();
      }
    }, debounceMs);
  }

  function performSaveImmediate() {
    if (!notebook) return;
    notebook.updatedAt = new Date().toISOString();

    // Defer expensive thumbnail generation if we were drawing very recently
    const recentlyDrawing = Date.now() - lastStrokeTime < 500;
    let thumbnail = notebook.thumbnail || '';
    if (!recentlyDrawing) {
      thumbnail = generateFirstPageThumbnail();
      notebook.thumbnail = thumbnail;
    } else {
      // Schedule a deferred thumbnail generation
      setTimeout(() => {
        if (notebook) {
          notebook.thumbnail = generateFirstPageThumbnail();
        }
      }, 2000);
    }

    const contentStr = serializeNotebook(notebook);
    lastSavedContent = contentStr;
    onSave(contentStr, thumbnail);
    appState.editorDirty = false;
  }

  onDestroy(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
    if (appState.editorDirty) {
      performSaveImmediate();
    }
    if (typeof document !== 'undefined') {
      document.body.classList.remove('handwriting-fullscreen');
    }
  });

  // Stroke event handlers
  function handleStrokeAdd(pageId: string, stroke: Stroke) {
    if (!notebook) return;
    const idx = notebook.pages.findIndex(p => p.id === pageId);
    if (idx === -1) return;

    lastStrokeTime = Date.now();

    pushToUndo({
      pageId,
      action: 'add',
      strokes: [stroke]
    });
    notebook.pages[idx].strokes = [...notebook.pages[idx].strokes, stroke];

    // Auto-append next page if this is the last page and drawing is near the bottom (y > 950 of 1130px)
    const isLastPage = idx === notebook.pages.length - 1;
    if (isLastPage) {
      const isNearBottom = stroke.points.some(p => p.y > 950);
      if (isNearBottom) {
        if (notebook.pages.length < 100) {
          const newPage = createEmptyPage(notebook.pages.length, notebook.defaultBackground);
          notebook.pages = [...notebook.pages, newPage];
          generatePageThumbnailImmediate(newPage.id);
        } else {
          appState.showToast('Maximum page limit (100) reached.', 'warning', 3000);
        }
      }
    }

    triggerPageThumbnailUpdate(pageId);
    triggerSave();
  }

  function handleStrokeErase(pageId: string, erasedIds: string[]) {
    if (!notebook) return;
    const idx = notebook.pages.findIndex(p => p.id === pageId);
    if (idx === -1) return;

    lastStrokeTime = Date.now();

    const originalCount = notebook.pages[idx].strokes.length;
    const erasedStrokes = notebook.pages[idx].strokes.filter(s => erasedIds.includes(s.id));
    const newStrokes = notebook.pages[idx].strokes.filter(s => !erasedIds.includes(s.id));

    if (newStrokes.length !== originalCount) {
      pushToUndo({
        pageId,
        action: 'erase',
        strokes: erasedStrokes
      });
      notebook.pages[idx].strokes = newStrokes;
      triggerPageThumbnailUpdate(pageId);
      triggerSave();
    }
  }

  // Active page selection routing
  function handlePageActive(pageId: string) {
    activePageId = pageId;
    // Auto-dismiss mobile tool options when active drawing starts
    if (isMobile && showToolOptions) {
      showToolOptions = false;
    }
  }

  // Page Operations
  function changePageBackground(bg: PageBackground, pageId?: string) {
    if (!notebook) return;
    const targetId = pageId || activePageId;
    const idx = notebook.pages.findIndex(p => p.id === targetId);
    if (idx === -1) return;

    notebook.pages[idx].background = bg;
    generatePageThumbnailImmediate(targetId);
    triggerSave();
    showSettingsDropdown = false;
  }

  function clearActivePage() {
    if (!notebook) return;
    const idx = notebook.pages.findIndex(p => p.id === activePageId);
    if (idx === -1) return;

    if (notebook.pages[idx].strokes.length === 0) return;
    
    if (confirm('Clear all drawings on this page?')) {
      pushToUndo({
        pageId: activePageId,
        action: 'clear',
        strokes: [...notebook.pages[idx].strokes]
      });
      notebook.pages[idx].strokes = [];
      generatePageThumbnailImmediate(activePageId);
      triggerSave();
    }
    showSettingsDropdown = false;
  }

  // PDF & PNG Export Helpers
  function openExportModal() {
    exportOptions.forceWhite = isLight;
    exportOptions.range = 'all';
    exportOptions.customRangeText = '';
    showExportModal = true;
  }

  function handleExportPdfClick() {
    openExportModal();
  }

  function parsePageRange(rangeStr: string, totalPages: number): number[] {
    const pages = new Set<number>();
    const parts = rangeStr.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.match(/^\d+$/)) {
        const val = parseInt(trimmed, 10);
        if (val >= 1 && val <= totalPages) {
          pages.add(val - 1);
        }
      } else if (trimmed.match(/^\d+\s*-\s*\d+$/)) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr.trim(), 10);
        const end = parseInt(endStr.trim(), 10);
        const minVal = Math.min(start, end);
        const maxVal = Math.max(start, end);
        for (let i = Math.max(1, minVal); i <= Math.min(totalPages, maxVal); i++) {
          pages.add(i - 1);
        }
      }
    }
    return Array.from(pages).sort((a, b) => a - b);
  }

  // Reactive page collections for export
  const pagesToExport = $derived.by(() => {
    if (!notebook) return [];
    if (exportOptions.range === 'all') {
      return notebook.pages;
    }
    if (exportOptions.range === 'current') {
      const activeIdx = notebook.pages.findIndex(p => p.id === activePageId);
      return activeIdx !== -1 ? [notebook.pages[activeIdx]] : [];
    }
    if (exportOptions.range === 'custom') {
      const indices = parsePageRange(exportOptions.customRangeText, notebook.pages.length);
      return indices.map(idx => notebook!.pages[idx]).filter(Boolean);
    }
    return [];
  });

  const estimatedSizeText = $derived.by(() => {
    const count = pagesToExport.length;
    const sizePerPageKb = exportOptions.quality === 'high' ? 400 : 150;
    const totalKb = count * sizePerPageKb;
    if (totalKb >= 1000) {
      return `${(totalKb / 1024).toFixed(1)} MB`;
    }
    return `${totalKb} KB`;
  });

  const isCustomRangeInvalid = $derived(
    exportOptions.range === 'custom' && 
    (!exportOptions.customRangeText.trim() || pagesToExport.length === 0)
  );

  function getRenderColor(strokeColor: string, forceWhite: boolean): string {
    if (!forceWhite) return strokeColor;
    const color = strokeColor.trim().toLowerCase();
    
    // Invert white ink to black/dark charcoal
    if (color === '#ffffff' || color === 'white' || color === '#fff' || color === 'rgb(255,255,255)' || color === 'rgb(255, 255, 255)') {
      return '#121212';
    }
    
    // Parse hex colors and check luminance
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      let r = 255, g = 255, b = 255;
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
      
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance > 220) {
        return '#2d3748';
      }
    }
    return strokeColor;
  }

  function drawStrokeForPdfOrPng(ctx: CanvasRenderingContext2D, stroke: Stroke, forceWhite: boolean) {
    if (stroke.points.length === 0) return;
    const isStylusStroke = stroke.points.some(p => p.pressure !== 0.5 && p.pressure !== 0 && p.pressure !== 1);
    const simulate = !isStylusStroke;

    const pointsArray = stroke.points.map(p => [p.x, p.y, p.pressure]);
    const strokeOutlinePoints = getStroke(pointsArray, {
      size: stroke.size,
      thinning: stroke.tool === 'highlighter' ? 0.05 : 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: simulate,
      last: true
    });

    if (strokeOutlinePoints.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(strokeOutlinePoints[0][0], strokeOutlinePoints[0][1]);
    for (let i = 1; i < strokeOutlinePoints.length; i++) {
      ctx.lineTo(strokeOutlinePoints[i][0], strokeOutlinePoints[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = getRenderColor(stroke.color, forceWhite);
    ctx.globalAlpha = stroke.opacity;
    ctx.fill();
    ctx.restore();
  }

  async function generatePdf() {
    if (!notebook) return;
    
    const targets = pagesToExport;
    if (targets.length === 0) {
      appState.showToast('No pages selected to export.', 'warning', 3000);
      return;
    }

    showExportModal = false;
    exportProgress = { exporting: true, current: 0, total: targets.length };
    
    const toastId = appState.showToast('Preparing PDF export...', 'info', 0, undefined, true);
    
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const scale = exportOptions.quality === 'high' ? 3 : 2;
      const forceWhite = exportOptions.forceWhite;
      const includeBg = exportOptions.includeBackground;
      
      const renderBgColor = forceWhite ? '#ffffff' : pageBg;
      const renderPatternColor = (forceWhite || isLight) ? '#e5e7eb' : '#2a2f38';

      for (let i = 0; i < targets.length; i++) {
        exportProgress.current = i + 1;
        appState.updateToast(toastId, {
          message: `Rendering page ${i + 1} of ${targets.length}...`,
          type: 'info',
          loading: true
        });
        
        // Yield to the event loop so progress UI redraws
        await tick();
        await new Promise(resolve => setTimeout(resolve, 30));

        if (i > 0) pdf.addPage();
        
        const page = targets[i];
        const canvas = document.createElement('canvas');
        canvas.width = page.width * scale;
        canvas.height = page.height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale, scale);
        
        // Draw background
        ctx.fillStyle = renderBgColor;
        ctx.fillRect(0, 0, page.width, page.height);
        
        // Draw background template pattern
        if (includeBg && page.background !== 'blank') {
          ctx.save();
          ctx.strokeStyle = renderPatternColor;
          ctx.fillStyle = renderPatternColor;
          ctx.lineWidth = 1;

          if (page.background === 'lined') {
            const lineGap = 28;
            ctx.beginPath();
            for (let y = lineGap; y < page.height; y += lineGap) {
              ctx.moveTo(0, y);
              ctx.lineTo(page.width, y);
            }
            ctx.stroke();
          } else if (page.background === 'grid') {
            const gridGap = 30;
            ctx.beginPath();
            for (let x = gridGap; x < page.width; x += gridGap) {
              ctx.moveTo(x, 0);
              ctx.lineTo(x, page.height);
            }
            for (let y = gridGap; y < page.height; y += gridGap) {
              ctx.moveTo(0, y);
              ctx.lineTo(page.width, y);
            }
            ctx.stroke();
          } else if (page.background === 'dotted') {
            const dotGap = 24;
            const dotRadius = 1;
            for (let x = dotGap; x < page.width; x += dotGap) {
              for (let y = dotGap; y < page.height; y += dotGap) {
                ctx.beginPath();
                ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
          ctx.restore();
        }

        // Draw highlighter strokes
        for (const stroke of page.strokes) {
          if (stroke.tool === 'highlighter') {
            drawStrokeForPdfOrPng(ctx, stroke, forceWhite);
          }
        }

        // Draw pen strokes next
        for (const stroke of page.strokes) {
          if (stroke.tool === 'pen') {
            drawStrokeForPdfOrPng(ctx, stroke, forceWhite);
          }
        }
        
        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      }

      const pdfBlob = pdf.output('blob');
      const filename = `${notebook.title || 'notebook'}.pdf`;

      // Check if navigator.share files is supported
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && navigator.canShare({ files: [new File([pdfBlob], filename, { type: 'application/pdf' })] })) {
        try {
          const file = new File([pdfBlob], filename, { type: 'application/pdf' });
          await navigator.share({
            files: [file],
            title: notebook.title || 'Notebook Export',
            text: 'Here is my notebook PDF export.'
          });
          appState.updateToast(toastId, {
            message: 'Shared PDF successfully!',
            type: 'success',
            loading: false,
            duration: 3000
          });
        } catch (shareErr) {
          console.warn('Share failed, downloading instead', shareErr);
          downloadBlob(pdfBlob, filename);
          appState.updateToast(toastId, {
            message: 'PDF exported successfully!',
            type: 'success',
            loading: false,
            duration: 3000
          });
        }
      } else {
        downloadBlob(pdfBlob, filename);
        appState.updateToast(toastId, {
          message: 'PDF exported successfully!',
          type: 'success',
          loading: false,
          duration: 3000
        });
      }
    } catch (e: any) {
      console.error('PDF export failed', e);
      appState.updateToast(toastId, {
        message: 'Failed to export PDF: ' + (e.message || String(e)),
        type: 'warning',
        loading: false,
        duration: 4000
      });
    } finally {
      exportProgress.exporting = false;
    }
  }

  async function exportPageAsPng(pageId: string) {
    if (!notebook) return;
    const page = notebook.pages.find(p => p.id === pageId);
    if (!page) return;
    const notebookTitle = notebook.title || 'notebook';

    const toastId = appState.showToast('Generating PNG...', 'info', 0, undefined, true);
    
    try {
      const scale = 2;
      const forceWhite = exportOptions.forceWhite;
      const includeBg = exportOptions.includeBackground;
      
      const renderBgColor = forceWhite ? '#ffffff' : pageBg;
      const renderPatternColor = (forceWhite || isLight) ? '#e5e7eb' : '#2a2f38';

      const canvas = document.createElement('canvas');
      canvas.width = page.width * scale;
      canvas.height = page.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      
      // Draw background
      ctx.fillStyle = renderBgColor;
      ctx.fillRect(0, 0, page.width, page.height);
      
      // Draw background template pattern
      if (includeBg && page.background !== 'blank') {
        ctx.save();
        ctx.strokeStyle = renderPatternColor;
        ctx.fillStyle = renderPatternColor;
        ctx.lineWidth = 1;

        if (page.background === 'lined') {
          const lineGap = 28;
          ctx.beginPath();
          for (let y = lineGap; y < page.height; y += lineGap) {
            ctx.moveTo(0, y);
            ctx.lineTo(page.width, y);
          }
          ctx.stroke();
        } else if (page.background === 'grid') {
          const gridGap = 30;
          ctx.beginPath();
          for (let x = gridGap; x < page.width; x += gridGap) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, page.height);
          }
          for (let y = gridGap; y < page.height; y += gridGap) {
            ctx.moveTo(0, y);
            ctx.lineTo(page.width, y);
          }
          ctx.stroke();
        } else if (page.background === 'dotted') {
          const dotGap = 24;
          const dotRadius = 1;
          for (let x = dotGap; x < page.width; x += dotGap) {
            for (let y = dotGap; y < page.height; y += dotGap) {
              ctx.beginPath();
              ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.restore();
      }

      // Draw highlighter strokes
      for (const stroke of page.strokes) {
        if (stroke.tool === 'highlighter') {
          drawStrokeForPdfOrPng(ctx, stroke, forceWhite);
        }
      }

      // Draw pen strokes next
      for (const stroke of page.strokes) {
        if (stroke.tool === 'pen') {
          drawStrokeForPdfOrPng(ctx, stroke, forceWhite);
        }
      }
      
      canvas.toBlob(async (blob) => {
        if (!blob) throw new Error('Blob generation failed');
        const filename = `${notebookTitle}_page_${page.index + 1}.png`;

        if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] })) {
          try {
            const file = new File([blob], filename, { type: 'image/png' });
            await navigator.share({
              files: [file],
              title: `Notebook Page ${page.index + 1}`,
              text: 'Check out my handwritten note page.'
            });
            appState.updateToast(toastId, {
              message: 'Shared PNG successfully!',
              type: 'success',
              loading: false,
              duration: 3000
            });
          } catch (shareErr) {
            console.warn('Share failed, downloading instead', shareErr);
            downloadBlob(blob, filename);
            appState.updateToast(toastId, {
              message: 'PNG exported successfully!',
              type: 'success',
              loading: false,
              duration: 3000
            });
          }
        } else {
          downloadBlob(blob, filename);
          appState.updateToast(toastId, {
            message: 'PNG exported successfully!',
            type: 'success',
            loading: false,
            duration: 3000
          });
        }
      }, 'image/png');
    } catch (e: any) {
      console.error('PNG export failed', e);
      appState.updateToast(toastId, {
        message: 'Failed to export PNG: ' + (e.message || String(e)),
        type: 'warning',
        loading: false,
        duration: 4000
      });
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Off-screen first page thumbnail rendering
  function generateFirstPageThumbnail(): string {
    if (!notebook || notebook.pages.length === 0) return '';
    const firstPage = notebook.pages[0];
    
    const offscreen = document.createElement('canvas');
    offscreen.width = 200;
    offscreen.height = 150;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return '';

    const margin = 6;
    const pageHeight = 150 - margin * 2;
    const pageWidth = pageHeight * (firstPage.width / firstPage.height);
    const offsetX = (200 - pageWidth) / 2;
    const offsetY = margin;
    const scale = pageWidth / firstPage.width;

    oCtx.fillStyle = workspaceBg;
    oCtx.fillRect(0, 0, 200, 150);

    oCtx.save();
    oCtx.fillStyle = pageBg;
    oCtx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    oCtx.shadowBlur = 4;
    oCtx.shadowOffsetY = 2;
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.fill();
    oCtx.restore();

    oCtx.save();
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.clip();

    oCtx.translate(offsetX, offsetY);
    oCtx.scale(scale, scale);

    // Draw background
    if (firstPage.background !== 'blank') {
      const patternCol = isLight ? '#f3f4f6' : '#272d37';
      oCtx.strokeStyle = patternCol;
      oCtx.fillStyle = patternCol;
      oCtx.lineWidth = 1;
      if (firstPage.background === 'lined') {
        const lineGap = 28;
        oCtx.beginPath();
        for (let y = lineGap; y < firstPage.height; y += lineGap) {
          oCtx.moveTo(0, y);
          oCtx.lineTo(firstPage.width, y);
        }
        oCtx.stroke();
      } else if (firstPage.background === 'grid') {
        const gridGap = 30;
        oCtx.beginPath();
        for (let x = gridGap; x < firstPage.width; x += gridGap) {
          oCtx.moveTo(x, 0);
          oCtx.lineTo(x, firstPage.height);
        }
        for (let y = gridGap; y < firstPage.height; y += gridGap) {
          oCtx.moveTo(0, y);
          oCtx.lineTo(firstPage.width, y);
        }
        oCtx.stroke();
      } else if (firstPage.background === 'dotted') {
        const dotGap = 24;
        for (let x = dotGap; x < firstPage.width; x += dotGap) {
          for (let y = dotGap; y < firstPage.height; y += dotGap) {
            oCtx.beginPath();
            oCtx.arc(x, y, 0.8, 0, Math.PI * 2);
            oCtx.fill();
          }
        }
      }
    }

    // Draw strokes
    for (const stroke of firstPage.strokes) {
      if (stroke.tool !== 'eraser' && stroke.points.length > 0) {
        const pointsArray = stroke.points.map(p => [p.x, p.y, p.pressure]);
        const strokeOutlinePoints = getStroke(pointsArray, {
          size: stroke.size,
          thinning: stroke.tool === 'highlighter' ? 0.05 : 0.6,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: !stroke.points.some(p => p.pressure !== 0.5 && p.pressure !== 0 && p.pressure !== 1),
          last: true
        });

        if (strokeOutlinePoints.length > 0) {
          oCtx.save();
          oCtx.beginPath();
          oCtx.moveTo(strokeOutlinePoints[0][0], strokeOutlinePoints[0][1]);
          for (let i = 1; i < strokeOutlinePoints.length; i++) {
            oCtx.lineTo(strokeOutlinePoints[i][0], strokeOutlinePoints[i][1]);
          }
          oCtx.closePath();
          oCtx.fillStyle = stroke.color;
          oCtx.globalAlpha = stroke.opacity;
          oCtx.fill();
          oCtx.restore();
        }
      }
    }

    oCtx.restore(); // restore clip

    oCtx.strokeStyle = borderCol;
    oCtx.lineWidth = 1;
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.stroke();

    return offscreen.toDataURL('image/jpeg', 0.85);
  }

  // Fit Width and Fit Page
  function fitWidth() {
    if (!scrollContainer) return;
    const padding = 32;
    const target = (scrollContainer.clientWidth - padding) / 800;
    zoom = Math.max(0.5, Math.min(3.0, target));
    showZoomMenu = false;
  }

  function fitPage() {
    if (!scrollContainer) return;
    const padding = 108;
    const target = (scrollContainer.clientHeight - padding) / 1130;
    zoom = Math.max(0.5, Math.min(3.0, target));
    showZoomMenu = false;
  }

  // Panning Event Handlers
  function handlePointerDown(e: PointerEvent) {
    const isMiddleButton = e.button === 1;
    const isHandActive = currentTool === 'hand';
    
    if ((isHandActive && e.button === 0) || isMiddleButton) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartScrollLeft = scrollContainer?.scrollLeft || 0;
      panStartScrollTop = scrollContainer?.scrollTop || 0;
      
      if (scrollContainer) {
        scrollContainer.style.cursor = 'grabbing';
        scrollContainer.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (isPanning && scrollContainer) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      scrollContainer.scrollLeft = panStartScrollLeft - dx;
      scrollContainer.scrollTop = panStartScrollTop - dy;
      e.preventDefault();
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (isPanning && scrollContainer) {
      isPanning = false;
      scrollContainer.style.cursor = '';
      try {
        scrollContainer.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  }

  // Desktop Mouse Scroll Wheel Zoom (Ctrl + Scroll / Cmd + Scroll)
  function handleWheel(e: WheelEvent) {
    const container = scrollContainer;
    if ((e.ctrlKey || e.metaKey) && container) {
      e.preventDefault();
      const oldZoom = zoom;
      const zoomStep = 0.05;
      let targetZoom = zoom;
      if (e.deltaY < 0) {
        targetZoom = Math.min(3.0, zoom + zoomStep);
      } else {
        targetZoom = Math.max(0.5, zoom - zoomStep);
      }
      
      if (targetZoom !== oldZoom) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const contentX = mouseX + container.scrollLeft;
        const contentY = mouseY + container.scrollTop;
        
        zoom = targetZoom;
        tick().then(() => {
          container.scrollLeft = contentX * (targetZoom / oldZoom) - mouseX;
          container.scrollTop = contentY * (targetZoom / oldZoom) - mouseY;
        });
      }
    }
  }

  // Touch Pinch-to-Zoom & Panning Gesture Handlers
  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 2 && scrollContainer) {
      isPinching = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartZoom = zoom;
      
      touchStartMidX = (t1.clientX + t2.clientX) / 2;
      touchStartMidY = (t1.clientY + t2.clientY) / 2;
      touchStartScrollLeft = scrollContainer.scrollLeft;
      touchStartScrollTop = scrollContainer.scrollTop;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    const container = scrollContainer;
    if (isPinching && e.touches.length === 2 && container) {
      e.preventDefault(); // Block default browser zoom/scroll
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      
      // Calculate current midpoint
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const deltaX = midX - touchStartMidX;
      const deltaY = midY - touchStartMidY;
      
      // Calculate zoom factor
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      let targetZoom = zoom;
      if (touchStartDist > 0) {
        const factor = dist / touchStartDist;
        targetZoom = Math.max(0.5, Math.min(3.0, touchStartZoom * factor));
      }
      
      if (targetZoom !== zoom) {
        const oldZoom = zoom;
        const rect = container.getBoundingClientRect();
        const containerMidX = midX - rect.left;
        const containerMidY = midY - rect.top;
        const contentX = containerMidX + touchStartScrollLeft - deltaX;
        const contentY = containerMidY + touchStartScrollTop - deltaY;
        
        zoom = targetZoom;
        tick().then(() => {
          container.scrollLeft = contentX * (targetZoom / oldZoom) - containerMidX;
          container.scrollTop = contentY * (targetZoom / oldZoom) - containerMidY;
        });
      } else {
        // Drag scrolling with two fingers
        container.scrollLeft = touchStartScrollLeft - deltaX;
        container.scrollTop = touchStartScrollTop - deltaY;
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (isPinching && e.touches.length < 2) {
      isPinching = false;
      touchStartDist = 0;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
      return;
    }

    const isZ = e.key.toLowerCase() === 'z';
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;

    if (isCmdOrCtrl && isZ) {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div 
  class="notebook-editor" 
  class:toolbar-top={isMobile && mobileToolbarPosition === 'top'}
  class:toolbar-bottom={isMobile && mobileToolbarPosition === 'bottom'}
  class:toolbar-left={isMobile && mobileToolbarPosition === 'left'}
  class:toolbar-right={isMobile && mobileToolbarPosition === 'right'}
  class:fullscreen-active={fullscreenMode}
  class:options-visible={isMobile && showToolOptions}
  style="--workspace-bg: {workspaceBg}; --border-color: {borderCol};"
  onclick={() => { showSettingsDropdown = false; showJumpPagePopover = false; showZoomMenu = false; }}
>
  {#if isMobile}
    <!-- Fixed Top Mobile Toolbar -->
    <div class="mobile-toolbar flex-row">
      <div class="mobile-toolbar-left flex-row">
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'pen'} 
          onclick={() => selectTool('pen')}
          title="Pen"
        >
          <Pen size={15} />
          <span class="active-dot" style="background-color: {toolSettings.pen.color};"></span>
        </button>
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'highlighter'} 
          onclick={() => selectTool('highlighter')}
          title="Highlighter"
        >
          <Highlighter size={15} />
          <span class="active-dot" style="background-color: {toolSettings.highlighter.color};"></span>
        </button>
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'eraser'} 
          onclick={() => selectTool('eraser')}
          title="Eraser"
        >
          <Eraser size={15} />
        </button>
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'hand'} 
          onclick={() => selectTool('hand')}
          title="Pan/Navigate"
        >
          <Hand size={15} />
        </button>
      </div>

      <div class="mobile-toolbar-center flex-row" style="gap: 2px;">
        <button 
          class="toolbar-btn compact" 
          onclick={() => navigatePage('prev')} 
          title="Previous Page"
          disabled={!notebook || notebook.pages.findIndex(p => p.id === activePageId) <= 0}
        >
          <ChevronLeft size={13} />
        </button>

        <!-- Interactive mobile page counter -->
        <button 
          class="mobile-page-counter font-mono flex-row" 
          style="gap: 2px;"
          onclick={(e) => { e.stopPropagation(); showMobilePageIndicatorPopover = !showMobilePageIndicatorPopover; }}
        >
          {notebook ? `${notebook.pages.findIndex(p => p.id === activePageId) + 1}/${notebook.pages.length}` : '0/0'}
          <ChevronDown size={8} />
        </button>

        <button 
          class="toolbar-btn compact" 
          onclick={() => navigatePage('next')} 
          title="Next Page"
          disabled={!notebook || notebook.pages.findIndex(p => p.id === activePageId) >= notebook.pages.length - 1}
        >
          <ChevronRight size={13} />
        </button>

        {#if showMobilePageIndicatorPopover}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <form 
            class="jump-page-popover mobile-jump flex-row" 
            onclick={(e) => e.stopPropagation()} 
            onsubmit={handleJumpPageSubmit}
            transition:fade={{ duration: 100 }}
          >
            <input 
              type="number" 
              placeholder="Page..." 
              min="1" 
              max={notebook?.pages.length || 1} 
              bind:value={jumpPageInputVal}
              class="jump-page-input"
            />
            <button type="submit" class="jump-page-submit-btn">Go</button>
          </form>
        {/if}
      </div>

      <div class="mobile-toolbar-right flex-row" style="gap: 2px;">
        <button class="toolbar-btn" disabled={undoStack.length === 0} onclick={handleUndo} title="Undo"><RotateCcw size={14} /></button>
        <button class="toolbar-btn" disabled={redoStack.length === 0} onclick={handleRedo} title="Redo"><RotateCw size={14} /></button>
        <button class="toolbar-btn" onclick={addPageAtEnd} title="Add Page"><Plus size={14} /></button>
        <button class="toolbar-btn text-danger" onclick={deleteCurrentPage} title="Delete Page"><Trash2 size={14} /></button>
        <button 
          class="toolbar-btn" 
          class:active={showMobileThumbnailsSheet} 
          onclick={() => showMobileThumbnailsSheet = !showMobileThumbnailsSheet} 
          title="Pages Overview"
        >
          <BookOpen size={14} />
        </button>
        <button class="toolbar-btn" onclick={() => { showMobileMoreMenu = true; }} title="Settings"><Settings size={14} /></button>
      </div>
    </div>

    <!-- Sliding Mobile options bar -->
    {#if showToolOptions}
      <div class="mobile-tool-options flex-row" transition:slide={{ axis: 'y', duration: 180 }}>
        <input 
          type="range" 
          min={currentTool === 'eraser' ? 10 : 1} 
          max={currentTool === 'eraser' ? 100 : 50} 
          bind:value={currentSize}
          oninput={updateToolSettings}
          style="flex: 1; max-width: 110px;"
        />
        <span class="size-val" style="width: auto; font-size: 11px;">{currentSize}px</span>

        {#if currentTool !== 'eraser'}
          <div class="toolbar-divider" style="height: 14px; margin: 0 4px;"></div>
          <div class="mobile-colors flex-row" style="gap: 6px; overflow-x: auto; flex: 1; padding: 4px 0;">
            {#each presetColors as colorPreset}
              <button 
                class="color-preset-btn" 
                style="background-color: {colorPreset}; min-width: 16px; min-height: 16px; width: 16px; height: 16px;"
                class:selected={currentColor === colorPreset}
                onclick={() => { currentColor = colorPreset; updateToolSettings(); triggerHaptic(8); }}
              ></button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <!-- Desktop Floating Glassmorphic Toolbar -->
    <div class="notebook-toolbar flex-row">
      <div class="toolbar-section flex-row">
        <!-- Drawing Tools -->
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'pen'} 
          onclick={() => selectTool('pen')}
          title="Pen"
        >
          <Pen size={18} />
          <span class="active-dot" style="background-color: {toolSettings.pen.color};"></span>
        </button>
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'highlighter'} 
          onclick={() => selectTool('highlighter')}
          title="Highlighter"
        >
          <Highlighter size={18} />
          <span class="active-dot" style="background-color: {toolSettings.highlighter.color};"></span>
        </button>
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'eraser'} 
          onclick={() => selectTool('eraser')}
          title="Eraser"
        >
          <Eraser size={18} />
        </button>
        <button 
          class="toolbar-btn" 
          class:active={currentTool === 'hand'} 
          onclick={() => selectTool('hand')}
          title="Pan/Navigate"
        >
          <Hand size={18} />
        </button>
        
        <!-- Sliders / Customizer Toggle -->
        <button 
          class="toolbar-btn options-toggle" 
          class:active={showToolOptions}
          onclick={() => showToolOptions = !showToolOptions}
          title="Size & Color Options"
        >
          <Sliders size={16} />
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <!-- Page Actions & Navigation -->
      <div class="toolbar-section flex-row page-nav-section">
        <button 
          class="toolbar-btn" 
          class:active={showThumbnailsSidePanel} 
          onclick={() => { 
            showThumbnailsSidePanel = !showThumbnailsSidePanel; 
            localStorage.setItem('mynotes_notebook_show_thumbnails', showThumbnailsSidePanel.toString());
          }} 
          title="Toggle Page Sidebar"
        >
          <BookOpen size={16} />
        </button>
        <button 
          class="toolbar-btn" 
          onclick={toggleFullscreen} 
          title={fullscreenMode ? "Exit Fullscreen" : "Fullscreen Mode"}
        >
          {#if fullscreenMode}
            <Minimize size={16} />
          {:else}
            <Maximize size={16} />
          {/if}
        </button>
        <div class="toolbar-divider" style="height: 14px; margin: 0 4px;"></div>
        <button class="toolbar-btn" onclick={() => navigatePage('prev')} title="Previous Page"><ChevronLeft size={16} /></button>
        
        <!-- Page Indicator clickable to Jump Page -->
        <div class="page-indicator-wrapper">
          <button 
            class="toolbar-btn font-mono flex-row" 
            style="width: auto; padding: 0 8px; font-size: 11px;"
            onclick={(e) => { e.stopPropagation(); showJumpPagePopover = !showJumpPagePopover; }}
            title="Jump to Page"
          >
            {notebook ? `Pg ${notebook.pages.findIndex(p => p.id === activePageId) + 1} / ${notebook.pages.length}` : 'Pg 0 / 0'}
          </button>
          
          {#if showJumpPagePopover}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <form 
              class="jump-page-popover flex-row" 
              onclick={(e) => e.stopPropagation()} 
              onsubmit={handleJumpPageSubmit}
              transition:fade={{ duration: 100 }}
            >
              <input 
                type="number" 
                placeholder="Page..." 
                min="1" 
                max={notebook?.pages.length || 1} 
                bind:value={jumpPageInputVal}
                class="jump-page-input"
              />
              <button type="submit" class="jump-page-submit-btn">Go</button>
            </form>
          {/if}
        </div>

        <button class="toolbar-btn" onclick={() => navigatePage('next')} title="Next Page"><ChevronRight size={16} /></button>
        
        <button class="toolbar-btn" onclick={addPageAtEnd} title="Add Page"><Plus size={16} /></button>
        <button class="toolbar-btn text-danger" onclick={deleteCurrentPage} title="Delete Page"><Trash2 size={16} /></button>
      </div>

      <div class="toolbar-divider"></div>

      <!-- History Actions -->
      <div class="toolbar-section flex-row">
        <button 
          class="toolbar-btn" 
          disabled={undoStack.length === 0} 
          onclick={handleUndo}
          title="Undo (Ctrl+Z)"
        >
          <RotateCcw size={16} />
        </button>
        <button 
          class="toolbar-btn" 
          disabled={redoStack.length === 0} 
          onclick={handleRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <RotateCw size={16} />
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <!-- Input Mode & Settings -->
      <div class="toolbar-section flex-row">
        <select 
          class="input-mode-select" 
          bind:value={inputMode}
          title="Input Mode Routing"
        >
          <option value="auto">Auto (Pen draws/Touch scrolls)</option>
          <option value="penOnly">Pen Only (Touches always scroll)</option>
          <option value="touchDraw">Touch Draw (Fingers draw/2-fingers scroll)</option>
        </select>

        <!-- Settings Dropdown Toggle -->
        <div class="settings-dropdown-wrapper">
          <button 
            class="toolbar-btn flex-row" 
            style="gap: 4px; padding: 0 8px;"
            onclick={(e) => { e.stopPropagation(); showSettingsDropdown = !showSettingsDropdown; }}
            title="Notebook Settings"
          >
            <Settings size={16} />
            <ChevronDown size={12} />
          </button>
          
          {#if showSettingsDropdown}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="settings-dropdown flex-col" onclick={(e) => e.stopPropagation()} transition:fade={{ duration: 150 }}>
              <span class="dropdown-header">Page Background</span>
              <div class="background-picker-row flex-row">
                <button 
                  class="bg-picker-btn" 
                  class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'blank'}
                  onclick={() => changePageBackground('blank')}
                >Blank</button>
                <button 
                  class="bg-picker-btn" 
                  class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'lined'}
                  onclick={() => changePageBackground('lined')}
                >Lined</button>
                <button 
                  class="bg-picker-btn" 
                  class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'grid'}
                  onclick={() => changePageBackground('grid')}
                >Grid</button>
                <button 
                  class="bg-picker-btn" 
                  class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'dotted'}
                  onclick={() => changePageBackground('dotted')}
                >Dotted</button>
              </div>

              <div class="dropdown-divider"></div>

              <button class="dropdown-item flex-row" onclick={handleExportPdfClick}>
                <Download size={14} />
                <span>Export as PDF</span>
              </button>

              <button class="dropdown-item flex-row text-danger" onclick={clearActivePage}>
                <Trash2 size={14} />
                <span>Clear current page</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Sliding Inline Tool Options Bar -->
    {#if showToolOptions}
      <div class="tool-options-bar flex-row" transition:slide={{ axis: 'y', duration: 200 }}>
        <div class="option-section flex-row" style="flex: 1; min-width: 150px;">
          <span class="option-label">Size</span>
          <input 
            type="range" 
            min={currentTool === 'eraser' ? 10 : 1} 
            max={currentTool === 'eraser' ? 100 : 50} 
            bind:value={currentSize}
            oninput={updateToolSettings}
            style="flex: 1; max-width: 150px;"
          />
          <span class="size-val">{currentSize}px</span>
        </div>

        {#if currentTool !== 'eraser'}
          <div class="toolbar-divider" style="height: 16px;"></div>
          <div class="option-section flex-row" style="gap: var(--spacing-xs); flex-wrap: wrap;">
            {#each presetColors as colorPreset}
              <button 
                class="color-preset-btn" 
                style="background-color: {colorPreset};"
                class:selected={currentColor === colorPreset}
                onclick={() => { currentColor = colorPreset; updateToolSettings(); triggerHaptic(8); }}
              ></button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Mobile More Menu Bottom Sheet -->
  {#if showMobileMoreMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mobile-sheet-backdrop" onclick={() => showMobileMoreMenu = false} transition:fade={{ duration: 150 }}>
      <div class="mobile-bottom-sheet flex-col" onclick={(e) => e.stopPropagation()} transition:fly={{ y: 300, duration: 250 }}>
        <div class="sheet-header flex-row">
          <span class="sheet-title">Notebook Actions</span>
          <button class="sheet-close-btn" onclick={() => showMobileMoreMenu = false}>Close</button>
        </div>

        <div class="sheet-section flex-col">
          <span class="sheet-section-title">Page Background Pattern</span>
          <div class="sheet-grid-buttons">
            <button class="sheet-action-btn" class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'blank'} onclick={() => changePageBackground('blank')}>Blank</button>
            <button class="sheet-action-btn" class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'lined'} onclick={() => changePageBackground('lined')}>Ruled</button>
            <button class="sheet-action-btn" class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'grid'} onclick={() => changePageBackground('grid')}>Grid</button>
            <button class="sheet-action-btn" class:active={notebook?.pages.find(p => p.id === activePageId)?.background === 'dotted'} onclick={() => changePageBackground('dotted')}>Dotted</button>
          </div>
        </div>

        <div class="sheet-divider"></div>

        <div class="sheet-section flex-col">
          <span class="sheet-section-title">Input Routing Mode</span>
          <div class="sheet-list-buttons flex-col">
            <button class="sheet-item-btn flex-row" class:active={inputMode === 'auto'} onclick={() => { inputMode = 'auto'; showMobileMoreMenu = false; }}>
              <span>Auto Mode (Pen draws / Touch scrolls)</span>
            </button>
            <button class="sheet-item-btn flex-row" class:active={inputMode === 'penOnly'} onclick={() => { inputMode = 'penOnly'; showMobileMoreMenu = false; }}>
              <span>Pen Only (Only stylus draws)</span>
            </button>
            <button class="sheet-item-btn flex-row" class:active={inputMode === 'touchDraw'} onclick={() => { inputMode = 'touchDraw'; showMobileMoreMenu = false; }}>
              <span>Touch Draw (Touches draw, 2-finger scrolls)</span>
            </button>
          </div>
        </div>

        <div class="sheet-divider"></div>

        <div class="sheet-section flex-col">
          <span class="sheet-section-title">Toolbar Dock Position</span>
          <div class="sheet-grid-buttons" style="grid-template-columns: repeat(4, 1fr);">
            <button class="sheet-action-btn" class:active={mobileToolbarPosition === 'top'} onclick={() => { mobileToolbarPosition = 'top'; showMobileMoreMenu = false; triggerHaptic(10); }}>Top</button>
            <button class="sheet-action-btn" class:active={mobileToolbarPosition === 'bottom'} onclick={() => { mobileToolbarPosition = 'bottom'; showMobileMoreMenu = false; triggerHaptic(10); }}>Bottom</button>
            <button class="sheet-action-btn" class:active={mobileToolbarPosition === 'left'} onclick={() => { mobileToolbarPosition = 'left'; showMobileMoreMenu = false; triggerHaptic(10); }}>Left</button>
            <button class="sheet-action-btn" class:active={mobileToolbarPosition === 'right'} onclick={() => { mobileToolbarPosition = 'right'; showMobileMoreMenu = false; triggerHaptic(10); }}>Right</button>
          </div>
        </div>

        <div class="sheet-divider"></div>

        <div class="sheet-section flex-col" style="gap: 8px;">
          <button class="sheet-row-action flex-row" onclick={() => { showMobileMoreMenu = false; toggleFullscreen(); }}>
            <span>{fullscreenMode ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span>
          </button>
          <button class="sheet-row-action flex-row" onclick={() => { showMobileMoreMenu = false; addPageAtEnd(); }}>
            <span>Add Page at End</span>
          </button>
          <button class="sheet-row-action flex-row text-danger" onclick={() => { showMobileMoreMenu = false; deleteCurrentPage(); }}>
            <span>Delete Current Page</span>
          </button>
          <button class="sheet-row-action flex-row text-danger" onclick={() => { showMobileMoreMenu = false; clearActivePage(); }}>
            <span>Clear Page strokes</span>
          </button>
          <button class="sheet-row-action flex-row primary" onclick={() => { showMobileMoreMenu = false; handleExportPdfClick(); }}>
            <span>Export Notebook to PDF</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Main Workspace Layout -->
  <div class="notebook-workspace">
    {#if !isMobile && showThumbnailsSidePanel}
      <div class="notebook-sidebar flex-col" transition:slide={{ axis: 'x', duration: 200 }}>
        <div class="sidebar-header flex-row">
          <span class="sidebar-title">Pages ({notebook?.pages.length || 0})</span>
          <button 
            class="sidebar-add-btn" 
            onclick={() => addPageAfter(notebook?.pages[notebook.pages.length - 1].id || '')} 
            title="Add Page at End"
          >
            <Plus size={14} />
          </button>
        </div>
        
        <div class="sidebar-thumbnails flex-col">
          {#if notebook}
            {#each notebook.pages as page, idx (page.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="thumbnail-card flex-col"
                class:active={activePageId === page.id}
                class:drag-over={dragOverIndex === idx}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, idx)}
                ondragover={(e) => handleDragOver(e, idx)}
                ondragleave={() => dragOverIndex = null}
                ondrop={(e) => handleDrop(e, idx)}
                ondragend={handleDragEnd}
                onclick={() => scrollToPage(page.id)}
              >
                <div class="thumbnail-wrapper">
                  {#if cachedThumbnails[page.id]}
                    <img src={cachedThumbnails[page.id]} alt="Page {idx + 1}" />
                  {:else}
                    <div class="thumbnail-placeholder font-mono">Page {idx + 1}</div>
                  {/if}
                  
                  <div class="thumbnail-overlay flex-row" onclick={(e) => e.stopPropagation()}>
                    <button class="overlay-btn" onclick={() => movePage(page.id, -1)} disabled={idx === 0} title="Move Up">
                      <ChevronUp size={11} />
                    </button>
                    <button class="overlay-btn" onclick={() => movePage(page.id, 1)} disabled={idx === notebook.pages.length - 1} title="Move Down">
                      <ChevronDown size={11} />
                    </button>
                    <button class="overlay-btn" onclick={() => duplicatePage(page.id)} title="Duplicate">
                      <Copy size={11} />
                    </button>
                    <button class="overlay-btn" onclick={() => exportPageAsPng(page.id)} title="Export Page as PNG">
                      <Download size={11} />
                    </button>
                    <button class="overlay-btn text-danger" onclick={() => deletePage(page.id)} title="Delete">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <div class="thumbnail-info flex-row" onclick={(e) => e.stopPropagation()}>
                  <span class="thumbnail-number font-mono">Page {idx + 1}</span>
                  <button 
                    class="thumbnail-add-after-btn" 
                    onclick={() => addPageAfter(page.id)} 
                    title="Insert page after"
                  >
                    <Plus size={11} />
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}

    <div class="notebook-main-content">
      <!-- Vertical scrollable multi-page container -->
      <div 
        class="notebook-scroll-container" 
        class:hand-tool={currentTool === 'hand'}
        bind:this={scrollContainer}
        style="padding-top: {isMobile ? '64px' : '72px'}; --zoom-level: {zoom};"
        onscroll={() => { contextMenuState.show = false; }}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        onwheel={handleWheel}
      >
        {#if notebook}
          {#each notebook.pages as page (page.id)}
            <div 
              class="notebook-page-wrapper"
              data-page-id={page.id}
              use:observePage={page.id}
              style="--zoom-level: {zoom};"
            >
              <NotebookPageComp
                page={page}
                active={activePageId === page.id}
                tool={currentTool}
                color={currentColor}
                size={currentSize}
                inputMode={inputMode}
                visible={visiblePages.has(page.id)}
                bind:hasStylus={hasStylus}
                zoom={zoom}
                onStrokeAdd={(stroke) => handleStrokeAdd(page.id, stroke)}
                onStrokeErase={(erasedIds) => handleStrokeErase(page.id, erasedIds)}
                onActive={() => handlePageActive(page.id)}
                onContextMenu={handlePageContextMenu}
                onLongPress={handlePageLongPress}
              />
            </div>
          {/each}
          
          <div class="notebook-footer font-mono">
            {notebook.pages.length} Pages • Active Page: {notebook.pages.findIndex(p => p.id === activePageId) + 1}
          </div>
        {/if}
      </div>

      <!-- Floating Zoom Controls Overlay -->
      <div class="zoom-controls-overlay flex-row" onclick={(e) => e.stopPropagation()}>
        <button 
          onclick={() => { zoom = Math.max(0.5, zoom - 0.1); showZoomMenu = false; }} 
          title="Zoom Out"
          disabled={zoom <= 0.5}
        >
          <Minus size={14} />
        </button>
        <button 
          onclick={() => showZoomMenu = !showZoomMenu} 
          class="zoom-value-btn"
          title="Zoom Options"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button 
          onclick={() => { zoom = Math.min(3.0, zoom + 0.1); showZoomMenu = false; }} 
          title="Zoom In"
          disabled={zoom >= 3.0}
        >
          <Plus size={14} />
        </button>
      </div>

      {#if showZoomMenu}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div 
          class="zoom-menu" 
          onclick={(e) => e.stopPropagation()}
          transition:fade={{ duration: 100 }}
        >
          <button class:active={zoom === 0.5} onclick={() => { zoom = 0.5; showZoomMenu = false; }}>50%</button>
          <button class:active={zoom === 1.0} onclick={() => { zoom = 1.0; showZoomMenu = false; }}>100%</button>
          <button class:active={zoom === 1.5} onclick={() => { zoom = 1.5; showZoomMenu = false; }}>150%</button>
          <button class:active={zoom === 2.0} onclick={() => { zoom = 2.0; showZoomMenu = false; }}>200%</button>
          <button class:active={zoom === 3.0} onclick={() => { zoom = 3.0; showZoomMenu = false; }}>300%</button>
          <div class="zoom-divider"></div>
          <button onclick={fitWidth}>Fit Width</button>
          <button onclick={fitPage}>Fit Page</button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Custom Context Menu for Per-Page Operations -->
  {#if contextMenuState.show}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      class="custom-context-menu" 
      style="top: {contextMenuState.y}px; left: {contextMenuState.x}px;"
      onclick={(e) => e.stopPropagation()}
      transition:fade={{ duration: 80 }}
    >
      <div class="menu-header font-mono">
        {#if notebook && notebook.pages.findIndex(p => p.id === contextMenuState.pageId) !== -1}
          Pg {notebook.pages.findIndex(p => p.id === contextMenuState.pageId) + 1} Actions
        {:else}
          Page Actions
        {/if}
      </div>
      
      <div class="menu-section-title">Background</div>
      <div class="background-options-grid">
        <button 
          class="bg-opt-btn" 
          class:active={notebook?.pages.find(p => p.id === contextMenuState.pageId)?.background === 'blank'} 
          onclick={() => { changePageBackground('blank', contextMenuState.pageId); contextMenuState.show = false; }}
        >Blank</button>
        <button 
          class="bg-opt-btn" 
          class:active={notebook?.pages.find(p => p.id === contextMenuState.pageId)?.background === 'lined'} 
          onclick={() => { changePageBackground('lined', contextMenuState.pageId); contextMenuState.show = false; }}
        >Ruled</button>
        <button 
          class="bg-opt-btn" 
          class:active={notebook?.pages.find(p => p.id === contextMenuState.pageId)?.background === 'grid'} 
          onclick={() => { changePageBackground('grid', contextMenuState.pageId); contextMenuState.show = false; }}
        >Grid</button>
        <button 
          class="bg-opt-btn" 
          class:active={notebook?.pages.find(p => p.id === contextMenuState.pageId)?.background === 'dotted'} 
          onclick={() => { changePageBackground('dotted', contextMenuState.pageId); contextMenuState.show = false; }}
        >Dotted</button>
      </div>

      <div class="menu-divider"></div>

      <button class="menu-item" onclick={() => { addPageAfter(contextMenuState.pageId); contextMenuState.show = false; }}>
        <Plus size={13} />
        <span>Insert Page After</span>
      </button>
      
      <button class="menu-item" onclick={() => { duplicatePage(contextMenuState.pageId); contextMenuState.show = false; }}>
        <Copy size={13} />
        <span>Duplicate Page</span>
      </button>
      
      <button class="menu-item" onclick={() => { exportPageAsPng(contextMenuState.pageId); contextMenuState.show = false; }}>
        <Download size={13} />
        <span>Export Page as PNG</span>
      </button>

      <button class="menu-item text-danger" onclick={() => { deletePage(contextMenuState.pageId); contextMenuState.show = false; }}>
        <Trash2 size={13} />
        <span>Delete Page</span>
      </button>
    </div>
  {/if}

  <!-- Mobile Bottom Sheet for Thumbnails -->
  {#if showMobileThumbnailsSheet}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mobile-sheet-backdrop" onclick={() => showMobileThumbnailsSheet = false} transition:fade={{ duration: 150 }}>
      <div class="mobile-bottom-sheet flex-col" onclick={(e) => e.stopPropagation()} transition:fly={{ y: 300, duration: 250 }}>
        <div class="sheet-header flex-row">
          <span class="sheet-title">Pages Overview ({notebook?.pages.length || 0})</span>
          <button class="sheet-close-btn" onclick={() => showMobileThumbnailsSheet = false}>Close</button>
        </div>

        <div class="mobile-thumbnails-horizontal flex-row">
          {#if notebook}
            {#each notebook.pages as page, idx (page.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="mobile-thumbnail-card flex-col"
                class:active={activePageId === page.id}
                onclick={() => { scrollToPage(page.id); showMobileThumbnailsSheet = false; }}
              >
                <div class="mobile-thumbnail-wrapper">
                  {#if cachedThumbnails[page.id]}
                    <img src={cachedThumbnails[page.id]} alt="Page {idx + 1}" />
                  {:else}
                    <div class="thumbnail-placeholder font-mono">Pg {idx + 1}</div>
                  {/if}
                </div>
                <div class="mobile-thumbnail-info flex-row" onclick={(e) => e.stopPropagation()}>
                  <span class="mobile-thumbnail-number font-mono">Page {idx + 1}</span>
                </div>
                <div class="mobile-thumbnail-actions flex-row" onclick={(e) => e.stopPropagation()}>
                  <button class="mobile-card-action-btn" onclick={() => movePage(page.id, -1)} disabled={idx === 0} title="Move Up">
                    <ChevronUp size={11} />
                  </button>
                  <button class="mobile-card-action-btn" onclick={() => movePage(page.id, 1)} disabled={idx === notebook.pages.length - 1} title="Move Down">
                    <ChevronDown size={11} />
                  </button>
                  <button class="mobile-card-action-btn" onclick={() => duplicatePage(page.id)} title="Duplicate">
                    <Copy size={11} />
                  </button>
                  <button class="mobile-card-action-btn" onclick={() => exportPageAsPng(page.id)} title="Export Page as PNG">
                    <Download size={11} />
                  </button>
                  <button class="mobile-card-action-btn text-danger" onclick={() => deletePage(page.id)} title="Delete">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            {/each}
            
            <button 
              class="mobile-add-page-card flex-col" 
              onclick={() => { addPageAfter(notebook?.pages[notebook.pages.length - 1].id || ''); }}
            >
              <Plus size={20} />
              <span class="font-mono" style="font-size: 9px; margin-top: 4px; opacity: 0.8;">Add Page</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- PDF Export Options Dialog Modal -->
  {#if showExportModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="export-modal-backdrop" onclick={() => showExportModal = false} transition:fade={{ duration: 150 }}>
      <div class="export-modal-card flex-col" onclick={(e) => e.stopPropagation()} transition:fly={{ y: 30, duration: 250 }}>
        <div class="export-modal-header flex-row">
          <span class="export-modal-title">Export Document</span>
          <button class="export-modal-close" onclick={() => showExportModal = false}>&times;</button>
        </div>

        <div class="export-modal-body flex-row">
          {#if !isMobile && notebook && notebook.pages.length > 0}
            <div class="export-preview-column flex-col">
              <span class="column-title">Preview (Page 1)</span>
              <div 
                class="export-preview-box bg-{notebook.pages[0].background}"
                class:force-white-preview={exportOptions.forceWhite}
                style="--preview-bg: {exportOptions.forceWhite ? '#ffffff' : pageBg}; --pattern-color: {(exportOptions.forceWhite || isLight) ? '#e5e7eb' : '#2a2f38'};"
              >
                {#if cachedThumbnails[notebook.pages[0].id]}
                  <img src={cachedThumbnails[notebook.pages[0].id]} alt="First Page Preview" class:force-white-img={exportOptions.forceWhite} />
                {:else}
                  <div class="thumbnail-placeholder font-mono">Page 1</div>
                {/if}
              </div>
            </div>
          {/if}

          <div class="export-settings-column flex-col">
            <span class="column-title">Export Settings</span>
            
            <div class="setting-group flex-col">
              <label class="setting-label">Page Range</label>
              <div class="radio-group flex-row">
                <label class="radio-label">
                  <input type="radio" name="exportRange" value="all" bind:group={exportOptions.range} />
                  <span>All ({notebook?.pages.length || 0})</span>
                </label>
                <label class="radio-label">
                  <input type="radio" name="exportRange" value="current" bind:group={exportOptions.range} />
                  <span>Current</span>
                </label>
                <label class="radio-label">
                  <input type="radio" name="exportRange" value="custom" bind:group={exportOptions.range} />
                  <span>Custom</span>
                </label>
              </div>
              
              {#if exportOptions.range === 'custom'}
                <input 
                  type="text" 
                  class="custom-range-input" 
                  placeholder="e.g., 1-3, 5" 
                  bind:value={exportOptions.customRangeText}
                  class:invalid-range={isCustomRangeInvalid}
                />
                <span class="range-hint">Enter pages separated by commas or ranges (e.g. 1-3, 5)</span>
              {/if}
            </div>

            <div class="setting-group flex-col">
              <label class="setting-label">Template & Colors</label>
              <div class="checkbox-list flex-col">
                <label class="checkbox-label">
                  <input type="checkbox" bind:checked={exportOptions.includeBackground} />
                  <span>Include Background Pattern</span>
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" bind:checked={exportOptions.forceWhite} />
                  <span>Force White Paper (Saves ink)</span>
                </label>
              </div>
            </div>

            <div class="setting-group flex-col">
              <label class="setting-label">Export Quality</label>
              <div class="radio-group flex-row">
                <label class="radio-label">
                  <input type="radio" name="exportQuality" value="standard" bind:group={exportOptions.quality} />
                  <span>Standard (2x scale)</span>
                </label>
                <label class="radio-label">
                  <input type="radio" name="exportQuality" value="high" bind:group={exportOptions.quality} />
                  <span>High (3x print-res)</span>
                </label>
              </div>
            </div>

            <div class="export-summary flex-row">
              <div class="summary-item flex-col">
                <span class="summary-label">Pages to export</span>
                <span class="summary-value">{pagesToExport.length}</span>
              </div>
              <div class="summary-item flex-col">
                <span class="summary-label">Estimated file size</span>
                <span class="summary-value">{estimatedSizeText}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="export-modal-footer flex-row">
          <button class="export-btn-cancel" onclick={() => showExportModal = false}>Cancel</button>
          <button 
            class="export-btn-confirm" 
            onclick={generatePdf} 
            disabled={pagesToExport.length === 0 || isCustomRangeInvalid}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- PDF Progressive Exporting Progress Overlay -->
  {#if exportProgress.exporting}
    <div class="export-progress-overlay flex-col">
      <div class="export-progress-card flex-col">
        <span class="progress-title font-mono">Generating PDF Export</span>
        <span class="progress-subtitle">Please keep this window open...</span>
        
        <div class="progress-bar-container">
          <div 
            class="progress-bar-fill" 
            style="width: {(exportProgress.current / exportProgress.total) * 100}%;"
          ></div>
        </div>
        
        <span class="progress-text font-mono">
          Page {exportProgress.current} of {exportProgress.total} ({Math.round((exportProgress.current / exportProgress.total) * 100)}%)
        </span>
      </div>
    </div>
  {/if}
</div>

<style>
  .notebook-editor {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background-color: var(--workspace-bg);
    overflow: hidden;
    position: relative;
  }

  /* Desktop Toolbar styling */
  .notebook-toolbar {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(12px) saturate(120%);
    -webkit-backdrop-filter: blur(12px) saturate(120%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    border-radius: 12px;
    padding: var(--spacing-2xs) var(--spacing-sm);
    gap: var(--spacing-xs);
    align-items: center;
  }

  :global(.theme-light) .notebook-toolbar {
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  }

  .toolbar-section {
    gap: var(--spacing-2xs);
    align-items: center;
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background-color: rgba(255, 255, 255, 0.15);
  }

  :global(.theme-light) .toolbar-divider {
    background-color: rgba(0, 0, 0, 0.1);
  }

  .toolbar-btn {
    background: none;
    border: none;
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    position: relative;
    transition: background-color 0.2s, transform 0.1s;
  }

  .toolbar-btn:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.1);
    transform: translateY(-1px);
  }

  .toolbar-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  :global(.theme-light) .toolbar-btn:hover:not(:disabled) {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .toolbar-btn.active {
    background-color: var(--accent);
    color: #ffffff;
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .active-dot {
    position: absolute;
    bottom: 3px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    box-shadow: 0 0 2px rgba(0,0,0,0.5);
  }

  .toolbar-btn.active .active-dot {
    display: none;
  }

  .input-mode-select {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    height: 28px;
    padding: 0 4px;
    cursor: pointer;
    outline: none;
  }

  :global(.theme-light) .input-mode-select {
    background: rgba(0, 0, 0, 0.03);
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  /* Page indicator popovers */
  .page-indicator-wrapper {
    position: relative;
  }

  .jump-page-popover {
    position: absolute;
    top: 42px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    padding: var(--spacing-2xs);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    z-index: 100;
    gap: 4px;
  }

  .jump-page-popover.mobile-jump {
    top: 36px;
  }

  .jump-page-input {
    width: 60px;
    height: 24px;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface);
    color: var(--text-primary);
    outline: none;
  }

  .jump-page-submit-btn {
    font-size: 11px;
    padding: 2px 8px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  /* Inline settings options bar */
  .tool-options-bar {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9;
    background: rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: var(--spacing-2xs) var(--spacing-sm);
    gap: var(--spacing-sm);
    align-items: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  }

  :global(.theme-light) .tool-options-bar {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  }

  .option-section {
    align-items: center;
    gap: 8px;
  }

  .option-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .size-val {
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    width: 32px;
    text-align: right;
  }

  .color-preset-btn {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.3);
    cursor: pointer;
    padding: 0;
    transition: transform 0.1s;
  }

  .color-preset-btn:hover {
    transform: scale(1.15);
  }

  .color-preset-btn.selected {
    box-shadow: 0 0 0 2px var(--accent);
    transform: scale(1.1);
  }

  /* Settings dropdown menu */
  .settings-dropdown-wrapper {
    position: relative;
  }

  .settings-dropdown {
    position: absolute;
    top: 42px;
    right: 0;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    border-radius: 8px;
    padding: 8px;
    width: 210px;
    z-index: 100;
  }

  .dropdown-header {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
    padding: 4px 8px;
  }

  .background-picker-row {
    padding: 4px;
    gap: 4px;
  }

  .bg-picker-btn {
    flex: 1;
    font-size: 10px;
    padding: 4px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: none;
    color: var(--text-primary);
    cursor: pointer;
  }

  .bg-picker-btn.active {
    background-color: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }

  .dropdown-divider {
    height: 1px;
    background-color: var(--border-color);
    margin: 6px 0;
  }

  .dropdown-item {
    background: none;
    border: none;
    color: var(--text-primary);
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: var(--font-size-xs);
    width: 100%;
    align-items: center;
    gap: 8px;
    text-align: left;
  }

  .dropdown-item:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  :global(.theme-light) .dropdown-item:hover {
    background-color: rgba(0, 0, 0, 0.03);
  }

  .dropdown-item.text-danger {
    color: var(--semantic-danger, #ff5c5c);
  }

  /* Page Scroll Container */
  .notebook-scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 72px 16px 36px 16px;
    gap: 16px;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    user-select: none;
    -webkit-user-select: none;
  }

  .notebook-scroll-container.hand-tool {
    cursor: grab;
  }

  .notebook-scroll-container.hand-tool:active {
    cursor: grabbing;
  }

  .notebook-page-wrapper {
    width: calc(100% * var(--zoom-level, 1));
    max-width: calc(800px * var(--zoom-level, 1));
    display: flex;
    justify-content: center;
    transition: width 0.15s ease-out, max-width 0.15s ease-out;
  }

  /* Zoom Overlay & Popover Styles */
  .zoom-controls-overlay {
    position: absolute;
    bottom: 24px;
    right: 24px;
    background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-color);
    border-radius: 30px;
    padding: 4px;
    gap: 2px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    z-index: 10;
    align-items: center;
  }

  .zoom-controls-overlay button {
    background: transparent;
    border: none;
    color: var(--text-primary);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .zoom-controls-overlay button:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .zoom-controls-overlay button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .zoom-value-btn {
    font-size: var(--font-size-xs);
    font-weight: 600;
    width: auto !important;
    padding: 0 8px;
    font-family: monospace;
  }

  .zoom-menu {
    position: absolute;
    bottom: 68px;
    right: 24px;
    background: color-mix(in srgb, var(--bg-surface) 95%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    z-index: 11;
    min-width: 120px;
  }

  .zoom-menu button {
    background: transparent;
    border: none;
    color: var(--text-primary);
    padding: 8px 12px;
    border-radius: 6px;
    text-align: left;
    font-size: var(--font-size-xs);
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .zoom-menu button:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .zoom-menu button.active {
    color: var(--accent);
    font-weight: bold;
  }

  .zoom-divider {
    height: 1px;
    background-color: var(--border-color);
    margin: 4px 0;
  }

  .notebook-footer {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    opacity: 0.6;
    padding-top: 8px;
    padding-bottom: 24px;
  }

  /* Mobile Specific Layouts & Elements */
  .mobile-toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 52px;
    z-index: 11;
    background: rgba(20, 20, 22, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--spacing-sm);
  }

  :global(.theme-light) .mobile-toolbar {
    background: rgba(255, 255, 255, 0.95);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  .mobile-page-counter {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 20px;
    align-items: center;
    cursor: pointer;
    position: relative;
  }

  :global(.theme-light) .mobile-page-counter {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .mobile-tool-options {
    position: absolute;
    top: 52px;
    left: 0;
    right: 0;
    height: 48px;
    z-index: 10;
    background: rgba(20, 20, 22, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    padding: 0 var(--spacing-md);
    gap: var(--spacing-sm);
  }

  :global(.theme-light) .mobile-tool-options {
    background: rgba(255, 255, 255, 0.9);
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }

  .mobile-colors::-webkit-scrollbar {
    display: none;
  }

  /* Mobile bottom sheet */
  .mobile-sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
    display: flex;
    align-items: flex-end;
  }

  .mobile-bottom-sheet {
    background: var(--bg-surface);
    border-top: 1px solid var(--border-color);
    border-radius: 16px 16px 0 0;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    padding: var(--spacing-md);
    gap: var(--spacing-md);
  }

  .sheet-header {
    justify-content: space-between;
    align-items: center;
    padding-bottom: 4px;
  }

  .sheet-title {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .sheet-close-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
  }

  .sheet-section {
    gap: 8px;
  }

  .sheet-section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
    opacity: 0.8;
  }

  .sheet-grid-buttons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--spacing-xs);
  }

  .sheet-action-btn {
    padding: 8px;
    font-size: var(--font-size-xs);
    border: 1px solid var(--border-color);
    background: none;
    color: var(--text-primary);
    border-radius: 6px;
    cursor: pointer;
  }

  .sheet-action-btn.active {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }

  .sheet-list-buttons {
    gap: 6px;
  }

  .sheet-item-btn {
    padding: 10px 12px;
    font-size: var(--font-size-sm);
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.01);
    color: var(--text-primary);
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }

  .sheet-item-btn.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .sheet-row-action {
    padding: 11px;
    font-size: var(--font-size-sm);
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    border-radius: 8px;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 100%;
  }

  .sheet-row-action.primary {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
    font-weight: 500;
  }

  .sheet-row-action.text-danger {
    color: var(--semantic-danger, #ff5c5c);
  }

  .sheet-divider {
    height: 1px;
    background-color: var(--border-color);
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
  }

  /* Mobile Toolbar button styling overrides */
  .mobile-toolbar .toolbar-btn {
    width: 28px;
    height: 32px;
    padding: 0;
  }

  .mobile-toolbar .toolbar-btn.compact {
    width: 24px;
    height: 32px;
  }

  .mobile-page-counter {
    padding: 2px 6px !important;
    font-size: 10px !important;
  }
  /* Workspace Layout & Sidebar */
  .notebook-workspace {
    display: flex;
    flex-direction: row;
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .notebook-main-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .notebook-sidebar {
    width: 240px;
    height: 100%;
    border-right: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.08);
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding-top: 72px;
  }

  :global(.theme-light) .notebook-sidebar {
    background: rgba(255, 255, 255, 0.35);
  }

  .sidebar-header {
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .sidebar-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .sidebar-add-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
  }

  .sidebar-add-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  :global(.theme-light) .sidebar-add-btn:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .sidebar-thumbnails {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    gap: 16px;
    display: flex;
    flex-direction: column;
  }

  .thumbnail-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    border-radius: 8px;
    border: 2px solid transparent;
    padding: 6px;
    background: rgba(255, 255, 255, 0.02);
    transition: all 0.2s;
    position: relative;
  }

  :global(.theme-light) .thumbnail-card {
    background: rgba(0, 0, 0, 0.02);
  }

  .thumbnail-card:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  :global(.theme-light) .thumbnail-card:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .thumbnail-card.active {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.06);
  }

  :global(.theme-light) .thumbnail-card.active {
    background: rgba(0, 0, 0, 0.04);
  }

  .thumbnail-card.drag-over {
    border-color: var(--accent);
    border-style: dashed;
  }

  .thumbnail-wrapper {
    position: relative;
    width: 100%;
    aspect-ratio: 120 / 170;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-surface);
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .thumbnail-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .thumbnail-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-secondary);
    font-size: 11px;
    opacity: 0.7;
  }

  .thumbnail-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    justify-content: center;
    gap: 6px;
    padding: 6px;
    opacity: 0;
    transition: opacity 0.2s;
    border-radius: 0 0 3px 3px;
  }

  .thumbnail-card:hover .thumbnail-overlay {
    opacity: 1;
  }

  .overlay-btn {
    background: none;
    border: none;
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .overlay-btn:hover {
    background-color: rgba(255, 255, 255, 0.2);
  }

  .overlay-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .thumbnail-info {
    justify-content: space-between;
    align-items: center;
    padding: 2px 4px;
  }

  .thumbnail-number {
    font-size: 10px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .thumbnail-add-after-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, background-color 0.2s;
  }

  .thumbnail-add-after-btn:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.1);
  }

  :global(.theme-light) .thumbnail-add-after-btn:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  /* Custom Context Menu */
  .custom-context-menu {
    position: fixed;
    z-index: 1000;
    background: rgba(30, 30, 35, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    padding: 6px;
    width: 180px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  :global(.theme-light) .custom-context-menu {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  }

  .menu-header {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
    padding: 6px 8px 4px 8px;
    letter-spacing: 0.5px;
  }

  .menu-section-title {
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--text-secondary);
    opacity: 0.7;
    padding: 4px 8px;
  }

  .background-options-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    padding: 2px 6px;
  }

  .bg-opt-btn {
    font-size: 10px;
    padding: 4px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: none;
    color: var(--text-primary);
    cursor: pointer;
    text-align: center;
    transition: background-color 0.2s;
  }

  .bg-opt-btn:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  :global(.theme-light) .bg-opt-btn:hover {
    background-color: rgba(0, 0, 0, 0.03);
  }

  .bg-opt-btn.active {
    background-color: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }

  .menu-divider {
    height: 1px;
    background-color: var(--border-color);
    margin: 4px 0;
  }

  .menu-item {
    background: none;
    border: none;
    color: var(--text-primary);
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: var(--font-size-xs);
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    transition: background-color 0.2s;
  }

  .menu-item:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  :global(.theme-light) .menu-item:hover {
    background-color: rgba(0, 0, 0, 0.03);
  }

  .menu-item.text-danger {
    color: var(--semantic-danger, #ff5c5c);
  }

  /* Mobile Horizontal Scroll Previews */
  .mobile-thumbnails-horizontal {
    overflow-x: auto;
    display: flex;
    flex-direction: row;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) 0;
    width: 100%;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }

  .mobile-thumbnails-horizontal::-webkit-scrollbar {
    display: none;
  }

  .mobile-thumbnail-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    border-radius: 8px;
    border: 2px solid transparent;
    padding: 6px;
    background: rgba(255, 255, 255, 0.02);
    transition: all 0.2s;
    flex-shrink: 0;
    width: 106px;
    align-items: center;
  }

  :global(.theme-light) .mobile-thumbnail-card {
    background: rgba(0, 0, 0, 0.02);
  }

  .mobile-thumbnail-card.active {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.08);
  }

  :global(.theme-light) .mobile-thumbnail-card.active {
    background: rgba(0, 0, 0, 0.04);
  }

  .mobile-thumbnail-wrapper {
    position: relative;
    width: 90px;
    height: 127px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-surface);
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .mobile-thumbnail-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .mobile-thumbnail-info {
    justify-content: center;
    width: 100%;
  }

  .mobile-thumbnail-number {
    font-size: 10px;
    color: var(--text-secondary);
    text-align: center;
    font-weight: 500;
  }

  .mobile-thumbnail-actions {
    justify-content: center;
    gap: 4px;
    width: 100%;
    margin-top: 2px;
  }

  .mobile-card-action-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    transition: background-color 0.2s, color 0.2s;
  }

  .mobile-card-action-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  :global(.theme-light) .mobile-card-action-btn:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .mobile-card-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .mobile-add-page-card {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 106px;
    height: 185px;
    border-radius: 8px;
    border: 1.5px dashed var(--border-color);
    background: rgba(255, 255, 255, 0.01);
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.2s, color 0.2s;
  }

  .mobile-add-page-card:hover {
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-primary);
  }

  /* PDF & PNG Export Dialog Modal Styles */
  .export-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  }

  .export-modal-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    width: 90%;
    max-width: 580px;
    overflow: hidden;
    gap: 0;
  }

  .export-modal-header {
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .export-modal-title {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .export-modal-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 24px;
    cursor: pointer;
    line-height: 1;
  }

  .export-modal-body {
    padding: 20px;
    gap: 20px;
    align-items: stretch;
  }

  .export-preview-column {
    width: 140px;
    flex-shrink: 0;
    gap: 8px;
  }

  .column-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
    letter-spacing: 0.5px;
  }

  .export-preview-box {
    width: 100%;
    aspect-ratio: 120 / 170;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--bg-surface);
    position: relative;
  }

  .export-preview-box img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .force-white-preview {
    background-color: #ffffff !important;
  }

  .force-white-img {
    filter: invert(1) hue-rotate(180deg);
  }

  .export-settings-column {
    flex: 1;
    gap: 16px;
  }

  .setting-group {
    gap: 6px;
  }

  .setting-label {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-primary);
  }

  .radio-group {
    gap: 12px;
    flex-wrap: wrap;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    cursor: pointer;
  }

  .radio-label input {
    cursor: pointer;
    accent-color: var(--accent);
  }

  .custom-range-input {
    height: 28px;
    font-size: var(--font-size-xs);
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface);
    color: var(--text-primary);
    outline: none;
    width: 100%;
    margin-top: 4px;
  }

  .custom-range-input:focus {
    border-color: var(--accent);
  }

  .custom-range-input.invalid-range {
    border-color: var(--semantic-danger, #ff5c5c);
  }

  .range-hint {
    font-size: 10px;
    color: var(--text-secondary);
    opacity: 0.8;
  }

  .checkbox-list {
    gap: 8px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    cursor: pointer;
  }

  .checkbox-label input {
    cursor: pointer;
    accent-color: var(--accent);
  }

  .export-summary {
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 10px 14px;
    justify-content: space-between;
    margin-top: 8px;
  }

  :global(.theme-light) .export-summary {
    background: rgba(0, 0, 0, 0.02);
  }

  .summary-item {
    gap: 2px;
  }

  .summary-label {
    font-size: 10px;
    color: var(--text-secondary);
  }

  .summary-value {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .export-modal-footer {
    padding: 14px 20px;
    border-top: 1px solid var(--border-color);
    justify-content: flex-end;
    gap: 10px;
    background: rgba(0, 0, 0, 0.02);
  }

  :global(.theme-light) .export-modal-footer {
    background: rgba(0, 0, 0, 0.01);
  }

  .export-btn-cancel {
    height: 32px;
    padding: 0 16px;
    font-size: var(--font-size-xs);
    border: 1px solid var(--border-color);
    background: none;
    color: var(--text-primary);
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .export-btn-cancel:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  :global(.theme-light) .export-btn-cancel:hover {
    background: rgba(0, 0, 0, 0.03);
  }

  .export-btn-confirm {
    height: 32px;
    padding: 0 16px;
    font-size: var(--font-size-xs);
    border: none;
    background: var(--accent);
    color: #ffffff;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: opacity 0.2s, transform 0.1s;
  }

  .export-btn-confirm:hover:not(:disabled) {
    opacity: 0.9;
  }

  .export-btn-confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* PDF Export Progress Overlay */
  .export-progress-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 1200;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(6px);
  }

  .export-progress-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 380px;
    align-items: center;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    text-align: center;
  }

  .progress-title {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .progress-subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: 4px;
    margin-bottom: 20px;
  }

  .progress-bar-container {
    width: 100%;
    height: 6px;
    background: var(--border-color);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 12px;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.2s ease-out;
  }

  .progress-text {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 500;
  }

  /* Fullscreen Global Elements Hiding */
  :global(body.handwriting-fullscreen .app-header),
  :global(body.handwriting-fullscreen .sidebar),
  :global(body.handwriting-fullscreen .note-list),
  :global(body.handwriting-fullscreen .resize-handle),
  :global(body.handwriting-fullscreen .mobile-editor-top) {
    display: none !important;
  }
  :global(body.handwriting-fullscreen .editor-panel) {
    width: 100% !important;
    flex-grow: 1 !important;
  }

  /* Mobile Toolbar relocations */
  .notebook-editor.toolbar-bottom .mobile-toolbar {
    top: auto;
    bottom: 0;
    border-bottom: none;
    border-top: 1px solid var(--border-color);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .notebook-editor.toolbar-bottom .notebook-scroll-container {
    padding-top: 16px !important;
    padding-bottom: calc(64px + env(safe-area-inset-bottom, 0)) !important;
  }

  .notebook-editor.toolbar-left .mobile-toolbar {
    top: 0;
    left: 0;
    width: 48px;
    height: 100%;
    flex-direction: column;
    border-bottom: none;
    border-right: 1px solid var(--border-color);
    padding: calc(16px + env(safe-area-inset-top, 0)) 0 16px 0;
    justify-content: flex-start;
    align-items: center;
  }

  .notebook-editor.toolbar-left .notebook-scroll-container {
    padding-top: 16px !important;
    padding-left: calc(48px + 16px + env(safe-area-inset-left, 0)) !important;
    padding-right: 16px !important;
  }

  .notebook-editor.toolbar-right .mobile-toolbar {
    top: 0;
    left: auto;
    right: 0;
    width: 48px;
    height: 100%;
    flex-direction: column;
    border-bottom: none;
    border-left: 1px solid var(--border-color);
    padding: calc(16px + env(safe-area-inset-top, 0)) 0 16px 0;
    justify-content: flex-start;
    align-items: center;
  }

  .notebook-editor.toolbar-right .notebook-scroll-container {
    padding-top: 16px !important;
    padding-right: calc(48px + 16px + env(safe-area-inset-right, 0)) !important;
    padding-left: 16px !important;
  }

  /* Flip flex alignment inside vertical mobile toolbars */
  .notebook-editor.toolbar-left .mobile-toolbar-left,
  .notebook-editor.toolbar-left .mobile-toolbar-center,
  .notebook-editor.toolbar-left .mobile-toolbar-right,
  .notebook-editor.toolbar-right .mobile-toolbar-left,
  .notebook-editor.toolbar-right .mobile-toolbar-center,
  .notebook-editor.toolbar-right .mobile-toolbar-right {
    flex-direction: column;
    width: 100%;
    align-items: center;
    gap: 12px;
  }

  /* Toolbar Options placement for side docks */
  .notebook-editor.toolbar-left .mobile-tool-options {
    top: 0;
    bottom: auto;
    left: 48px;
    right: 0;
  }

  .notebook-editor.toolbar-right .mobile-tool-options {
    top: 0;
    bottom: auto;
    left: 0;
    right: 48px;
  }

  .notebook-editor.toolbar-bottom .mobile-tool-options {
    top: auto;
    bottom: 52px;
    border-bottom: none;
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  :global(.theme-light) .notebook-editor.toolbar-bottom .mobile-tool-options {
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }

  /* Padding adjustments when tool options slide out */
  .notebook-editor.toolbar-left.options-visible .notebook-scroll-container,
  .notebook-editor.toolbar-right.options-visible .notebook-scroll-container {
    padding-top: 64px !important;
  }

  .notebook-editor.toolbar-bottom.options-visible .notebook-scroll-container {
    padding-bottom: calc(100px + env(safe-area-inset-bottom, 0)) !important;
  }

  /* Fullscreen adjustments for mobile when toolbar is not top-docked */
  .notebook-editor.fullscreen-active.toolbar-bottom .notebook-scroll-container,
  .notebook-editor.fullscreen-active.toolbar-left .notebook-scroll-container,
  .notebook-editor.fullscreen-active.toolbar-right .notebook-scroll-container {
    padding-top: 16px !important;
  }
</style>
