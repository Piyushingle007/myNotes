<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getStroke } from 'perfect-freehand';
  import { 
    Pen, 
    Highlighter, 
    Eraser, 
    RotateCcw, 
    RotateCw, 
    Trash2, 
    Sliders,
    Grid,
    Eye,
    Check,
    Palette,
    Download,
    Settings
  } from 'lucide-svelte';
  import { appState } from '../stores/appState.svelte';
  import type { 
    StrokePoint, 
    Stroke, 
    CanvasTool, 
    CanvasBackground, 
    InputMode,
    Viewport
  } from '../utils/canvasTypes';

  const PAGE_WIDTH = 800;
  const PAGE_HEIGHT = 1130;

  // Component Props
  interface Props {
    // Current active note path/id to handle resets on switch
    notePath?: string;
    // Initial strokes to load (e.g. from note document)
    initialStrokes?: Stroke[];
    // Initial background to load
    initialBackground?: CanvasBackground;
    // Callback when strokes change (autosave)
    onSave?: (strokes: Stroke[], background: CanvasBackground, thumbnail: string) => void;
  }

  let { 
    notePath = '',
    initialStrokes = [], 
    initialBackground = 'blank',
    onSave 
  }: Props = $props();

  // Elements
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let wrapperElement = $state<HTMLDivElement | null>(null);
  let colorInputEl = $state<HTMLInputElement | null>(null);

  // Mobile and Fullscreen states
  let isMobile = $derived(appState.isMobile);
  let isFullscreen = $state(false);
  let activeMobilePopup = $state<'none' | 'color' | 'size' | 'menu'>('none');
  let containerElement = $state<HTMLDivElement | null>(null);

  function toggleMobilePopup(type: 'color' | 'size' | 'menu') {
    if (activeMobilePopup === type) {
      activeMobilePopup = 'none';
    } else {
      activeMobilePopup = type;
    }
  }

  function toggleFullscreen() {
    if (!containerElement) return;
    if (!document.fullscreenElement) {
      containerElement.requestFullscreen().then(() => {
        isFullscreen = true;
      }).catch(err => {
        console.error("Error entering fullscreen:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        isFullscreen = false;
      }).catch(err => {
        console.error("Error exiting fullscreen:", err);
      });
    }
  }

  // Monitor fullscreen status
  $effect(() => {
    const handleFullscreenChange = () => {
      isFullscreen = document.fullscreenElement === containerElement;
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  });

  // States
  let strokes = $state<Stroke[]>([]);
  let undoStack = $state<Stroke[][]>([]);
  let redoStack = $state<Stroke[][]>([]);
  let currentTool = $state<CanvasTool>('pen');
  let currentBackground = $state<CanvasBackground>('blank');
  let inputMode = $state<InputMode>('auto');
  let hasStylus = $state(false);
  let viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });

  // Tool settings
  let currentSize = $state(4);
  let currentColor = $state('#ffffff');

  // We keep separate last-used settings per tool
  let toolSettings = $state({
    pen: { size: 4, color: '#ffffff' },
    highlighter: { size: 16, color: '#ffe066' },
    eraser: { size: 24, color: '' }
  });

  // Active drawing tracking (non-reactive to avoid Svelte proxy overhead in hot loop)
  let activePoints: StrokePoint[] = [];
  let isDrawing = false;
  let lastCursorPos = $state<{ x: number; y: number } | null>(null);

  // Viewport & Gestures tracking
  let activePointersMap = new Map<number, PointerEvent>();
  let activePointerId: number | null = null;
  let activePointerType: string | null = null;
  let initialPinchDistance = 0;
  let initialViewport = { x: 0, y: 0, zoom: 1 };
  let initialMidpoint = { x: 0, y: 0 };

  // Colors Palette
  const presetColors = [
    '#ffffff', // White/Light
    '#000000', // Black/Dark
    '#ff5c5c', // Red
    '#ffc83b', // Yellow
    '#4caf50', // Green
    '#3b82f6', // Blue
    '#a78bfa', // Purple
    '#f472b6'  // Pink
  ];

  // Background Options
  const backgroundOptions: { value: CanvasBackground; label: string }[] = [
    { value: 'blank', label: 'Blank' },
    { value: 'lined', label: 'Ruled' },
    { value: 'grid', label: 'Grid' },
    { value: 'dotted', label: 'Dotted' }
  ];

  // Reactive Theme Card colors
  const activeThemeObj = $derived(appState.themes.find(t => t.id === appState.theme));
  const isLight = $derived(activeThemeObj?.category === 'light');
  const workspaceBg = $derived(isLight ? '#eef0f3' : (activeThemeObj?.bg || '#111317'));
  const pageBg = $derived(isLight ? '#ffffff' : (appState.theme === 'black' ? '#121212' : '#1c1c1e'));
  const borderCol = $derived(isLight ? '#d1d5db' : '#2d333b');
  const shadowCol = $derived(isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 0, 0, 0.4)');

  let minZoom = $state(0.25);

  function fitPageToScreen() {
    if (!canvasElement || !wrapperElement) return;
    const rect = wrapperElement.getBoundingClientRect();
    const margin = 16;
    const availableWidth = rect.width - margin * 2;

    const scaleVal = Math.max(0.1, Math.min(4.0, availableWidth / PAGE_WIDTH));

    // Limit minimum zoom based on mobile view to keep it readable and writable
    if (isMobile) {
      minZoom = scaleVal;
    } else {
      minZoom = 0.25;
    }

    viewport.zoom = scaleVal;
    viewport.x = (rect.width - PAGE_WIDTH * scaleVal) / 2;
    viewport.y = margin;
    
    redrawAll();
  }

  // Reset canvas state when notePath changes
  let lastLoadedPath = $state('');
  $effect(() => {
    const path = notePath;
    if (path && path !== lastLoadedPath) {
      untrack(() => {
        strokes = [...initialStrokes];
        currentBackground = initialBackground;
        undoStack = [];
        redoStack = [];
        lastLoadedPath = path;
        
        tick().then(() => {
          resizeCanvas();
          fitPageToScreen();
        });
      });
    }
  });

  // Restore input mode preferences
  $effect(() => {
    const savedMode = localStorage.getItem('mynotes_canvas_input_mode') as InputMode;
    if (savedMode && ['auto', 'penOnly', 'touchDraw'].includes(savedMode)) {
      inputMode = savedMode;
    }
  });

  // Sync Input Mode changes to localStorage
  $effect(() => {
    localStorage.setItem('mynotes_canvas_input_mode', inputMode);
  });

  // Load tool settings from localStorage on mount
  $effect(() => {
    const savedSettings = localStorage.getItem('mynotes_canvas_tool_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (parsed.pen) toolSettings.pen = parsed.pen;
        if (parsed.highlighter) toolSettings.highlighter = parsed.highlighter;
        if (parsed.eraser) toolSettings.eraser = parsed.eraser;
      } catch (err) {
        console.warn('Failed to parse saved tool settings', err);
      }
    }
  });

  // Auto-save tool settings to localStorage on change
  $effect(() => {
    const serialized = JSON.stringify({
      pen: toolSettings.pen,
      highlighter: toolSettings.highlighter,
      eraser: toolSettings.eraser
    });
    localStorage.setItem('mynotes_canvas_tool_settings', serialized);
  });

  // Track tool changes to update local color & size settings
  $effect(() => {
    const settings = toolSettings[currentTool];
    currentSize = settings.size;
    if (currentTool !== 'eraser') {
      currentColor = settings.color;
    }
  });

  // Keep toolSettings in sync when user edits size/color
  function updateToolSettings() {
    toolSettings[currentTool].size = currentSize;
    if (currentTool !== 'eraser') {
      toolSettings[currentTool].color = currentColor;
    }
  }

  // Generate a compressed 200x150 JPEG thumbnail preview of the strokes
  function generateThumbnail(): string {
    const offscreen = document.createElement('canvas');
    offscreen.width = 200;
    offscreen.height = 150;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return '';

    // Fill workspace background
    oCtx.fillStyle = workspaceBg;
    oCtx.fillRect(0, 0, 200, 150);

    // Fit A4 page to the 200x150 thumbnail area
    const margin = 6;
    const pageHeight = 150 - margin * 2;
    const pageWidth = pageHeight * (PAGE_WIDTH / PAGE_HEIGHT);
    const offsetX = (200 - pageWidth) / 2;
    const offsetY = margin;
    const scale = pageWidth / PAGE_WIDTH;

    // Draw shadow
    oCtx.save();
    oCtx.fillStyle = pageBg;
    oCtx.shadowColor = shadowCol;
    oCtx.shadowBlur = 4;
    oCtx.shadowOffsetX = 0;
    oCtx.shadowOffsetY = 2;
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.fill();
    oCtx.restore();

    // Draw page background
    oCtx.fillStyle = pageBg;
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.fill();

    // Clip to the page
    oCtx.save();
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.clip();

    // Apply scale and translation for content
    oCtx.translate(offsetX, offsetY);
    oCtx.scale(scale, scale);

    // Draw background pattern if not blank
    if (currentBackground !== 'blank') {
      const patternCol = isLight ? '#f3f4f6' : '#272d37';
      oCtx.save();
      oCtx.strokeStyle = patternCol;
      oCtx.fillStyle = patternCol;
      oCtx.lineWidth = 1;
      if (currentBackground === 'lined') {
        const lineGap = 28;
        oCtx.beginPath();
        for (let y = lineGap; y < PAGE_HEIGHT; y += lineGap) {
          oCtx.moveTo(0, y);
          oCtx.lineTo(PAGE_WIDTH, y);
        }
        oCtx.stroke();
      } else if (currentBackground === 'grid') {
        const gridGap = 30;
        oCtx.beginPath();
        for (let x = gridGap; x < PAGE_WIDTH; x += gridGap) {
          oCtx.moveTo(x, 0);
          oCtx.lineTo(x, PAGE_HEIGHT);
        }
        for (let y = gridGap; y < PAGE_HEIGHT; y += gridGap) {
          oCtx.moveTo(0, y);
          oCtx.lineTo(PAGE_WIDTH, y);
        }
        oCtx.stroke();
      } else if (currentBackground === 'dotted') {
        const dotGap = 24;
        for (let x = dotGap; x < PAGE_WIDTH; x += dotGap) {
          for (let y = dotGap; y < PAGE_HEIGHT; y += dotGap) {
            oCtx.beginPath();
            oCtx.arc(x, y, 0.8, 0, Math.PI * 2);
            oCtx.fill();
          }
        }
      }
      oCtx.restore();
    }

    // Draw completed highlighter strokes first
    for (const stroke of strokes) {
      if (stroke.tool === 'highlighter') {
        drawStroke(oCtx, stroke);
      }
    }

    // Draw completed pen strokes next
    for (const stroke of strokes) {
      if (stroke.tool === 'pen') {
        drawStroke(oCtx, stroke);
      }
    }

    oCtx.restore(); // Restore clip

    // Draw border
    oCtx.strokeStyle = borderCol;
    oCtx.lineWidth = 1;
    oCtx.beginPath();
    oCtx.roundRect(offsetX, offsetY, pageWidth, pageHeight, 2);
    oCtx.stroke();

    return offscreen.toDataURL('image/jpeg', 0.85);
  }

  // Export current canvas drawings to high-res PNG file
  async function exportAsPng() {
    const exportScale = 2;
    const exportWidth = PAGE_WIDTH * exportScale;
    const exportHeight = PAGE_HEIGHT * exportScale;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;

    const eCtx = exportCanvas.getContext('2d');
    if (!eCtx) return;

    const includeBg = confirm('Include the page background color and template pattern in the exported image? (Cancel for transparent background)');

    if (includeBg) {
      // Fill page background color
      eCtx.fillStyle = pageBg;
      eCtx.fillRect(0, 0, exportWidth, exportHeight);

      // Draw background template patterns
      eCtx.save();
      eCtx.scale(exportScale, exportScale);
      
      const patternCol = isLight ? '#e5e7eb' : '#2a2f38';
      eCtx.strokeStyle = patternCol;
      eCtx.fillStyle = patternCol;
      eCtx.lineWidth = 1;

      if (currentBackground === 'lined') {
        const lineGap = 28;
        eCtx.beginPath();
        for (let y = lineGap; y < PAGE_HEIGHT; y += lineGap) {
          eCtx.moveTo(0, y);
          eCtx.lineTo(PAGE_WIDTH, y);
        }
        eCtx.stroke();
      } else if (currentBackground === 'grid') {
        const gridGap = 30;
        eCtx.beginPath();
        for (let x = gridGap; x < PAGE_WIDTH; x += gridGap) {
          eCtx.moveTo(x, 0);
          eCtx.lineTo(x, PAGE_HEIGHT);
        }
        for (let y = gridGap; y < PAGE_HEIGHT; y += gridGap) {
          eCtx.moveTo(0, y);
          eCtx.lineTo(PAGE_WIDTH, y);
        }
        eCtx.stroke();
      } else if (currentBackground === 'dotted') {
        const dotGap = 24;
        for (let x = dotGap; x < PAGE_WIDTH; x += dotGap) {
          for (let y = dotGap; y < PAGE_HEIGHT; y += dotGap) {
            eCtx.beginPath();
            eCtx.arc(x, y, 1, 0, Math.PI * 2);
            eCtx.fill();
          }
        }
      }
      eCtx.restore();
    }

    // Draw strokes scaled
    eCtx.save();
    eCtx.scale(exportScale, exportScale);

    // Draw completed highlighter strokes first
    for (const stroke of strokes) {
      if (stroke.tool === 'highlighter') {
        drawStroke(eCtx, stroke);
      }
    }

    // Draw completed pen strokes next
    for (const stroke of strokes) {
      if (stroke.tool === 'pen') {
        drawStroke(eCtx, stroke);
      }
    }

    eCtx.restore();

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = (appState.activeNoteTitle || 'canvas-export') + '.png';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      if (typeof appState !== 'undefined') {
        appState.showToast(`Exported image successfully.`, 'success');
      }
    }, 'image/png');
  }

  // Trigger parent save when strokes list updates
  function triggerSave() {
    if (onSave) {
      const thumbnail = generateThumbnail();
      onSave(strokes, currentBackground, thumbnail);
    }
  }

  // Resize handler
  function resizeCanvas() {
    if (!canvasElement || !wrapperElement) return;

    const rect = wrapperElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvasElement.width = rect.width * dpr;
    canvasElement.height = rect.height * dpr;
    canvasElement.style.width = `${rect.width}px`;
    canvasElement.style.height = `${rect.height}px`;

    const ctx = canvasElement.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      redrawAll();
    }
  }

  // Set up ResizeObserver
  $effect(() => {
    if (!wrapperElement) return;
    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });
    observer.observe(wrapperElement);

    return () => {
      observer.disconnect();
    };
  });

  // Redraw canvas
  function redrawAll() {
    if (!canvasElement) return;
    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    const rect = canvasElement.getBoundingClientRect();

    // Clear and fill workspace background
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = workspaceBg;
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    // Apply viewport transform
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);

    // 1. Draw page card shadow
    ctx.save();
    ctx.fillStyle = pageBg;
    ctx.shadowColor = shadowCol;
    ctx.shadowBlur = 12 * viewport.zoom;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4 * viewport.zoom;
    ctx.beginPath();
    ctx.roundRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 8);
    ctx.fill();
    ctx.restore();

    // 2. Draw page card background
    ctx.fillStyle = pageBg;
    ctx.beginPath();
    ctx.roundRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 8);
    ctx.fill();

    // 3. Clip subsequent drawing to page card rounded rectangle
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 8);
    ctx.clip();

    // Draw background pattern
    drawBackground(ctx);

    // Draw completed highlighter strokes first
    for (const stroke of strokes) {
      if (stroke.tool === 'highlighter') {
        drawStroke(ctx, stroke);
      }
    }

    // Draw active highlighter stroke (if drawing)
    if (isDrawing && activePoints.length > 0 && currentTool === 'highlighter') {
      const activeStroke: Stroke = {
        id: 'active',
        tool: currentTool,
        points: activePoints,
        color: currentColor,
        size: currentSize,
        opacity: 0.3
      };
      drawStroke(ctx, activeStroke);
    }

    // Draw completed pen strokes next
    for (const stroke of strokes) {
      if (stroke.tool === 'pen') {
        drawStroke(ctx, stroke);
      }
    }

    // Draw active pen stroke (if drawing)
    if (isDrawing && activePoints.length > 0 && currentTool === 'pen') {
      const activeStroke: Stroke = {
        id: 'active',
        tool: currentTool,
        points: activePoints,
        color: currentColor,
        size: currentSize,
        opacity: 1.0
      };
      drawStroke(ctx, activeStroke);
    }

    ctx.restore(); // Restore clip region

    // 4. Draw page card border on top (outside clip for crisp outline)
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 8);
    ctx.stroke();

    // Eraser cursor preview (drawn in world space inside the transform)
    if (currentTool === 'eraser' && lastCursorPos) {
      ctx.beginPath();
      ctx.arc(lastCursorPos.x, lastCursorPos.y, currentSize / 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'var(--text-secondary)';
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
      ctx.stroke();
    }

    ctx.restore(); // Restore viewport transform
  }

  // Draw background patterns
  function drawBackground(ctx: CanvasRenderingContext2D) {
    if (currentBackground === 'blank') return;

    const patternCol = isLight ? '#e5e7eb' : '#2a2f38';

    ctx.save();
    ctx.strokeStyle = patternCol;
    ctx.fillStyle = patternCol;
    ctx.lineWidth = 1;

    if (currentBackground === 'lined') {
      const lineGap = 28;
      ctx.beginPath();
      for (let y = lineGap; y < PAGE_HEIGHT; y += lineGap) {
        ctx.moveTo(0, y);
        ctx.lineTo(PAGE_WIDTH, y);
      }
      ctx.stroke();
    } else if (currentBackground === 'grid') {
      const gridGap = 30;
      ctx.beginPath();
      // Verticals
      for (let x = gridGap; x < PAGE_WIDTH; x += gridGap) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, PAGE_HEIGHT);
      }
      // Horizontals
      for (let y = gridGap; y < PAGE_HEIGHT; y += gridGap) {
        ctx.moveTo(0, y);
        ctx.lineTo(PAGE_WIDTH, y);
      }
      ctx.stroke();
    } else if (currentBackground === 'dotted') {
      const dotGap = 24;
      const dotRadius = 1;

      for (let x = dotGap; x < PAGE_WIDTH; x += dotGap) {
        for (let y = dotGap; y < PAGE_HEIGHT; y += dotGap) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

  }

  // Render a stroke on canvas
  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    if (stroke.points.length === 0) return;
    if (stroke.tool === 'eraser') return;

    const isStylus = stroke.points.some(p => p.pressure !== 0.5 && p.pressure !== 0 && p.pressure !== 1);
    const simulate = !isStylus;

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

    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.opacity;
    ctx.fill();
    ctx.restore();
  }

  // Coordinate Helper
  function getPointerCoords(e: PointerEvent): { x: number; y: number } {
    if (!canvasElement) return { x: 0, y: 0 };
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - viewport.x) / viewport.zoom,
      y: (screenY - viewport.y) / viewport.zoom
    };
  }

  // Pointer Event Handlers
  function initGesture() {
    const pointers = Array.from(activePointersMap.values());
    if (pointers.length >= 2) {
      const p1 = pointers[0];
      const p2 = pointers[1];
      initialPinchDistance = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      initialMidpoint = {
        x: (p1.clientX + p2.clientX) / 2,
        y: (p1.clientY + p2.clientY) / 2
      };
      initialViewport = { ...viewport };
    } else if (pointers.length === 1 && pointers[0].pointerType === 'mouse' && (pointers[0].button === 1 || pointers[0].button === 2)) {
      const p = pointers[0];
      initialMidpoint = { x: p.clientX, y: p.clientY };
      initialViewport = { ...viewport };
    }
  }

  // Pointer Event Handlers
  function handlePointerDown(e: PointerEvent) {
    // Detect stylus
    if (e.pointerType === 'pen') {
      hasStylus = true;
    }

    const isPen = e.pointerType === 'pen';
    const isMouse = e.pointerType === 'mouse';
    const isTouch = e.pointerType === 'touch';

    // Palm rejection: if drawing with stylus, ignore touch events
    if (isDrawing && activePointerType === 'pen' && isTouch) {
      return;
    }

    // Add pointer to map
    activePointersMap.set(e.pointerId, e);

    // Handle middle click (button 1) and right click (button 2) for drag panning
    const isPanButton = isMouse && (e.button === 1 || e.button === 2);

    if (activePointersMap.size >= 2 || isPanButton) {
      if (isDrawing) {
        isDrawing = false;
        activePointerId = null;
        activePointerType = null;
        activePoints = [];
        redrawAll();
      }
      initGesture();
      if (isPanButton) {
        e.preventDefault();
      }
      return;
    }

    // Only allow drawing with primary button (left click)
    if (e.button !== 0) return;

    let allowDrawing = false;
    if (isPen || isMouse) {
      allowDrawing = true;
    } else if (isTouch) {
      if (inputMode === 'touchDraw') {
        allowDrawing = true;
      } else if (inputMode === 'auto' && !hasStylus) {
        allowDrawing = true;
      }
    }

    if (!allowDrawing) return;

    // Capture pointer
    try {
      canvasElement?.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('Failed to set pointer capture', err);
    }

    isDrawing = true;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType;
    
    const coords = getPointerCoords(e);
    lastCursorPos = coords;

    if (currentTool === 'eraser') {
      eraseAt(coords.x, coords.y);
    } else {
      activePoints = [{
        x: coords.x,
        y: coords.y,
        pressure: e.pressure,
        timestamp: Date.now()
      }];
    }

    redrawAll();
  }

  function handlePointerMove(e: PointerEvent) {
    const isTouch = e.pointerType === 'touch';

    // Palm rejection
    if (isDrawing && activePointerType === 'pen' && isTouch) {
      return;
    }

    if (activePointersMap.has(e.pointerId)) {
      activePointersMap.set(e.pointerId, e);
    }

    const pointers = Array.from(activePointersMap.values());

    // 1. Two-finger pinch-to-zoom and pan
    if (pointers.length >= 2) {
      const p1 = pointers[0];
      const p2 = pointers[1];

      const currentDistance = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      const currentMidpoint = {
        x: (p1.clientX + p2.clientX) / 2,
        y: (p1.clientY + p2.clientY) / 2
      };

      let newZoom = initialViewport.zoom;
      if (initialPinchDistance > 0 && currentDistance > 0) {
        const zoomRatio = currentDistance / initialPinchDistance;
        newZoom = initialViewport.zoom * zoomRatio;
        newZoom = Math.max(minZoom, Math.min(4.0, newZoom));
      }

      const dx = currentMidpoint.x - initialMidpoint.x;
      const dy = currentMidpoint.y - initialMidpoint.y;

      if (!canvasElement) return;
      const rect = canvasElement.getBoundingClientRect();
      const mX = initialMidpoint.x - rect.left;
      const mY = initialMidpoint.y - rect.top;

      const worldMidX = (mX - initialViewport.x) / initialViewport.zoom;
      const worldMidY = (mY - initialViewport.y) / initialViewport.zoom;

      viewport.zoom = newZoom;
      viewport.x = (mX + dx) - worldMidX * newZoom;
      viewport.y = (mY + dy) - worldMidY * newZoom;

      redrawAll();
      return;
    }

    // 2. Middle/Right drag panning on desktop
    const isPanningMouse = pointers.length === 1 && 
      pointers[0].pointerType === 'mouse' && 
      ((pointers[0].buttons & 4) || (pointers[0].buttons & 2));

    if (isPanningMouse) {
      const p = pointers[0];
      const dx = p.clientX - initialMidpoint.x;
      const dy = p.clientY - initialMidpoint.y;

      viewport.x = initialViewport.x + dx;
      viewport.y = initialViewport.y + dy;

      redrawAll();
      return;
    }

    // 3. Otherwise, normal drawing
    if (!isDrawing) {
      const coords = getPointerCoords(e);
      lastCursorPos = coords;
      if (currentTool === 'eraser') {
        redrawAll();
      }
      return;
    }

    if (e.pointerId !== activePointerId) return;

    const coords = getPointerCoords(e);
    lastCursorPos = coords;

    if (currentTool === 'eraser') {
      eraseAt(coords.x, coords.y);
    } else {
      activePoints.push({
        x: coords.x,
        y: coords.y,
        pressure: e.pressure,
        timestamp: Date.now()
      });
    }

    redrawAll();
  }

  function handlePointerUp(e: PointerEvent) {
    // Palm rejection
    if (isDrawing && activePointerType === 'pen' && e.pointerType === 'touch') {
      return;
    }

    activePointersMap.delete(e.pointerId);

    if (activePointersMap.size > 0) {
      initGesture();
      return;
    }

    if (!isDrawing || e.pointerId !== activePointerId) {
      isDrawing = false;
      activePointerId = null;
      activePointerType = null;
      return;
    }

    try {
      canvasElement?.releasePointerCapture(e.pointerId);
    } catch (err) {
      // already released
    }

    isDrawing = false;
    activePointerId = null;
    activePointerType = null;
    lastCursorPos = null;

    if (currentTool !== 'eraser' && activePoints.length > 0) {
      const newStroke: Stroke = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        tool: currentTool,
        points: [...activePoints],
        color: currentColor,
        size: currentSize,
        opacity: currentTool === 'highlighter' ? 0.3 : 1.0
      };

      saveToHistory();
      strokes = [...strokes, newStroke];
      redoStack = [];
      triggerSave();
    }

    activePoints = [];
    redrawAll();
  }

  // Eraser Logic
  function distance(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  function hitTestStroke(stroke: Stroke, ex: number, ey: number, eraserRadius: number) {
    const threshold = eraserRadius + (stroke.size / 2);
    
    // Quick Bounding Box bounding pre-check for speed
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    if (ex < minX - threshold || ex > maxX + threshold ||
        ey < minY - threshold || ey > maxY + threshold) {
      return false;
    }

    return stroke.points.some(p => distance(p.x, p.y, ex, ey) < threshold);
  }

  function eraseAt(x: number, y: number) {
    const eraserRadius = currentSize / 2;
    let hitDetected = false;

    const newStrokes = strokes.filter(stroke => {
      const isHit = hitTestStroke(stroke, x, y, eraserRadius);
      if (isHit) hitDetected = true;
      return !isHit;
    });

    if (hitDetected) {
      saveToHistory();
      strokes = newStrokes;
      triggerSave();
      redrawAll();
    }
  }

  // Undo / Redo / History
  function saveToHistory() {
    undoStack = [...undoStack, [...strokes]];
    if (undoStack.length > 50) {
      undoStack.shift();
    }
  }

  function undo() {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, [...strokes]];
    strokes = previous;
    triggerSave();
    redrawAll();
  }

  function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, [...strokes]];
    strokes = next;
    triggerSave();
    redrawAll();
  }

  function clearCanvas() {
    if (strokes.length === 0) return;
    if (confirm('Clear all strokes? This can be undone.')) {
      saveToHistory();
      strokes = [];
      redoStack = [];
      triggerSave();
      redrawAll();
    }
  }

  // Toolbar Actions
  function selectTool(tool: CanvasTool) {
    currentTool = tool;
  }

  function setBackground(bg: CanvasBackground) {
    currentBackground = bg;
    redrawAll();
    triggerSave();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (appState.editorMode !== 'canvas') return;

    const isZ = e.key.toLowerCase() === 'z';
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;

    if (isCmdOrCtrl && isZ) {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();

    if (!canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    const cX = e.clientX - rect.left;
    const cY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    let newZoom = viewport.zoom * zoomFactor;
    newZoom = Math.max(minZoom, Math.min(4.0, newZoom));

    if (newZoom === viewport.zoom) return;

    const worldCX = (cX - viewport.x) / viewport.zoom;
    const worldCY = (cY - viewport.y) / viewport.zoom;

    viewport.zoom = newZoom;
    viewport.x = cX - worldCX * newZoom;
    viewport.y = cY - worldCY * newZoom;

    redrawAll();
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="canvas-editor-container" style="background-color: {workspaceBg};" bind:this={containerElement}>
  {#if isMobile}
    <!-- Beautiful Compact Mobile Toolbar -->
    <div class="canvas-toolbar mobile flex-row">
      <!-- Tools selection group -->
      <div class="toolbar-group flex-row">
        <button 
          class="tool-btn flex-row" 
          class:active={currentTool === 'pen'} 
          onclick={() => { selectTool('pen'); activeMobilePopup = 'none'; }} 
          title="Pen Tool"
        >
          <Pen size={18} />
        </button>
        <button 
          class="tool-btn flex-row" 
          class:active={currentTool === 'highlighter'} 
          onclick={() => { selectTool('highlighter'); activeMobilePopup = 'none'; }} 
          title="Highlighter"
        >
          <Highlighter size={18} />
        </button>
        <button 
          class="tool-btn flex-row" 
          class:active={currentTool === 'eraser'} 
          onclick={() => { selectTool('eraser'); activeMobilePopup = 'none'; }} 
          title="Eraser Tool"
        >
          <Eraser size={18} />
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <!-- Color trigger button (only if not eraser) -->
      {#if currentTool !== 'eraser'}
        <button
          class="tool-btn flex-row color-trigger-btn"
          class:active={activeMobilePopup === 'color'}
          onclick={() => toggleMobilePopup('color')}
          title="Brush Color"
          style="padding: var(--spacing-2xs);"
        >
          <span class="color-dot" style="display: block; width: 18px; height: 18px; border-radius: 50%; background: {currentColor}; border: 1.5px solid var(--border-color);"></span>
        </button>
      {/if}

      <!-- Size trigger button -->
      <button
        class="tool-btn flex-row size-trigger-btn"
        class:active={activeMobilePopup === 'size'}
        onclick={() => toggleMobilePopup('size')}
        title="Brush Size"
      >
        <Sliders size={18} />
      </button>

      <div class="toolbar-divider"></div>

      <!-- Undo & Redo group -->
      <div class="toolbar-group flex-row">
        <button 
          class="action-btn flex-row" 
          onclick={undo} 
          disabled={undoStack.length === 0} 
          title="Undo"
        >
          <RotateCcw size={18} />
        </button>
        <button 
          class="action-btn flex-row" 
          onclick={redo} 
          disabled={redoStack.length === 0} 
          title="Redo"
        >
          <RotateCw size={18} />
        </button>
      </div>

      <!-- Fullscreen toggle -->
      <button
        class="tool-btn flex-row fullscreen-btn"
        onclick={toggleFullscreen}
        title={isFullscreen ? "Exit Fullscreen" : "Go Fullscreen"}
      >
        {#if isFullscreen}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
          </svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3M10 14l-7 7M14 10l7-7"/>
          </svg>
        {/if}
      </button>

      <!-- Settings / Actions Menu trigger -->
      <button
        class="tool-btn flex-row menu-trigger-btn"
        class:active={activeMobilePopup === 'menu'}
        onclick={() => toggleMobilePopup('menu')}
        title="Canvas Settings"
      >
        <Settings size={18} />
      </button>

      <!-- Hidden Color Input for Custom Colors -->
      <input 
        type="color" 
        bind:this={colorInputEl} 
        bind:value={currentColor} 
        oninput={updateToolSettings}
        style="display: none;" 
      />

      <!-- --- MOBILE POPUPS --- -->
      {#if activeMobilePopup === 'color'}
        <div class="mobile-popup color-popup flex-row" transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }}>
          <div class="swatches flex-row" style="gap: var(--spacing-xs);">
            {#each presetColors as color}
              <button 
                class="color-btn flex-row" 
                class:active={currentColor === color} 
                onclick={() => { currentColor = color; updateToolSettings(); activeMobilePopup = 'none'; }}
                style="background-color: {color}; width: 22px; height: 22px;"
              >
                {#if currentColor === color}
                  <Check size={12} color={color === '#ffffff' ? '#000000' : '#ffffff'} />
                {/if}
              </button>
            {/each}
            <!-- Custom Color button -->
            <button 
              class="color-btn flex-row custom-color-picker-btn" 
              class:active={!presetColors.includes(currentColor)}
              style="background: linear-gradient(135deg, #ff5c5c, #ffc83b, #4caf50, #3b82f6, #a78bfa); width: 22px; height: 22px;"
              onclick={() => colorInputEl?.click()}
              title="Custom Color"
            >
              {#if !presetColors.includes(currentColor)}
                <Check size={12} color="#ffffff" />
              {/if}
            </button>
          </div>
        </div>
      {/if}

      {#if activeMobilePopup === 'size'}
        <div class="mobile-popup size-popup flex-row" transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }}>
          <div class="slider-container flex-row" style="margin: 0; width: 100%; justify-content: space-between; gap: var(--spacing-sm);">
            <input 
              type="range" 
              min="1" 
              max={currentTool === 'eraser' ? 80 : currentTool === 'highlighter' ? 60 : 30} 
              bind:value={currentSize}
              oninput={updateToolSettings}
              class="size-slider"
              style="width: 130px;"
            />
            <span class="size-label" style="font-size: var(--font-size-xs); width: auto; font-weight: bold; color: var(--text-primary);">{currentSize}px</span>
          </div>
        </div>
      {/if}

      {#if activeMobilePopup === 'menu'}
        <div class="mobile-popup menu-popup flex-col" transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }} style="width: 220px; padding: var(--spacing-sm); gap: var(--spacing-sm);">
          <div class="menu-item flex-col" style="align-items: flex-start; gap: var(--spacing-2xs); width: 100%;">
            <span class="menu-label">Background</span>
            <div class="segmented-control flex-row" style="width: 100%; display: flex; background: var(--bg-card-hover); border-radius: var(--radius-standard); padding: 2px; border: 1px solid var(--border-color);">
              {#each backgroundOptions as option}
                <button
                  type="button"
                  class="segment-btn"
                  class:active={currentBackground === option.value}
                  onclick={() => { setBackground(option.value); activeMobilePopup = 'none'; }}
                  style="flex: 1; text-align: center; border: none; background: transparent; padding: 4px 2px; font-size: 10px; font-weight: 600; border-radius: var(--radius-standard); color: {currentBackground === option.value ? 'var(--text-primary)' : 'var(--text-secondary)'}; cursor: pointer; transition: all var(--motion-duration-fast);"
                >
                  {option.label}
                </button>
              {/each}
            </div>
          </div>
          
          <div class="menu-item flex-col" style="align-items: flex-start; gap: var(--spacing-2xs); width: 100%;">
            <span class="menu-label">Stylus Input</span>
            <div class="segmented-control flex-row" style="width: 100%; display: flex; background: var(--bg-card-hover); border-radius: var(--radius-standard); padding: 2px; border: 1px solid var(--border-color);">
              {#each [
                { value: 'auto', label: 'Auto' },
                { value: 'penOnly', label: 'Pen' },
                { value: 'touchDraw', label: 'Touch' }
              ] as mode}
                <button
                  type="button"
                  class="segment-btn"
                  class:active={inputMode === mode.value}
                  onclick={() => { inputMode = mode.value as InputMode; activeMobilePopup = 'none'; }}
                  style="flex: 1; text-align: center; border: none; background: transparent; padding: 4px 2px; font-size: 10px; font-weight: 600; border-radius: var(--radius-standard); color: {inputMode === mode.value ? 'var(--text-primary)' : 'var(--text-secondary)'}; cursor: pointer; transition: all var(--motion-duration-fast);"
                >
                  {mode.label}
                </button>
              {/each}
            </div>
          </div>

          <div class="menu-divider" style="width: 100%; height: 1px; background-color: var(--border-color); margin: 2px 0;"></div>

          <button 
            class="menu-btn flex-row" 
            onclick={() => { fitPageToScreen(); activeMobilePopup = 'none'; }} 
          >
            <Eye size={14} style="margin-right: var(--spacing-xs);" />
            <span>Fit Page to Screen</span>
          </button>

          <button 
            class="menu-btn flex-row" 
            onclick={() => { exportAsPng(); activeMobilePopup = 'none'; }} 
            disabled={strokes.length === 0}
          >
            <Download size={14} style="margin-right: var(--spacing-xs);" />
            <span>Export as PNG</span>
          </button>

          <button 
            class="menu-btn flex-row danger" 
            onclick={() => { clearCanvas(); activeMobilePopup = 'none'; }} 
            disabled={strokes.length === 0}
          >
            <Trash2 size={14} style="margin-right: var(--spacing-xs);" />
            <span>Clear Canvas</span>
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Desktop Toolbar -->
    <div class="canvas-toolbar flex-row">
      <!-- Tools selection group -->
      <div class="toolbar-group flex-row">
        <button 
          class="tool-btn flex-row" 
          class:active={currentTool === 'pen'} 
          onclick={() => selectTool('pen')} 
          title="Pen Tool"
        >
          <Pen size={16} />
        </button>
        <button 
          class="tool-btn flex-row" 
          class:active={currentTool === 'highlighter'} 
          onclick={() => selectTool('highlighter')} 
          title="Highlighter"
        >
          <Highlighter size={16} />
        </button>
        <button 
          class="tool-btn flex-row" 
          class:active={currentTool === 'eraser'} 
          onclick={() => selectTool('eraser')} 
          title="Eraser Tool"
        >
          <Eraser size={16} />
        </button>
      </div>

      <!-- Separator -->
      <div class="toolbar-divider"></div>

      <!-- Size selector group -->
      <div class="toolbar-group flex-row">
        {#each currentTool === 'eraser' ? [12, 24, 36, 48] : currentTool === 'highlighter' ? [12, 16, 24, 32] : [2, 4, 8, 12] as size}
          <button 
            class="size-dot-btn flex-row" 
            class:active={currentSize === size} 
            onclick={() => { currentSize = size; updateToolSettings(); }}
            title="{size}px"
          >
            <span 
              class="size-dot" 
              style="width: {Math.max(3, Math.min(18, size))}px; height: {Math.max(3, Math.min(18, size))}px; background-color: {currentTool === 'eraser' ? 'var(--text-secondary)' : currentColor};"
            ></span>
          </button>
        {/each}

        <!-- Slider for fine-tuning -->
        <div class="slider-container flex-row">
          <input 
            type="range" 
            min="1" 
            max={currentTool === 'eraser' ? 80 : currentTool === 'highlighter' ? 60 : 30} 
            bind:value={currentSize}
            oninput={updateToolSettings}
            class="size-slider"
            title="Fine-tune brush size"
          />
          <span class="size-label">{currentSize}px</span>
        </div>
      </div>

      {#if currentTool !== 'eraser'}
        <!-- Separator -->
        <div class="toolbar-divider"></div>

        <!-- Color swatches group -->
        <div class="toolbar-group flex-row swatches">
          {#each presetColors as color}
            <button 
              class="color-btn flex-row" 
              class:active={currentColor === color} 
              onclick={() => { currentColor = color; updateToolSettings(); }}
              style="background-color: {color};"
              title={color === '#ffffff' ? 'White' : color === '#000000' ? 'Black' : color}
            >
              {#if currentColor === color}
                <Check size={10} color={color === '#ffffff' ? '#000000' : '#ffffff'} />
              {/if}
            </button>
          {/each}

          <!-- Custom Color Picker Trigger -->
          <button 
            class="color-btn flex-row custom-color-picker-btn" 
            class:active={!presetColors.includes(currentColor)}
            style="background: linear-gradient(135deg, #ff5c5c, #ffc83b, #4caf50, #3b82f6, #a78bfa); border: 1px solid var(--border-color);"
            onclick={() => colorInputEl?.click()}
            title="Custom Color"
          >
            {#if !presetColors.includes(currentColor)}
              <Check size={10} color="#ffffff" />
            {/if}
          </button>
          <input 
            type="color" 
            bind:this={colorInputEl} 
            bind:value={currentColor} 
            oninput={updateToolSettings}
            style="display: none;" 
          />
        </div>
      {/if}

      <!-- Separator -->
      <div class="toolbar-divider"></div>

      <!-- Background Pattern selection -->
      <div class="toolbar-group flex-row select-wrapper">
        <select 
          class="canvas-select" 
          value={currentBackground} 
          onchange={(e) => setBackground((e.target as HTMLSelectElement).value as CanvasBackground)}
          title="Background Template"
        >
          {#each backgroundOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <!-- Input Mode selection -->
      <div class="toolbar-group flex-row select-wrapper">
        <select 
          class="canvas-select" 
          bind:value={inputMode} 
          title="Stylus Input Mode"
        >
          <option value="auto">Auto (Pen/Touch)</option>
          <option value="penOnly">Pen Only</option>
          <option value="touchDraw">Touch Draw</option>
        </select>
      </div>

      <!-- Separator -->
      <div class="toolbar-divider"></div>

      <!-- History / Control Actions group -->
      <div class="toolbar-group flex-row actions">
        <button 
          class="action-btn flex-row" 
          onclick={undo} 
          disabled={undoStack.length === 0} 
          title="Undo (Ctrl+Z)"
        >
          <RotateCcw size={16} />
        </button>
        <button 
          class="action-btn flex-row" 
          onclick={redo} 
          disabled={redoStack.length === 0} 
          title="Redo (Ctrl+Shift+Z)"
        >
          <RotateCw size={16} />
        </button>
        <button 
          class="action-btn flex-row" 
          onclick={toggleFullscreen} 
          title={isFullscreen ? "Exit Fullscreen" : "Go Fullscreen"}
        >
          {#if isFullscreen}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
            </svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3M10 14l-7 7M14 10l7-7"/>
            </svg>
          {/if}
        </button>
        <button 
          class="action-btn flex-row" 
          onclick={fitPageToScreen} 
          title="Fit Page to Screen"
        >
          <Eye size={16} />
        </button>
        <button 
          class="action-btn flex-row" 
          onclick={exportAsPng} 
          disabled={strokes.length === 0} 
          title="Export Canvas as PNG"
        >
          <Download size={16} />
        </button>
        <button 
          class="action-btn danger flex-row" 
          onclick={clearCanvas} 
          disabled={strokes.length === 0} 
          title="Clear Canvas"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  {/if}

  <!-- Drawing Surface -->
  <div class="canvas-wrapper" bind:this={wrapperElement}>
    <canvas 
      bind:this={canvasElement}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onwheel={handleWheel}
      oncontextmenu={(e) => e.preventDefault()}
    ></canvas>
  </div>
</div>

<style>
  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .canvas-editor-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background-color: var(--bg-base);
  }

  /* Toolbar Styling */
  .canvas-toolbar {
    position: absolute;
    top: var(--spacing-sm);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-index-header);
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    box-shadow: var(--shadow-heavy);
    max-width: 95%;
    flex-wrap: wrap;
    justify-content: center;
    transition: all var(--motion-duration-standard) var(--motion-ease-standard);
  }

  .toolbar-group {
    gap: var(--spacing-2xs);
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background-color: var(--border-color);
  }

  /* Tool buttons */
  .tool-btn, .action-btn {
    background: transparent;
    border: none;
    padding: var(--spacing-xs);
    border-radius: var(--radius-standard);
    color: var(--text-secondary);
    cursor: pointer;
    justify-content: center;
    transition: all var(--motion-duration-fast) var(--motion-ease-out);
  }

  .tool-btn:hover, .action-btn:not(:disabled):hover {
    background-color: var(--bg-card-hover);
    color: var(--text-primary);
  }

  .tool-btn.active {
    background-color: var(--accent-light);
    color: var(--accent);
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .action-btn.danger:not(:disabled):hover {
    background-color: color-mix(in srgb, var(--semantic-error) 15%, transparent);
    color: var(--semantic-error);
  }

  /* Size buttons */
  .size-dot-btn {
    background: transparent;
    border: none;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-standard);
    cursor: pointer;
    justify-content: center;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-out);
  }

  .size-dot-btn:hover {
    background-color: var(--bg-card-hover);
  }

  .size-dot-btn.active {
    background-color: var(--bg-card-hover);
    border: 1px solid var(--accent);
  }

  .size-dot {
    border-radius: var(--radius-circle);
    display: inline-block;
    transition: background-color var(--motion-duration-fast);
  }

  /* Color picker */
  .color-btn {
    border: 1px solid var(--border-color);
    width: 20px;
    height: 20px;
    border-radius: var(--radius-circle);
    cursor: pointer;
    padding: 0;
    justify-content: center;
    position: relative;
    transition: transform var(--motion-duration-fast) var(--motion-ease-out);
  }

  .color-btn:hover {
    transform: scale(1.15);
  }

  .color-btn.active {
    border: 1.5px solid var(--accent);
    transform: scale(1.1);
  }

  .swatches {
    gap: var(--spacing-3xs);
  }

  /* Custom dropdown wrappers */
  .select-wrapper {
    position: relative;
  }

  .canvas-select {
    background: var(--bg-card-hover);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    padding: var(--spacing-3xs) var(--spacing-xs);
    border-radius: var(--radius-standard);
    font-size: var(--font-size-xs);
    font-weight: 500;
    cursor: pointer;
    outline: none;
    transition: all var(--motion-duration-fast) var(--motion-ease-out);
  }

  .canvas-select:hover {
    color: var(--text-primary);
    border-color: var(--border-highlight);
  }

  .canvas-select:focus {
    border-color: var(--accent);
  }

  /* Fine-tuning brush size slider */
  .slider-container {
    margin-left: var(--spacing-xs);
    gap: var(--spacing-xs);
  }

  .size-slider {
    width: 64px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-card-hover);
    height: 4px;
    border-radius: var(--radius-pill);
    outline: none;
    cursor: pointer;
  }

  .size-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-circle);
    background: var(--accent);
    cursor: pointer;
    border: none;
    transition: transform var(--motion-duration-fast) var(--motion-ease-out);
  }

  .size-slider::-webkit-slider-thumb:hover {
    transform: scale(1.25);
  }

  .size-label {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    width: 32px;
    text-align: right;
  }

  /* Canvas area */
  .canvas-wrapper {
    flex: 1;
    position: relative;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    background-color: transparent;
  }

  /* Fullscreen container styling */
  .canvas-editor-container:fullscreen {
    width: 100vw;
    height: 100vh;
    background-color: var(--bg-base) !important;
  }

  /* Mobile responsiveness */
  @media (max-width: 768px) {
    .canvas-toolbar.mobile {
      position: absolute;
      top: var(--spacing-sm);
      bottom: auto;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 95%;
      max-width: 480px;
      padding: var(--spacing-xs) var(--spacing-sm);
      box-sizing: border-box;
      border-radius: var(--radius-large);
      z-index: var(--z-index-header);
      background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-heavy);
    }

    .toolbar-divider {
      height: 16px;
      width: 1px;
      background-color: var(--border-color);
      margin: 0 var(--spacing-2xs);
    }

    /* Mobile Popup Drawers */
    .mobile-popup {
      position: absolute;
      top: calc(100% + var(--spacing-xs));
      left: 50%;
      transform: translateX(-50%);
      background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-standard);
      box-shadow: var(--shadow-heavy);
      z-index: calc(var(--z-index-header) + 10);
      padding: var(--spacing-sm);
      display: flex;
      box-sizing: border-box;
    }

    .color-popup {
      width: auto;
      max-width: 90vw;
    }

    .size-popup {
      width: 200px;
      justify-content: center;
      align-items: center;
    }

    .menu-popup {
      width: 180px;
      flex-direction: column;
      gap: var(--spacing-xs);
    }

    .menu-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      gap: var(--spacing-sm);
    }

    .menu-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .menu-btn {
      display: flex;
      align-items: center;
      background: transparent;
      border: none;
      padding: var(--spacing-xs) var(--spacing-sm);
      border-radius: var(--radius-standard);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      width: 100%;
      text-align: left;
      transition: background-color var(--motion-duration-fast);
    }

    .menu-btn:hover:not(:disabled) {
      background-color: var(--bg-card-hover);
    }

    .menu-btn.danger {
      color: var(--semantic-error);
    }

    .menu-btn.danger:hover:not(:disabled) {
      background-color: color-mix(in srgb, var(--semantic-error) 10%, transparent);
    }

    .canvas-select {
      background: var(--bg-card-hover);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      padding: 2px var(--spacing-xs);
      border-radius: var(--radius-standard);
      font-size: 11px;
      outline: none;
    }
  }
</style>
