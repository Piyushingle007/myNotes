<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		decodeDiagram,
		encodeDiagram,
		newShapeId,
		type DiagramData,
		type DiagramShape,
		type DiagramShapeType
	} from '../utils/diagram';

	interface Props {
		data: string;
		onSave: (encoded: string) => void;
		onCancel: () => void;
		onChangeEditorType?: (type: 'native' | 'drawio' | 'mermaid', currentData?: string) => void;
	}
	let { data, onSave, onCancel, onChangeEditorType }: Props = $props();

	function handleSwitchEditor(targetType: 'native' | 'drawio' | 'mermaid') {
		const diagramData = decodeDiagram(data);
		diagramData.shapes = shapes;
		diagramData.width = canvasW;
		diagramData.height = canvasH;
		const encoded = encodeDiagram(diagramData);
		onChangeEditorType?.(targetType, encoded);
	}

	const initial: DiagramData = decodeDiagram(data);

	let shapes = $state<DiagramShape[]>(initial.shapes);
	let canvasW = $state<number>(initial.width || 800);
	let canvasH = $state<number>(initial.height || 480);

	type Tool = 'select' | DiagramShapeType;
	let tool = $state<Tool>('select');
	let selectedId = $state<string | null>(null);
	let showMobileStyleDrawer = $state(false);

	// Current styling applied to new shapes (and the selected shape).
	let stroke = $state<string>('#374151');
	let fill = $state<string>('#f9fafb');
	let strokeWidth = $state<number>(2);
	let fontSize = $state<number>(14);

	const palette = [
		'#1f2937', '#374151', '#6b7280', '#0ea5e9', '#22c55e',
		'#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6'
	];
	const fillPalette = [
		'transparent', '#f9fafb', '#e5e7eb', '#dbeafe', '#dcfce7',
		'#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3', '#ede9fe'
	];

	let svgEl = $state<SVGSVGElement | null>(null);

	// Interaction state
	let dragMode = $state<'none' | 'draft' | 'move' | 'resize' | 'pen' | 'endpoint'>('none');
	let draft = $state<DiagramShape | null>(null);
	let moveOffset = { x: 0, y: 0 };
	let endpointWhich: 'start' | 'end' = 'end';
	let editingTextId = $state<string | null>(null);

	let selectedShape = $derived(shapes.find((s) => s.id === selectedId) || null);

	function toCanvasCoords(e: PointerEvent): { x: number; y: number } {
		const rect = svgEl!.getBoundingClientRect();
		// SVG is rendered 1:1 with its viewBox, so no scaling math needed.
		const scaleX = canvasW / rect.width;
		const scaleY = canvasH / rect.height;
		return {
			x: Math.round((e.clientX - rect.left) * scaleX),
			y: Math.round((e.clientY - rect.top) * scaleY)
		};
	}

	function shapeBounds(s: DiagramShape) {
		if (s.type === 'line' || s.type === 'arrow') {
			const x = Math.min(s.x, s.x + s.w);
			const y = Math.min(s.y, s.y + s.h);
			return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
		}
		if (s.type === 'draw') {
			const pts = s.points || [];
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (let i = 0; i < pts.length; i += 2) {
				minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
				minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
			}
			if (!isFinite(minX)) return { x: s.x, y: s.y, w: 0, h: 0 };
			return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
		}
		if (s.type === 'text') {
			const fs = s.fontSize || 16;
			const lines = (s.text || ' ').split('\n');
			const w = Math.max(40, Math.max(...lines.map((l) => l.length)) * fs * 0.55);
			const h = lines.length * fs * 1.3;
			return { x: s.x, y: s.y - fs, w, h };
		}
		return { x: s.x, y: s.y, w: s.w, h: s.h };
	}

	function hitTest(x: number, y: number): DiagramShape | null {
		for (let i = shapes.length - 1; i >= 0; i--) {
			const b = shapeBounds(shapes[i]);
			const pad = 8;
			if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
				return shapes[i];
			}
		}
		return null;
	}

	function onPointerDown(e: PointerEvent) {
		if (editingTextId) return;
		(e.target as Element).setPointerCapture?.(e.pointerId);
		const { x, y } = toCanvasCoords(e);

		if (tool === 'select') {
			// Resize handle hit?
			if (selectedShape) {
				const handle = handleAt(selectedShape, x, y);
				if (handle === 'se') { dragMode = 'resize'; return; }
				if (handle === 'start' || handle === 'end') {
					dragMode = 'endpoint'; endpointWhich = handle; return;
				}
			}
			const hit = hitTest(x, y);
			if (hit) {
				selectedId = hit.id;
				syncStyleFromShape(hit);
				dragMode = 'move';
				const b = shapeBounds(hit);
				moveOffset = { x: x - b.x, y: y - b.y };
			} else {
				selectedId = null;
				dragMode = 'none';
			}
			return;
		}

		if (tool === 'text') {
			const s: DiagramShape = {
				id: newShapeId(), type: 'text', x, y: y + fontSize, w: 0, h: 0,
				text: '', stroke, fill: 'transparent', strokeWidth, fontSize
			};
			shapes = [...shapes, s];
			selectedId = s.id;
			editingTextId = s.id;
			tool = 'select';
			dragMode = 'none';
			return;
		}

		if (tool === 'draw') {
			draft = {
				id: newShapeId(), type: 'draw', x, y, w: 0, h: 0,
				points: [x, y], stroke, fill: 'transparent', strokeWidth
			};
			dragMode = 'pen';
			return;
		}

		// Shape tools (rect / ellipse / diamond / line / arrow)
		draft = {
			id: newShapeId(), type: tool as DiagramShapeType, x, y, w: 0, h: 0,
			stroke, fill: (tool === 'line' || tool === 'arrow') ? 'transparent' : fill, strokeWidth
		};
		dragMode = 'draft';
	}

	function onPointerMove(e: PointerEvent) {
		if (dragMode === 'none') return;
		const { x, y } = toCanvasCoords(e);

		if (dragMode === 'draft' && draft) {
			draft = { ...draft, w: x - draft.x, h: y - draft.y };
		} else if (dragMode === 'pen' && draft) {
			draft = { ...draft, points: [...(draft.points || []), x, y] };
		} else if (dragMode === 'move' && selectedShape) {
			const s = selectedShape;
			const b = shapeBounds(s);
			const dx = x - moveOffset.x - b.x;
			const dy = y - moveOffset.y - b.y;
			updateSelected((sh) => {
				if (sh.type === 'draw' && sh.points) {
					const pts = sh.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy));
					return { ...sh, points: pts, x: sh.x + dx, y: sh.y + dy };
				}
				return { ...sh, x: sh.x + dx, y: sh.y + dy };
			});
		} else if (dragMode === 'resize' && selectedShape) {
			updateSelected((sh) => ({ ...sh, w: Math.max(4, x - sh.x), h: Math.max(4, y - sh.y) }));
		} else if (dragMode === 'endpoint' && selectedShape) {
			updateSelected((sh) => {
				if (endpointWhich === 'start') {
					const ex = sh.x + sh.w, ey = sh.y + sh.h;
					return { ...sh, x, y, w: ex - x, h: ey - y };
				}
				return { ...sh, w: x - sh.x, h: y - sh.y };
			});
		}
	}

	function onPointerUp() {
		if ((dragMode === 'draft' || dragMode === 'pen') && draft) {
			let finalized = draft;
			if (finalized.type !== 'draw' && finalized.type !== 'line' && finalized.type !== 'arrow') {
				// Normalize negative drags
				const nx = Math.min(finalized.x, finalized.x + finalized.w);
				const ny = Math.min(finalized.y, finalized.y + finalized.h);
				finalized = { ...finalized, x: nx, y: ny, w: Math.abs(finalized.w), h: Math.abs(finalized.h) };
			}
			const b = shapeBounds(finalized);
			const big = finalized.type === 'draw' ? (finalized.points || []).length > 4 : (Math.abs(b.w) > 4 || Math.abs(b.h) > 4);
			if (big) {
				shapes = [...shapes, finalized];
				selectedId = finalized.id;
			}
			draft = null;
			tool = 'select';
		}
		dragMode = 'none';
	}

	function updateSelected(fn: (s: DiagramShape) => DiagramShape) {
		shapes = shapes.map((s) => (s.id === selectedId ? fn(s) : s));
	}

	function syncStyleFromShape(s: DiagramShape) {
		stroke = s.stroke;
		fill = s.fill;
		strokeWidth = s.strokeWidth;
		if (s.fontSize) fontSize = s.fontSize;
	}

	// Resize/endpoint handle hit detection
	function handleAt(s: DiagramShape, x: number, y: number): 'se' | 'start' | 'end' | null {
		const r = 9;
		if (s.type === 'line' || s.type === 'arrow') {
			if (Math.hypot(x - s.x, y - s.y) <= r) return 'start';
			if (Math.hypot(x - (s.x + s.w), y - (s.y + s.h)) <= r) return 'end';
			return null;
		}
		if (s.type === 'draw' || s.type === 'text') return null;
		if (Math.hypot(x - (s.x + s.w), y - (s.y + s.h)) <= r) return 'se';
		return null;
	}

	// Apply current style controls to the selected shape live
	function applyStyle() {
		if (!selectedShape) return;
		updateSelected((s) => ({
			...s,
			stroke,
			fill: s.type === 'line' || s.type === 'arrow' || s.type === 'text' ? s.fill : fill,
			strokeWidth,
			fontSize: s.type === 'text' ? fontSize : s.fontSize
		}));
	}

	function deleteSelected() {
		if (!selectedId) return;
		shapes = shapes.filter((s) => s.id !== selectedId);
		selectedId = null;
		editingTextId = null;
	}

	function bringForward() {
		if (!selectedId) return;
		const idx = shapes.findIndex((s) => s.id === selectedId);
		if (idx < 0 || idx === shapes.length - 1) return;
		const copy = [...shapes];
		[copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
		shapes = copy;
	}
	function sendBackward() {
		if (!selectedId) return;
		const idx = shapes.findIndex((s) => s.id === selectedId);
		if (idx <= 0) return;
		const copy = [...shapes];
		[copy[idx], copy[idx - 1]] = [copy[idx - 1], copy[idx]];
		shapes = copy;
	}

	function clearAll() {
		if (shapes.length && !confirm('Clear the entire diagram?')) return;
		shapes = [];
		selectedId = null;
	}

	function commitText() {
		editingTextId = null;
		// Drop empty text shapes
		shapes = shapes.filter((s) => !(s.type === 'text' && !(s.text || '').trim()));
	}

	function onTextKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); commitText(); }
		// Enter inserts newline; Shift+Enter also newline; Ctrl/Cmd+Enter commits.
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitText(); }
	}

	function handleSave() {
		// trim trailing empty text shapes
		const cleaned = shapes.filter((s) => !(s.type === 'text' && !(s.text || '').trim()));
		onSave(encodeDiagram({ shapes: cleaned, width: canvasW, height: canvasH, background: 'transparent' }));
	}

	function onKeydown(e: KeyboardEvent) {
		if (editingTextId) return;
		if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
			e.preventDefault();
			deleteSelected();
		}
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSave(); }
	}

	// Arrow head polygon points for a line/arrow shape
	function arrowHead(s: DiagramShape): string {
		const x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
		const angle = Math.atan2(y2 - y1, x2 - x1);
		const head = 10 + s.strokeWidth * 1.5;
		const a1 = angle - Math.PI / 7;
		const a2 = angle + Math.PI / 7;
		const hx1 = x2 - head * Math.cos(a1);
		const hy1 = y2 - head * Math.sin(a1);
		const hx2 = x2 - head * Math.cos(a2);
		const hy2 = y2 - head * Math.sin(a2);
		return `${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`;
	}

	function drawPath(s: DiagramShape): string {
		const p = s.points || [];
		if (p.length < 2) return '';
		let d = `M ${p[0]} ${p[1]}`;
		for (let i = 2; i < p.length; i += 2) d += ` L ${p[i]} ${p[i + 1]}`;
		return d;
	}

	function diamondPoints(s: DiagramShape): string {
		const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
		return `${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}`;
	}

	const tools: { id: Tool; label: string; icon: string }[] = [
		{ id: 'select', label: 'Select / Move', icon: 'M3 3l7 17 2.5-7L19 10z' },
		{ id: 'rect', label: 'Rectangle', icon: 'RECT' },
		{ id: 'ellipse', label: 'Ellipse', icon: 'ELL' },
		{ id: 'diamond', label: 'Diamond', icon: 'DIA' },
		{ id: 'arrow', label: 'Arrow', icon: 'ARR' },
		{ id: 'line', label: 'Line', icon: 'LIN' },
		{ id: 'text', label: 'Text', icon: 'TXT' },
		{ id: 'draw', label: 'Pen', icon: 'PEN' }
	];
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="diagram-overlay" onclick={onCancel}>
	<div class="diagram-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Diagram editor">
		<!-- Header -->
		<div class="diagram-header">
			<!-- Mobile-only Cancel button -->
			<button type="button" class="dg-btn mobile-only" onclick={onCancel}>Cancel</button>

			<div class="header-left-title flex-row" style="display: flex; align-items: center; gap: var(--spacing-xs);">
				<span class="diagram-title" style="display: flex; align-items: center; gap: var(--spacing-xs);">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/></svg>
					<span>Shape Editor</span>
				</span>
			</div>

			<!-- Wrap switchers for mobile grid layout, using display: contents on desktop -->
			<div class="header-switchers-wrapper">
				{#if onChangeEditorType}
					<div class="editor-host-switcher flex-row">
						<button type="button" class="switcher-btn" onclick={() => handleSwitchEditor('mermaid')}>Mermaid</button>
						<button type="button" class="switcher-btn" onclick={() => handleSwitchEditor('drawio')}>Draw.io</button>
						<button type="button" class="switcher-btn active" disabled>Native</button>
					</div>
				{/if}
			</div>

			<div class="header-right-actions flex-row" style="display: flex; align-items: center; gap: var(--spacing-xs);">
				<!-- Desktop-only Cancel button -->
				<button type="button" class="dg-btn desktop-only" onclick={onCancel}>Cancel</button>
				<button class="dg-btn primary" onclick={handleSave}>Save</button>
			</div>
		</div>

		<!-- Toolbar -->
		<div class="diagram-toolbar">
			<div class="dg-tools-wrapper">
				<div class="dg-tools">
					{#each tools as t}
						<button
							class="dg-tool"
							class:active={tool === t.id}
							title={t.label}
							aria-label={t.label}
							onclick={() => { tool = t.id; }}
						>
							{#if t.id === 'select'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M4 2l7 18 2.2-6.8L20 11z"/></svg>
							{:else if t.id === 'rect'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/></svg>
							{:else if t.id === 'ellipse'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>
							{:else if t.id === 'diamond'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 9-9 9-9-9z"/></svg>
							{:else if t.id === 'arrow'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="4"/><polyline points="10 4 20 4 20 14"/></svg>
							{:else if t.id === 'line'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>
							{:else if t.id === 'text'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6V4h16v2M12 4v16M9 20h6"/></svg>
							{:else if t.id === 'draw'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<button
				type="button"
				class="dg-tool style-toggle-btn dg-mobile-only"
				class:active={showMobileStyleDrawer}
				onclick={() => { showMobileStyleDrawer = true; }}
				title="Style properties"
				aria-label="Style properties"
			>
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.76 4.24 17 7 17H8.17C8.72 17 9.17 17.45 9.17 18C9.17 18.27 9.06 18.52 8.89 18.7L7.04 20.55C6.71 20.88 6.5 21.34 6.5 21.85C6.5 21.93 6.51 22 6.52 22.04" />
					<circle cx="7.5" cy="10.5" r="1.5" fill="currentColor" />
					<circle cx="11.5" cy="7.5" r="1.5" fill="currentColor" />
					<circle cx="16.5" cy="9.5" r="1.5" fill="currentColor" />
					<circle cx="15.5" cy="14.5" r="1.5" fill="currentColor" />
				</svg>
			</button>

			<div class="dg-sep dg-desktop-only"></div>

			<!-- Stroke color -->
			<div class="dg-group dg-desktop-only">
				<span class="dg-label">Stroke</span>
				<div class="dg-swatches">
					{#each palette as c}
						<button class="dg-swatch" class:sel={stroke === c} style="background:{c}" aria-label="Stroke {c}" onclick={() => { stroke = c; applyStyle(); }}></button>
					{/each}
					<input type="color" class="dg-color" bind:value={stroke} onchange={applyStyle} aria-label="Custom stroke color" />
				</div>
			</div>

			<!-- Fill color -->
			<div class="dg-group dg-desktop-only">
				<span class="dg-label">Fill</span>
				<div class="dg-swatches">
					{#each fillPalette as c}
						<button class="dg-swatch" class:sel={fill === c} class:none={c === 'transparent'} style={c === 'transparent' ? '' : `background:${c}`} aria-label="Fill {c}" onclick={() => { fill = c; applyStyle(); }}></button>
					{/each}
				</div>
			</div>

			<!-- Stroke width -->
			<div class="dg-group dg-desktop-only">
				<span class="dg-label">Width</span>
				{#each [1, 2, 4, 6] as w}
					<button class="dg-w" class:active={strokeWidth === w} onclick={() => { strokeWidth = w; applyStyle(); }} aria-label="Width {w}">
						<span style="height:{w}px"></span>
					</button>
				{/each}
			</div>

			{#if selectedShape}
				<div class="dg-sep dg-desktop-only"></div>
				<div class="dg-group dg-desktop-only">
					<button class="dg-btn ghost" onclick={sendBackward} title="Send backward">⤓</button>
					<button class="dg-btn ghost" onclick={bringForward} title="Bring forward">⤒</button>
					<button class="dg-btn danger" onclick={deleteSelected} title="Delete (Del)">Delete</button>
				</div>
			{/if}

			<div class="dg-spacer dg-desktop-only"></div>
			<button class="dg-btn ghost" onclick={clearAll}>Clear</button>
		</div>

		<!-- Canvas -->
		<div class="diagram-canvas-wrap">
			<div class="diagram-canvas-inner" style="width:{canvasW}px; height:{canvasH}px;">
				<svg
					bind:this={svgEl}
					class="diagram-canvas"
					width={canvasW}
					height={canvasH}
					viewBox="0 0 {canvasW} {canvasH}"
					style="cursor:{tool === 'select' ? 'default' : 'crosshair'};"
					onpointerdown={onPointerDown}
					onpointermove={onPointerMove}
					onpointerup={onPointerUp}
					role="application"
					tabindex="-1"
				>
					<!-- grid -->
					<defs>
						<pattern id="dg-grid" width="20" height="20" patternUnits="userSpaceOnUse">
							<path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="1" />
						</pattern>
					</defs>
					<rect x="0" y="0" width={canvasW} height={canvasH} fill="url(#dg-grid)" />

					{#each shapes as s (s.id)}
						{#if s.type === 'rect'}
							<rect x={s.x} y={s.y} width={Math.max(1, s.w)} height={Math.max(1, s.h)} rx="6" ry="6" fill={s.fill} stroke={s.stroke} stroke-width={s.strokeWidth} />
						{:else if s.type === 'ellipse'}
							<ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={Math.max(1, s.w / 2)} ry={Math.max(1, s.h / 2)} fill={s.fill} stroke={s.stroke} stroke-width={s.strokeWidth} />
						{:else if s.type === 'diamond'}
							<polygon points={diamondPoints(s)} fill={s.fill} stroke={s.stroke} stroke-width={s.strokeWidth} />
						{:else if s.type === 'line'}
							<line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={s.stroke} stroke-width={s.strokeWidth} stroke-linecap="round" />
						{:else if s.type === 'arrow'}
							<line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={s.stroke} stroke-width={s.strokeWidth} stroke-linecap="round" />
							<polygon points={arrowHead(s)} fill={s.stroke} stroke={s.stroke} stroke-width={s.strokeWidth} stroke-linejoin="round" />
						{:else if s.type === 'draw'}
							<path d={drawPath(s)} fill="none" stroke={s.stroke} stroke-width={s.strokeWidth} stroke-linecap="round" stroke-linejoin="round" />
						{:else if s.type === 'text'}
							<text x={s.x} y={s.y} fill={s.stroke} font-size={s.fontSize} font-family="Inter, system-ui, sans-serif" style="user-select:none;">
								{#each (s.text || ' ').split('\n') as line, i}
									<tspan x={s.x} dy={i === 0 ? 0 : (s.fontSize || 16) * 1.3}>{line || ' '}</tspan>
								{/each}
							</text>
						{/if}
					{/each}

					<!-- Draft preview -->
					{#if draft}
						{#if draft.type === 'rect'}
							<rect x={Math.min(draft.x, draft.x + draft.w)} y={Math.min(draft.y, draft.y + draft.h)} width={Math.abs(draft.w)} height={Math.abs(draft.h)} rx="6" fill={draft.fill} stroke={draft.stroke} stroke-width={draft.strokeWidth} opacity="0.8" />
						{:else if draft.type === 'ellipse'}
							<ellipse cx={draft.x + draft.w / 2} cy={draft.y + draft.h / 2} rx={Math.abs(draft.w / 2)} ry={Math.abs(draft.h / 2)} fill={draft.fill} stroke={draft.stroke} stroke-width={draft.strokeWidth} opacity="0.8" />
						{:else if draft.type === 'diamond'}
							<polygon points={diamondPoints(draft)} fill={draft.fill} stroke={draft.stroke} stroke-width={draft.strokeWidth} opacity="0.8" />
						{:else if draft.type === 'line'}
							<line x1={draft.x} y1={draft.y} x2={draft.x + draft.w} y2={draft.y + draft.h} stroke={draft.stroke} stroke-width={draft.strokeWidth} stroke-linecap="round" opacity="0.8" />
						{:else if draft.type === 'arrow'}
							<line x1={draft.x} y1={draft.y} x2={draft.x + draft.w} y2={draft.y + draft.h} stroke={draft.stroke} stroke-width={draft.strokeWidth} stroke-linecap="round" opacity="0.8" />
							<polygon points={arrowHead(draft)} fill={draft.stroke} opacity="0.8" />
						{:else if draft.type === 'draw'}
							<path d={drawPath(draft)} fill="none" stroke={draft.stroke} stroke-width={draft.strokeWidth} stroke-linecap="round" stroke-linejoin="round" />
						{/if}
					{/if}

					<!-- Selection overlay -->
					{#if selectedShape}
						{@const b = shapeBounds(selectedShape)}
						<rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="5 4" pointer-events="none" />
						{#if selectedShape.type === 'line' || selectedShape.type === 'arrow'}
							<circle cx={selectedShape.x} cy={selectedShape.y} r="6" fill="#0b0b0e" stroke="#38bdf8" stroke-width="2" />
							<circle cx={selectedShape.x + selectedShape.w} cy={selectedShape.y + selectedShape.h} r="6" fill="#0b0b0e" stroke="#38bdf8" stroke-width="2" />
						{:else if selectedShape.type !== 'draw' && selectedShape.type !== 'text'}
							<rect x={selectedShape.x + selectedShape.w - 6} y={selectedShape.y + selectedShape.h - 6} width="12" height="12" rx="2" fill="#0b0b0e" stroke="#38bdf8" stroke-width="2" />
						{/if}
					{/if}
				</svg>

				<!-- Inline text editor overlay -->
				{#if editingTextId}
					{@const ts = shapes.find((s) => s.id === editingTextId)}
					{#if ts}
						<textarea
							class="dg-text-input"
							style="left:{ts.x}px; top:{ts.y - (ts.fontSize || 16)}px; font-size:{ts.fontSize || 16}px; color:{ts.stroke};"
							value={ts.text || ''}
							oninput={(e) => { const v = e.currentTarget.value; shapes = shapes.map((s) => s.id === editingTextId ? { ...s, text: v } : s); }}
							onblur={commitText}
							onkeydown={onTextKeydown}
							placeholder="Type…"
							autofocus
						></textarea>
					{/if}
				{/if}
			</div>
		</div>

		<!-- ST-017: Mobile Style Drawer -->
		{#if showMobileStyleDrawer}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				class="drawer-backdrop dg-mobile-only" 
				onclick={() => { showMobileStyleDrawer = false; }}
				onkeydown={(e) => e.key === 'Escape' && (showMobileStyleDrawer = false)}
				transition:fade={{ duration: 150 }}
			>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div 
					class="drawer-sheet flex-col" 
					onclick={(e) => e.stopPropagation()}
					transition:fly={{ y: 300, duration: 250, easing: cubicOut }}
				>
					<div class="drawer-header flex-row" style="display: flex; width: 100%; justify-content: space-between; align-items: center;">
						<span class="drawer-title">Shape Style</span>
						<button 
							type="button" 
							class="dg-btn primary done-btn" 
							onclick={() => { showMobileStyleDrawer = false; }}
						>
							Done
						</button>
					</div>

					<div class="drawer-content flex-col" style="display: flex; flex-direction: column; width: 100%; gap: var(--spacing-md);">
						<!-- Stroke color -->
						<div class="drawer-group flex-col" style="display: flex; flex-direction: column; width: 100%; gap: var(--spacing-xs);">
							<span class="drawer-label">Stroke Color</span>
							<div class="drawer-swatches" style="display: flex; gap: var(--spacing-xs); overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch; padding-bottom: var(--spacing-2xs);">
								{#each palette as c}
									<button 
										type="button"
										class="dg-swatch" 
										class:sel={stroke === c} 
										style="background:{c}" 
										aria-label="Stroke {c}" 
										onclick={() => { stroke = c; applyStyle(); }}
									></button>
								{/each}
								<input type="color" class="dg-color" bind:value={stroke} onchange={applyStyle} aria-label="Custom stroke color" />
							</div>
						</div>

						<!-- Fill color -->
						<div class="drawer-group flex-col" style="display: flex; flex-direction: column; width: 100%; gap: var(--spacing-xs);">
							<span class="drawer-label">Fill Color</span>
							<div class="drawer-swatches" style="display: flex; gap: var(--spacing-xs); overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch; padding-bottom: var(--spacing-2xs);">
								{#each fillPalette as c}
									<button 
										type="button"
										class="dg-swatch" 
										class:sel={fill === c} 
										class:none={c === 'transparent'} 
										style={c === 'transparent' ? '' : `background:${c}`} 
										aria-label="Fill {c}" 
										onclick={() => { fill = c; applyStyle(); }}
									></button>
								{/each}
							</div>
						</div>

						<!-- Stroke width -->
						<div class="drawer-group flex-col" style="display: flex; flex-direction: column; width: 100%; gap: var(--spacing-xs);">
							<span class="drawer-label">Stroke Width</span>
							<div class="drawer-widths" style="display: flex; gap: var(--spacing-xs); width: 100%;">
								{#each [1, 2, 4, 6] as w}
									<button 
										type="button"
										class="dg-w" 
										class:active={strokeWidth === w} 
										onclick={() => { strokeWidth = w; applyStyle(); }} 
										aria-label="Width {w}"
										style="flex: 1;"
									>
										<span style="height:{w}px"></span>
									</button>
								{/each}
							</div>
						</div>

						{#if selectedShape}
							<!-- Arrange layer order -->
							<div class="drawer-group flex-col" style="display: flex; flex-direction: column; width: 100%; gap: var(--spacing-xs);">
								<span class="drawer-label">Layer Arrange</span>
								<div class="drawer-arrange" style="display: flex; gap: var(--spacing-sm); width: 100%;">
									<button 
										type="button"
										class="dg-btn ghost" 
										style="flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--spacing-xs); padding: var(--spacing-sm);"
										onclick={sendBackward}
									>
										Send Backward
									</button>
									<button 
										type="button"
										class="dg-btn ghost" 
										style="flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--spacing-xs); padding: var(--spacing-sm);"
										onclick={bringForward}
									>
										Bring Forward
									</button>
								</div>
							</div>

							<!-- Delete Shape -->
							<button 
								type="button"
								class="dg-btn danger delete-shape-btn" 
								style="width: 100%; margin-top: var(--spacing-md); padding: var(--spacing-sm); display: flex; align-items: center; justify-content: center; border-radius: 8px; font-weight: 600;"
								onclick={() => {
									deleteSelected();
									showMobileStyleDrawer = false;
								}}
							>
								Delete Shape
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<div class="diagram-footer">
			<span class="dg-hint">
				{#if tool === 'select'}Click to select · drag to move · drag handle to resize · Del to delete{:else if tool === 'text'}Click to place text{:else if tool === 'draw'}Click &amp; drag to draw freehand{:else}Click &amp; drag on the canvas{/if}
			</span>
			<span class="dg-hint">{shapes.length} object{shapes.length === 1 ? '' : 's'} · double-click text to edit · {(/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl')}+Enter to save</span>
		</div>
	</div>
</div>

<style>
	.editor-host-switcher {
		display: inline-flex;
		align-items: center;
		background: color-mix(in srgb, var(--text-primary) 5%, transparent);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: var(--spacing-3xs);
		gap: var(--spacing-3xs);
	}
	.switcher-btn {
		background: transparent;
		border: none;
		color: #aaa;
		font-size: 11px;
		font-weight: 600;
		padding: var(--spacing-2xs) var(--spacing-sm);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.switcher-btn:hover {
		color: #fff;
		background: color-mix(in srgb, var(--text-primary) 5%, transparent);
	}
	.switcher-btn.active {
		color: #fff;
		background: var(--accent, #00adb5);
	}
	.switcher-btn:disabled {
		cursor: default;
	}

	.diagram-overlay {
		position: fixed;
		inset: 0;
		z-index: 2000;
		background: color-mix(in srgb, var(--bg-base) 60%, transparent);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-lg);
	}

	.diagram-modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-highlight);
		border-radius: 14px;
		width: min(1100px, 96vw);
		height: min(760px, 94vh);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: var(--shadow-heavy);
	}

	.diagram-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--border-color);
		gap: var(--spacing-md);
	}

	.header-switchers-wrapper {
		display: contents;
	}

	.header-left-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.header-right-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.diagram-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-weight: 700;
		font-size: 14px;
		color: var(--text-primary);
	}

	.mobile-only {
		display: none !important;
	}

	.desktop-only {
		display: inline-flex !important;
	}

	@media (min-width: 769px) {
		.editor-host-switcher {
			margin-right: auto;
		}
	}

	.diagram-toolbar {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-bottom: 1px solid var(--border-color);
		flex-wrap: wrap;
		background: var(--bg-base);
	}

	.dg-tools { display: flex; gap: var(--spacing-3xs); }

	.dg-tool {
		width: 32px; height: 32px;
		display: flex; align-items: center; justify-content: center;
		border-radius: 7px;
		color: var(--text-secondary);
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
	}
	.dg-tool:hover { background: var(--bg-mid-dark); color: var(--text-primary); }
	.dg-tool.active {
		background: var(--accent-light);
		color: var(--accent);
		border-color: var(--accent);
	}

	.dg-sep { width: 1px; align-self: stretch; background: var(--border-color); margin: var(--spacing-3xs) var(--spacing-2xs); }
	.dg-spacer { flex: 1; }

	.dg-group { display: flex; align-items: center; gap: var(--spacing-xs); }
	.dg-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary); font-weight: 700; }

	.dg-swatches { display: flex; align-items: center; gap: var(--spacing-3xs); }
	.dg-swatch {
		width: 18px; height: 18px; border-radius: 5px;
		border: 1.5px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
		cursor: pointer; padding: 0;
	}
	.dg-swatch.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
	.dg-swatch.none {
		background: repeating-conic-gradient(#555 0% 25%, #888 0% 50%) 50% / 8px 8px;
	}
	.dg-color {
		width: 24px; height: 22px; padding: 0; border: none; background: none; cursor: pointer;
		border-radius: 5px;
	}

	.dg-w {
		width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
		border-radius: 6px; background: transparent; border: 1px solid var(--border-color);
		cursor: pointer;
	}
	.dg-w span { display: block; width: 14px; background: var(--text-secondary); border-radius: 2px; }
	.dg-w.active { border-color: var(--accent); }
	.dg-w.active span { background: var(--accent); }

	.dg-btn {
		padding: 7px var(--spacing-md); border-radius: 8px; font-size: 13px; font-weight: 600;
		background: var(--bg-mid-dark); color: var(--text-primary);
		border: 1px solid var(--border-color); cursor: pointer; transition: all 0.15s;
	}
	.dg-btn:hover { background: var(--bg-card-hover); }
	.dg-btn.primary { background: var(--accent); color: #001018; border-color: transparent; }
	.dg-btn.primary:hover { filter: brightness(1.08); }
	.dg-btn.ghost { background: transparent; }
	.dg-btn.danger { color: var(--semantic-error); border-color: var(--semantic-error); background: transparent; }
	.dg-btn.danger:hover { background: color-mix(in srgb, var(--semantic-error) 12%, transparent); }

	.diagram-canvas-wrap {
		flex: 1;
		overflow: auto;
		background: #e5e7eb;
		padding: var(--spacing-lg);
		display: flex;
		justify-content: center;
		align-items: flex-start;
	}

	.diagram-canvas-inner { position: relative; flex-shrink: 0; }

	.diagram-canvas {
		background: #ffffff;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		touch-action: none;
		display: block;
		box-shadow: 0 4px 12px rgba(0,0,0,0.1);
	}

	.dg-text-input {
		position: absolute;
		min-width: 60px;
		background: rgba(255,255,255,0.95);
		border: 2px solid #3b82f6;
		border-radius: 4px;
		color: #1f2937;
		font-family: system-ui, -apple-system, sans-serif;
		line-height: 1.3;
		padding: var(--spacing-3xs) var(--spacing-2xs);
		resize: none;
		outline: none;
		overflow: hidden;
	}

	.diagram-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) var(--spacing-md);
		border-top: 1px solid var(--border-color);
		gap: var(--spacing-sm);
	}

	.dg-hint { font-size: 11px; color: var(--text-tertiary); }

	.dg-mobile-only {
		display: none !important;
	}

	@media (max-width: 768px) {
		.diagram-overlay { padding: 0; }
		.diagram-modal { width: 100vw; height: 100vh; border-radius: 0; }
		.dg-label { display: none; }
		
		.dg-desktop-only {
			display: none !important;
		}
		
		.dg-mobile-only {
			display: flex !important;
		}

		.diagram-header {
			display: grid !important;
			grid-template-columns: auto 1fr auto !important;
			grid-template-rows: auto auto !important;
			padding: var(--spacing-sm) var(--spacing-sm) !important;
			gap: var(--spacing-sm) var(--spacing-xs) !important;
			background: var(--bg-surface);
			border-bottom: 1px solid var(--border-color);
		}

		.dg-btn.mobile-only {
			grid-column: 1;
			grid-row: 1;
			justify-self: start;
			padding: var(--spacing-xs) var(--spacing-sm);
			font-size: 13px;
		}

		.header-left-title {
			grid-column: 2;
			grid-row: 1;
			justify-self: center;
			gap: var(--spacing-xs);
		}

		.diagram-title {
			display: flex !important;
			align-items: center;
			gap: var(--spacing-xs);
			font-size: 14px !important;
			font-weight: 700;
		}

		.header-right-actions {
			grid-column: 3;
			grid-row: 1;
			justify-self: end;
			gap: var(--spacing-xs);
		}

		.header-switchers-wrapper {
			display: flex !important;
			grid-column: 1 / -1;
			grid-row: 2;
			justify-content: center;
			align-items: center;
			width: 100%;
		}

		.editor-host-switcher {
			flex-shrink: 0;
		}

		.switcher-btn {
			padding: var(--spacing-2xs) var(--spacing-xs);
			font-size: 10px;
		}

		.dg-btn.primary {
			padding: var(--spacing-xs) var(--spacing-sm);
			font-size: 13px;
		}

		.diagram-toolbar {
			justify-content: space-between !important;
			flex-wrap: nowrap !important;
			overflow-x: auto;
			padding: var(--spacing-xs) var(--spacing-xs);
			gap: var(--spacing-xs);
		}

		.dg-tools-wrapper {
			overflow-x: auto;
			display: flex;
			flex-shrink: 1;
			min-width: 0;
			-webkit-overflow-scrolling: touch;
		}
		.dg-tools-wrapper::-webkit-scrollbar {
			display: none;
		}

		.dg-tools {
			flex-wrap: nowrap;
			gap: var(--spacing-2xs);
		}

		.style-toggle-btn {
			flex-shrink: 0;
			background: color-mix(in srgb, var(--text-primary) 5%, transparent);
			border: 1px solid var(--border-color);
			color: var(--accent);
		}
		.style-toggle-btn.active {
			background: var(--accent-light);
			border-color: var(--accent);
		}

		/* Drawer styles */
		.drawer-backdrop {
			position: absolute;
			inset: 0;
			background: color-mix(in srgb, var(--bg-base) 60%, transparent);
			backdrop-filter: blur(4px);
			-webkit-backdrop-filter: blur(4px);
			z-index: 1000;
			display: flex;
			align-items: flex-end;
			justify-content: center;
		}

		.drawer-sheet {
			width: 100%;
			background: var(--bg-surface);
			border-top: 1px solid var(--border-highlight);
			border-radius: 16px 16px 0 0;
			padding: var(--spacing-lg);
			gap: var(--spacing-md);
			box-shadow: var(--shadow-heavy);
			max-height: 75vh;
			overflow-y: auto;
			box-sizing: border-box;
		}

		.drawer-header {
			justify-content: space-between;
			align-items: center;
			border-bottom: 1px solid var(--border-color);
			padding-bottom: var(--spacing-sm);
			width: 100%;
		}

		.drawer-title {
			font-weight: 700;
			font-size: 15px;
			color: var(--text-primary);
		}

		.drawer-content {
			width: 100%;
			gap: var(--spacing-md);
		}

		.drawer-group {
			width: 100%;
			gap: var(--spacing-xs);
			align-items: flex-start;
		}

		.drawer-label {
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			color: var(--text-tertiary);
			font-weight: 700;
			margin-bottom: var(--spacing-3xs);
		}

		.drawer-swatches {
			width: 100%;
			overflow-x: auto;
			display: flex;
			gap: var(--spacing-xs);
			padding-bottom: var(--spacing-2xs);
			flex-wrap: nowrap;
			-webkit-overflow-scrolling: touch;
		}
		.drawer-swatches::-webkit-scrollbar {
			display: none;
		}

		.drawer-widths {
			width: 100%;
			display: flex;
			gap: var(--spacing-xs);
		}

		.drawer-sheet .dg-swatch {
			flex-shrink: 0;
			width: 24px;
			height: 24px;
			border-radius: 6px;
		}
		
		.drawer-sheet .dg-color {
			flex-shrink: 0;
			width: 28px;
			height: 26px;
		}

		.drawer-sheet .dg-w {
			flex: 1;
			height: 36px;
		}
		
		.done-btn {
			height: 32px;
			padding: 0 var(--spacing-md);
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			border-radius: 6px;
		}
	}
</style>

