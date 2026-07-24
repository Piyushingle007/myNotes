import type { StorageAdapter, NoteFile } from './StorageAdapter';

export class TauriFSAdapter implements StorageAdapter {
  private rootPath: string = '';
  private vaultName: string = 'MyNotes';

  constructor(defaultPath?: string) {
    if (defaultPath) {
      this.rootPath = defaultPath;
      this.vaultName = defaultPath.split('/').filter(Boolean).pop() || 'MyNotes';
    }
  }

  async selectDirectory(): Promise<string> {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const selected = await dialog.open({
        directory: true,
        multiple: false,
        title: 'Select Vault Directory'
      });

      if (!selected) {
        throw new Error('No directory selected');
      }

      this.rootPath = Array.isArray(selected) ? selected[0] : selected;
      this.vaultName = this.rootPath.split('/').filter(Boolean).pop() || 'Vault';
      return this.vaultName;
    } catch (err) {
      console.warn('Tauri dialog.open failed or fallback:', err);
      return this.vaultName;
    }
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async listNotes(): Promise<NoteFile[]> {
    if (!this.rootPath) return [];
    const fs = await import('@tauri-apps/plugin-fs');
    const notes: NoteFile[] = [];

    const readRecursive = async (dirPath: string, relativePrefix: string = '') => {
      try {
        const entries = await fs.readDir(dirPath);
        for (const entry of entries) {
          const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
          const fullPath = `${dirPath}/${entry.name}`;

          if (entry.isDirectory) {
            await readRecursive(fullPath, relPath);
          } else if (entry.isFile && (entry.name.endsWith('.md') || entry.name.endsWith('.html') || entry.name.endsWith('.notebook.json'))) {
            try {
              const content = await fs.readTextFile(fullPath);
              const stat = await fs.stat(fullPath);
              const nameWithoutExt = entry.name.replace(/\.(md|html|notebook\.json)$/, '');

              notes.push({
                path: relPath,
                name: nameWithoutExt,
                content,
                modified: stat.mtime ? new Date(stat.mtime).getTime() : Date.now(),
                created: stat.birthtime ? new Date(stat.birthtime).getTime() : Date.now()
              });
            } catch (readErr) {
              console.error(`Failed to read file ${fullPath}`, readErr);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to read dir ${dirPath}`, err);
      }
    };

    await readRecursive(this.rootPath);
    return notes;
  }

  async writeNote(path: string, content: string): Promise<void> {
    if (!this.rootPath) return;
    const fs = await import('@tauri-apps/plugin-fs');
    const fullPath = `${this.rootPath}/${path}`;
    
    // Ensure parent directory exists
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      const parentDir = fullPath.substring(0, lastSlash);
      const parentExists = await fs.exists(parentDir);
      if (!parentExists) {
        await fs.mkdir(parentDir, { recursive: true });
      }
    }

    await fs.writeTextFile(fullPath, content);
  }

  async deleteNote(path: string): Promise<void> {
    if (!this.rootPath) return;
    const fs = await import('@tauri-apps/plugin-fs');
    const fullPath = `${this.rootPath}/${path}`;
    if (await fs.exists(fullPath)) {
      await fs.remove(fullPath);
    }
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    if (!this.rootPath) return;
    const fs = await import('@tauri-apps/plugin-fs');
    const oldFullPath = `${this.rootPath}/${oldPath}`;
    const newFullPath = `${this.rootPath}/${newPath}`;
    
    if (await fs.exists(oldFullPath)) {
      const content = await fs.readTextFile(oldFullPath);
      await this.writeNote(newPath, content);
      await fs.remove(oldFullPath);
    }
  }

  async createDirectory(path: string): Promise<void> {
    if (!this.rootPath) return;
    const fs = await import('@tauri-apps/plugin-fs');
    const fullPath = `${this.rootPath}/${path}`;
    if (!(await fs.exists(fullPath))) {
      await fs.mkdir(fullPath, { recursive: true });
    }
  }

  async deleteDirectory(path: string): Promise<void> {
    if (!this.rootPath) return;
    const fs = await import('@tauri-apps/plugin-fs');
    const fullPath = `${this.rootPath}/${path}`;
    if (await fs.exists(fullPath)) {
      await fs.remove(fullPath, { recursive: true });
    }
  }

  async readBlob(path: string): Promise<Blob> {
    if (!this.rootPath) throw new Error('No vault directory selected');
    const fs = await import('@tauri-apps/plugin-fs');
    const fullPath = `${this.rootPath}/${path}`;
    const bytes = await fs.readFile(fullPath);
    return new Blob([bytes]);
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    if (!this.rootPath) return;
    const fs = await import('@tauri-apps/plugin-fs');
    const fullPath = `${this.rootPath}/${path}`;
    
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      const parentDir = fullPath.substring(0, lastSlash);
      if (!(await fs.exists(parentDir))) {
        await fs.mkdir(parentDir, { recursive: true });
      }
    }

    const arrayBuffer = await blob.arrayBuffer();
    await fs.writeFile(fullPath, new Uint8Array(arrayBuffer));
  }
}
