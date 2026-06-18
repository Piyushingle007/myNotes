export interface Tag {
  id: string;            // unique identifier (UUID or slug)
  name: string;          // tag display name (e.g. "Work")
  normalizedName: string; // lowercase name (e.g. "work") for unique constraint
  createdAt: number;     // timestamp
  color?: string;        // optional hex color code (e.g. "#ef4444")
}

export interface NoteTagRelation {
  notePath: string;      // note path/Id, e.g. "Notebook/Note.html"
  tagId: string;         // associated tag's id
}

export class TagDatabase {
  private dbName: string;
  private db: IDBDatabase | null = null;

  constructor(vaultName: string) {
    this.dbName = `myNotesMetadata_${encodeURIComponent(vaultName || 'default')}`;
  }

  private ensureDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);
      
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (e) => {
        const db = request.result;
        
        // 1. Create tags store
        if (!db.objectStoreNames.contains('tags')) {
          const tagStore = db.createObjectStore('tags', { keyPath: 'id' });
          // Unique index on normalized name to prevent duplicates (case-insensitive)
          tagStore.createIndex('normalizedName', 'normalizedName', { unique: true });
        }
        
        // 2. Create note-tag relations store
        if (!db.objectStoreNames.contains('note_tags')) {
          const relationStore = db.createObjectStore('note_tags', { keyPath: ['notePath', 'tagId'] });
          relationStore.createIndex('notePath', 'notePath', { unique: false });
          relationStore.createIndex('tagId', 'tagId', { unique: false });
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
   * Add a new tag. Prevents case-insensitive duplicates.
   */
  async addTag(name: string): Promise<Tag> {
    const db = await this.ensureDb();
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Tag name cannot be empty');
    
    const normalizedName = cleanName.toLowerCase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tags', 'readwrite');
      const store = transaction.objectStore('tags');
      
      const tag: Tag = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        name: cleanName,
        normalizedName,
        createdAt: Date.now()
      };

      const request = store.add(tag);

      request.onsuccess = () => resolve(tag);
      
      request.onerror = (e) => {
        // If it's a constraint error (duplicate normalizedName), retrieve the existing tag
        if (request.error?.name === 'ConstraintError') {
          // Find the existing tag by normalizedName
          const readTx = db.transaction('tags', 'readonly');
          const readStore = readTx.objectStore('tags');
          const index = readStore.index('normalizedName');
          const getReq = index.get(normalizedName);
          
          getReq.onsuccess = () => {
            if (getReq.result) {
              resolve(getReq.result);
            } else {
              reject(new Error('Constraint error on tags but failed to retrieve existing tag'));
            }
          };
          getReq.onerror = () => reject(getReq.error);
        } else {
          reject(request.error || new Error('Failed to add tag'));
        }
      };
    });
  }

  /**
   * Retrieve a tag by its ID
   */
  async getTag(tagId: string): Promise<Tag | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tags', 'readonly');
      const store = transaction.objectStore('tags');
      const request = store.get(tagId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * List all global tags
   */
  async listTags(): Promise<Tag[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tags', 'readonly');
      const store = transaction.objectStore('tags');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a tag globally
   */
  async deleteTag(tagId: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tags', 'note_tags'], 'readwrite');
      const tagsStore = transaction.objectStore('tags');
      const relationsStore = transaction.objectStore('note_tags');
      
      // Delete the tag itself
      tagsStore.delete(tagId);
      
      // Delete all relations with this tagId
      const tagIndex = relationsStore.index('tagId');
      const request = tagIndex.openCursor(IDBKeyRange.only(tagId));
      
      request.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Associate a note with a tag
   */
  async addRelation(notePath: string, tagId: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('note_tags', 'readwrite');
      const store = transaction.objectStore('note_tags');
      
      const relation: NoteTagRelation = { notePath, tagId };
      const request = store.put(relation); // put overrides or adds uniquely
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove association between a note and a tag
   */
  async removeRelation(notePath: string, tagId: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('note_tags', 'readwrite');
      const store = transaction.objectStore('note_tags');
      const request = store.delete([notePath, tagId]);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all associated tag IDs for a note
   */
  async getTagsForNote(notePath: string): Promise<string[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('note_tags', 'readonly');
      const store = transaction.objectStore('note_tags');
      const index = store.index('notePath');
      const request = index.getAll(IDBKeyRange.only(notePath));
      
      request.onsuccess = () => {
        const relations = (request.result || []) as NoteTagRelation[];
        resolve(relations.map(r => r.tagId));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all note paths associated with a tag ID
   */
  async getNotesForTag(tagId: string): Promise<string[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('note_tags', 'readonly');
      const store = transaction.objectStore('note_tags');
      const index = store.index('tagId');
      const request = index.getAll(IDBKeyRange.only(tagId));
      
      request.onsuccess = () => {
        const relations = (request.result || []) as NoteTagRelation[];
        resolve(relations.map(r => r.notePath));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Prune any relation whose notePath is not in the activePaths set
   */
  async pruneZombieRelations(activePaths: Set<string>): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('note_tags', 'readwrite');
      const store = transaction.objectStore('note_tags');
      const request = store.openCursor();
      
      request.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          const relation = cursor.value as NoteTagRelation;
          if (!activePaths.has(relation.notePath)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Rename a tag inside the database, updating both display name and normalized name.
   */
  async renameTagInDb(tagId: string, newName: string): Promise<void> {
    const db = await this.ensureDb();
    const cleanName = newName.trim();
    if (!cleanName) throw new Error('Tag name cannot be empty');
    
    const normalizedName = cleanName.toLowerCase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tags', 'readwrite');
      const store = transaction.objectStore('tags');
      
      const getReq = store.get(tagId);
      
      getReq.onsuccess = () => {
        const tag = getReq.result as Tag;
        if (!tag) {
          reject(new Error(`Tag with ID ${tagId} not found`));
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
   * Update a tag's color. Pass null/undefined to remove custom color.
   */
  async updateTagColor(tagId: string, color: string | null): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tags', 'readwrite');
      const store = transaction.objectStore('tags');

      const getReq = store.get(tagId);

      getReq.onsuccess = () => {
        const tag = getReq.result as Tag;
        if (!tag) {
          reject(new Error(`Tag with ID ${tagId} not found`));
          return;
        }

        if (color) {
          tag.color = color;
        } else {
          delete tag.color;
        }

        const putReq = store.put(tag);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  }
}
