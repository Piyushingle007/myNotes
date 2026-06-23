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

  // Elements
  let canvasElement = $state<HTMLCanvasElement | null>(null);

  // Long press and Context Menu detection
  let longPressTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
  let startPointerPos = $state<{ x: number; y: number } | null>(null);

  // Drawing tracking
  let isDrawing = $state(false);
  let activePoints = $state<StrokePoint[]>([]);
  let activePointerId = $state<number | null>(null);
  let lastCursorPos = $state<{ x: number; y: number } | null>(null);

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
    if (!canvasElement) return { x: 0, y: 0 };
    const rect = canvasElement.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    
    // Map to base coordinate system (800x1130)
    return {
      x: (clientX / rect.width) * PAGE_WIDTH,
      y: (clientY / rect.height) * PAGE_HEIGHT
    };
  }

  // Render a stroke on canvas
  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    if (stroke.points.length === 0) return;
    if (stroke.tool === 'eraser') return;

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

    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.opacity;
    ctx.fill();
    ctx.restore();
  }

  // Redraw the entire canvas
  function redrawAll() {
    if (!canvasElement) return;
    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    const rect = canvasElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    if (canvasElement.width !== targetWidth || canvasElement.height !== targetHeight) {
      canvasElement.width = targetWidth;
      canvasElement.height = targetHeight;
    }

    ctx.save();
    ctx.scale(rect.width * dpr / PAGE_WIDTH, rect.height * dpr / PAGE_HEIGHT);
    ctx.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    // Draw completed highlighter strokes first
    for (const stroke of page.strokes) {
      if (stroke.tool === 'highlighter') {
        drawStroke(ctx, stroke);
      }
    }

    // Draw active highlighter stroke (if drawing on this page)
    if (isDrawing && activePoints.length > 0 && tool === 'highlighter') {
      const activeStroke: Stroke = {
        id: 'active',
        tool: tool,
        points: activePoints,
        color: color,
        size: size,
        opacity: 0.3
      };
      drawStroke(ctx, activeStroke);
    }

    // Draw completed pen strokes next
    for (const stroke of page.strokes) {
      if (stroke.tool === 'pen') {
        drawStroke(ctx, stroke);
      }
    }

    // Draw active pen stroke (if drawing on this page)
    if (isDrawing && activePoints.length > 0 && tool === 'pen') {
      const activeStroke: Stroke = {
        id: 'active',
        tool: tool,
        points: activePoints,
        color: color,
        size: size,
        opacity: 1.0
      };
      drawStroke(ctx, activeStroke);
    }

    // Eraser preview cursor
    if (active && tool === 'eraser' && lastCursorPos) {
      ctx.beginPath();
      ctx.arc(lastCursorPos.x, lastCursorPos.y, size / 2, 0, Math.PI * 2);
      ctx.strokeStyle = isLight ? '#000000' : '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Reactive redraw triggers
  $effect(() => {
    if (visible && canvasElement) {
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
      canvasElement?.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('Pointer capture failed', err);
    }

    isDrawing = true;
    activePointerId = e.pointerId;
    const coords = getPointerCoords(e);
    lastCursorPos = coords;

    if (tool === 'eraser') {
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
    if (e.pointerType === 'pen') {
      hasStylus = true;
    }

    const coords = getPointerCoords(e);
    lastCursorPos = coords;

    if (!isDrawing || e.pointerId !== activePointerId) {
      if (active && tool === 'eraser') {
        redrawAll();
      }
      return;
    }

    if (tool === 'eraser') {
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
    if (!isDrawing || e.pointerId !== activePointerId) return;

    try {
      canvasElement?.releasePointerCapture(e.pointerId);
    } catch (err) {}

    isDrawing = false;
    activePointerId = null;
    lastCursorPos = null;

    if (tool !== 'eraser' && activePoints.length > 0) {
      const newStroke: Stroke = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        tool: tool,
        points: [...activePoints],
        color: color,
        size: size,
        opacity: tool === 'highlighter' ? 0.3 : 1.0
      };
      onStrokeAdd(newStroke);
    }

    activePoints = [];
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
    <canvas
      bind:this={canvasElement}
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

  .notebook-page-container canvas {
    display: block;
    width: 100%;
    height: 100%;
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
