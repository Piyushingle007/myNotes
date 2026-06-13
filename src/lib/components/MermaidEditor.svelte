<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Code, Columns, Eye, Download, Info, ZoomIn, ZoomOut, RefreshCw } from 'lucide-svelte';
	import { appState } from '../stores/appState.svelte';
	import { encodeDiagram, decodeDiagram, type DiagramData } from '../utils/diagram';

	interface Props {
		data: string;
		onSave: (encoded: string) => void;
		onCancel: () => void;
	}
	let { data, onSave, onCancel }: Props = $props();

	let mermaidCode = $state('');
	let viewMode = $state<'code' | 'split' | 'preview'>('split');
	let svgContent = $state('');
	let errorMsg = $state('');
	let isSaving = $state(false);
	let isDirty = $state(false);
	let originalCode = '';

	let zoomLevel = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let startX = 0;
	let startY = 0;
	let startPanX = 0;
	let startPanY = 0;

	let mermaidInstance: any = null;
	let renderCounter = 0;

	const DEFAULT_MERMAID = `graph TD
  Mermaid --> Diagram`;

	onMount(async () => {
		const decoded = decodeDiagram(data);
		mermaidCode = decoded.mermaidCode || DEFAULT_MERMAID;
		originalCode = mermaidCode;

		try {
			const mod = await import('mermaid');
			mermaidInstance = mod.default;
			
			// Detect theme mode
			const isLight = ['paper', 'sakura', 'matcha'].includes(appState.theme);
			mermaidInstance.initialize({
				startOnLoad: false,
				theme: isLight ? 'default' : 'dark',
				securityLevel: 'loose',
				themeVariables: isLight ? {} : {
					background: '#1e1e1e',
					primaryColor: '#38bdf8',
					primaryTextColor: '#fff',
					lineColor: '#58a6ff'
				}
			});
			await renderPreview();
		} catch (e) {
			console.error('Failed to load mermaid library', e);
			errorMsg = 'Failed to load Mermaid rendering library.';
		}
	});

	async function renderPreview() {
		if (!mermaidInstance) return;
		errorMsg = '';
		const source = mermaidCode.trim();
		if (!source) {
			svgContent = '';
			return;
		}
		try {
			// Syntax validation
			await mermaidInstance.parse(source, { suppressErrors: false });
			// Render diagram to SVG
			const id = `mermaid-editor-${++renderCounter}`;
			const { svg } = await mermaidInstance.render(id, source);
			svgContent = svg;
		} catch (e: any) {
			errorMsg = e?.message || String(e);
		}
	}

	// Reactive tracking of updates
	$effect(() => {
		mermaidCode;
		isDirty = mermaidCode !== originalCode;
		// Debounce render preview slightly to prevent lag on typing
		const timer = setTimeout(() => {
			renderPreview();
		}, 150);
		return () => clearTimeout(timer);
	});

	function handleSave() {
		isSaving = true;
		try {
			const diagramData: DiagramData = {
				shapes: [],
				width: 800,
				height: 600,
				mermaidCode: mermaidCode,
				mermaidSvg: svgContent
			};
			onSave(encodeDiagram(diagramData));
		} catch (e) {
			console.error('Failed to save diagram', e);
		} finally {
			isSaving = false;
		}
	}

	function handleCancel() {
		if (isDirty) {
			if (!confirm('Are you sure you want to discard unsaved changes?')) {
				return;
			}
		}
		onCancel();
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const scaleFactor = 1.1;
		if (e.deltaY < 0) {
			zoomLevel = Math.min(10, zoomLevel * scaleFactor);
		} else {
			zoomLevel = Math.max(0.1, zoomLevel / scaleFactor);
		}
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0) return; // Only left-click
		if ((e.target as HTMLElement).closest('.preview-controls')) return;
		isDragging = true;
		startX = e.clientX;
		startY = e.clientY;
		startPanX = panX;
		startPanY = panY;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isDragging) return;
		panX = startPanX + (e.clientX - startX);
		panY = startPanY + (e.clientY - startY);
	}

	function handleMouseUp() {
		isDragging = false;
	}

	function resetZoom() {
		zoomLevel = 1;
		panX = 0;
		panY = 0;
	}

	function zoomIn() {
		zoomLevel = Math.min(10, zoomLevel * 1.2);
	}

	function zoomOut() {
		zoomLevel = Math.max(0.1, zoomLevel / 1.2);
	}

	function downloadSvg() {
		if (!svgContent) return;
		const blob = new Blob([svgContent], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'mermaid_diagram.svg';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:window 
	onmousemove={isDragging ? handleMouseMove : null} 
	onmouseup={isDragging ? handleMouseUp : null} 
/>

<div 
	class="mermaid-overlay flex-row" 
	role="dialog" 
	transition:fade={{ duration: 150 }}
	onclick={(e) => e.stopPropagation()}
	onmousedown={(e) => e.stopPropagation()}
>
	<div class="mermaid-modal flex-col" transition:fly={{ y: 30, duration: 300, easing: cubicOut }}>
		
		<!-- Header Toolbar -->
		<div class="mermaid-header flex-row">
			<div class="header-left flex-row" style="gap: 12px;">
				<span class="logo">📊</span>
				<span class="title">Mermaid Diagram Editor</span>
			</div>
			
			<div class="header-center flex-row" style="gap: 16px;">
				<!-- Segmented View Mode Controls -->
				<div class="segmented-control flex-row">
					<button 
						class="control-btn flex-row" 
						class:active={viewMode === 'code'} 
						onclick={() => viewMode = 'code'}
					>
						<Code size={13} />
						<span>Code</span>
					</button>
					<button 
						class="control-btn flex-row" 
						class:active={viewMode === 'split'} 
						onclick={() => viewMode = 'split'}
					>
						<Columns size={13} />
						<span>Split</span>
					</button>
					<button 
						class="control-btn flex-row" 
						class:active={viewMode === 'preview'} 
						onclick={() => viewMode = 'preview'}
					>
						<Eye size={13} />
						<span>Preview</span>
					</button>
				</div>
			</div>

			<div class="header-right flex-row" style="gap: 10px;">
				{#if svgContent}
					<button class="icon-action-btn" onclick={downloadSvg} title="Download SVG" aria-label="Download SVG">
						<Download size={16} />
					</button>
				{/if}
				<button class="btn-save" onclick={handleSave} disabled={isSaving || !!errorMsg}>
					{#if isSaving}
						Saving...
					{:else}
						💾 Save
					{/if}
				</button>
			</div>
		</div>

		<!-- Editor Workspace -->
		<div class="mermaid-workspace" class:code-only={viewMode === 'code'} class:preview-only={viewMode === 'preview'}>
			
			<!-- Editor Panel (Monospace textarea) -->
			{#if viewMode !== 'preview'}
				<div class="editor-pane flex-col">
					<div class="pane-header flex-row">
						<span>Mermaid Source Code</span>
						<a href="https://mermaid.js.org/intro/" target="_blank" rel="noopener noreferrer" class="docs-link flex-row">
							<Info size={12} />
							<span>Mermaid Docs</span>
						</a>
					</div>
					<textarea
						bind:value={mermaidCode}
						placeholder="Write mermaid code here..."
						class="code-textarea"
						spellcheck="false"
					></textarea>
					
					<!-- Syntax error banner -->
					{#if errorMsg}
						<div class="error-banner flex-col" transition:fly={{ y: 10, duration: 150 }}>
							<span class="error-title">⚠️ Syntax Error</span>
							<pre class="error-text">{errorMsg}</pre>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Divider line for split mode -->
			{#if viewMode === 'split'}
				<div class="workspace-divider"></div>
			{/if}

			<!-- Live SVG Preview Panel -->
			{#if viewMode !== 'code'}
				<div class="preview-pane flex-col" style="position: relative;">
					<div class="pane-header flex-row" style="justify-content: space-between;">
						<span>Diagram Render Preview</span>
						{#if svgContent}
							<span style="font-size: 10px; color: var(--text-tertiary);">Scroll to Zoom • Drag to Pan</span>
						{/if}
					</div>
					<div 
						class="svg-container flex-row"
						onwheel={handleWheel}
						onmousedown={handleMouseDown}
						style="overflow: hidden; cursor: {isDragging ? 'grabbing' : (zoomLevel !== 1 || panX !== 0 || panY !== 0 ? 'move' : 'grab')}; position: relative; width: 100%; height: 100%;"
					>
						{#if svgContent}
							<div 
								class="rendered-svg"
								style="transform: translate({panX}px, {panY}px) scale({zoomLevel}); transform-origin: center; transition: {isDragging ? 'none' : 'transform 0.1s ease'};"
							>
								{@html svgContent}
							</div>
							
							<!-- Floating Zoom Controls -->
							<div class="preview-controls flex-row">
								<button class="control-btn-circle" onclick={zoomOut} title="Zoom Out" aria-label="Zoom Out">
									<ZoomOut size={14} />
								</button>
								<span class="zoom-level">{Math.round(zoomLevel * 100)}%</span>
								<button class="control-btn-circle" onclick={zoomIn} title="Zoom In" aria-label="Zoom In">
									<ZoomIn size={14} />
								</button>
								<button class="control-btn-circle" onclick={resetZoom} title="Reset View" aria-label="Reset View">
									<RefreshCw size={12} />
								</button>
							</div>
						{:else}
							<div class="empty-preview flex-col">
								<span>📊</span>
								<span>No diagram content to display</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.mermaid-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(4px);
		padding: 24px;
		align-items: center;
		justify-content: center;
	}

	.mermaid-modal {
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 12px;
		width: min(1500px, 96vw);
		height: min(880px, 92vh);
		overflow: hidden;
		box-shadow: 0 25px 80px rgba(0, 0, 0, 0.7);
		position: relative;
	}

	.mermaid-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 14px 20px;
		background: #181818;
		border-bottom: 1px solid #2d2d2d;
		flex-shrink: 0;
	}

	.logo {
		font-size: 18px;
	}

	.title {
		font-size: 15px;
		font-weight: 700;
		color: #ffffff;
		letter-spacing: -0.2px;
	}



	.segmented-control {
		background: #121212;
		border: 1px solid #2d2d2d;
		border-radius: 20px;
		padding: 2px;
		gap: 2px;
	}

	.control-btn {
		background: transparent;
		border: none;
		color: #888;
		font-size: 11px;
		font-weight: 600;
		padding: 4px 12px;
		border-radius: 20px;
		cursor: pointer;
		gap: 6px;
		height: 24px;
		transition: all 0.2s;
	}

	.control-btn:hover {
		color: #fff;
	}

	.control-btn.active {
		background: #2b2b2b;
		color: #fff;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
	}

	.icon-action-btn {
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		padding: 6px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.2s, color 0.2s;
	}

	.icon-action-btn:hover {
		background-color: rgba(255, 255, 255, 0.06);
		color: #fff;
	}

	.btn-cancel {
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		background: transparent;
		color: #aaa;
		border: 1px solid #333;
		cursor: pointer;
		transition: background-color 0.2s, color 0.2s;
	}

	.btn-cancel:hover {
		background: #252525;
		color: #fff;
	}

	.btn-save {
		padding: 8px 20px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		background: #10b981;
		color: #fff;
		border: none;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.btn-save:hover:not(:disabled) {
		background: #059669;
	}

	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}



	/* Workspace */
	.mermaid-workspace {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1px 1fr;
		min-height: 0;
	}

	.mermaid-workspace.code-only {
		grid-template-columns: 1fr;
	}

	.mermaid-workspace.preview-only {
		grid-template-columns: 1fr;
	}

	.workspace-divider {
		background-color: #2d2d2d;
	}

	/* Editor Pane */
	.editor-pane {
		background: #151515;
		min-height: 0;
		position: relative;
	}

	.pane-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 16px;
		background: #1b1b1b;
		border-bottom: 1px solid #252525;
		color: #888;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.docs-link {
		color: var(--accent);
		text-decoration: none;
		gap: 4px;
	}

	.code-textarea {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		resize: none;
		padding: 16px;
		color: #e4e4e7;
		font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 13px;
		line-height: 1.6;
	}

	.error-banner {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: rgba(239, 68, 68, 0.15);
		border-top: 1px solid rgba(239, 68, 68, 0.3);
		padding: 12px 16px;
		max-height: 150px;
		overflow-y: auto;
		z-index: 10;
		gap: 4px;
	}

	.error-title {
		color: #f87171;
		font-weight: 700;
		font-size: 11px;
	}

	.error-text {
		color: #fca5a5;
		font-size: 11px;
		font-family: monospace;
		white-space: pre-wrap;
		margin: 0;
		line-height: 1.4;
	}

	/* Preview Pane */
	.preview-pane {
		background: #111111;
		min-height: 0;
	}

	.svg-container {
		flex: 1;
		align-items: center;
		justify-content: center;
		padding: 24px;
		overflow: auto;
		background: radial-gradient(circle at center, #1b1b1f 0%, #111113 100%);
		position: relative;
	}

	.rendered-svg {
		display: flex;
		align-items: center;
		justify-content: center;
		max-width: 100%;
		max-height: 100%;
		user-select: none;
	}

	.rendered-svg :global(svg) {
		max-width: 100%;
		height: auto;
		background: transparent !important;
		pointer-events: none; /* Let drag events fall through to container */
	}

	.preview-controls {
		position: absolute;
		bottom: 16px;
		right: 16px;
		background: rgba(24, 24, 24, 0.85);
		border: 1px solid #333;
		border-radius: 20px;
		padding: 4px 8px;
		gap: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 15;
		user-select: none;
	}

	.control-btn-circle {
		background: transparent;
		border: none;
		color: #aaa;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		transition: background-color 0.2s, color 0.2s;
	}

	.control-btn-circle:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.zoom-level {
		color: #ccc;
		font-size: 11px;
		font-weight: 700;
		min-width: 36px;
		text-align: center;
	}

	.empty-preview {
		color: #555;
		font-size: 13px;
		font-weight: 600;
		gap: 8px;
		align-items: center;
	}

	.empty-preview span:first-child {
		font-size: 40px;
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
</style>
