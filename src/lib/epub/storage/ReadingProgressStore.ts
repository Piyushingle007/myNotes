import type { ReadingProgress } from '../types';

export class ReadingProgressStore {
  private dbName: string;
  private db: IDBDatabase | null = null;
  private readonly storeName = 'reading_progress';

  constructor(vaultName: string = 'default') {
    this.dbName = `myNotesEpub_${encodeURIComponent(vaultName || 'default')}`;
  }

  private ensureDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);

      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains('epub_library')) {
          const store = db.createObjectStore('epub_library', { keyPath: 'bookId' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('addedAt', 'addedAt', { unique: false });
          store.createIndex('filePath', 'filePath', { unique: false });
        }
        if (!db.objectStoreNames.contains(this.storeName)) {
          const progressStore = db.createObjectStore(this.storeName, { keyPath: 'bookId' });
          progressStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          progressStore.createIndex('lastReadAt', 'lastReadAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  private getLocalKey(bookId: string): string {
    return `mynotes_epub_prog_${this.dbName}_${bookId}`;
  }

  private readFromLocalStorage(bookId: string): ReadingProgress | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(this.getLocalKey(bookId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeToLocalStorage(progress: ReadingProgress): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.getLocalKey(progress.bookId), JSON.stringify(progress));
    } catch {
      // Ignore quota exceeded
    }
  }

  private removeFromLocalStorage(bookId: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(this.getLocalKey(bookId));
    } catch {}
  }

  async getProgress(bookId: string): Promise<ReadingProgress | null> {
    const cached = this.readFromLocalStorage(bookId);
    try {
      const db = await this.ensureDb();
      const idbResult = await new Promise<ReadingProgress | null>((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(bookId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });

      if (!cached) return idbResult;
      if (!idbResult) return cached;
      // Return whichever has newer updatedAt
      return (cached.updatedAt || 0) >= (idbResult.updatedAt || 0) ? cached : idbResult;
    } catch (err) {
      console.warn('[ReadingProgressStore] Falling back to localStorage progress cache:', err);
      return cached;
    }
  }

  async saveProgress(progress: ReadingProgress): Promise<void> {
    // 1. Immediately cache in localStorage synchronously so data cannot be lost on navigation
    this.writeToLocalStorage(progress);

    // 2. Persist in IndexedDB
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(progress);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllProgress(): Promise<Record<string, ReadingProgress>> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        const list: ReadingProgress[] = request.result || [];
        const map: Record<string, ReadingProgress> = {};
        for (const item of list) {
          map[item.bookId] = item;
        }

        // Overlay with localStorage in case newer writes haven't flushed
        if (typeof localStorage !== 'undefined') {
          try {
            const prefix = `mynotes_epub_prog_${this.dbName}_`;
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(prefix)) {
                const bookId = k.slice(prefix.length);
                const cached = this.readFromLocalStorage(bookId);
                if (cached && (!map[bookId] || (cached.updatedAt || 0) > (map[bookId].updatedAt || 0))) {
                  map[bookId] = cached;
                }
              }
            }
          } catch {}
        }

        resolve(map);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteProgress(bookId: string): Promise<void> {
    this.removeFromLocalStorage(bookId);
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async markFinished(bookId: string): Promise<void> {
    const current = await this.getProgress(bookId);
    const now = Date.now();
    if (current) {
      current.finishedAt = now;
      current.percentage = 1.0;
      current.updatedAt = now;
      await this.saveProgress(current);
    } else {
      await this.saveProgress({
        bookId,
        cfi: null,
        percentage: 1.0,
        chapterHref: '',
        chapterTitle: '',
        lastReadAt: now,
        firstOpenedAt: now,
        finishedAt: now,
        totalActiveSeconds: 0,
        engineVersion: '1.0.0',
        locationsVersion: 1,
        updatedAt: now,
        recentPagesPerMinute: 1.0,
        avgWordsPerPage: 250
      });
    }
  }

  async markUnread(bookId: string): Promise<void> {
    const current = await this.getProgress(bookId);
    const now = Date.now();
    if (current) {
      current.finishedAt = null;
      current.percentage = 0.0;
      current.cfi = null;
      current.updatedAt = now;
      await this.saveProgress(current);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
