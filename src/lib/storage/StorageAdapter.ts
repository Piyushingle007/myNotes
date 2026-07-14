export interface NoteFile {
  path: string;       // relative path e.g. "Work/Project A.md" or "Daily Notes/2026-06-08.md"
  name: string;       // filename without extension e.g. "Project A"
  content: string;
  modified: number;
  created: number;
}

export interface StorageAdapter {
  selectDirectory(): Promise<string>; // Returns the name of the active vault/folder
  listNotes(): Promise<NoteFile[]>;
  writeNote(path: string, content: string): Promise<void>;
  deleteNote(path: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  readBlob?(path: string): Promise<Blob>;
  writeBlob?(path: string, blob: Blob): Promise<void>;
  migrateNotes?(convertFn: (md: string) => string): Promise<void>;
}

// ----------------------------------------------------
// 1. IndexedDB Sandbox Adapter (Fallback / Sandbox mode)
// ----------------------------------------------------
export class IndexedDBAdapter implements StorageAdapter {
  private dbName = 'myNotesSandbox';
  private storeName = 'notes';
  private db: IDBDatabase | null = null;
  private selectedFolder: string = 'Local Sandbox';

  async selectDirectory(): Promise<string> {
    await this.ensureDb();
    return this.selectedFolder;
  }

