import type { NotebookDocument, NotebookPage, PageBackground } from './notebookTypes';

export function createEmptyNotebook(title: string): NotebookDocument {
  return {
    version: 1,
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
    title,
    pages: [createEmptyPage(0, 'lined')],
    defaultBackground: 'lined',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createEmptyPage(index: number, bg?: PageBackground): NotebookPage {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
    index,
    background: bg || 'lined',
    strokes: [],
    width: 800,
    height: 1130
  };
}

export function serializeNotebook(doc: NotebookDocument): string {
  return JSON.stringify(doc);
}

export function deserializeNotebook(json: string): NotebookDocument {
  const parsed = JSON.parse(json);
  
  if (parsed && parsed.strokes && !parsed.pages) {
    console.log("Migrating CanvasDocument to NotebookDocument...");
    return {
      version: 1,
      id: parsed.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)),
      title: parsed.title || 'Migrated Notebook',
      pages: [
        {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
          index: 0,
          background: parsed.background || 'lined',
          strokes: parsed.strokes,
          width: parsed.width || 800,
          height: parsed.height || 1130
        }
      ],
      defaultBackground: parsed.background || 'lined',
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  
  return parsed as NotebookDocument;
}
