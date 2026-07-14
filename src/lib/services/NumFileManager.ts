import { appState, generateHtmlNote, parseHtmlMetadata } from '../stores/appState.svelte';
import type { NumDocument, NumLine } from './NumbatEngine';

export class NumFileManagerClass {
  /**
   * Ensure that the "Num" folder directory exists in the storage.
   */
  public async ensureNumFolder(): Promise<void> {
    try {
      await appState.storage.createDirectory('Num');
    } catch (e) {
      console.warn('Failed to create Num directory (might already exist or unsupported by storage):', e);
    }
  }

  /**
   * List all Num files in the storage.
   * Scans `appState.notes` for paths starting with 'Num/'.
   */
  public listNumFiles(): { path: string; name: string; created: number; modified: number }[] {
    return appState.notes
      .filter(note => note.path.startsWith('Num/'))
      .map(note => ({
        path: note.path,
        name: note.name,
        created: note.created,
        modified: note.modified
      }))
      .sort((a, b) => b.modified - a.modified); // Sort by most recently modified
  }

  /**
   * Load and parse a Num document from a file path.
   */
  /**
   * Load and parse a Num document from a file path.
   * Automatically migrates legacy version 1 documents (lines array) to version 2 (text string).
   */
  public loadNumFile(path: string): NumDocument {
    const note = appState.notes.find(n => n.path === path);
    if (!note) {
      throw new Error(`File not found: ${path}`);
    }

    try {
      let parsed: any = null;
      
      // Parse HTML to extract JSON from <script id="num-session-data">
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(note.content, 'text/html');
        const scriptEl = doc.getElementById('num-session-data');
        if (scriptEl && scriptEl.textContent) {
          parsed = JSON.parse(scriptEl.textContent);
        }
      } else {
        // Fallback using Regex
        const scriptMatch = note.content.match(/<script\s+type="application\/json"\s+id="num-session-data">([\s\S]*?)<\/script>/i);
        if (scriptMatch && scriptMatch[1]) {
          parsed = JSON.parse(scriptMatch[1].trim());
        }
      }

      if (parsed) {
        if (parsed.version === 2) {
          return parsed as NumDocument;
        }
        
        // Auto-migration from version 1 (lines array) to version 2 (text document)
        if (parsed.version === 1 && Array.isArray(parsed.lines)) {
          const migratedText = parsed.lines.map((l: any) => l.input).join('\n');
          return {
            version: 2,
            title: parsed.title || note.name || 'Untitled',
            text: migratedText,
            createdAt: parsed.createdAt || new Date(note.created || Date.now()).toISOString(),
            modifiedAt: parsed.modifiedAt || new Date(note.modified || Date.now()).toISOString()
          };
        }
      }
    } catch (e) {
      console.error('Failed to parse Num session data script tag:', e);
    }

