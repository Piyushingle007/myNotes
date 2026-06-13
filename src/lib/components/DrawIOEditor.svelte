<script lang="ts">
	import { encodeDiagram, decodeDiagram, type DiagramData } from '../utils/diagram';
	import { appState } from '../stores/appState.svelte';

	interface Props {
		data: string;
		onSave: (encoded: string) => void;
		onCancel: () => void;
	}
	let { data, onSave, onCancel }: Props = $props();

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isDirty = $state(false);
	let isOnline = $state(typeof window !== 'undefined' ? navigator.onLine : true);

	// Convert our format to draw.io XML
	function toDrawioXml(diagramData: DiagramData): string {
		let cells: string[] = [];
		let id = 2;

		for (const shape of diagramData.shapes) {
			const cellId = id++;
			let style = '';
			let geo = `<mxGeometry x="${shape.x}" y="${shape.y}" width="${Math.max(shape.w, 40)}" height="${Math.max(shape.h, 40)}" as="geometry"/>`;

			if (shape.type === 'rect') {
				style = `rounded=1;whiteSpace=wrap;html=1;strokeColor=${shape.stroke};fillColor=${shape.fill === 'transparent' ? 'none' : shape.fill};strokeWidth=${shape.strokeWidth};`;
			} else if (shape.type === 'ellipse') {
				style = `ellipse;whiteSpace=wrap;html=1;strokeColor=${shape.stroke};fillColor=${shape.fill === 'transparent' ? 'none' : shape.fill};strokeWidth=${shape.strokeWidth};`;
			} else if (shape.type === 'diamond') {
				style = `rhombus;whiteSpace=wrap;html=1;strokeColor=${shape.stroke};fillColor=${shape.fill === 'transparent' ? 'none' : shape.fill};strokeWidth=${shape.strokeWidth};`;
			} else if (shape.type === 'text') {
				style = `text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontColor=${shape.stroke};fontSize=${shape.fontSize || 14};`;
				cells.push(`<mxCell id="${cellId}" value="${escapeXml(shape.text || '')}" style="${style}" vertex="1" parent="1">${geo}</mxCell>`);
				continue;
			} else if (shape.type === 'line' || shape.type === 'arrow') {
				const endArrow = shape.type === 'arrow' ? 'classic' : 'none';
				style = `endArrow=${endArrow};html=1;strokeColor=${shape.stroke};strokeWidth=${shape.strokeWidth};`;
				const edgeGeo = `<mxGeometry relative="1" as="geometry"><mxPoint x="${shape.x}" y="${shape.y}" as="sourcePoint"/><mxPoint x="${shape.x + shape.w}" y="${shape.y + shape.h}" as="targetPoint"/></mxGeometry>`;
				cells.push(`<mxCell id="${cellId}" value="" style="${style}" edge="1" parent="1">${edgeGeo}</mxCell>`);
				continue;
			} else {
				continue;
			}

			cells.push(`<mxCell id="${cellId}" value="" style="${style}" vertex="1" parent="1">${geo}</mxCell>`);
		}

		return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
	}

	function escapeXml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// Parse draw.io XML to our format
	function fromDrawioXml(xml: string): DiagramData {
		const shapes: any[] = [];
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, 'text/xml');

		doc.querySelectorAll('mxCell').forEach((cell) => {
			const geo = cell.querySelector('mxGeometry');
			if (!geo) return;

			const style = cell.getAttribute('style') || '';
			const value = cell.getAttribute('value') || '';
			const isEdge = cell.getAttribute('edge') === '1';
			const isVertex = cell.getAttribute('vertex') === '1';

			if (!isEdge && !isVertex) return;

			const x = parseFloat(geo.getAttribute('x') || '0');
			const y = parseFloat(geo.getAttribute('y') || '0');
			const w = parseFloat(geo.getAttribute('width') || '100');
			const h = parseFloat(geo.getAttribute('height') || '60');

			let type = 'rect';
			if (isEdge) {
				type = style.includes('endArrow=classic') ? 'arrow' : 'line';
			} else if (style.includes('ellipse')) {
				type = 'ellipse';
			} else if (style.includes('rhombus')) {
				type = 'diamond';
			} else if (style.includes('text;') || (value && style.includes('fillColor=none'))) {
				type = 'text';
			}

			const strokeMatch = style.match(/strokeColor=([^;]+)/);
			const fillMatch = style.match(/fillColor=([^;]+)/);
			const widthMatch = style.match(/strokeWidth=(\d+)/);
			const fontColorMatch = style.match(/fontColor=([^;]+)/);

			let shapeX = x, shapeY = y, shapeW = w, shapeH = h;

			if (isEdge) {
				const srcPt = geo.querySelector('mxPoint[as="sourcePoint"]');
				const tgtPt = geo.querySelector('mxPoint[as="targetPoint"]');
				if (srcPt && tgtPt) {
					shapeX = parseFloat(srcPt.getAttribute('x') || '0');
					shapeY = parseFloat(srcPt.getAttribute('y') || '0');
					shapeW = parseFloat(tgtPt.getAttribute('x') || '0') - shapeX;
					shapeH = parseFloat(tgtPt.getAttribute('y') || '0') - shapeY;
				}
			}

			shapes.push({
				id: 'sh_' + Math.random().toString(36).slice(2, 9),
				type,
				x: shapeX,
				y: shapeY,
				w: shapeW,
				h: shapeH,
				text: type === 'text' ? value : undefined,
				stroke: fontColorMatch?.[1] || strokeMatch?.[1] || '#38bdf8',
				fill: (fillMatch?.[1] && fillMatch[1] !== 'none') ? fillMatch[1] : 'transparent',
				strokeWidth: widthMatch ? parseInt(widthMatch[1]) : 2,
				fontSize: type === 'text' ? 14 : undefined
			});
		});

		return { shapes, width: 800, height: 600, background: 'transparent' };
	}

	function handleMessage(event: MessageEvent) {
		if (!event.data || typeof event.data !== 'string') return;

		try {
			const msg = JSON.parse(event.data);
			console.log('[DrawIO]', msg.event);

			if (msg.event === 'init') {
				isLoading = false;
				const diagramData = decodeDiagram(data);
				// Prioritize raw drawioXml (lossless round-trip) if it exists
				const xml = diagramData.drawioXml || toDrawioXml(diagramData);
				lastXml = xml;

				iframeRef?.contentWindow?.postMessage(JSON.stringify({
					action: 'load',
					autosave: 1,
					xml: xml
				}), '*');
			}
			else if (msg.event === 'autosave' || msg.event === 'save') {
				if (msg.xml) {
					lastXml = msg.xml;
					isDirty = true;
					console.log('[DrawIO] Stored autosave XML');
				}
			}
			else if (msg.event === 'export') {
				if (isSaving) {
					console.log('[DrawIO] Export received, saving...');
					const xml = msg.xml || lastXml || '';
					try {
						// Decode base64 SVG
						const svgData = atob(msg.data.split(',').pop() || msg.data);
						const diagramData = fromDrawioXml(xml);
						diagramData.drawioSvg = svgData;
						diagramData.drawioXml = xml;
						onSave(encodeDiagram(diagramData));
					} catch (e) {
						console.error('[DrawIO] Export parse failed, saving fallback:', e);
						const diagramData = fromDrawioXml(xml);
						diagramData.drawioXml = xml;
						// Keep old SVG if parse failed
						const oldData = decodeDiagram(data);
						diagramData.drawioSvg = oldData.drawioSvg;
						onSave(encodeDiagram(diagramData));
					}
					isSaving = false;
				}
			}
			else if (msg.event === 'exit') {
				handleCancel();
			}
		} catch {
			// Ignore non-JSON messages
		}
	}

	let lastXml = '';

	function saveAndClose() {
		isSaving = true;
		iframeRef?.contentWindow?.postMessage(JSON.stringify({
			action: 'export',
			format: 'xmlsvg'
		}), '*');

		// Fallback timeout in case export fails
		setTimeout(() => {
			if (isSaving) {
				console.log('[DrawIO] Export timeout, saving with last known state');
				const xml = lastXml || '';
				const diagramData = fromDrawioXml(xml);
				diagramData.drawioXml = xml;
				const oldData = decodeDiagram(data);
				diagramData.drawioSvg = oldData.drawioSvg;
				onSave(encodeDiagram(diagramData));
				isSaving = false;
			}
		}, 3000);
	}

	function handleCancel() {
		if (isDirty) {
			if (!confirm('Are you sure you want to discard unsaved changes?')) {
				return;
			}
		}
		onCancel();
	}

	function switchToNative() {
		appState.setDiagramEditorType('native');
		onCancel();
	}

	$effect(() => {
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	});

	$effect(() => {
		const updateOnline = () => { isOnline = navigator.onLine; };
		window.addEventListener('online', updateOnline);
		window.addEventListener('offline', updateOnline);
		return () => {
			window.removeEventListener('online', updateOnline);
			window.removeEventListener('offline', updateOnline);
		};
	});

	const drawioUrl = $derived.by(() => {
		// Detect light theme to configure draw.io theme dynamically
		const isLightTheme = ['paper', 'sakura', 'matcha'].includes(appState.theme);
		const params = new URLSearchParams({
			embed: '1',
			proto: 'json',
			spin: '1',
			dark: isLightTheme ? '0' : '1',
			ui: 'kennedy',
			libraries: '1',
			saveAndExit: '0',
			noSaveBtn: '1',
			noExitBtn: '1'
		});
		return `https://embed.diagrams.net/?${params.toString()}`;
	});
