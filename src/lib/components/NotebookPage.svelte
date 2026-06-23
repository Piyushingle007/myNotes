<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import { appState } from '../stores/appState.svelte';
  import type { NotebookPage, Stroke, StrokePoint, NotebookTool, PageBackground, InputMode } from '../utils/notebookTypes';

  const PAGE_WIDTH = 800;
  const PAGE_HEIGHT = 1130;

  // Component Props
  interface Props {
    page: NotebookPage;
    active: boolean;
    tool: NotebookTool;
    color: string;
    size: number;
    inputMode: InputMode;
    visible: boolean;
    hasStylus: boolean;
    zoom: number;
    onStrokeAdd: (stroke: Stroke) => void;
    onStrokeErase: (erasedIds: string[]) => void;
    onActive: () => void;
    onContextMenu?: (pageId: string, clientX: number, clientY: number) => void;
    onLongPress?: (pageId: string, clientX: number, clientY: number) => void;
  }

  let {
    page,
    active,
    tool,
    color,
    size,
    inputMode,
    visible,
    hasStylus = $bindable(false),
    zoom,
    onStrokeAdd,
    onStrokeErase,
    onActive,
    onContextMenu,
    onLongPress
  }: Props = $props();

  // ─── Dual-Layer Canvas Elements ────────────────────────────────────
  // Static layer: completed strokes (only redrawn on stroke add/erase)
  // Dynamic layer: active in-progress stroke + eraser cursor (redrawn on pointer-move)
  let staticCanvas = $state<HTMLCanvasElement | null>(null);
  let dynamicCanvas = $state<HTMLCanvasElement | null>(null);

  // Long press and Context Menu detection
  let longPressTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
  let startPointerPos = $state<{ x: number; y: number } | null>(null);

  // ─── Drawing State (Plain JS — NOT reactive during drawing) ────────
  // Using plain variables instead of $state to avoid Svelte reactivity
  // overhead during the hot drawing loop. Only synced back on pointer-up.
  let _isDrawing = false;
  let _activePoints: StrokePoint[] = [];
  let _activePointerId: number | null = null;
  let _lastCursorPos: { x: number; y: number } | null = null;

  // Reactive wrapper only for touch-action CSS binding
  let isDrawing = $state(false);

  // ─── Path2D Cache for Completed Strokes ────────────────────────────
  // Maps stroke.id → { path: Path2D, color, opacity, pointCount }
  // Avoids recomputing getStroke() for strokes that haven't changed.
  interface CachedPath {
    path: Path2D;
    color: string;
    opacity: number;
    pointCount: number;
  }
  let pathCache = new Map<string, CachedPath>();

  // ─── RAF Batching ─────────────────────────────────────────────────
  let rafId: number | null = null;
  let staticDirty = false;

  // Theme support
  const activeThemeObj = $derived(appState.themes.find(t => t.id === appState.theme));
  const isLight = $derived(activeThemeObj?.category === 'light');
  const pageBg = $derived(isLight ? '#ffffff' : (appState.theme === 'black' ? '#121212' : '#1c1c1e'));
  const borderCol = $derived(isLight ? '#d1d5db' : '#2d333b');
  const shadowCol = $derived(isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 0, 0, 0.4)');

  // Touch action determination
  const touchAction = $derived.by(() => {
    if (tool === 'hand') return 'pan-x pan-y';
    return 'none';
  });

  const activeTouchAction = $derived(isDrawing ? 'none' : touchAction);

  // Coordinates translation helper
  function getPointerCoords(e: PointerEvent): { x: number; y: number } {
    // Use dynamicCanvas (topmost) for bounding rect
    const canvas = dynamicCanvas || staticCanvas;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    
    // Map to base coordinate system (800x1130)
    return {
      x: (clientX / rect.width) * PAGE_WIDTH,
      y: (clientY / rect.height) * PAGE_HEIGHT
    };
  }

  // ─── Path2D Computation ────────────────────────────────────────────
  // Compute a Path2D from a stroke's points using perfect-freehand
  function computeStrokePath(stroke: Stroke): Path2D | null {
    if (stroke.points.length === 0) return null;
    if (stroke.tool === 'eraser') return null;

    const isStylusStroke = stroke.points.some(p => p.pressure !== 0.5 && p.pressure !== 0 && p.pressure !== 1);
    const simulate = !isStylusStroke;

    const pointsArray = stroke.points.map(p => [p.x, p.y, p.pressure]);
    const outlinePoints = getStroke(pointsArray, {
      size: stroke.size,
      thinning: stroke.tool === 'highlighter' ? 0.05 : 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: simulate,
      last: true
    });

    if (outlinePoints.length === 0) return null;

    const path = new Path2D();
    path.moveTo(outlinePoints[0][0], outlinePoints[0][1]);
    for (let i = 1; i < outlinePoints.length; i++) {
      path.lineTo(outlinePoints[i][0], outlinePoints[i][1]);
    }
    path.closePath();
    return path;
  }

  // Get or create a cached Path2D for a completed stroke
  function getCachedPath(stroke: Stroke): CachedPath | null {
    const existing = pathCache.get(stroke.id);
    if (existing && existing.pointCount === stroke.points.length) {
      return existing;
    }

    const path = computeStrokePath(stroke);
    if (!path) return null;

    const cached: CachedPath = {
      path,
      color: stroke.color,
      opacity: stroke.opacity,
      pointCount: stroke.points.length
    };
    pathCache.set(stroke.id, cached);
    return cached;
  }

  // Prune cache entries for strokes that no longer exist
  function prunePathCache() {
    const currentIds = new Set(page.strokes.map(s => s.id));
    for (const id of pathCache.keys()) {
      if (!currentIds.has(id)) {
        pathCache.delete(id);
      }
    }
  }

  // ─── Canvas Setup Helper ──────────────────────────────────────────
  function setupCanvasSize(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    return ctx;
  }

  // ─── Static Layer: Completed Strokes ──────────────────────────────
  function redrawStatic() {
    if (!staticCanvas) return;
    const ctx = setupCanvasSize(staticCanvas);
    if (!ctx) return;

    const rect = staticCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.scale(rect.width * dpr / PAGE_WIDTH, rect.height * dpr / PAGE_HEIGHT);
    ctx.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    // Draw completed highlighter strokes first (below pen strokes)
    for (const stroke of page.strokes) {
      if (stroke.tool === 'highlighter') {
        const cached = getCachedPath(stroke);
        if (cached) {
          ctx.save();
          ctx.fillStyle = cached.color;
          ctx.globalAlpha = cached.opacity;
          ctx.fill(cached.path);
          ctx.restore();
        }
      }
    }

    // Draw completed pen strokes next (on top)
    for (const stroke of page.strokes) {
      if (stroke.tool === 'pen') {
        const cached = getCachedPath(stroke);
        if (cached) {
          ctx.save();
          ctx.fillStyle = cached.color;
          ctx.globalAlpha = cached.opacity;
          ctx.fill(cached.path);
          ctx.restore();
        }
      }
    }

    ctx.restore();
    prunePathCache();
  }

  // ─── Dynamic Layer: Active Stroke + Eraser Cursor ─────────────────
  function redrawDynamic() {
    if (!dynamicCanvas) return;
    const ctx = setupCanvasSize(dynamicCanvas);
    if (!ctx) return;

    const rect = dynamicCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.scale(rect.width * dpr / PAGE_WIDTH, rect.height * dpr / PAGE_HEIGHT);
    ctx.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    // Draw active stroke (if currently drawing)
    if (_isDrawing && _activePoints.length > 0 && tool !== 'eraser') {
      const activeStroke: Stroke = {
        id: 'active',
        tool: tool,
        points: _activePoints,
        color: color,
        size: size,
        opacity: tool === 'highlighter' ? 0.3 : 1.0
      };

      const path = computeStrokePath(activeStroke);
      if (path) {
        ctx.save();
        ctx.fillStyle = activeStroke.color;
        ctx.globalAlpha = activeStroke.opacity;
        ctx.fill(path);
        ctx.restore();
      }
    }

    // Eraser preview cursor
    if (active && tool === 'eraser' && _lastCursorPos) {
      ctx.beginPath();
      ctx.arc(_lastCursorPos.x, _lastCursorPos.y, size / 2, 0, Math.PI * 2);
      ctx.strokeStyle = isLight ? '#000000' : '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ─── Combined Redraw (for non-drawing scenarios) ──────────────────
  function redrawAll() {
    redrawStatic();
    redrawDynamic();
  }

  // ─── RAF-Batched Render Scheduler ─────────────────────────────────
  // During active drawing, we batch renders to once per animation frame.
  function scheduleDrawingFrame() {
    if (rafId !== null) return; // Already scheduled

    rafId = requestAnimationFrame(() => {
      rafId = null;

      if (staticDirty) {
        redrawStatic();
        staticDirty = false;
      }
      redrawDynamic();
    });
  }

  // ─── Reactive Redraw Triggers ─────────────────────────────────────
  // Only triggers for non-drawing changes (theme, strokes added/removed externally, zoom)
  $effect(() => {
    if (visible && staticCanvas && dynamicCanvas) {
      // Establish Svelte 5 reactive dependencies
      const _strokes = page.strokes;
      const _bg = page.background;
      const _theme = appState.theme;
      const _active = active;
      const _tool = tool;
      const _color = color;
      const _size = size;
      const _zoom = zoom;
      
      tick().then(() => {
        redrawAll();
      });
    }
  });

  // Pointer routing logic
  function shouldDraw(e: PointerEvent): boolean {
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse' && e.button === 0) return true;
    if (e.pointerType === 'touch') {
      if (inputMode === 'touchDraw') return true;
      if (inputMode === 'auto' && !hasStylus) return true;
      return false; // let it scroll
    }
    return false;
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType === 'pen') {
      hasStylus = true;
    }

    if (!shouldDraw(e)) return;

    // Report active drawing to parent
    onActive();

    // Capture pointer to track dragging outside bounds
    try {
      dynamicCanvas?.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('Pointer capture failed', err);
    }

    _isDrawing = true;
    isDrawing = true; // Reactive wrapper for CSS touch-action
    _activePointerId = e.pointerId;
    const coords = getPointerCoords(e);
    _lastCursorPos = coords;

    if (tool === 'eraser') {
      eraseAt(coords.x, coords.y);
      staticDirty = true;
      scheduleDrawingFrame();
    } else {
      _activePoints = [{
        x: coords.x,
        y: coords.y,
        pressure: e.pressure,
        timestamp: Date.now()
      }];
      scheduleDrawingFrame();
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (e.pointerType === 'pen') {
      hasStylus = true;
    }

    const coords = getPointerCoords(e);
    _lastCursorPos = coords;

    if (!_isDrawing || e.pointerId !== _activePointerId) {
      if (active && tool === 'eraser') {
        scheduleDrawingFrame();
      }
      return;
    }

    if (tool === 'eraser') {
      // Process coalesced events for smoother erasing
      const coalescedEvents = e.getCoalescedEvents?.() || [e];
      for (const ce of coalescedEvents) {
        const ceCoords = getPointerCoords(ce);
        eraseAt(ceCoords.x, ceCoords.y);
      }
      staticDirty = true;
    } else {
      // Process coalesced events for smoother strokes
      const coalescedEvents = e.getCoalescedEvents?.() || [e];
      for (const ce of coalescedEvents) {
        const ceCoords = getPointerCoords(ce);
        _activePoints.push({
          x: ceCoords.x,
          y: ceCoords.y,
          pressure: ce.pressure,
          timestamp: Date.now()
        });
      }
    }

    scheduleDrawingFrame();
  }

  function handlePointerUp(e: PointerEvent) {
    if (!_isDrawing || e.pointerId !== _activePointerId) return;

    try {
      dynamicCanvas?.releasePointerCapture(e.pointerId);
    } catch (err) {}

    _isDrawing = false;
    isDrawing = false; // Update reactive wrapper
    _activePointerId = null;
    _lastCursorPos = null;

    if (tool !== 'eraser' && _activePoints.length > 0) {
      const newStroke: Stroke = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        tool: tool,
        points: [..._activePoints],
        color: color,
        size: size,
        opacity: tool === 'highlighter' ? 0.3 : 1.0
      };
      onStrokeAdd(newStroke);
    }

    _activePoints = [];

    // Cancel any pending RAF and do a full clean redraw
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    staticDirty = false;
    redrawAll();
  }

  // Eraser hit detection
  function distance(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  function hitTestStroke(stroke: Stroke, ex: number, ey: number, eraserRadius: number) {
    const threshold = eraserRadius + (stroke.size / 2);
    
    // Bounding Box Pre-check
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
    const eraserRadius = size / 2;
    const hitIds: string[] = [];

    for (const stroke of page.strokes) {
      if (hitTestStroke(stroke, x, y, eraserRadius)) {
        hitIds.push(stroke.id);
      }
    }

    if (hitIds.length > 0) {
      onStrokeErase(hitIds);
    }
  }

  // Long press timer functions
  function startLongPressTimer(e: PointerEvent) {
    if (e.pointerType === 'pen') return; // Stylus drawing should not open settings
    if (shouldDraw(e)) return; // If drawing, don't trigger long press
    
    startPointerPos = { x: e.clientX, y: e.clientY };
    
    if (longPressTimeout) clearTimeout(longPressTimeout);
    longPressTimeout = setTimeout(() => {
      if (startPointerPos && onLongPress) {
        onLongPress(page.id, startPointerPos.x, startPointerPos.y);
      }
      longPressTimeout = null;
      startPointerPos = null;
    }, 600); // 600ms hold
  }

  function checkLongPressMove(e: PointerEvent) {
    if (!startPointerPos) return;
    const dist = Math.hypot(e.clientX - startPointerPos.x, e.clientY - startPointerPos.y);
    if (dist > 10) {
      cancelLongPress();
    }
  }

  function cancelLongPress() {
    if (longPressTimeout) {
      clearTimeout(longPressTimeout);
      longPressTimeout = null;
    }
    startPointerPos = null;
  }

  function handleContextMenu(e: MouseEvent) {
    if (onContextMenu) {
      e.preventDefault();
      onContextMenu(page.id, e.clientX, e.clientY);
    }
  }

  // Cleanup pending RAF on unmount
  onMount(() => {
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  });
</script>

<div
  class="notebook-page-container bg-{page.background}"
  class:active
  style="--page-bg: {pageBg}; --border-color: {borderCol}; --shadow-color: {shadowCol}; --pattern-color: {isLight ? '#e5e7eb' : '#2a2f38'}; touch-action: {activeTouchAction};"
  oncontextmenu={handleContextMenu}
  onpointerdown={startLongPressTimer}
  onpointermove={checkLongPressMove}
  onpointerup={cancelLongPress}
  onpointercancel={cancelLongPress}
>
  {#if visible}
    <!-- Static layer: completed strokes (bottom) -->
    <canvas
      bind:this={staticCanvas}
      class="canvas-layer static-layer"
      style="touch-action: {activeTouchAction};"
    ></canvas>
    <!-- Dynamic layer: active stroke + eraser cursor (top, receives events) -->
    <canvas
      bind:this={dynamicCanvas}
      class="canvas-layer dynamic-layer"
      style="touch-action: {activeTouchAction};"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
    ></canvas>
  {:else}
    <div class="notebook-page-placeholder font-mono">
      Page {page.index + 1}
    </div>
  {/if}
</div>

<style>
  .notebook-page-container {
    position: relative;
    width: calc(100% * var(--zoom-level, 1));
    max-width: calc(800px * var(--zoom-level, 1));
    aspect-ratio: 800 / 1130;
    border-radius: 8px;
    box-shadow: 0 4px 12px var(--shadow-color);
    border: 1px solid var(--border-color);
    overflow: hidden;
    background-color: var(--page-bg);
    transition: box-shadow 0.25s ease, border-color 0.25s ease, width 0.15s ease-out, max-width 0.15s ease-out;
  }

  .notebook-page-container.bg-blank {
    background-image: none;
  }

  .notebook-page-container.bg-lined {
    background-image: linear-gradient(to bottom, transparent calc(100% - 1px), var(--pattern-color) 1px);
    background-size: 100% 2.477876%; /* 28px/1130px */
  }

  .notebook-page-container.bg-grid {
    background-image: 
      linear-gradient(to right, transparent calc(100% - 1px), var(--pattern-color) 1px),
      linear-gradient(to bottom, transparent calc(100% - 1px), var(--pattern-color) 1px);
    background-size: 3.75% 2.654867%; /* 30px/800px horizontally, 30px/1130px vertically */
  }

  .notebook-page-container.bg-dotted {
    background-image: radial-gradient(circle at 100% 100%, var(--pattern-color) 1px, transparent 1px);
    background-size: 3% 2.123893%; /* 24px/800px horizontally, 24px/1130px vertically */
  }

  .notebook-page-container.active {
    box-shadow: 0 0 0 2px var(--accent), 0 4px 12px var(--shadow-color);
    border-color: var(--accent);
  }

  /* Dual-layer canvas stacking */
  .canvas-layer {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .static-layer {
    z-index: 0;
  }

  .dynamic-layer {
    z-index: 1;
  }

  .notebook-page-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    background-color: var(--page-bg);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
</style>
