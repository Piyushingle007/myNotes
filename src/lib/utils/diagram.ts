// Shared diagram data model + SVG renderer used by both the TipTap node
// (preview/export) and the DiagramEditor modal. Kept framework-agnostic so it
// can run inside ProseMirror node views and Svelte components alike.

export type DiagramShapeType =
	| 'rect'
	| 'ellipse'
	| 'diamond'
	| 'text'
	| 'line'
	| 'arrow'
	| 'draw';

export interface DiagramShape {
	id: string;
	type: DiagramShapeType;
	x: number;
	y: number;
	w: number;
	h: number;
	points?: number[]; // freehand path points [x0,y0,x1,y1,...] (absolute)
	text?: string;
	stroke: string;
	fill: string;
	strokeWidth: number;
	fontSize?: number;
}

export interface DiagramData {
	shapes: DiagramShape[];
	width: number;
	height: number;
	background?: string;
	drawioSvg?: string; // Raw SVG from draw.io for faithful rendering
	drawioXml?: string; // Raw XML from draw.io for lossless editing
	mermaidCode?: string; // Raw Mermaid source code
	mermaidSvg?: string;  // Rendered Mermaid SVG
}

export const DEFAULT_DIAGRAM: DiagramData = {
	shapes: [],
	width: 800,
	height: 480,
	background: 'transparent'
};

export function newShapeId(): string {
	return 'sh_' + Math.random().toString(36).slice(2, 9);
}

export function encodeDiagram(data: DiagramData): string {
	try {
		return encodeURIComponent(JSON.stringify(data));
	} catch {
		return '';
	}
}

export function decodeDiagram(encoded: string): DiagramData {
	if (!encoded) return structuredCloneSafe(DEFAULT_DIAGRAM);
	try {
		const parsed = JSON.parse(decodeURIComponent(encoded));
		if (!parsed) return structuredCloneSafe(DEFAULT_DIAGRAM);
		return {
			shapes: parsed.shapes || [],
			width: parsed.width || DEFAULT_DIAGRAM.width,
			height: parsed.height || DEFAULT_DIAGRAM.height,
			background: parsed.background || 'transparent',
			drawioSvg: parsed.drawioSvg, // Preserve draw.io SVG if present
			drawioXml: parsed.drawioXml,  // Preserve draw.io XML if present
			mermaidCode: parsed.mermaidCode, // Preserve mermaid code if present
			mermaidSvg: parsed.mermaidSvg    // Preserve mermaid SVG if present
		};
	} catch {
		return structuredCloneSafe(DEFAULT_DIAGRAM);
	}
}

function structuredCloneSafe<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

function escapeXml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

