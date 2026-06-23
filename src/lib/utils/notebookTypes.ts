export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  timestamp?: number;
}

export type NotebookTool = 'pen' | 'highlighter' | 'eraser' | 'hand';
export type PageBackground = 'blank' | 'lined' | 'grid' | 'dotted';
export type InputMode = 'auto' | 'penOnly' | 'touchDraw';

export interface Stroke {
  id: string;
  tool: NotebookTool;
  points: StrokePoint[];
  color: string;
  size: number;
  opacity: number;
}

export interface NotebookPage {
  id: string;
  index: number;           // page order (0-based)
  background: PageBackground;
  strokes: Stroke[];
  width: number;           // default 800
  height: number;          // default 1130 (A4 ratio)
}

export interface NotebookDocument {
  version: number;         // schema version for migrations
  id: string;
  title: string;
  pages: NotebookPage[];
  defaultBackground: PageBackground;
  thumbnail?: string;      // base64 thumbnail of first page
  createdAt: string;
  updatedAt: string;
}
