/**
 * FocusCardStore — IndexedDB persistence for Focus (swipe planner) cards.
 *
 * Completely standalone store, isolated from notes, tags, and calc-tags.
 * Database: `myNotesFocus_${vaultName}` (v1)
 * Object store: `focus_cards`
 *
 * Card lifecycle:  inbox → today → done → archived
 *                               ↘ skipped → (re-queued next day)
 */

// ─────────────────────── Types ───────────────────────

export type CardStatus = 'inbox' | 'today' | 'done' | 'skipped' | 'archived';
export type CardPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type CardEffort = 'trivial' | 'small' | 'medium' | 'large' | 'epic';

export interface FocusCard {
  id: string;
  title: string;
  description: string;
  status: CardStatus;
  priority: CardPriority;
  effort: CardEffort;
  tags: string[];             // free-form tag strings
  dueDate: string | null;     // ISO date string (YYYY-MM-DD) or null
  createdAt: number;          // epoch ms
  updatedAt: number;          // epoch ms
  completedAt: number | null; // epoch ms when marked done
  sortOrder: number;          // position within today's plan
  linkedNotePath: string | null; // optional link to an existing note
  color: string | null;       // optional accent color for the card
  recurrence: string | null;  // future: recurrence rule string
}

// ─────────────────── State machine ───────────────────

/** Valid transitions for the card state machine. */
const VALID_TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  inbox:    ['today', 'skipped', 'archived'],
  today:    ['done', 'skipped', 'archived', 'inbox'],
  done:     ['today', 'inbox', 'archived'],
  skipped:  ['today', 'inbox', 'archived'],
  archived: ['inbox'],
};

export function canTransition(from: CardStatus, to: CardStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─────────────────── Helpers ───────────────────

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function createBlankCard(overrides: Partial<FocusCard> = {}): FocusCard {
  const now = Date.now();
  return {
    id: generateId(),
    title: '',
    description: '',
    status: 'inbox',
    priority: 'none',
    effort: 'small',
    tags: [],
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sortOrder: 0,
    linkedNotePath: null,
    color: null,
    recurrence: null,
    ...overrides,
  };
}

/** Today's date as YYYY-MM-DD in local timezone. */
export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────── Database ───────────────────

const DB_VERSION = 1;
const STORE_NAME = 'focus_cards';

export class FocusCardStore {
  private dbName: string;
  private db: IDBDatabase | null = null;

  constructor(vaultName: string) {
    this.dbName = `myNotesFocus_${encodeURIComponent(vaultName || 'default')}`;
  }

  // ───────── Connection ─────────

  private ensureDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);

      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('dueDate', 'dueDate', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ───────── CRUD ─────────

  /** Add a new card. Returns the created card. */
  async addCard(card: FocusCard): Promise<FocusCard> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(card);
      request.onsuccess = () => resolve(card);
      request.onerror = () => reject(request.error);
    });
  }

  /** Get a single card by ID. */
  async getCard(id: string): Promise<FocusCard | undefined> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? undefined);
      request.onerror = () => reject(request.error);
    });
  }

  /** Update an existing card (full replace). */
  async updateCard(card: FocusCard): Promise<void> {
    const db = await this.ensureDb();
    card.updatedAt = Date.now();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(card);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Delete a card permanently. */
  async deleteCard(id: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** List all cards. */
  async listAll(): Promise<FocusCard[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /** List cards filtered by status. */
  async listByStatus(status: CardStatus): Promise<FocusCard[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('status');
      const request = index.getAll(status);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ───────── State transitions ─────────

  /** Transition a card to a new status, enforcing the state machine. */
  async transitionCard(id: string, newStatus: CardStatus): Promise<FocusCard> {
    const card = await this.getCard(id);
    if (!card) throw new Error(`Focus card ${id} not found`);
    if (!canTransition(card.status, newStatus)) {
      throw new Error(`Invalid transition: ${card.status} → ${newStatus}`);
    }
    card.status = newStatus;
    card.updatedAt = Date.now();
    if (newStatus === 'done') {
      card.completedAt = Date.now();
    }
    await this.updateCard(card);
    return card;
  }

  // ───────── Daily queue ─────────

  /**
   * Build today's queue: cards that are due today or earlier, plus all inbox
   * cards, plus previously-skipped cards that should be re-surfaced.
   * Sorted by priority (urgent first), then by sortOrder.
   */
  async buildDailyQueue(): Promise<FocusCard[]> {
    const all = await this.listAll();
    const today = todayDateString();

    const queue = all.filter((c) => {
      // Already done or archived — skip
      if (c.status === 'done' || c.status === 'archived') return false;
      // Cards explicitly marked for today
      if (c.status === 'today') return true;
      // Inbox cards (unprocessed)
      if (c.status === 'inbox') return true;
      // Skipped cards get re-surfaced
      if (c.status === 'skipped') return true;
      return false;
    });

    // Also include cards with a due date ≤ today that haven't been archived
    const dueSoon = all.filter(
      (c) =>
        c.dueDate &&
        c.dueDate <= today &&
        c.status !== 'done' &&
        c.status !== 'archived' &&
        !queue.some((q) => q.id === c.id)
    );

    const combined = [...queue, ...dueSoon];

    // Sort: urgent > high > medium > low > none, then by sortOrder
    const priorityWeight: Record<CardPriority, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
      none: 4,
    };

    combined.sort((a, b) => {
      const pa = priorityWeight[a.priority] ?? 4;
      const pb = priorityWeight[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      return a.sortOrder - b.sortOrder;
    });

    return combined;
  }

  /**
   * Get today's committed plan — cards the user has swiped right on (status=today).
   * Sorted by sortOrder for the user's preferred execution order.
   */
  async getTodayPlan(): Promise<FocusCard[]> {
    const todayCards = await this.listByStatus('today');
    todayCards.sort((a, b) => a.sortOrder - b.sortOrder);
    return todayCards;
  }

  /**
   * Get completed cards for a given date (for summaries/stats).
   */
  async getCompletedForDate(dateStr: string): Promise<FocusCard[]> {
    const all = await this.listByStatus('done');
    return all.filter((c) => {
      if (!c.completedAt) return false;
      const d = new Date(c.completedAt);
      const completed = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return completed === dateStr;
    });
  }

  // ───────── Bulk operations ─────────

  /** Archive all completed cards (cleanup). */
  async archiveCompleted(): Promise<number> {
    const done = await this.listByStatus('done');
    let count = 0;
    for (const card of done) {
      await this.transitionCard(card.id, 'archived');
      count++;
    }
    return count;
  }

  /** Reset all skipped cards back to inbox (new day). */
  async resetSkipped(): Promise<number> {
    const skipped = await this.listByStatus('skipped');
    let count = 0;
    for (const card of skipped) {
      card.status = 'inbox';
      card.updatedAt = Date.now();
      await this.updateCard(card);
      count++;
    }
    return count;
  }

  /** Upsert a card (used for sync). */
  async upsertCard(card: FocusCard): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(card);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Export all cards as JSON (for Google Drive sync). */
  async exportAll(): Promise<string> {
    const all = await this.listAll();
    return JSON.stringify(all, null, 2);
  }

  /** Import cards from JSON (for Google Drive sync). Upserts by ID. */
  async importFromJson(json: string): Promise<number> {
    const cards: FocusCard[] = JSON.parse(json);
    if (!Array.isArray(cards)) throw new Error('Invalid focus cards JSON: expected array');
    let count = 0;
    for (const card of cards) {
      if (!card.id || !card.title) continue;
      await this.upsertCard(card);
      count++;
    }
    return count;
  }
}