// Render a single shape to an SVG fragment string.
export function renderShape(s: DiagramShape): string {
	// Use darker colors for white background
	const stroke = s.stroke || '#374151';
	const fill = s.fill || 'transparent';
	const sw = s.strokeWidth ?? 2;

	switch (s.type) {
		case 'rect':
			return `<rect x="${s.x}" y="${s.y}" width="${Math.max(1, s.w)}" height="${Math.max(1, s.h)}" rx="4" ry="4" fill="${fill === 'transparent' ? '#f9fafb' : fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
		case 'ellipse':
			return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.max(1, s.w / 2)}" ry="${Math.max(1, s.h / 2)}" fill="${fill === 'transparent' ? '#f9fafb' : fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
		case 'diamond': {
			const cx = s.x + s.w / 2;
			const cy = s.y + s.h / 2;
			const pts = `${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}`;
			return `<polygon points="${pts}" fill="${fill === 'transparent' ? '#f9fafb' : fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
		}
		case 'line':
			return `<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
		case 'arrow': {
			const x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
			const angle = Math.atan2(y2 - y1, x2 - x1);
			const head = 10 + sw * 1.5;
			const a1 = angle - Math.PI / 7;
			const a2 = angle + Math.PI / 7;
			const hx1 = x2 - head * Math.cos(a1);
			const hy1 = y2 - head * Math.sin(a1);
			const hx2 = x2 - head * Math.cos(a2);
			const hy2 = y2 - head * Math.sin(a2);
			return (
				`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>` +
				`<polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`
			);
		}
		case 'draw': {
			const p = s.points || [];
			if (p.length < 4) return '';
			let d = `M ${p[0]} ${p[1]}`;
			for (let i = 2; i < p.length; i += 2) d += ` L ${p[i]} ${p[i + 1]}`;
			return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
		}
		case 'text': {
			const fontSize = s.fontSize || 14;
			const textColor = stroke === '#38bdf8' ? '#1f2937' : stroke;
			const lines = (s.text || '').split('\n');
			const tspans = lines
				.map((ln, i) => `<tspan x="${s.x}" dy="${i === 0 ? fontSize : fontSize * 1.3}">${escapeXml(ln) || ' '}</tspan>`)
				.join('');
			return `<text x="${s.x}" y="${s.y}" fill="${textColor}" font-size="${fontSize}" font-family="system-ui, -apple-system, sans-serif">${tspans}</text>`;
		}
		default:
			return '';
	}
}

// Compute bounding box for a single shape
function shapeBoundingBox(s: DiagramShape): { minX: number; minY: number; maxX: number; maxY: number } {
	const sw = s.strokeWidth ?? 2;
	const pad = sw; // Padding for stroke width

	switch (s.type) {
		case 'rect':
		case 'diamond':
			return {
				minX: s.x - pad,
				minY: s.y - pad,
				maxX: s.x + Math.max(1, s.w) + pad,
				maxY: s.y + Math.max(1, s.h) + pad
			};
		case 'ellipse':
			return {
				minX: s.x - pad,
				minY: s.y - pad,
				maxX: s.x + Math.max(1, s.w) + pad,
				maxY: s.y + Math.max(1, s.h) + pad
			};
		case 'line':
		case 'arrow': {
			const x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
			const arrowPad = s.type === 'arrow' ? 15 : 0;
			return {
				minX: Math.min(x1, x2) - pad - arrowPad,
				minY: Math.min(y1, y2) - pad - arrowPad,
				maxX: Math.max(x1, x2) + pad + arrowPad,
				maxY: Math.max(y1, y2) + pad + arrowPad
			};
		}
		case 'draw': {
			const pts = s.points || [];
			if (pts.length < 2) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (let i = 0; i < pts.length; i += 2) {
				minX = Math.min(minX, pts[i]);
				maxX = Math.max(maxX, pts[i]);
				minY = Math.min(minY, pts[i + 1]);
				maxY = Math.max(maxY, pts[i + 1]);
			}
			return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
		}
		case 'text': {
			const fontSize = s.fontSize || 16;
			const lines = (s.text || ' ').split('\n');
			const textWidth = Math.max(20, Math.max(...lines.map(l => l.length)) * fontSize * 0.6);
			const textHeight = lines.length * fontSize * 1.3;
			return {
				minX: s.x - 2,
				minY: s.y - 2,
				maxX: s.x + textWidth + 2,
				maxY: s.y + textHeight + 2
			};
		}
		default:
			return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}
}

// Render the full diagram to a standalone SVG string (used for preview + export).
export function renderDiagramSVG(data: DiagramData, opts: { maxWidth?: number } = {}): string {
	// If we have a raw mermaid SVG, clean it up and use it directly.
	// Use string manipulation instead of DOMParser('image/svg+xml') because the strict
	// XML parser silently returns a <parsererror> document for any malformed Mermaid output,
	// causing the diagram to collapse to 0 height.
	if (data.mermaidSvg) {
		try {
			let svgStr = data.mermaidSvg.trim();

			// Extract viewBox dimensions so we can set explicit width/height for correct aspect ratio
			let widthAttr = '';
			let heightAttr = '';
			const vbMatch = svgStr.match(/viewBox\s*=\s*["']([^"']+)["']/i);
			if (vbMatch) {
				const parts = vbMatch[1].trim().split(/[\s,]+/);
				if (parts.length >= 4) {
					const w = parseFloat(parts[2]);
					const h = parseFloat(parts[3]);
					if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
						widthAttr = `width="${w}" `;
						heightAttr = `height="${h}" `;
					}
				}
			}

			// Rewrite the opening <svg ...> tag: strip width/height/style, then inject our own
			svgStr = svgStr.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
				const cleaned = attrs
					.replace(/\s+width="[^"]*"/gi, '')
					.replace(/\s+height="[^"]*"/gi, '')
					.replace(/\s+style="[^"]*"/gi, '');
				return `<svg${cleaned} ${widthAttr}${heightAttr}style="width:100%; height:auto; background:transparent;">`;
			});

			return svgStr;
		} catch (e) {
			console.warn('Failed to process mermaid SVG, falling back to native rendering', e);
		}
	}

	// If we have a raw draw.io SVG, clean it up and use it directly
	if (data.drawioSvg) {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(data.drawioSvg, 'image/svg+xml');
			const svg = doc.querySelector('svg');
			if (svg) {
				// Set responsive styles but keep background transparent (inherited from diagram-block)
				svg.setAttribute('style', 'max-width:100%; height:auto; background:transparent;');
				// We do NOT remove width/height attributes so the container can dynamically size using fit-content!
				const content = svg.getAttribute('content');
				if (content) svg.removeAttribute('content');
				return svg.outerHTML;
			}
		} catch (e) {
			console.warn('Failed to parse draw.io SVG, falling back to native rendering');
		}
	}

	const canvasWidth = data.width || DEFAULT_DIAGRAM.width;
	const canvasHeight = data.height || DEFAULT_DIAGRAM.height;
	const body = data.shapes.map(renderShape).join('');
	
	// Calculate actual bounding box of all shapes
	let minX = 0, minY = 0, maxX = canvasWidth, maxY = canvasHeight;
	
	for (const shape of data.shapes) {
		const bb = shapeBoundingBox(shape);
		minX = Math.min(minX, bb.minX);
		minY = Math.min(minY, bb.minY);
		maxX = Math.max(maxX, bb.maxX);
		maxY = Math.max(maxY, bb.maxY);
	}
	
	// Add padding
	const padding = 20;
	minX -= padding;
	minY -= padding;
	maxX += padding;
	maxY += padding;
	
	const viewBoxWidth = maxX - minX;
	const viewBoxHeight = maxY - minY;
	
	// Transparent background (inherited from container) with natural dimensions
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxWidth}" height="${viewBoxHeight}" viewBox="${minX} ${minY} ${viewBoxWidth} ${viewBoxHeight}" style="max-width:100%; height:auto; background:transparent;" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