</script>

<div class="drawio-overlay" role="dialog">
	<div class="drawio-modal">
		<div class="drawio-header">
			<span class="title">✏️ Edit Diagram</span>
			<div class="actions">
				<button class="btn-cancel" onclick={handleCancel}>Cancel</button>
				<button class="btn-save" onclick={saveAndClose} disabled={isSaving || !isOnline}>
					{#if isSaving}
						Saving...
					{:else}
						💾 Save & Close
					{/if}
				</button>
			</div>
		</div>

		{#if !isOnline}
			<div class="offline-state">
				<div class="offline-icon">🌐❌</div>
				<h3 class="offline-title">Offline Mode</h3>
				<p class="offline-desc">Draw.io requires an active internet connection to load and edit diagrams.</p>
				<button class="btn-switch" onclick={switchToNative}>Switch to Native Editor (Offline)</button>
			</div>
		{:else}
			{#if isLoading}
				<div class="loading">
					<div class="spinner"></div>
					<span>Loading editor...</span>
				</div>
			{/if}

			<iframe
				bind:this={iframeRef}
				src={drawioUrl}
				title="Diagram Editor"
				class="drawio-frame"
				class:hidden={isLoading}
			></iframe>
		{/if}
	</div>
</div>

<style>
	.drawio-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.drawio-modal {
		background: #1a1a1a;
		border-radius: 12px;
		width: min(1400px, 95vw);
		height: min(850px, 90vh);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
	}

	.drawio-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 20px;
		background: #252525;
		border-bottom: 1px solid #333;
	}

	.title {
		font-size: 15px;
		font-weight: 600;
		color: #fff;
	}

	.actions {
		display: flex;
		gap: 10px;
	}

	.btn-cancel {
		padding: 8px 18px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		background: transparent;
		color: #aaa;
		border: 1px solid #444;
		cursor: pointer;
	}

	.btn-cancel:hover {
		background: #333;
		color: #fff;
	}

	.btn-save {
		padding: 8px 22px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		background: #10b981;
		color: #fff;
		border: none;
		cursor: pointer;
	}

	.btn-save:hover:not(:disabled) {
		background: #059669;
	}

	.btn-save:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.drawio-frame {
		flex: 1;
		width: 100%;
		border: none;
		background: #1a1a1a;
	}

	.drawio-frame.hidden {
		opacity: 0;
	}

	.loading {
		position: absolute;
		inset: 60px 0 0 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		color: #888;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid #333;
		border-top-color: #10b981;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Offline State Styling */
	.offline-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px;
		text-align: center;
		background: #1a1a1a;
		color: #ccc;
	}

	.offline-icon {
		font-size: 48px;
		margin-bottom: 16px;
	}

	.offline-title {
		font-size: 20px;
		font-weight: 600;
		color: #fff;
		margin-bottom: 8px;
	}

	.offline-desc {
		font-size: 14px;
		color: #aaa;
		max-width: 400px;
		margin-bottom: 24px;
		line-height: 1.5;
	}

	.btn-switch {
		padding: 10px 24px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		background: #3b82f6;
		color: #fff;
		border: none;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-switch:hover {
		background: #2563eb;
	}
</style>