    // If script parse fails or does not exist, try to reconstruct from HTML metadata
    const parsedMeta = parseHtmlMetadata(note.content);
    return {
      version: 2,
      title: parsedMeta.meta.title || note.name || 'Untitled',
      text: '',
      createdAt: parsedMeta.meta.created || new Date().toISOString(),
      modifiedAt: parsedMeta.meta.modified || new Date().toISOString()
    };
  }

  /**
   * Save a Num document to a file path.
   */
  public async saveNumFile(path: string, doc: NumDocument): Promise<void> {
    await this.ensureNumFolder();

    // 1. Generate static HTML preview representation for bodyContent
    let bodyContent = `<div class="num-document-container">\n`;
    bodyContent += `  <pre class="num-source-preview">${this.escapeHtml(doc.text)}</pre>\n`;
    bodyContent += `</div>\n`;

    // 2. Append serialized JSON script tag for state reconstruction
    const jsonStr = JSON.stringify(doc);
    bodyContent += `<script type="application/json" id="num-session-data">\n${jsonStr}\n</script>`;

    // 3. Construct note metadata
    const isoNow = new Date().toISOString();
    const meta = {
      id: path,
      title: doc.title,
      tags: ['num'],
      pinned: false,
      created: doc.createdAt || isoNow,
      modified: isoNow
    };

    // 4. Generate final HTML content and write to storage
    const htmlContent = generateHtmlNote(meta, bodyContent);
    await appState.storage.writeNote(path, htmlContent);

    // Update the local in-memory notes array directly so it refreshes instantly
    const idx = appState.notes.findIndex(n => n.path === path);
    const name = doc.title;
    const timestamp = Date.now();
    if (idx !== -1) {
      appState.notes[idx].content = htmlContent;
      appState.notes[idx].name = name;
      appState.notes[idx].modified = timestamp;
    } else {
      appState.notes.push({
        path,
        name,
        content: htmlContent,
        created: timestamp,
        modified: timestamp
      });
    }

    // Refresh search index and reload list in background
    await appState.refreshNotes();

    // Trigger sync in background if enabled
    if (appState.syncEnabled && appState.googleConnected) {
      appState.syncNotes();
    }
  }

  /**
   * Create a new Num file with a unique name in the 'Num/' folder.
   */
  public async createNumFile(title: string): Promise<string> {
    await this.ensureNumFolder();
    
    let cleanTitle = title.trim();
    if (!cleanTitle) {
      cleanTitle = 'Untitled Calc';
    }

    // De-duplicate title/filename
    let finalTitle = cleanTitle;
    let path = `Num/${finalTitle}.html`;
    let count = 1;
    while (appState.notes.some(n => n.path === path)) {
      finalTitle = `${cleanTitle} ${count}`;
      path = `Num/${finalTitle}.html`;
      count++;
    }

    const isoNow = new Date().toISOString();
    const doc: NumDocument = {
      version: 2,
      title: finalTitle,
      text: '',
      createdAt: isoNow,
      modifiedAt: isoNow
    };

    await this.saveNumFile(path, doc);
    return path;
  }

  /**
   * Delete a Num file.
   */
  public async deleteNumFile(path: string): Promise<void> {
    try {
      await appState.storage.deleteNote(path);
      appState.notes = appState.notes.filter(n => n.path !== path);
      await appState.refreshNotes();
      
      // Trigger sync in background
      if (appState.syncEnabled && appState.googleConnected) {
        appState.syncNotes();
      }
    } catch (e) {
      console.error(`Failed to delete Num file: ${path}`, e);
      throw e;
    }
  }

  /**
   * Rename a Num file, updating its internal title and updating the filename.
   */
  public async renameNumFile(oldPath: string, newTitle: string): Promise<string> {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return oldPath;

    // Check suffix/extensions and directories
    const parts = oldPath.split('/');
    parts[parts.length - 1] = `${cleanTitle}.html`;
    const newPath = parts.join('/');

    if (newPath === oldPath) return oldPath;

    // Verify it doesn't collide
    if (appState.notes.some(n => n.path === newPath)) {
      appState.showToast('A calculation file with this name already exists.', 'warning', 4000);
      throw new Error('File name already exists');
    }

    try {
      // 1. Load document
      const doc = this.loadNumFile(oldPath);
      doc.title = cleanTitle;
      doc.modifiedAt = new Date().toISOString();

      // 2. Save document to the old path first (to update internal title)
      await this.saveNumFile(oldPath, doc);

      // 3. Use storage rename
      await appState.storage.renameNote(oldPath, newPath);

      // 4. Update in-memory appState.notes array
      const idx = appState.notes.findIndex(n => n.path === oldPath);
      if (idx !== -1) {
        appState.notes[idx].path = newPath;
        appState.notes[idx].name = cleanTitle;
        // Re-read content and update meta
        const note = appState.notes[idx];
        const parsed = parseHtmlMetadata(note.content);
        parsed.meta.title = cleanTitle;
        parsed.meta.id = newPath;
        note.content = generateHtmlNote(parsed.meta, parsed.content);
      }

      await appState.refreshNotes();

      // Trigger sync
      if (appState.syncEnabled && appState.googleConnected) {
        appState.syncNotes();
      }

      return newPath;
    } catch (e) {
      console.error(`Failed to rename Num file from ${oldPath} to ${newPath}:`, e);
      appState.showToast('Failed to rename calculation file.', 'error', 4000);
      throw e;
    }
  }

  /**
   * Escape HTML utility.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const NumFileManager = new NumFileManagerClass();
