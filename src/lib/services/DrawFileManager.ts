import { appState, parseHtmlMetadata } from '../stores/appState.svelte';

export interface DrawDocument {
  version: 1;
  title: string;
  snapshot: any; // Tldraw snapshot object
  createdAt: string;
  modifiedAt: string;
}

export class DrawFileManagerClass {
  /**
   * Ensure that the "Draw" folder directory exists in the storage.
   */
  public async ensureDrawFolder(): Promise<void> {
    try {
      await appState.storage.createDirectory('Draw');
    } catch (e) {
      console.warn('Failed to create Draw directory:', e);
    }
  }

  /**
   * List all Draw files in the storage.
   */
  public listDrawFiles(): { path: string; name: string; created: number; modified: number }[] {
    return appState.notes
      .filter(note => note.path.startsWith('Draw/'))
      .map(note => ({
        path: note.path,
        name: note.name,
        created: note.created,
        modified: note.modified
      }))
      .sort((a, b) => b.modified - a.modified); // Sort by most recently modified
  }

  /**
   * Load and parse a Draw document from a file path.
   */
  public loadDrawFile(path: string): DrawDocument {
    const note = appState.notes.find(n => n.path === path);
    if (!note) {
      throw new Error(`File not found: ${path}`);
    }

    try {
      let parsed: any = null;
      
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(note.content, 'text/html');
        const scriptEl = doc.getElementById('draw-session-data');
        if (scriptEl && scriptEl.textContent) {
          parsed = JSON.parse(scriptEl.textContent);
        }
      } else {
        const scriptMatch = note.content.match(/<script\s+type="application\/json"\s+id="draw-session-data">([\s\S]*?)<\/script>/i);
        if (scriptMatch && scriptMatch[1]) {
          parsed = JSON.parse(scriptMatch[1].trim());
        }
      }

      if (parsed) {
        return parsed as DrawDocument;
      }
    } catch (e) {
      console.error('Failed to parse Draw session data script tag:', e);
    }

    const parsedMeta = parseHtmlMetadata(note.content);
    return {
      version: 1,
      title: parsedMeta.meta.title || note.name || 'Untitled',
      snapshot: null,
      createdAt: parsedMeta.meta.created || new Date().toISOString(),
      modifiedAt: parsedMeta.meta.modified || new Date().toISOString()
    };
  }

  /**
   * Save a Draw document to a file path.
   */
  public async saveDrawFile(path: string, doc: DrawDocument): Promise<void> {
    await this.ensureDrawFolder();
    
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="title" content="${doc.title}">
  <meta name="created" content="${doc.createdAt}">
  <meta name="modified" content="${doc.modifiedAt}">
</head>
<body>
  <script type="application/json" id="draw-session-data">
${JSON.stringify(doc, null, 2)}
  </script>
</body>
</html>`;

    await appState.saveNote(path, htmlContent);
  }

  /**
   * Create a new Draw file.
   */
  public async createDrawFile(title: string = 'Whiteboard'): Promise<string> {
    await this.ensureDrawFolder();
    const timestamp = Date.now();
    const path = `Draw/${timestamp}.draw`;
    
    const doc: DrawDocument = {
      version: 1,
      title,
      snapshot: null,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    };

    await this.saveDrawFile(path, doc);
    return path;
  }

  /**
   * Rename a Draw file.
   */
  public async renameDrawFile(path: string, newTitle: string): Promise<string> {
    const doc = this.loadDrawFile(path);
    doc.title = newTitle;
    doc.modifiedAt = new Date().toISOString();
    await this.saveDrawFile(path, doc);
    return path;
  }

  /**
   * Delete a Draw file.
   */
  public async deleteDrawFile(path: string): Promise<void> {
    await appState.deleteNote(path);
  }
}

export const DrawFileManager = new DrawFileManagerClass();