  private ensureDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);
      const request = indexedDB.open(this.dbName, 2);
      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'path' });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async listNotes(): Promise<NoteFile[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async writeNote(path: string, content: string): Promise<void> {
    const db = await this.ensureDb();
    const notes = await this.listNotes();
    const existing = notes.find(n => n.path === path);
    const now = Date.now();
    const note: NoteFile = {
      path,
      name: path.split('/').pop()?.replace(/\.(md|html|notebook\.json)$/, '') || 'Untitled',
      content,
      modified: now,
      created: existing ? existing.created : now
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(note);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNote(path: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(path);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const notes = await this.listNotes();
    const existing = notes.find(n => n.path === oldPath);
    if (!existing) return;
    await this.deleteNote(oldPath);
    await this.writeNote(newPath, existing.content);
  }

  async createDirectory(path: string): Promise<void> {
    // IndexedDB uses flat keys with slashes. Creating a directory is a no-op 
    // until a file is added under it.
  }

  async deleteDirectory(path: string): Promise<void> {
    const db = await this.ensureDb();
    const notes = await this.listNotes();
    const prefix = path.endsWith('/') ? path : path + '/';
    const notesToDelete = notes.filter(n => n.path.startsWith(prefix));

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      let count = notesToDelete.length;
      if (count === 0) return resolve();

      for (const n of notesToDelete) {
        const request = store.delete(n.path);
        request.onsuccess = () => {
          count--;
          if (count === 0) resolve();
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  async readBlob(path: string): Promise<Blob> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('attachments', 'readonly');
      const store = transaction.objectStore('attachments');
      const request = store.get(path);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.blob);
        } else {
          reject(new Error('Attachment not found: ' + path));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('attachments', 'readwrite');
      const store = transaction.objectStore('attachments');
      const request = store.put({ path, blob });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async migrateNotes(convertFn: (md: string) => string): Promise<void> {
    const db = await this.ensureDb();
    const notesList: NoteFile[] = await new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const mdNotes = notesList.filter(n => n.path.endsWith('.md'));
    if (mdNotes.length === 0) return;

    const transaction = db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);

    for (const note of mdNotes) {
      const htmlContent = convertFn(note.content);
      const htmlPath = note.path.replace(/\.md$/, '.html');
      const now = Date.now();
      const newNote: NoteFile = {
        path: htmlPath,
        name: htmlPath.split('/').pop()?.replace(/\.html$/, '') || 'Untitled',
        content: htmlContent,
        modified: now,
        created: note.created
      };
      
      store.put(newNote);
      store.delete(note.path);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

// ----------------------------------------------------
// 2. Native File System Access API Adapter
// ----------------------------------------------------
export class FileSystemAccessAdapter implements StorageAdapter {
  private dirHandle: FileSystemDirectoryHandle | null = null;

  constructor(dirHandle?: FileSystemDirectoryHandle) {
    if (dirHandle) this.dirHandle = dirHandle;
  }

  async selectDirectory(): Promise<string> {
    try {
      // @ts-ignore (FileSystemAccess types can be missing)
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      this.dirHandle = handle;
      return handle.name;
    } catch (e) {
      console.warn('Directory picker cancelled or unsupported, falling back to IndexedDB', e);
      throw e;
    }
  }

  async listNotes(): Promise<NoteFile[]> {
    if (!this.dirHandle) throw new Error('No directory selected');
    
    // Verify permissions
    const permission = await (this.dirHandle as any).queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      const request = await (this.dirHandle as any).requestPermission({ mode: 'readwrite' });
      if (request !== 'granted') throw new Error('Permission denied');
    }

    const files: NoteFile[] = [];
    await this.scanDirRecursive(this.dirHandle, '', files);
    return files;
  }

  private async scanDirRecursive(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string,
    results: NoteFile[]
  ): Promise<void> {
    // @ts-ignore
    for await (const entry of dirHandle.values()) {
      const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file' && (entry.name.endsWith('.html') || entry.name.endsWith('.notebook.json'))) {
        const file = await entry.getFile();
        const content = await file.text();
        const isNotebook = entry.name.endsWith('.notebook.json');
        results.push({
          path: relativePath,
          name: isNotebook ? entry.name.replace(/\.notebook\.json$/, '') : entry.name.replace(/\.html$/, ''),
          content,
          modified: file.lastModified,
          created: file.lastModified // File System Access API does not expose file creation date easily
        });
      } else if (entry.kind === 'directory') {
        // Skip hidden folders like .git
        if (entry.name.startsWith('.')) continue;
        await this.scanDirRecursive(entry, relativePath, results);
      }
    }
  }

  private async getHandleForPath(
    path: string,
    options: { create?: boolean } = {}
  ): Promise<{ parentDir: FileSystemDirectoryHandle; filename: string }> {
    if (!this.dirHandle) throw new Error('No directory selected');
    const parts = path.split('/');
    const filename = parts.pop() || '';
    let currentDir = this.dirHandle;

    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: options.create });
    }

    return { parentDir: currentDir, filename };
  }

  async writeNote(path: string, content: string): Promise<void> {
    const { parentDir, filename } = await this.getHandleForPath(path, { create: true });
    const fileHandle = await parentDir.getFileHandle(filename, { create: true });
    // @ts-ignore
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async deleteNote(path: string): Promise<void> {
    const { parentDir, filename } = await this.getHandleForPath(path);
    await parentDir.removeEntry(filename);
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const { parentDir: oldParent, filename: oldFilename } = await this.getHandleForPath(oldPath);
    const fileHandle = await oldParent.getFileHandle(oldFilename);
    const file = await fileHandle.getFile();
    const content = await file.text();

    await this.writeNote(newPath, content);
    await oldParent.removeEntry(oldFilename);
  }

  async createDirectory(path: string): Promise<void> {
    if (!this.dirHandle) throw new Error('No directory selected');
    const parts = path.split('/');
    let currentDir = this.dirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
  }

  async deleteDirectory(path: string): Promise<void> {
    if (!this.dirHandle) throw new Error('No directory selected');
    const parts = path.split('/');
    const dirToDeleteName = parts.pop() || '';
    let currentDir = this.dirHandle;

    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part);
    }
    await currentDir.removeEntry(dirToDeleteName, { recursive: true });
  }

  async readBlob(path: string): Promise<Blob> {
    const { parentDir, filename } = await this.getHandleForPath(path);
    const fileHandle = await parentDir.getFileHandle(filename);
    return await fileHandle.getFile();
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const { parentDir, filename } = await this.getHandleForPath(path, { create: true });
    const fileHandle = await parentDir.getFileHandle(filename, { create: true });
    // @ts-ignore
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async migrateNotes(convertFn: (md: string) => string): Promise<void> {
    if (!this.dirHandle) return;
    await this.migrateRecursive(this.dirHandle, '', convertFn);
  }

  private async migrateRecursive(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string,
    convertFn: (md: string) => string
  ): Promise<void> {
    // @ts-ignore
    for await (const entry of dirHandle.values()) {
      const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        try {
          const file = await entry.getFile();
          const mdContent = await file.text();
          const htmlContent = convertFn(mdContent);
          
          const htmlPath = relativePath.replace(/\.md$/, '.html');
          const { parentDir, filename } = await this.getHandleForPath(htmlPath, { create: true });
          const fileHandle = await parentDir.getFileHandle(filename, { create: true });
          // @ts-ignore
          const writable = await fileHandle.createWritable();
          await writable.write(htmlContent);
          await writable.close();
          
          const { parentDir: oldParent, filename: oldFilename } = await this.getHandleForPath(relativePath);
          await oldParent.removeEntry(oldFilename);
        } catch (err) {
          console.error('Failed to migrate markdown file:', relativePath, err);
        }
      } else if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue;
        await this.migrateRecursive(entry, relativePath, convertFn);
      }
    }
  }
}
