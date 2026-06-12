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
		if (!parsed || !Array.isArray(parsed.shapes)) return structuredCloneSafe(DEFAULT_DIAGRAM);
		return {
			shapes: parsed.shapes,
			width: parsed.width || DEFAULT_DIAGRAM.width,
			height: parsed.height || DEFAULT_DIAGRAM.height,
			background: parsed.background || 'transparent'
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
	const stroke = s.stroke || '#e2e8f0';
	const fill = s.fill || 'transparent';
	const sw = s.strokeWidth ?? 2;

	switch (s.type) {
		case 'rect':
			return `<rect x="${s.x}" y="${s.y}" width="${Math.max(1, s.w)}" height="${Math.max(1, s.h)}" rx="6" ry="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
		case 'ellipse':
			return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.max(1, s.w / 2)}" ry="${Math.max(1, s.h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
		case 'diamond': {
			const cx = s.x + s.w / 2;
			const cy = s.y + s.h / 2;
			const pts = `${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}`;
			return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
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
			const fontSize = s.fontSize || 16;
			const lines = (s.text || '').split('\n');
			const tspans = lines
				.map((ln, i) => `<tspan x="${s.x}" dy="${i === 0 ? fontSize : fontSize * 1.3}">${escapeXml(ln) || ' '}</tspan>`)
				.join('');
			return `<text x="${s.x}" y="${s.y}" fill="${stroke}" font-size="${fontSize}" font-family="Inter, system-ui, sans-serif">${tspans}</text>`;
		}
		default:
			return '';
	}
}

// Render the full diagram to a standalone SVG string (used for preview + export).
export function renderDiagramSVG(data: DiagramData, opts: { maxWidth?: number } = {}): string {
	const width = data.width || DEFAULT_DIAGRAM.width;
	const height = data.height || DEFAULT_DIAGRAM.height;
	const body = data.shapes.map(renderShape).join('');
	const bg =
		data.background && data.background !== 'transparent'
			? `<rect x="0" y="0" width="${width}" height="${height}" fill="${data.background}"/>`
			: '';
	const styleMax = opts.maxWidth ? `max-width:${opts.maxWidth}px;` : 'max-width:100%;';
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${styleMax} height:auto;" preserveAspectRatio="xMidYMid meet">${bg}${body}</svg>`;
}

