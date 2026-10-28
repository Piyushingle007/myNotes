import type { EpubBook } from '../types';

export class EpubLibraryStore {
  private dbName: string;
  private db: IDBDatabase | null = null;
  private readonly storeName = 'epub_library';

  constructor(vaultName: string = 'default') {
    this.dbName = `myNotesEpub_${encodeURIComponent(vaultName || 'default')}`;
  }

  private ensureDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);

      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'bookId' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('addedAt', 'addedAt', { unique: false });
          store.createIndex('filePath', 'filePath', { unique: false });
        }
        if (!db.objectStoreNames.contains('reading_progress')) {
          const progressStore = db.createObjectStore('reading_progress', { keyPath: 'bookId' });
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

  async getAllBooks(): Promise<EpubBook[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getBook(bookId: string): Promise<EpubBook | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(bookId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async hasBook(bookId: string): Promise<boolean> {
    const book = await this.getBook(bookId);
    return book !== null;
  }

  async findBookByPath(filePath: string): Promise<EpubBook | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('filePath');
      const request = index.get(filePath);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async upsertBook(book: EpubBook): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      // Strip transient in-memory URLs before storing
      const { coverUrl, ...persistentBook } = book;
      const request = store.put(persistentBook);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updateLocations(bookId: string, locationsData: string, version: number): Promise<void> {
    const book = await this.getBook(bookId);
    if (!book) return;
    book.locationsData = locationsData;
    book.locationsVersion = version;
    await this.upsertBook(book);
  }

  async updateStatus(bookId: string, status: EpubBook['status']): Promise<void> {
    const book = await this.getBook(bookId);
    if (!book) return;
    book.status = status;
    await this.upsertBook(book);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
