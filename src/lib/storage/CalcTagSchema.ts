export interface CalcTag {
  id: string;            // unique identifier (UUID or slug)
  name: string;          // tag display name (e.g. "Food")
  normalizedName: string; // lowercase name (e.g. "food") for unique constraint
  enabled: boolean;      // whether the tag is currently active/disabled globally
  createdAt: number;     // timestamp
  color?: string;        // optional hex color code (e.g. "#ef4444")
}

export class CalcTagDatabase {
  private dbName: string;
  private db: IDBDatabase | null = null;

  constructor(vaultName: string) {
    this.dbName = `myNotesMetadata_${encodeURIComponent(vaultName || 'default')}`;
  }

  private ensureDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);
      
      const request = indexedDB.open(this.dbName, 2); // DB Version 2

      request.onupgradeneeded = (e) => {
        const db = request.result;
        
        // 1. Create tags store
        if (!db.objectStoreNames.contains('tags')) {
          const tagStore = db.createObjectStore('tags', { keyPath: 'id' });
          tagStore.createIndex('normalizedName', 'normalizedName', { unique: true });
        }
        
        // 2. Create note-tag relations store
        if (!db.objectStoreNames.contains('note_tags')) {
          const relationStore = db.createObjectStore('note_tags', { keyPath: ['notePath', 'tagId'] });
          relationStore.createIndex('notePath', 'notePath', { unique: false });
          relationStore.createIndex('tagId', 'tagId', { unique: false });
        }

        // 3. Create calc_tags store
        if (!db.objectStoreNames.contains('calc_tags')) {
          const calcTagStore = db.createObjectStore('calc_tags', { keyPath: 'id' });
          calcTagStore.createIndex('normalizedName', 'normalizedName', { unique: true });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Add a new calculation tag. Prevents case-insensitive duplicates.
   */
  async addCalcTag(name: string, color?: string): Promise<CalcTag> {
    const db = await this.ensureDb();
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Category name cannot be empty');
    
    const normalizedName = cleanName.toLowerCase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readwrite');
      const store = transaction.objectStore('calc_tags');
      
      const tag: CalcTag = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        name: cleanName,
        normalizedName,
        enabled: true,
        createdAt: Date.now(),
        color
      };

      const request = store.add(tag);

      request.onsuccess = () => resolve(tag);
      
      request.onerror = () => {
        if (request.error?.name === 'ConstraintError') {
          // Find the existing tag by normalizedName
          const readTx = db.transaction('calc_tags', 'readonly');
          const readStore = readTx.objectStore('calc_tags');
          const index = readStore.index('normalizedName');
          const getReq = index.get(normalizedName);
          
          getReq.onsuccess = () => {
            if (getReq.result) {
              resolve(getReq.result);
            } else {
              reject(new Error('Constraint error on calc_tags but failed to retrieve existing category'));
            }
          };
          getReq.onerror = () => reject(getReq.error);
        } else {
          reject(request.error || new Error('Failed to add category'));
        }
      };
    });
  }

  /**
   * List all calculation tags
   */
  async listCalcTags(): Promise<CalcTag[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readonly');
      const store = transaction.objectStore('calc_tags');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a calculation tag globally
   */
  async deleteCalcTag(tagId: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readwrite');
      const store = transaction.objectStore('calc_tags');
      const request = store.delete(tagId);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Rename a calculation tag
   */
  async renameCalcTag(tagId: string, newName: string): Promise<void> {
    const db = await this.ensureDb();
    const cleanName = newName.trim();
    if (!cleanName) throw new Error('Category name cannot be empty');
    
    const normalizedName = cleanName.toLowerCase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readwrite');
      const store = transaction.objectStore('calc_tags');
      
      const getReq = store.get(tagId);
      
      getReq.onsuccess = () => {
        const tag = getReq.result as CalcTag;
        if (!tag) {
          reject(new Error(`Category with ID ${tagId} not found`));
          return;
        }
        
        tag.name = cleanName;
        tag.normalizedName = normalizedName;
        
        const putReq = store.put(tag);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Toggle enabled state of a tag
   */
  async setTagEnabled(tagId: string, enabled: boolean): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readwrite');
      const store = transaction.objectStore('calc_tags');
      
      const getReq = store.get(tagId);
      getReq.onsuccess = () => {
        const tag = getReq.result as CalcTag;
        if (!tag) {
          reject(new Error(`Category with ID ${tagId} not found`));
          return;
        }
        
        tag.enabled = enabled;
        const putReq = store.put(tag);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Change color of a tag
   */
  async setTagColor(tagId: string, color: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readwrite');
      const store = transaction.objectStore('calc_tags');
      
      const getReq = store.get(tagId);
      getReq.onsuccess = () => {
        const tag = getReq.result as CalcTag;
        if (!tag) {
          reject(new Error(`Category with ID ${tagId} not found`));
          return;
        }
        
        tag.color = color;
        const putReq = store.put(tag);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Upsert a calculation tag directly (used for cross-device metadata synchronization)
   */
  async upsertCalcTag(tag: CalcTag): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('calc_tags', 'readwrite');
      const store = transaction.objectStore('calc_tags');
      const request = store.put(tag);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

