export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;      // 0.0-1.0 (stylus) or simulated
  timestamp?: number;     // for velocity-based effects
}

export type CanvasTool = 'pen' | 'highlighter' | 'eraser';

export interface Stroke {
  id: string;
  tool: CanvasTool;
  points: StrokePoint[];
  color: string;          // hex
  size: number;           // base width in px
  opacity: number;        // 1.0 pen, 0.3 highlighter
}

export type CanvasBackground = 'blank' | 'lined' | 'grid' | 'dotted';

export type InputMode = 'auto' | 'penOnly' | 'touchDraw';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasDocument {
  version: number;
  width: number;
  height: number;
  background: CanvasBackground;
  strokes: Stroke[];
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
}
