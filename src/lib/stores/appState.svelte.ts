import { type NoteFile, type StorageAdapter, IndexedDBAdapter, FileSystemAccessAdapter } from '../storage/StorageAdapter';
import { TagDatabase, type Tag } from '../storage/TagSchema';
import { CalcTagDatabase, type CalcTag } from '../storage/CalcTagSchema';
import { GoogleDriveSync } from '../sync/GoogleDriveSync';
import MiniSearch from 'minisearch';
import MarkdownIt from 'markdown-it';

declare const google: any;

export interface SyncMapping {
  id: string;
  lastSyncRemoteTime: number;
  lastSyncLocalTime: number;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error' | 'warning';
  title?: string;
  loading?: boolean;
  duration?: number;
  action?: {
    label: string;
    callback: () => void | Promise<void>;
  };
}

export function parseHtmlMetadata(html: string): { meta: any; content: string } {
  const meta: any = {
    id: '',
    title: '',
    tags: [],
    pinned: false,
    created: '',
    modified: '',
    thumbnail: ''
  };
  let content = html;
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const metaTags = doc.querySelectorAll('meta');
      metaTags.forEach(tag => {
        const name = tag.getAttribute('name');
        const contentVal = tag.getAttribute('content');
        if (name && contentVal !== null) {
          if (name === 'id') meta.id = contentVal;
          else if (name === 'title') meta.title = contentVal;
          else if (name === 'pinned') meta.pinned = contentVal === 'true';
          else if (name === 'tags') {
            meta.tags = contentVal ? contentVal.split(',').map(t => t.trim()).filter(Boolean) : [];
          }
          else if (name === 'created') meta.created = contentVal;
          else if (name === 'modified') meta.modified = contentVal;
          else if (name === 'thumbnail') meta.thumbnail = contentVal;
        }
      });
      if (doc.body) {
        content = doc.body.innerHTML;
      }
    } catch (e) {
      console.error('Failed to parse HTML metadata:', e);
    }
  } else {
    // Basic regex fallback if DOMParser isn't available
    const getMeta = (name: string) => {
      const match = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i'));
      return match ? match[1] : '';
    };
    meta.id = getMeta('id');
    meta.title = getMeta('title');
    meta.pinned = getMeta('pinned') === 'true';
    const tagsVal = getMeta('tags');
    meta.tags = tagsVal ? tagsVal.split(',').map(t => t.trim()).filter(Boolean) : [];
    meta.created = getMeta('created');
    meta.modified = getMeta('modified');
    meta.thumbnail = getMeta('thumbnail');
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/i);
    if (bodyMatch) content = bodyMatch[1];
  }
  return { meta, content };
}

export function generateHtmlNote(meta: any, bodyContent: string): string {
  const titleEscaped = (meta.title || '').replace(/"/g, '&quot;');
  const tagsString = (meta.tags || []).join(',');
  const idEscaped = (meta.id || '').replace(/"/g, '&quot;');
  const createdEscaped = (meta.created || '').replace(/"/g, '&quot;');
  const modifiedEscaped = (meta.modified || '').replace(/"/g, '&quot;');
  const thumbnailEscaped = (meta.thumbnail || '').replace(/"/g, '&quot;');
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="id" content="${idEscaped}">
<meta name="title" content="${titleEscaped}">
<meta name="tags" content="${tagsString}">
<meta name="pinned" content="${meta.pinned ? 'true' : 'false'}">
<meta name="created" content="${createdEscaped}">
<meta name="modified" content="${modifiedEscaped}">
<meta name="thumbnail" content="${thumbnailEscaped}">
<title>${meta.title || 'Untitled'}</title>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

function parseFrontmatter(rawContent: string): { meta: any; content: string } {
  const meta: any = {
    id: '',
    title: '',
    tags: [],
    pinned: false,
    created: '',
    modified: ''
  };
  let content = rawContent;
  if (rawContent.startsWith('---')) {
    const endIdx = rawContent.indexOf('---', 3);
    if (endIdx !== -1) {
      const yamlText = rawContent.substring(3, endIdx);
      content = rawContent.substring(endIdx + 3);
      const lines = yamlText.split('\n');
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const key = line.substring(0, colonIdx).trim().toLowerCase();
          let val = line.substring(colonIdx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          if (key === 'id') meta.id = val;
          else if (key === 'title') meta.title = val;
          else if (key === 'pinned') meta.pinned = val === 'true';
          else if (key === 'tags') {
            meta.tags = val.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
          }
          else if (key === 'created') meta.created = val;
          else if (key === 'modified') meta.modified = val;
        }
      }
    }
  }
  return { meta, content };
}

class AppState {
  // Reactive states
  vaultName = $state<string | null>(null);
  vaultReady = $state<boolean>(false);
  loadingNotes = $state<boolean>(false);
  tagDb = null as TagDatabase | null;
  tags = $state<Tag[]>([]);
  calcTagDb = null as CalcTagDatabase | null;
  calcTags = $state<CalcTag[]>([]);
  selectedTag = $state<string | null>(null);
  notes = $state<NoteFile[]>([]);
  activeNotePath = $state<string | null>(null);
  activeNoteContent = $state<string>('');
  activeNoteTitle = $state<string>('');
  activeNotebook = $state<string | null>(null);
  activeTab = $state<'home' | 'search' | 'library' | 'daily' | 'tags'>('home');
  favorites = $state<string[]>(JSON.parse(localStorage.getItem('mynotes_favorites') || '[]'));
  searchQuery = $state<string>('');
  showSettings = $state<boolean>(false);
  settingsActiveTab = $state<'sync' | 'styling' | 'editor' | 'calculation'>('sync');
  isReadOnly = $state<boolean>(false);
  sourceMode = $state<boolean>(localStorage.getItem('mynotes_editor_source_mode') === 'true');
  editorDirty = $state<boolean>(false);
  editorMode = $state<'text' | 'canvas'>('text');
  selectMode = $state<boolean>(false);
  selectedNotes = $state<Set<string>>(new Set());
  autoPruneTags = $state<boolean>(localStorage.getItem('mynotes_tags_auto_prune') === 'true');
  theme = $state<string>(localStorage.getItem('mynotes_theme') || 'steel');
  defaultCurrency = $state<string>(localStorage.getItem('mynotes_calc_currency') || '₹');
  defaultIncomeLabel = $state<string>(localStorage.getItem('mynotes_calc_income_label') || 'Income');
  customDriveFolderId = $state<string | null>(localStorage.getItem('mynotes_custom_drive_folder_id') || null);
  customDriveFolderName = $state<string | null>(localStorage.getItem('mynotes_custom_drive_folder_name') || null);
  googleDriveFolders = $state<any[]>([]);
  fetchingFolders = $state<boolean>(false);
  onForceSave = null as (() => Promise<void>) | null;
  lastRenamedPath = null as { oldPath: string; newPath: string } | null;

  // ST-016: Confirmation Modal State
  showConfirmModal = $state<boolean>(false);
  confirmTitle = $state<string>('');
  confirmMessage = $state<string>('');
  confirmButtonText = $state<string>('Delete');
  confirmOnConfirm = $state<(() => void) | null>(null);

  // Custom Prompt Modal State
  showPromptModal = $state<boolean>(false);
  promptTitle = $state<string>('');
  promptMessage = $state<string>('');
  promptValue = $state<string>('');
  promptPlaceholder = $state<string>('');
  promptOnConfirm = $state<((val: string) => void | Promise<void>) | null>(null);

  // Layout States
  sidebarWidth = $state<number>(Number(localStorage.getItem('mynotes_sidebar_width')) || 260);
  sidebarCollapsed = $state<boolean>(localStorage.getItem('mynotes_sidebar_collapsed') === 'true');
  notelistWidth = $state<number>(Number(localStorage.getItem('mynotes_notelist_width')) || 340);
  notelistCollapsed = $state<boolean>(localStorage.getItem('mynotes_notelist_collapsed') === 'true');
  editorCollapsed = $state<boolean>(localStorage.getItem('mynotes_editor_collapsed') === 'true');

  // Sorting preferences
  sortField = $state<'title' | 'modified' | 'notebook'>(
    (localStorage.getItem('mynotes_sort_field') as 'title' | 'modified' | 'notebook') || 'modified'
  );
  sortDirection = $state<'asc' | 'desc'>(
    (localStorage.getItem('mynotes_sort_direction') as 'asc' | 'desc') || 'desc'
  );

  // UI Density: 'comfortable' or 'compact'
  uiDensity = $state<'comfortable' | 'compact'>(
    (localStorage.getItem('mynotes_ui_density') as 'comfortable' | 'compact') || 'comfortable'
  );

  // Diagram Editor Preference: 'native' (built-in), 'drawio' (embed diagrams.net), or 'mermaid'
  diagramEditorType = $state<'native' | 'drawio' | 'mermaid'>((localStorage.getItem('mynotes_diagram_editor') as 'native' | 'drawio' | 'mermaid') || 'mermaid');

  setDiagramEditorType(type: 'native' | 'drawio' | 'mermaid') {
    this.diagramEditorType = type;
    localStorage.setItem('mynotes_diagram_editor', type);
  }

  async switchEditorMode(mode: 'text' | 'canvas') {
    if (this.editorMode === mode) return;
    if (this.editorDirty && this.activeNotePath) {
      await this.saveActiveNote(true);
    }
    this.editorMode = mode;
  }

  setSourceMode(val: boolean) {
    this.sourceMode = val;
    localStorage.setItem('mynotes_editor_source_mode', String(val));
  }

  setSort(field: 'title' | 'modified' | 'notebook') {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      if (field === 'title' || field === 'notebook') {
        this.sortDirection = 'asc';
      } else {
        this.sortDirection = 'desc';
      }
    }
    localStorage.setItem('mynotes_sort_field', this.sortField);
    localStorage.setItem('mynotes_sort_direction', this.sortDirection);
  }

  toggleUiDensity() {
    this.uiDensity = this.uiDensity === 'comfortable' ? 'compact' : 'comfortable';
    localStorage.setItem('mynotes_ui_density', this.uiDensity);
  }

  toggleReadMode() {
    this.isReadOnly = !this.isReadOnly;
  }

  showCommandPalette = $state<boolean>(false);

  themes = [
    // Light themes
    { id: 'paper', name: 'Paper Lite 📝', bg: '#fcfbf9', accent: '#2b2a27', category: 'light' },
    { id: 'sakura', name: 'Sakura Breeze 🌸', bg: '#fff0f3', accent: '#ff758f', category: 'light' },
    { id: 'mint', name: 'Minty Fresh 🍵', bg: '#f0fdf4', accent: '#16a34a', category: 'light' },
    { id: 'lavender', name: 'Lavender Dream 🪻', bg: '#faf5ff', accent: '#9333ea', category: 'light' },
    { id: 'cottoncandy', name: 'Cotton Candy 🍬', bg: '#fff5f7', accent: '#ec4899', category: 'light' },
    { id: 'matcha', name: 'Matcha Latte 🍵', bg: '#f7f4eb', accent: '#606c38', category: 'light' },
    { id: 'barbie', name: 'Barbie World 🎀', bg: '#fff0f6', accent: '#ff007f', category: 'light' },
    { id: 'sundae', name: 'Ice Cream Sundae 🍦', bg: '#fefefa', accent: '#fb7185', category: 'light' },

    // Dark themes
    { id: 'steel', name: 'Steel Minimalist 🛡️', bg: '#111317', accent: '#00adb5', category: 'dark' },
    { id: 'nordic', name: 'Nordic Frost 🏔️', bg: '#0f141c', accent: '#58a6ff', category: 'dark' },
    { id: 'dracula', name: 'Dracula Vampire 🧛', bg: '#1e1f29', accent: '#ff79c6', category: 'dark' },
    { id: 'sepia', name: 'Sepia Warmth 🍂', bg: '#1b1712', accent: '#d97706', category: 'dark' },
    { id: 'emerald', name: 'Emerald Forest 🌲', bg: '#0a0f0d', accent: '#10b981', category: 'dark' },
    { id: 'black', name: 'Amoled Black 🌌', bg: '#000000', accent: '#ffffff', category: 'dark' },
    { id: 'dark', name: 'Standard Dark 🎵', bg: '#121212', accent: '#1ed760', category: 'dark' },
    { id: 'cherry', name: 'Midnight Cherry 🍒', bg: '#0a0404', accent: '#ff2a2a', category: 'dark' },
    { id: 'space', name: 'Aether Space 🪐', bg: '#080b12', accent: '#8b5cf6', category: 'dark' },
    { id: 'abyss', name: 'Ocean Abyss 🌊', bg: '#050c0f', accent: '#14b8a6', category: 'dark' },
    { id: 'gold', name: 'Golden Obsidian 🪙', bg: '#0d0d0d', accent: '#d4af37', category: 'dark' },
    { id: 'solarized', name: 'Solarized Dark ☀️', bg: '#002b36', accent: '#2aa198', category: 'dark' },
    { id: 'norddeep', name: 'Nord Deep ❄️', bg: '#1e222a', accent: '#88c0d0', category: 'dark' },
    { id: 'slate', name: 'Monochrome Slate 🧱', bg: '#18181b', accent: '#fafafa', category: 'dark' },

    // Vivid/Neon/Colorful themes
    { id: 'cyberpunk', name: 'Cyberpunk Neon ⚡', bg: '#0b0813', accent: '#00ffff', category: 'vivid' },
    { id: 'synthwave', name: 'Synthwave 1984 🎸', bg: '#170621', accent: '#ff007f', category: 'vivid' },
    { id: 'prism', name: 'Prism Rainbow 🌈', bg: '#101014', accent: '#a78bfa', category: 'vivid' },
    { id: 'solarflare', name: 'Solar Flare 💥', bg: '#140c06', accent: '#f97316', category: 'vivid' },
    { id: 'sunset', name: 'Sunset Horizon 🌅', bg: '#120c17', accent: '#f43f5e', category: 'vivid' },
    { id: 'toxic', name: 'Toxic Glow 🧪', bg: '#0e100f', accent: '#39ff14', category: 'vivid' },
    { id: 'matrix', name: 'Retro Terminal 📟', bg: '#051a05', accent: '#33ff33', category: 'vivid' },
    { id: 'aurora', name: 'Northern Lights 🌌', bg: '#030f12', accent: '#34d399', category: 'vivid' },
    { id: 'bubblegum', name: 'Bubblegum Pop 🧼', bg: '#0f0914', accent: '#f472b6', category: 'vivid' },
    { id: 'volcano', name: 'Volcanic Ash 🌋', bg: '#111111', accent: '#ff4500', category: 'vivid' },
    { id: 'glitch', name: 'Glitch Matrix 💾', bg: '#000000', accent: '#00ff66', category: 'vivid' },
    { id: 'vaporwave', name: 'Retro Vaporwave 👾', bg: '#1c0a35', accent: '#00ffff', category: 'vivid' }
  ];

  // Google Drive Sync Reactive States
  googleClientId = $state<string>(localStorage.getItem('mynotes_google_client_id') || '');
  googleRedirectUri = $state<string>(localStorage.getItem('mynotes_google_redirect_uri') || 'http://localhost');
  googleConnected = $state<boolean>(false);
  googleUserEmail = $state<string | null>(null);
  syncStatus = $state<'idle' | 'syncing' | 'error'>('idle');
  syncErrorMessage = $state<string | null>(null);
  saveError = $state<string | null>(null);
  lastSyncedTime = $state<number | null>(localStorage.getItem('mynotes_last_synced') ? Number(localStorage.getItem('mynotes_last_synced')) : null);
  syncEnabled = $state<boolean>(localStorage.getItem('mynotes_sync_enabled') === 'true');
  editorViewMode = $state<'edit' | 'split' | 'preview'>((localStorage.getItem('mynotes_editor_view_mode') as any) || 'edit');
  driveMappings = $state<Record<string, SyncMapping>>({});
  toasts = $state<Toast[]>([]);
  focusModeEnabled = $state<boolean>(localStorage.getItem('mynotes_focus_mode') === 'true');
  typewriterScrollEnabled = $state<boolean>(localStorage.getItem('mynotes_typewriter_scroll') === 'true');

  // Mobile Google authentication flow (UI-M-014)
  // Drives a multi-step, mobile-appropriate OAuth handoff with clear progress
  // and retry. Steps: idle → awaiting (browser sign-in) → verifying → idle,
  // or → error (with a retry affordance).
  mobileAuthStep = $state<'idle' | 'awaiting' | 'verifying' | 'error'>('idle');
  mobileAuthError = $state<string | null>(null);

  // Move/Copy Note Dialog States
  showMoveCopyModal = $state<boolean>(false);
  moveCopyNotePath = $state<string | null>(null);
  moveCopyNoteName = $state<string>('');

  showToast(
    message: string,
    type: 'success' | 'info' | 'error' | 'warning' = 'info',
    duration = 4000,
    title?: string,
    loading = false,
    action?: { label: string; callback: () => void | Promise<void> }
  ): string {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = { id, message, type, title, loading, duration, action };

    // Enforce max stack limit of 5 toasts
    if (this.toasts.length >= 5) {
      this.dismissToast(this.toasts[0].id);
    }

    this.toasts = [...this.toasts, newToast];
    return id;
  }

  updateToast(id: string, updates: Partial<Omit<Toast, 'id'>>) {
    this.toasts = this.toasts.map(t => {
      if (t.id === id) {
        return { ...t, ...updates };
      }
      return t;
    });
  }

  dismissToast(id: string) {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  // Compares two note files by their body content (ignoring volatile metadata
  // like created/modified timestamps) so first-time sync can detect true equality.
  private notesBodyEqual(a: string, b: string): boolean {
    try {
      const ba = parseHtmlMetadata(a).content.replace(/\s+/g, ' ').trim();
      const bb = parseHtmlMetadata(b).content.replace(/\s+/g, ' ').trim();
      return ba === bb;
    } catch {
      return a.trim() === b.trim();
    }
  }

  isNoteSynced(notePath: string | null): boolean {
    if (!notePath) return true;
    if (!this.syncEnabled || !this.googleConnected) return false;
    const note = this.notes.find(n => n.path === notePath);
    if (!note) return true;
    const mapping = this.driveMappings[notePath];
    if (!mapping) return false;
    // Synced if local modified time matches or is older than the last sync local time (with 2s buffer)
    return note.modified <= (mapping.lastSyncLocalTime + 2000);
  }

  // Google Drive Sync Service (non-reactive class instance, token stored privately inside)
  syncService = new GoogleDriveSync(localStorage.getItem('mynotes_google_client_id') || '');

  // Non-reactive helper variables
  private syncDebounceTimer: number | null = null;
  storage: StorageAdapter = new IndexedDBAdapter();
  private searchIndex = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: ['path', 'title'],
    idField: 'path'
  });

  private async waitForGoogleSDK(timeoutMs = 5000): Promise<void> {
    const isNative = typeof window !== 'undefined' && (window as any).Capacitor;
    if (isNative) {
      throw new Error(
        'Google Drive Sync is currently only supported in web browsers.\n\n' +
        'Google blocks OAuth authentication inside mobile application WebViews for security.\n' +
        'Please use the web version of this app in a standard mobile browser (Chrome/Safari) to connect and sync your notes.'
      );
    }
    if (typeof google !== 'undefined') return;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (typeof google !== 'undefined') {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Google Identity Services SDK failed to load. Please verify your internet connection.'));
        }
      }, 100);
    });
  }

  setTheme(newTheme: string) {
    this.theme = newTheme;
    localStorage.setItem('mynotes_theme', newTheme);
    this.applyThemeClass();
  }

  setEditorViewMode(mode: 'edit' | 'split' | 'preview') {
    this.editorViewMode = mode;
    localStorage.setItem('mynotes_editor_view_mode', mode);
  }

  setFocusMode(enabled: boolean) {
    this.focusModeEnabled = enabled;
    localStorage.setItem('mynotes_focus_mode', String(enabled));
  }

  setTypewriterScroll(enabled: boolean) {
    this.typewriterScrollEnabled = enabled;
    localStorage.setItem('mynotes_typewriter_scroll', String(enabled));
  }

  applyThemeClass() {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      // Remove all theme- classes
      root.className = root.className.replace(/\btheme-\S+/g, '');
      root.classList.add(`theme-${this.theme}`);
    }
  }

  async setCustomDriveFolder(id: string | null, name: string | null) {
    this.customDriveFolderId = id;
    this.customDriveFolderName = name;
    
    if (id && name) {
      localStorage.setItem('mynotes_custom_drive_folder_id', id);
      localStorage.setItem('mynotes_custom_drive_folder_name', name);
    } else {
      localStorage.removeItem('mynotes_custom_drive_folder_id');
      localStorage.removeItem('mynotes_custom_drive_folder_name');
    }
    
    this.syncService.setFolderId(id);
    
    // Clear mappings when switching folder
    localStorage.removeItem('mynotes_drive_mappings');
    this.driveMappings = {};
    
    // Automatically trigger sync if connected
    if (this.syncEnabled && this.googleConnected) {
      await this.syncNotes();
    }
  }

  async fetchGoogleDriveFolders() {
    if (!this.googleConnected) return;
    this.fetchingFolders = true;
    try {
      this.googleDriveFolders = await this.syncService.listFolders();
    } catch (e) {
      console.error('Failed to fetch Google Drive folders:', e);
    } finally {
      this.fetchingFolders = false;
    }
  }

  async createGoogleDriveFolder(name: string) {
    if (!this.googleConnected) return;
    this.fetchingFolders = true;
    try {
      const id = await this.syncService.createFolder(name);
      await this.setCustomDriveFolder(id, name);
      await this.fetchGoogleDriveFolders();
    } catch (e) {
      console.error('Failed to create Google Drive folder:', e);
      throw e;
    } finally {
      this.fetchingFolders = false;
    }
  }

  constructor() {
    const customFolderId = localStorage.getItem('mynotes_custom_drive_folder_id');
    if (customFolderId) {
      this.syncService.setFolderId(customFolderId);
    }
    this.applyThemeClass();

    const savedMappings = localStorage.getItem('mynotes_drive_mappings');
    if (savedMappings) {
      try {
        this.driveMappings = JSON.parse(savedMappings);
      } catch (e) {
        console.error('Failed to parse drive mappings from localStorage:', e);
      }
    }

    const token = localStorage.getItem('mynotes_google_access_token');
    const expiry = Number(localStorage.getItem('mynotes_google_token_expiry') || '0');
    
    if (token && Date.now() < expiry) {
      console.log('Restoring Google Drive token from localStorage...');
      this.syncService.setAccessToken(token);
      this.googleConnected = true;
      // Wait for Google SDK to load before validating the token and fetching user email
      this.waitForGoogleSDK(5000).then(() => {
        this.syncService.getUserEmail().then(email => {
          this.googleUserEmail = email;
        }).catch(e => {
          console.warn('Failed to refresh user email using restored token:', e);
          if (e.message === 'UNAUTHORIZED' || (e.message && e.message.includes('401'))) {
            this.disconnectGoogleDrive();
          }
        });
      }).catch(err => {
        console.warn('Google SDK load failed during token restore:', err);
      });
    }
  }

  get notebooks() {
    const list = new Set<string>();
    this.notes.forEach(note => {
      const parts = note.path.split('/');
      if (parts.length > 1) {
        const folderPath = parts.slice(0, -1).join('/');
        if (!folderPath.startsWith('Daily Notes')) {
          parts.slice(0, -1).forEach((_, idx) => {
            list.add(parts.slice(0, idx + 1).join('/'));
          });
        }
      }
    });
    return Array.from(list).sort();
  }

  get filteredNotes() {
    let list = this.notes;

    if (this.activeNotebook) {
      const prefix = this.activeNotebook.endsWith('/') ? this.activeNotebook : this.activeNotebook + '/';
      list = list.filter(n => n.path.startsWith(prefix) || n.path === this.activeNotebook);
    }

    if (this.selectedTag) {
      const normalized = this.selectedTag.toLowerCase();
      list = list.filter(n => {
        const parsed = parseHtmlMetadata(n.content);
        return (parsed.meta.tags || []).map((t: string) => t.toLowerCase()).includes(normalized);
      });
    }

    let queryText = this.searchQuery.trim();
    const tagFilters: string[] = [];
    if (queryText) {
      const tagRegex = /\btag:(\S+)/gi;
      let match;
      while ((match = tagRegex.exec(queryText)) !== null) {
        tagFilters.push(match[1].toLowerCase());
      }
      queryText = queryText.replace(tagRegex, '').replace(/\s+/g, ' ').trim();
    }

    if (tagFilters.length > 0) {
      list = list.filter(n => {
        const parsed = parseHtmlMetadata(n.content);
        const noteTags = (parsed.meta.tags || []).map((t: string) => t.toLowerCase());
        return tagFilters.every(f => noteTags.includes(f));
      });
    }

    if (queryText) {
      try {
        const results = this.searchIndex.search(queryText);
        const paths = results.map(r => r.id);
        list = list.filter(n => paths.includes(n.path));
      } catch (e) {
        // Fail-safe search fallback
        const q = queryText.toLowerCase();
        list = list.filter(n => n.name.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
      }
    }

    // Sort dynamically
    return [...list].sort((a, b) => {
      let comparison = 0;
      if (this.sortField === 'title') {
        comparison = a.name.localeCompare(b.name);
      } else if (this.sortField === 'notebook') {
        const getNotebook = (p: string) => {
          const parts = p.split('/');
          return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        };
        comparison = getNotebook(a.path).localeCompare(getNotebook(b.path));
        if (comparison === 0) {
          comparison = a.name.localeCompare(b.name);
        }
      } else {
        comparison = a.modified - b.modified;
      }
      return this.sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  get linesCountInActiveNotebook() {
    if (!this.notes || this.notes.length === 0) return 0;
    if (!this.activeNotebook) {
      return this.notes.reduce((sum, note) => sum + (note?.content || '').split('\n').length, 0);
    }
    const prefix = this.activeNotebook.endsWith('/') ? this.activeNotebook : this.activeNotebook + '/';
    const notebookNotes = this.notes.filter(n => n.path.startsWith(prefix) || n.path === this.activeNotebook);
    return notebookNotes.reduce((sum, note) => sum + (note?.content || '').split('\n').length, 0);
  }

  get recentNotes() {
    // Return top 6 recently modified notes
    return [...this.notes].sort((a, b) => b.modified - a.modified).slice(0, 6);
  }

  get activeNote() {
    if (!this.activeNotePath) return null;
    return this.notes.find(n => n.path === this.activeNotePath) || null;
  }

  // Action methods
  setClientId(clientId: string) {
    this.googleClientId = clientId.trim();
    localStorage.setItem('mynotes_google_client_id', this.googleClientId);
    this.syncService.setClientId(this.googleClientId);
  }

  setRedirectUri(redirectUri: string) {
    this.googleRedirectUri = redirectUri.trim();
    localStorage.setItem('mynotes_google_redirect_uri', this.googleRedirectUri);
  }

  setSyncEnabled(enabled: boolean) {
    this.syncEnabled = enabled;
    localStorage.setItem('mynotes_sync_enabled', String(enabled));
  }

  setAutoPruneTags(enabled: boolean) {
    this.autoPruneTags = enabled;
    localStorage.setItem('mynotes_tags_auto_prune', String(enabled));
    if (enabled) {
      this.pruneUnusedTags();
    }
  }

  setDefaultCurrency(currency: string) {
    this.defaultCurrency = currency;
    localStorage.setItem('mynotes_calc_currency', currency);
  }

  setDefaultIncomeLabel(label: string) {
    this.defaultIncomeLabel = label;
    localStorage.setItem('mynotes_calc_income_label', label);
  }

  /**
   * Returns a Map of normalizedTagName → color for fast lookups in UI rendering.
   */
  get tagColorMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const tag of this.tags) {
      if (tag.color) {
        map.set(tag.normalizedName || tag.name.toLowerCase(), tag.color);
      }
    }
    return map;
  }

  /**
   * Set or remove a tag's custom color.
   * @param tagName - The display name of the tag
   * @param color - Hex color string (e.g. "#ef4444") or null to reset
   */
  async setTagColor(tagName: string, color: string | null): Promise<void> {
    if (!this.tagDb) throw new Error('Tag database not initialized');
    const normalized = tagName.trim().toLowerCase();
    const tag = this.tags.find(t => (t.normalizedName || t.name.toLowerCase()) === normalized);
    if (!tag) throw new Error(`Tag not found: ${tagName}`);
    await this.tagDb.updateTagColor(tag.id, color);
    this.tags = await this.tagDb.listTags();
  }

  async connectGoogleDrive() {
    try {
      await this.waitForGoogleSDK(5000);
    } catch (e) {
      this.syncStatus = 'error';
      throw e;
    }

    return new Promise<void>((resolve, reject) => {
      if (!this.googleClientId) {
        return reject(new Error('Please set your Google OAuth Client ID first.'));
      }
      this.syncStatus = 'syncing';
      this.syncService.login(
        async (token) => {
          try {
            localStorage.setItem('mynotes_google_access_token', token);
            localStorage.setItem('mynotes_google_token_expiry', String(Date.now() + 3500 * 1000));
            
            this.googleUserEmail = await this.syncService.getUserEmail();
            this.setSyncEnabled(true);
            this.googleConnected = true;
            this.syncStatus = 'idle';
            await this.syncNotes();
            resolve();
          } catch (e) {
            this.googleConnected = false;
            this.syncStatus = 'error';
            reject(e);
          }
        },
        (err) => {
          this.googleConnected = false;
          this.syncStatus = 'error';
          reject(err);
        }
      );
    });
  }

  async connectGoogleDriveMobile(tokenOrUrl: string): Promise<void> {
    let token = tokenOrUrl.trim();
    if (token.includes('access_token=')) {
      const match = token.match(/access_token=([^&]+)/);
      if (match) {
        token = match[1];
      }
    }
    
    if (!token) {
      throw new Error('Could not find access token in the pasted text.');
    }
    
    this.syncStatus = 'syncing';
    try {
      this.syncService.setAccessToken(token);
      const email = await this.syncService.getUserEmail();
      
      localStorage.setItem('mynotes_google_access_token', token);
      localStorage.setItem('mynotes_google_token_expiry', String(Date.now() + 3500 * 1000));
      
      this.googleUserEmail = email;
      this.setSyncEnabled(true);
      this.googleConnected = true;
      this.syncStatus = 'idle';
      
      await this.syncNotes();
    } catch (e) {
      this.googleConnected = false;
      this.syncStatus = 'error';
      throw e;
    }
  }

  // ───────────────────── Mobile OAuth handoff (UI-M-014) ─────────────────────

  private mobileAuthListenerCleanup: (() => void) | null = null;

  /** True when running inside a native Capacitor shell (Android/iOS). */
  private get isNativePlatform(): boolean {
    return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
  }

  /** Build the Google implicit-grant OAuth URL for the mobile/browser flow. */
  buildGoogleAuthUrl(): string {
    return 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' +
      encodeURIComponent(this.googleClientId) +
      '&redirect_uri=' + encodeURIComponent(this.googleRedirectUri) +
      '&response_type=token&scope=' + encodeURIComponent('https://www.googleapis.com/auth/drive.file') +
      '&prompt=consent';
  }

  /**
   * Begin the mobile Google sign-in flow: open the secure system browser and,
   * on native, register a deep-link listener so the OAuth redirect is captured
   * automatically (no manual copy/paste). Falls back to manual paste if the
   * deep link isn't wired up on the device.
   */
  async startMobileGoogleAuth(): Promise<void> {
    if (!this.googleClientId.trim()) {
      this.mobileAuthStep = 'error';
      this.mobileAuthError = 'Please enter your Google OAuth Client ID first.';
      return;
    }
    if (!this.googleRedirectUri.trim()) {
      this.mobileAuthStep = 'error';
      this.mobileAuthError = 'Please set an OAuth Redirect URI first.';
      return;
    }

    this.mobileAuthError = null;
    this.mobileAuthStep = 'awaiting';

    // Attempt automatic capture of the redirect via Capacitor deep links.
    await this.registerMobileAuthRedirectListener();

    // Hand off to the secure system browser (required by Google policy).
    const url = this.buildGoogleAuthUrl();
    try {
      window.open(url, '_system');
    } catch {
      window.location.href = url;
    }
  }

  private async registerMobileAuthRedirectListener(): Promise<void> {
    this.clearMobileAuthRedirectListener();
    if (!this.isNativePlatform) return;
    try {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appUrlOpen', (event: { url: string }) => {
        if (event?.url && event.url.includes('access_token')) {
          void this.completeMobileGoogleAuth(event.url).catch(() => {/* surfaced via state */});
        }
      });
      this.mobileAuthListenerCleanup = () => { void handle.remove(); };
    } catch (e) {
      console.warn('[Auth] appUrlOpen deep-link listener unavailable:', e);
    }
  }

  private clearMobileAuthRedirectListener(): void {
    if (this.mobileAuthListenerCleanup) {
      try { this.mobileAuthListenerCleanup(); } catch { /* ignore */ }
      this.mobileAuthListenerCleanup = null;
    }
  }

  /**
   * Finish the mobile flow with a captured/pasted redirect URL or raw token.
   * Updates progress state and surfaces a clear error (with retry) on failure.
   */
  async completeMobileGoogleAuth(tokenOrUrl: string): Promise<void> {
    this.mobileAuthStep = 'verifying';
    this.mobileAuthError = null;
    try {
      await this.connectGoogleDriveMobile(tokenOrUrl);
      this.mobileAuthStep = 'idle';
      this.clearMobileAuthRedirectListener();
      this.showToast('Connected to Google Drive', 'success');
    } catch (e: any) {
      this.mobileAuthStep = 'error';
      this.mobileAuthError = e?.message || 'Failed to verify the sign-in. Please try again.';
      throw e;
    }
  }

  /** Reset the mobile auth flow back to its initial state. */
  cancelMobileGoogleAuth(): void {
    this.mobileAuthStep = 'idle';
    this.mobileAuthError = null;
    this.clearMobileAuthRedirectListener();
  }

  async disconnectGoogleDrive() {
    this.syncService.clearToken();
    localStorage.removeItem('mynotes_google_access_token');
    localStorage.removeItem('mynotes_google_token_expiry');
    this.googleConnected = false;
    this.googleUserEmail = null;
    this.setSyncEnabled(false);
    this.syncStatus = 'idle';
    this.cancelMobileGoogleAuth();
  }

  async autoConnectGoogleDrive() {
    if (!this.googleClientId || !this.syncEnabled) return;
    
    console.log('Attempting silent Google Drive reconnection...');
    this.syncStatus = 'syncing';

    try {
      await this.waitForGoogleSDK(5000);
    } catch (e) {
      console.warn('Google SDK not loaded for silent auto-connect:', e);
      this.googleConnected = false;
      this.syncStatus = 'error';
      return;
    }

    this.syncService.login(
      async (token) => {
        try {
          localStorage.setItem('mynotes_google_access_token', token);
          localStorage.setItem('mynotes_google_token_expiry', String(Date.now() + 3500 * 1000));
          
          this.googleUserEmail = await this.syncService.getUserEmail();
          this.googleConnected = true;
          this.syncStatus = 'idle';
          console.log('Successfully reconnected to Google Drive silently.');
          await this.syncNotes();
        } catch (e) {
          console.error('Silent Google Drive reconnection failed:', e);
          this.googleConnected = false;
          this.syncStatus = 'error';
        }
      },
      (err) => {
        console.warn('Silent Google Drive reconnection popup blocked or failed:', err);
        this.googleConnected = false;
        this.syncStatus = 'error';
      }
    );
  }

  triggerDebouncedSync() {
    console.log('triggerDebouncedSync called. syncEnabled:', this.syncEnabled, 'googleConnected:', this.googleConnected);
    if (!this.syncEnabled || !this.googleConnected || !this.syncService) {
      console.warn('Sync skipped: disabled or disconnected.');
      return;
    }

    if (this.syncDebounceTimer) {
      console.log('Existing sync timer cleared. Restarting 5s debounce...');
      clearTimeout(this.syncDebounceTimer);
    } else {
      console.log('Starting 5s debounce timer for Google Drive sync...');
    }

    this.syncDebounceTimer = window.setTimeout(async () => {
      console.log('Debounce timer fired. Initiating remote sync now...');
      this.syncDebounceTimer = null;
      await this.syncNotes();
    }, 5000); // 5 seconds debounce
  }

  async syncNotes() {
    if (!this.syncEnabled || !this.googleConnected || !this.syncService) return;

    let remoteDeletionsCount = 0;
    let remoteDeletionsFailedCount = 0;

    this.syncStatus = 'syncing';
    try {
      console.log('--- STARTING GOOGLE DRIVE SYNC CYCLE ---');
      const folderId = await this.syncService.getOrCreateSyncFolder();
      const driveFiles = await this.syncService.listFiles(folderId);
      console.log(`Remote Drive Folder ID: ${folderId}. Found ${driveFiles.length} files on Drive.`);

      // Load drive mappings
      const mappings: Record<string, string | SyncMapping> = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
      const activeMappings: Record<string, SyncMapping> = {};

      // Map of drive files by path for faster lookup
      const driveFileMap = new Map(driveFiles.map(f => [f.path ? f.path.toLowerCase() : '', f]));

      // Helper to upload a note to Drive, resolving/creating folders recursively
      const uploadNoteToDrive = async (notePath: string, filename: string, content: string, fileId?: string): Promise<{ id: string; modifiedTime: string }> => {
        const parts = notePath.split('/');
        if (parts.length > 1) {
          const folderNames = parts.slice(0, -1);
          const subfolderId = await this.syncService.getOrCreateSubfolders(folderId, folderNames);
          return this.syncService.uploadFile(filename, content, fileId, subfolderId);
        } else {
          return this.syncService.uploadFile(filename, content, fileId);
        }
      };

      // Step 1: Sync local files to remote
      for (const note of this.notes) {
        const mapEntry = mappings[note.path];
        let remoteId: string | undefined;
        let lastSyncRemoteTime = 0;
        let lastSyncLocalTime = 0;

        if (mapEntry) {
          if (typeof mapEntry === 'string') {
            remoteId = mapEntry;
          } else {
            remoteId = mapEntry.id;
            lastSyncRemoteTime = mapEntry.lastSyncRemoteTime || 0;
            lastSyncLocalTime = mapEntry.lastSyncLocalTime || 0;
          }
        }

        // Match by ID, or fallback to relative path
        const driveFile = remoteId 
          ? driveFiles.find(f => f.id === remoteId)
          : driveFileMap.get(note.path.toLowerCase());

        // Legacy string mappings upgrade on-the-fly
        if (mapEntry && typeof mapEntry === 'string') {
          lastSyncLocalTime = note.modified;
          lastSyncRemoteTime = driveFile ? new Date(driveFile.modifiedTime).getTime() : 0;
        }

        console.log(`Sync check for: ${note.path}`);
        if (driveFile) {
          const remoteTime = new Date(driveFile.modifiedTime).getTime();
          console.log(`  Remote file found: ${driveFile.name} (ID: ${driveFile.id})`);
          console.log(`  Local modified: ${note.modified} (Last sync local: ${lastSyncLocalTime})`);
          console.log(`  Remote modified: ${remoteTime} (Last sync remote: ${lastSyncRemoteTime})`);

          // First-time reconciliation: there is no prior sync record for this note
          // (e.g. first connect, a second device, or after switching Drive folders).
          // Compare the actual content first so we don't needlessly re-upload notes
          // that already match what's on Drive.
          if (!mapEntry) {
            let remoteContent: string | null = null;
            try {
              remoteContent = await this.syncService.downloadFile(driveFile.id);
            } catch (e) {
              console.warn('  First-sync compare: failed to download remote, reconciling by time.', e);
            }

            if (remoteContent !== null && this.notesBodyEqual(note.content, remoteContent)) {
              console.log('  First sync: local and remote are identical. Linking without transfer.');
              activeMappings[note.path] = {
                id: driveFile.id,
                lastSyncLocalTime: note.modified,
                lastSyncRemoteTime: remoteTime
              };
            } else if (remoteContent !== null && remoteTime > note.modified) {
              console.log('  First sync: remote is newer. Adopting remote copy.');
              await this.storage.writeNote(note.path, remoteContent);
              activeMappings[note.path] = {
                id: driveFile.id,
                lastSyncLocalTime: Date.now(),
                lastSyncRemoteTime: remoteTime
              };
            } else {
              console.log('  First sync: local is newer (or remote unavailable). Uploading local copy.');
              const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.html`, note.content, driveFile.id);
              const updatedRemoteTime = new Date(uploadRes.modifiedTime).getTime();
              activeMappings[note.path] = {
                id: uploadRes.id,
                lastSyncLocalTime: note.modified,
                lastSyncRemoteTime: updatedRemoteTime
              };
            }
            continue; // reconciliation handled for this note
          }

          const localChanged = note.modified > lastSyncLocalTime + 2000;
          const remoteChanged = remoteTime > lastSyncRemoteTime + 2000;
          console.log(`  localChanged: ${localChanged}, remoteChanged: ${remoteChanged}`);

          if (localChanged && remoteChanged) {
            // Conflict! Resolving via Last Modified Wins
            console.log('  Conflict detected! Resolving via Last Modified Wins.');
            // Trust local edits within a 5-minute clock skew buffer to prevent data loss.
            if (note.modified > remoteTime - 300000) {
              console.log('  Local is newer or within skew buffer. Uploading note...');
              const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.html`, note.content, driveFile.id);
              const updatedRemoteTime = new Date(uploadRes.modifiedTime).getTime();
              activeMappings[note.path] = {
                id: uploadRes.id,
                lastSyncLocalTime: note.modified,
                lastSyncRemoteTime: updatedRemoteTime
              };
            } else {
              console.log('  Remote is newer. Downloading note...');
              const remoteContent = await this.syncService.downloadFile(driveFile.id);
              await this.storage.writeNote(note.path, remoteContent);
              activeMappings[note.path] = {
                id: driveFile.id,
                lastSyncLocalTime: Date.now(),
                lastSyncRemoteTime: remoteTime
              };
            }
          } else if (localChanged) {
            console.log('  Local changed since last sync. Uploading updates...');
            const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.html`, note.content, driveFile.id);
            const updatedRemoteTime = new Date(uploadRes.modifiedTime).getTime();
            activeMappings[note.path] = {
              id: uploadRes.id,
              lastSyncLocalTime: note.modified,
              lastSyncRemoteTime: updatedRemoteTime
            };
          } else if (remoteChanged) {
            console.log('  Remote changed since last sync. Downloading updates...');
            const remoteContent = await this.syncService.downloadFile(driveFile.id);
            await this.storage.writeNote(note.path, remoteContent);
            activeMappings[note.path] = {
              id: driveFile.id,
              lastSyncLocalTime: Date.now(),
              lastSyncRemoteTime: remoteTime
            };
          } else {
            console.log('  Note is in sync. No transfer needed.');
            activeMappings[note.path] = {
              id: driveFile.id,
              lastSyncLocalTime: lastSyncLocalTime || note.modified,
              lastSyncRemoteTime: lastSyncRemoteTime || remoteTime
            };
          }
        } else {
          if (remoteId) {
            console.log('  Note was deleted on Google Drive. Deleting locally...');
            const noteName = note.path.split('/').pop()?.replace(/\.(md|html)$/, '') || note.path;
            try {
              await this.storage.deleteNote(note.path);
              this.showToast(`Deleted note "${noteName}" locally to match Google Drive deletion.`, 'info', 4000);
            } catch (err) {
              console.error(`Failed to delete local note ${note.path}:`, err);
            }
          } else {
            console.log('  New local note found. Uploading to Google Drive...');
            const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.html`, note.content);
            const updatedRemoteTime = new Date(uploadRes.modifiedTime).getTime();
            activeMappings[note.path] = {
              id: uploadRes.id,
              lastSyncLocalTime: note.modified,
              lastSyncRemoteTime: updatedRemoteTime
            };
          }
        }
      }

      // Step 2: Sync remote files that don't exist locally
      for (const remote of driveFiles) {
        if (!remote.path) continue;

        // Check if this remote file was already matched/processed in Step 1
        const processedPath = Object.keys(activeMappings).find(key => activeMappings[key].id === remote.id);
        if (processedPath) {
          continue; // Already synced/updated in Step 1
        }

        // Check if there was an old mapping for this remote file
        const oldLocalPath = Object.keys(mappings).find(key => {
          const mapVal = mappings[key];
          const id = typeof mapVal === 'string' ? mapVal : mapVal.id;
          return id === remote.id;
        });

        if (oldLocalPath) {
          // The file was previously synced, but is no longer present locally.
          // This means it was deleted locally. We should delete it on Google Drive.
          console.log(`Note ${oldLocalPath} was deleted locally. Deleting remote file ${remote.path} (ID: ${remote.id}) on Drive...`);
          try {
            await this.syncService.deleteFile(remote.id);
            remoteDeletionsCount++;
          } catch (e) {
            console.error(`Failed to delete remote file ${remote.id}:`, e);
            remoteDeletionsFailedCount++;
          }
        } else {
          // This is a brand new remote file from another client. Download it.
          console.log(`New remote file found: ${remote.path} (ID: ${remote.id}). Downloading...`);
          const remoteContent = await this.syncService.downloadFile(remote.id);
          await this.storage.writeNote(remote.path, remoteContent);
          const remoteTime = new Date(remote.modifiedTime).getTime();
          activeMappings[remote.path] = {
            id: remote.id,
            lastSyncLocalTime: Date.now(),
            lastSyncRemoteTime: remoteTime
          };
        }
      }

      // Save updated mappings
      localStorage.setItem('mynotes_drive_mappings', JSON.stringify(activeMappings));
      this.driveMappings = activeMappings;
      console.log('Mappings updated:', activeMappings);
      
      await this.refreshNotes();
      this.lastSyncedTime = Date.now();
      localStorage.setItem('mynotes_last_synced', String(this.lastSyncedTime));
      this.syncStatus = 'idle';
      this.syncErrorMessage = null;
      console.log('--- SYNC CYCLE COMPLETED SUCCESSFULLY ---');

      if (remoteDeletionsCount > 0 || remoteDeletionsFailedCount > 0) {
        if (remoteDeletionsFailedCount === 0) {
          this.showToast(`Successfully synced deletions to Google Drive (${remoteDeletionsCount} file(s) removed).`, 'success', 4000);
        } else {
          this.showToast(`Synced deletions to Google Drive: ${remoteDeletionsCount} file(s) removed, ${remoteDeletionsFailedCount} failed.`, 'warning', 5000);
        }
      }
    } catch (e: any) {
      console.error('--- SYNC CYCLE FAILED ---', e);
      this.syncStatus = 'error';
      this.syncErrorMessage = e.message || String(e);
      if (e.message === 'UNAUTHORIZED' || (e.message && e.message.includes('401'))) {
        this.googleConnected = false;
        this.googleUserEmail = null;
        this.syncService.clearToken();
        localStorage.removeItem('mynotes_google_access_token');
        localStorage.removeItem('mynotes_google_token_expiry');
      }
    }
  }



  async migrateOldNotes() {
    if (this.storage.migrateNotes) {
      const markdownParser = new MarkdownIt({
        html: true,
        breaks: true,
        linkify: true
      });
      const convertFn = (md: string) => {
        const parsed = parseFrontmatter(md);
        const htmlBody = markdownParser.render(parsed.content);
        return generateHtmlNote(parsed.meta, htmlBody);
      };
      
      try {
        await this.storage.migrateNotes(convertFn);
        console.log('Successfully migrated markdown notes to html notes.');
      } catch (err) {
        console.error('Error migrating markdown notes:', err);
      }
    }
  }

  async initSandbox() {
    console.log('[MyNotes] initSandbox started');
    try {
      this.storage = new IndexedDBAdapter();
      console.log('[MyNotes] IndexedDBAdapter instance created');
      const name = await this.storage.selectDirectory();
      console.log('[MyNotes] selectDirectory returned:', name);
      this.vaultName = name;
      if (this.tagDb) this.tagDb.close();
      if (this.calcTagDb) this.calcTagDb.close();
      this.tagDb = new TagDatabase(name);
      this.calcTagDb = new CalcTagDatabase(name);
      
      // Perform migration of markdown notes to html notes
      await this.migrateOldNotes();
      
      // Clean up existing default files if they are in the storage
      console.log('[MyNotes] listNotes starting...');
      const list = await this.storage.listNotes();
      console.log('[MyNotes] listNotes completed, count:', list?.length);
      const defaultFiles = ['Welcome.html', 'Recipes/Pizza.html', 'Daily Notes/2026-06-08.html'];
      let needsRefresh = false;
      for (const file of defaultFiles) {
        if (list && list.some(n => n.path === file)) {
          console.log('[MyNotes] deleting default file:', file);
          await this.storage.deleteNote(file);
          needsRefresh = true;
        }
      }
      
      console.log('[MyNotes] refreshNotes starting...');
      await this.refreshNotes();
      console.log('[MyNotes] refreshNotes completed');
      this.vaultReady = true;
      console.log('[MyNotes] vaultReady set to true');
      
      // Auto-sync after initialization
      if (this.syncEnabled) {
        if (this.googleConnected) {
          this.syncNotes();
        } else {
          this.autoConnectGoogleDrive();
        }
      }
      
      // Do not open any note by default on startup (shows dashboard)
      this.activeNotePath = null;
    } catch (err) {
      console.error('[MyNotes] initSandbox error caught:', err);
      throw err;
    }
  }

  async openDirectory() {
    try {
      const adapter = new FileSystemAccessAdapter();
      const name = await adapter.selectDirectory();
      this.storage = adapter;
      this.vaultName = name;
      if (this.tagDb) this.tagDb.close();
      if (this.calcTagDb) this.calcTagDb.close();
      this.tagDb = new TagDatabase(name);
      this.calcTagDb = new CalcTagDatabase(name);
      // Perform migration of markdown notes to html notes
      await this.migrateOldNotes();
      await this.refreshNotes();
      this.vaultReady = true;
      
      // Auto-sync after initialization
      if (this.syncEnabled) {
        if (this.googleConnected) {
          this.syncNotes();
        } else {
          this.autoConnectGoogleDrive();
        }
      }

      // Do not open any note by default on directory select (shows dashboard)
      this.activeNotePath = null;
      this.activeNoteContent = '';
      this.activeNoteTitle = '';
    } catch (e) {
      console.error('Failed to open directory', e);
    }
  }

  async refreshNotes() {
    this.loadingNotes = true;
    try {
      const list = await this.storage.listNotes();
      this.notes = list;
      
      // Reindex search
      this.searchIndex.removeAll();
      const searchDocs = list.map(note => ({
        path: note.path,
        title: note.name,
        content: note.content.replace(/<[^>]+>/g, ' ')
      }));
      this.searchIndex.addAll(searchDocs);

      // Sync favorites based on note metadata
      const pinnedPaths: string[] = [];
      for (const note of list) {
        if (note.content) {
          try {
            const parsed = parseHtmlMetadata(note.content);
            if (parsed.meta.pinned) {
              pinnedPaths.push(note.path);
            }
          } catch (e) {
            console.error(`Failed to parse HTML metadata for note: ${note.path}`, e);
          }
        }
      }
      const localFavs = JSON.parse(localStorage.getItem('mynotes_favorites') || '[]') as string[];
      const mergedFavs = Array.from(new Set([
        ...localFavs.filter((p: string) => list.some((n: NoteFile) => n.path === p)),
        ...pinnedPaths
      ]));
      this.favorites = mergedFavs;
      localStorage.setItem('mynotes_favorites', JSON.stringify(mergedFavs));

      // Sync tag database
      if (this.tagDb) {
        try {
          await this.syncTagDatabase(list);
        } catch (e) {
          console.error('[MyNotes] Failed to sync tag database in refreshNotes:', e);
        }
      }

      // Auto prune empty tags if enabled
      if (this.tagDb && this.autoPruneTags) {
        try {
          await this.pruneUnusedTags();
        } catch (e) {
          console.error('[MyNotes] Failed to auto-prune empty tags in refreshNotes:', e);
        }
      }

      // Sync and refresh budget categories
      if (this.calcTagDb) {
        try {
          await this.syncCalcTags(list);
        } catch (e) {
          console.error('[MyNotes] Failed to sync budget categories in refreshNotes:', e);
        }
        await this.refreshCalcTags();
      }
    } finally {
      this.loadingNotes = false;
    }
  }

  async syncTagDatabase(notesList: NoteFile[]) {
    if (!this.tagDb) return;
    try {
      const dbTags = await this.tagDb.listTags();
      const activePaths = new Set(notesList.map((n: NoteFile) => n.path));

      // 1. Prune relations for deleted/moved notes
      await this.tagDb.pruneZombieRelations(activePaths);

      // 2. Scan each note and synchronize tag relations
      for (const note of notesList) {
        if (!note.content) continue;
        const parsed = parseHtmlMetadata(note.content);
        const noteTags = parsed.meta.tags || [];

        // Resolve tag IDs (create tags if they don't exist)
        const tagIds: string[] = [];
        for (const tagName of noteTags) {
          const cleanName = tagName.trim();
          if (!cleanName) continue;
          const normalized = cleanName.toLowerCase();
          
          let tag = dbTags.find((t: Tag) => t.normalizedName === normalized);
          if (!tag) {
            tag = await this.tagDb.addTag(cleanName);
            dbTags.push(tag);
          }
          tagIds.push(tag.id);
        }

        // Get existing relationships in database for this note
        const dbTagIds = await this.tagDb.getTagsForNote(note.path);

        // Add missing relations
        for (const tagId of tagIds) {
          if (!dbTagIds.includes(tagId)) {
            await this.tagDb.addRelation(note.path, tagId);
          }
        }

        // Remove old relations that are no longer in the note's tags list
        for (const dbTagId of dbTagIds) {
          if (!tagIds.includes(dbTagId)) {
            await this.tagDb.removeRelation(note.path, dbTagId);
          }
        }
      }

      // 3. Update the appState's reactive tags list
      this.tags = await this.tagDb.listTags();
    } catch (e) {
      console.error('[MyNotes] syncTagDatabase error:', e);
    }
  }

  async pruneUnusedTags(): Promise<void> {
    if (!this.tagDb) return;
    try {
      const globalTags = await this.tagDb.listTags();
      
      // Build a set of all normalized tags currently in notes
      const activeNormalizedTags = new Set<string>();
      this.notes.forEach((note: NoteFile) => {
        if (!note.content) return;
        try {
          const parsed = parseHtmlMetadata(note.content);
          (parsed.meta.tags || []).forEach((t: string) => activeNormalizedTags.add(t.toLowerCase()));
        } catch (e) {
          // ignore parsing error for this specific note
        }
      });
      
      // Delete any global tag that has no active relations (is not in activeNormalizedTags)
      for (const tag of globalTags) {
        if (!activeNormalizedTags.has(tag.normalizedName)) {
          await this.tagDb.deleteTag(tag.id);
        }
      }
      
      // Refresh tags list
      this.tags = await this.tagDb.listTags();
    } catch (e) {
      console.error('[MyNotes] pruneUnusedTags error:', e);
    }
  }

  // ST-002 Tag CRUD operations API
  async createTag(name: string): Promise<Tag> {
    if (!this.tagDb) throw new Error('Tag database not initialized');
    const tag = await this.tagDb.addTag(name);
    this.tags = await this.tagDb.listTags();
    return tag;
  }

  // ST-011: Bulk Operations Actions
  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) {
      this.clearSelection();
    }
  }

  toggleNoteSelection(notePath: string) {
    if (this.selectedNotes.has(notePath)) {
      this.selectedNotes.delete(notePath);
    } else {
      this.selectedNotes.add(notePath);
    }
    this.selectedNotes = new Set(this.selectedNotes);
  }

  selectAllNotes(visibleNotes: string[]) {
    const allSelected = visibleNotes.every(p => this.selectedNotes.has(p));
    if (allSelected) {
      visibleNotes.forEach(p => this.selectedNotes.delete(p));
    } else {
      visibleNotes.forEach(p => this.selectedNotes.add(p));
    }
    this.selectedNotes = new Set(this.selectedNotes);
  }

  clearSelection() {
    this.selectedNotes.clear();
    this.selectedNotes = new Set();
  }

  // ST-016: Confirmation Modal Actions
  showConfirmation(options: {
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void | Promise<void>;
  }) {
    this.confirmTitle = options.title;
    this.confirmMessage = options.message;
    this.confirmButtonText = options.confirmText || 'Delete';
    this.confirmOnConfirm = async () => {
      await options.onConfirm();
      this.closeConfirmation();
    };
    this.showConfirmModal = true;
  }

  closeConfirmation() {
    this.showConfirmModal = false;
    this.confirmOnConfirm = null;
  }

  showPrompt(options: {
    title: string;
    message: string;
    value?: string;
    placeholder?: string;
    onConfirm: (value: string) => void | Promise<void>;
  }) {
    this.promptTitle = options.title;
    this.promptMessage = options.message;
    this.promptValue = options.value || '';
    this.promptPlaceholder = options.placeholder || '';
    this.promptOnConfirm = options.onConfirm;
    this.showPromptModal = true;
  }

  closePrompt() {
    this.showPromptModal = false;
    this.promptOnConfirm = null;
  }

  async bulkAddTag(tagName: string): Promise<void> {
    if (this.selectedNotes.size === 0) return;
    const cleanName = tagName.trim();
    if (!cleanName) return;

    const notesToUpdate = Array.from(this.selectedNotes);
    let updatedAny = false;
    
    for (const notePath of notesToUpdate) {
      const note = this.notes.find((n: NoteFile) => n.path === notePath);
      if (!note) continue;

      const parsed = parseHtmlMetadata(note.content);
      const currentTags = parsed.meta.tags || [];
      const normalizedNew = cleanName.toLowerCase();
      
      if (!currentTags.some((t: string) => t.trim().toLowerCase() === normalizedNew)) {
        parsed.meta.tags = [...currentTags, cleanName];
        const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        note.content = updatedContent;
        note.modified = Date.now();

        if (this.activeNotePath === notePath) {
          this.activeNoteContent = updatedContent;
        }

        await this.storage.writeNote(notePath, updatedContent);
        updatedAny = true;
      }
    }

    if (updatedAny) {
      await this.refreshNotes();
      if (this.syncEnabled && this.googleConnected) {
        this.triggerDebouncedSync();
      }
    }
  }

  async bulkRemoveTag(tagName: string): Promise<void> {
    if (this.selectedNotes.size === 0) return;
    const normalizedRemove = tagName.trim().toLowerCase();

    const notesToUpdate = Array.from(this.selectedNotes);
    let updatedAny = false;

    for (const notePath of notesToUpdate) {
      const note = this.notes.find((n: NoteFile) => n.path === notePath);
      if (!note) continue;

      const parsed = parseHtmlMetadata(note.content);
      const currentTags = parsed.meta.tags || [];
      
      const updatedTags = currentTags.filter((t: string) => t.trim().toLowerCase() !== normalizedRemove);
      if (updatedTags.length !== currentTags.length) {
        parsed.meta.tags = updatedTags;
        const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        note.content = updatedContent;
        note.modified = Date.now();

        if (this.activeNotePath === notePath) {
          this.activeNoteContent = updatedContent;
        }

        await this.storage.writeNote(notePath, updatedContent);
        updatedAny = true;
      }
    }

    if (updatedAny) {
      await this.refreshNotes();
      if (this.syncEnabled && this.googleConnected) {
        this.triggerDebouncedSync();
      }
    }
  }

  async bulkDeleteNotes(notePaths: string[]): Promise<void> {
    if (notePaths.length === 0) return;
    
    let activeDeleted = false;
    for (const path of notePaths) {
      if (this.activeNotePath === path) {
        activeDeleted = true;
      }
    }
    if (activeDeleted) {
      this.activeNotePath = null;
      this.activeNoteContent = '';
      this.activeNoteTitle = '';
      this.editorDirty = false;
    }

    const mappings = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
    const remoteIdsToDelete: { path: string; id: string }[] = [];

    for (const path of notePaths) {
      try {
        await this.storage.deleteNote(path);
        const mapEntry = mappings[path];
        const remoteId = mapEntry ? (typeof mapEntry === 'string' ? mapEntry : mapEntry.id) : undefined;
        if (remoteId) {
          remoteIdsToDelete.push({ path, id: remoteId });
        }
      } catch (err) {
        console.error(`Failed to delete note "${path}" locally:`, err);
      }
    }

    await this.refreshNotes();
    
    this.showToast(`Deleted ${notePaths.length} note(s) locally.`, 'success', 3000);

    if (activeDeleted && this.notes.length > 0) {
      this.selectNote(this.notes[0].path);
    }

    if (this.syncEnabled && this.googleConnected && this.syncService && remoteIdsToDelete.length > 0) {
      const toastId = this.showToast(`Syncing deletion of ${remoteIdsToDelete.length} note(s) to Google Drive...`, 'info', 0, undefined, true);
      try {
        const activeMappings = { ...mappings };
        let successCount = 0;
        for (const item of remoteIdsToDelete) {
          try {
            await this.syncService.deleteFile(item.id);
            delete activeMappings[item.path];
            successCount++;
          } catch (e) {
            console.error(`Failed to delete remote file for ${item.path}:`, e);
          }
        }
        localStorage.setItem('mynotes_drive_mappings', JSON.stringify(activeMappings));
        this.driveMappings = activeMappings;
        
        this.updateToast(toastId, {
          message: `Deleted ${successCount} note(s) from Google Drive.`,
          type: 'success',
          loading: false,
          duration: 3000
        });
      } catch (e) {
        console.error('Remote bulk delete failed', e);
        this.updateToast(toastId, {
          message: `Failed to complete bulk deletion on Google Drive. Will retry on next sync.`,
          type: 'warning',
          loading: false,
          duration: 4000
        });
      }
    }
    
    this.clearSelection();
  }

  async bulkMoveNotes(notePaths: string[], targetNotebook: string | null): Promise<void> {
    if (notePaths.length === 0) return;
    const cleanNotebook = targetNotebook ? targetNotebook.trim() : null;

    let movedAny = false;
    const mappings = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
    const activeMappings = { ...mappings };

    for (const oldPath of notePaths) {
      const note = this.notes.find((n: NoteFile) => n.path === oldPath);
      if (!note) continue;

      const parts = oldPath.split('/');
      const filename = parts.pop()!;
      const cleanTitle = filename.replace(/\.html$/, '');

      let newPath = cleanNotebook ? `${cleanNotebook}/${filename}` : filename;
      if (newPath === oldPath) continue;

      let version = 1;
      let finalNewPath = newPath;
      let titleUpdated = false;
      let finalTitle = cleanTitle;

      while (this.notes.some(n => n.path === finalNewPath) || finalNewPath === oldPath) {
        if (finalNewPath === oldPath) {
          break;
        }
        finalTitle = `${cleanTitle} (${version})`;
        finalNewPath = cleanNotebook 
          ? `${cleanNotebook}/${finalTitle}.html`
          : `${finalTitle}.html`;
        version++;
        titleUpdated = true;
      }

      if (finalNewPath === oldPath) continue;

      try {
        const parsed = parseHtmlMetadata(note.content);
        parsed.meta.id = finalNewPath;
        if (titleUpdated) {
          parsed.meta.title = finalTitle;
        }
        const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        
        await this.storage.writeNote(oldPath, updatedContent);
        await this.storage.renameNote(oldPath, finalNewPath);

        if (this.favorites.includes(oldPath)) {
          this.favorites = this.favorites.map(p => p === oldPath ? finalNewPath : p);
          localStorage.setItem('mynotes_favorites', JSON.stringify(this.favorites));
        }

        if (activeMappings[oldPath]) {
          activeMappings[finalNewPath] = activeMappings[oldPath];
          delete activeMappings[oldPath];
        }

        if (this.activeNotePath === oldPath) {
          this.activeNotePath = finalNewPath;
          if (titleUpdated) {
            this.activeNoteTitle = finalTitle;
          }
        }

        movedAny = true;
      } catch (err) {
        console.error(`Failed to move note "${oldPath}" to "${finalNewPath}":`, err);
      }
    }

    if (movedAny) {
      localStorage.setItem('mynotes_drive_mappings', JSON.stringify(activeMappings));
      this.driveMappings = activeMappings;

      await this.refreshNotes();
      this.showToast(`Moved ${notePaths.length} note(s) to ${cleanNotebook || 'root'}.`, 'success', 3000);

      if (this.syncEnabled && this.googleConnected) {
        this.triggerDebouncedSync();
      }
    }

    this.clearSelection();
  }

  async addTagToNote(notePath: string, tagName: string): Promise<void> {
    const note = this.notes.find((n: NoteFile) => n.path === notePath);
    if (!note) throw new Error(`Note not found: ${notePath}`);

    const parsed = parseHtmlMetadata(note.content);
    const currentTags = parsed.meta.tags || [];
    
    // Check if tag is already associated (case-insensitively)
    const normalizedNew = tagName.trim().toLowerCase();
    if (currentTags.some((t: string) => t.trim().toLowerCase() === normalizedNew)) {
      return;
    }

    // Append tag (maintaining case of user input)
    parsed.meta.tags = [...currentTags, tagName.trim()];
    const updatedContent = generateHtmlNote(parsed.meta, parsed.content);

    // Write note
    note.content = updatedContent;
    note.modified = Date.now();
    
    if (this.activeNotePath === notePath) {
      this.activeNoteContent = updatedContent;
    }

    await this.storage.writeNote(notePath, updatedContent);

    // Refresh database index
    await this.refreshNotes();

    // Trigger background sync if enabled
    if (this.syncEnabled && this.googleConnected) {
      this.triggerDebouncedSync();
    }
  }

  async removeTagFromNote(notePath: string, tagName: string): Promise<void> {
    const note = this.notes.find((n: NoteFile) => n.path === notePath);
    if (!note) throw new Error(`Note not found: ${notePath}`);

    const parsed = parseHtmlMetadata(note.content);
    const currentTags = parsed.meta.tags || [];
    
    const normalizedRemove = tagName.trim().toLowerCase();
    const updatedTags = currentTags.filter((t: string) => t.trim().toLowerCase() !== normalizedRemove);

    if (updatedTags.length === currentTags.length) {
      return; // tag was not on note
    }

    parsed.meta.tags = updatedTags;
    const updatedContent = generateHtmlNote(parsed.meta, parsed.content);

    // Write note
    note.content = updatedContent;
    note.modified = Date.now();

    if (this.activeNotePath === notePath) {
      this.activeNoteContent = updatedContent;
    }

    await this.storage.writeNote(notePath, updatedContent);

    // Refresh database index
    await this.refreshNotes();

    // Trigger background sync if enabled
    if (this.syncEnabled && this.googleConnected) {
      this.triggerDebouncedSync();
    }
  }

  async renameTag(oldName: string, newName: string): Promise<void> {
    if (!this.tagDb) throw new Error('Tag database not initialized');
    const cleanOld = oldName.trim();
    const cleanNew = newName.trim();
    if (!cleanOld || !cleanNew) return;
    if (cleanOld.toLowerCase() === cleanNew.toLowerCase()) return;

    // Find the tag to rename
    const dbTags = await this.tagDb.listTags();
    const targetTag = dbTags.find((t: Tag) => t.normalizedName === cleanOld.toLowerCase());
    if (!targetTag) return;

    // Check if target tag name already exists
    const existingTargetTag = dbTags.find((t: Tag) => t.normalizedName === cleanNew.toLowerCase());

    if (existingTargetTag) {
      // Merge case: We are renaming "oldName" to a tag that already exists!
      // Find all notes containing oldName, replace with newName (if not already there)
      for (const note of this.notes) {
        const parsed = parseHtmlMetadata(note.content);
        const currentTags = parsed.meta.tags || [];
        
        if (currentTags.some((t: string) => t.trim().toLowerCase() === cleanOld.toLowerCase())) {
          // Filter out oldName
          let updatedTags = currentTags.filter((t: string) => t.trim().toLowerCase() !== cleanOld.toLowerCase());
          // Add newName if not already present
          if (!updatedTags.some((t: string) => t.trim().toLowerCase() === cleanNew.toLowerCase())) {
            updatedTags.push(cleanNew);
          }
          
          parsed.meta.tags = updatedTags;
          const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
          note.content = updatedContent;
          note.modified = Date.now();
          
          if (this.activeNotePath === note.path) {
            this.activeNoteContent = updatedContent;
          }
          await this.storage.writeNote(note.path, updatedContent);
        }
      }

      // Delete the old tag globally from DB (which removes its relations)
      await this.tagDb.deleteTag(targetTag.id);
    } else {
      // Standard rename case: Update tag name in DB
      await this.tagDb.renameTagInDb(targetTag.id, cleanNew);

      // Update in all note files
      for (const note of this.notes) {
        const parsed = parseHtmlMetadata(note.content);
        const currentTags = parsed.meta.tags || [];
        
        if (currentTags.some((t: string) => t.trim().toLowerCase() === cleanOld.toLowerCase())) {
          parsed.meta.tags = currentTags.map((t: string) => t.trim().toLowerCase() === cleanOld.toLowerCase() ? cleanNew : t);
          
          const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
          note.content = updatedContent;
          note.modified = Date.now();
          
          if (this.activeNotePath === note.path) {
            this.activeNoteContent = updatedContent;
          }
          await this.storage.writeNote(note.path, updatedContent);
        }
      }
    }

    // Refresh database index
    await this.refreshNotes();

    // Trigger background sync if enabled
    if (this.syncEnabled && this.googleConnected) {
      this.triggerDebouncedSync();
    }
  }

  async deleteTag(tagName: string): Promise<void> {
    if (!this.tagDb) throw new Error('Tag database not initialized');
    const cleanName = tagName.trim();
    if (!cleanName) return;

    // Find tag in DB
    const dbTags = await this.tagDb.listTags();
    const targetTag = dbTags.find((t: Tag) => t.normalizedName === cleanName.toLowerCase());
    if (!targetTag) return;

    // Remove from DB (handles relations deletion as well)
    await this.tagDb.deleteTag(targetTag.id);

    // Remove from all note files
    for (const note of this.notes) {
      const parsed = parseHtmlMetadata(note.content);
      const currentTags = parsed.meta.tags || [];
      
      if (currentTags.some((t: string) => t.trim().toLowerCase() === cleanName.toLowerCase())) {
        parsed.meta.tags = currentTags.filter((t: string) => t.trim().toLowerCase() !== cleanName.toLowerCase());
        
        const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        note.content = updatedContent;
        note.modified = Date.now();
        
        if (this.activeNotePath === note.path) {
          this.activeNoteContent = updatedContent;
        }
        await this.storage.writeNote(note.path, updatedContent);
      }
    }

    // Refresh database index
    await this.refreshNotes();

    // Trigger background sync if enabled
    if (this.syncEnabled && this.googleConnected) {
      this.triggerDebouncedSync();
    }
  }

  async readBlob(path: string): Promise<Blob | null> {
    if (this.storage.readBlob) {
      try {
        return await this.storage.readBlob(path);
      } catch (e) {
        console.error('Failed to read blob:', path, e);
      }
    }
    return null;
  }

  async writeBlob(path: string, blob: Blob) {
    if (this.storage.writeBlob) {
      await this.storage.writeBlob(path, blob);
    }
  }

  selectNote(path: string) {
    if (this.editorDirty && this.activeNotePath) {
      this.saveActiveNote(true);
    }
    const note = this.notes.find(n => n.path === path);
    if (note) {
      this.activeNotePath = path;
      this.activeNoteContent = note.content;
      this.activeNoteTitle = note.name;
      this.editorMode = 'text';
      this.editorDirty = false;
      this.setEditorCollapsed(false); // auto-expand editor on note selection
    }
  }

  resizeSidebar(delta: number) {
    this.sidebarWidth = Math.max(180, Math.min(400, this.sidebarWidth + delta));
    localStorage.setItem('mynotes_sidebar_width', String(this.sidebarWidth));
  }

  resizeNotelist(delta: number) {
    this.notelistWidth = Math.max(240, Math.min(500, this.notelistWidth + delta));
    localStorage.setItem('mynotes_notelist_width', String(this.notelistWidth));
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    localStorage.setItem('mynotes_sidebar_collapsed', String(collapsed));
  }

  setNotelistCollapsed(collapsed: boolean) {
    this.notelistCollapsed = collapsed;
    localStorage.setItem('mynotes_notelist_collapsed', String(collapsed));
  }

  setEditorCollapsed(collapsed: boolean) {
    this.editorCollapsed = collapsed;
    localStorage.setItem('mynotes_editor_collapsed', String(collapsed));
  }

  async saveActiveNote(immediateSync = false) {
    if (!this.activeNotePath) return;
    console.log('saveActiveNote called. immediateSync:', immediateSync, 'editorDirty:', this.editorDirty);
    
    // Update local reactive list first to prevent delay
    const noteIdx = this.notes.findIndex(n => n.path === this.activeNotePath);
    if (noteIdx !== -1) {
      this.notes[noteIdx].content = this.activeNoteContent;
      this.notes[noteIdx].modified = Date.now();
    }
    
    try {
      await this.storage.writeNote(this.activeNotePath, this.activeNoteContent);
      this.saveError = null;
      this.editorDirty = false;
      await this.refreshNotes();

      // Trigger auto background sync
      console.log('Checking sync pre-requisites: syncEnabled:', this.syncEnabled, 'googleConnected:', this.googleConnected);
      if (this.syncEnabled && this.googleConnected) {
        if (immediateSync) {
          console.log('Immediate sync requested. Clearing any active debounce timer...');
          if (this.syncDebounceTimer) {
            clearTimeout(this.syncDebounceTimer);
            this.syncDebounceTimer = null;
          }
          await this.syncNotes();
        } else {
          console.log('Triggering debounced sync...');
          this.triggerDebouncedSync();
        }
      }
    } catch (e: any) {
      console.error('Save active note failed:', e);
      this.saveError = e.message || String(e);
      throw e;
    }
  }

  async createNote(title: string, folder: string | null = null) {
    const cleanTitle = title.trim() || 'Untitled';
    let path = `${cleanTitle}.html`;
    if (folder) {
      path = `${folder}/${cleanTitle}.html`;
    }
    
    // Ensure unique path
    let version = 1;
    let finalPath = path;
    while (this.notes.some(n => n.path === finalPath)) {
      finalPath = folder 
        ? `${folder}/${cleanTitle} (${version}).html`
        : `${cleanTitle} (${version}).html`;
      version++;
    }

    const meta = {
      id: finalPath,
      title: cleanTitle,
      tags: this.selectedTag ? [this.selectedTag] : [],
      pinned: false,
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    const bodyContent = `<h1>${cleanTitle}</h1><p></p>`;
    const initialContent = generateHtmlNote(meta, bodyContent);
    await this.storage.writeNote(finalPath, initialContent);
    await this.refreshNotes();
    this.selectNote(finalPath);

    // Trigger auto background sync
    if (this.syncEnabled && this.googleConnected) {
      this.syncNotes();
    }
  }

  async deleteNote(path: string) {
    const noteName = path.split('/').pop()?.replace(/\.(md|html)$/, '') || path;
    
    // Read mapping before deleting note to enable deleting on Drive
    const mappings = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
    const mapEntry = mappings[path];
    const remoteId = mapEntry ? (typeof mapEntry === 'string' ? mapEntry : mapEntry.id) : undefined;

    // Deselect active note first if it's the one being deleted to avoid stale state in Editor
    const isActive = this.activeNotePath === path;
    if (isActive) {
      this.activeNotePath = null;
      this.activeNoteContent = '';
      this.activeNoteTitle = '';
      this.editorDirty = false;
    }

    try {
      await this.storage.deleteNote(path);
      await this.refreshNotes();
      
      this.showToast(`Deleted note "${noteName}" locally.`, 'success', 3000);
      
      if (isActive) {
        if (this.notes.length > 0) {
          this.selectNote(this.notes[0].path);
        }
      }
    } catch (err) {
      console.error('Local delete failed', err);
      this.showToast(`Failed to delete note "${noteName}" locally.`, 'error', 4000);
      return;
    }

    // Trigger remote deletion & update mappings
    if (this.syncEnabled && this.googleConnected && this.syncService) {
      if (remoteId) {
        const toastId = this.showToast(`Syncing deletion of "${noteName}" to Google Drive...`, 'info', 0, undefined, true);
        try {
          await this.syncService.deleteFile(remoteId);
          const activeMappings = { ...mappings };
          delete activeMappings[path];
          localStorage.setItem('mynotes_drive_mappings', JSON.stringify(activeMappings));
          this.driveMappings = activeMappings;
          
          this.updateToast(toastId, {
            message: `Deleted "${noteName}" from Google Drive.`,
            type: 'success',
            loading: false,
            duration: 3000
          });
        } catch (e) {
          console.error('Remote delete failed', e);
          this.updateToast(toastId, {
            message: `Could not delete "${noteName}" from Google Drive. Will retry on next sync.`,
            type: 'warning',
            loading: false,
            duration: 4000
          });
        }
      } else {
        this.showToast(`Note "${noteName}" was not synced to Google Drive (no remote file to delete).`, 'info', 3000);
      }
    }
  }

  async createNotebook(name: string) {
    const cleanName = name.trim();
    if (!cleanName) return;
    await this.storage.createDirectory(cleanName);
    const readmePath = `${cleanName}/ReadMe.html`;
    const meta = {
      id: readmePath,
      title: `${cleanName} Notebook`,
      tags: [],
      pinned: false,
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    const bodyContent = `<h1>${cleanName} Notebook 📂</h1><p>Folder created. Add your notes here!</p>`;
    const initialContent = generateHtmlNote(meta, bodyContent);
    await this.storage.writeNote(readmePath, initialContent);
    await this.refreshNotes();
    this.activeNotebook = cleanName;

    // Trigger auto background sync
    if (this.syncEnabled && this.googleConnected) {
      this.syncNotes();
    }
  }

  async deleteNotebook(path: string) {
    const notebookName = path.split('/').pop() || path;
    
    // If the active note is inside the deleted notebook, deselect it first
    const isActiveNoteInside = this.activeNotePath && (this.activeNotePath === path || this.activeNotePath.startsWith(path + '/'));
    if (isActiveNoteInside) {
      this.activeNotePath = null;
      this.activeNoteContent = '';
      this.activeNoteTitle = '';
      this.editorDirty = false;
    }

    try {
      await this.storage.deleteDirectory(path);
      await this.refreshNotes();
      this.showToast(`Deleted notebook "${notebookName}" locally.`, 'success', 3000);
      
      if (this.activeNotebook === path) {
        this.activeNotebook = null;
      }

      if (isActiveNoteInside) {
        if (this.notes.length > 0) {
          this.selectNote(this.notes[0].path);
        }
      }
    } catch (err) {
      console.error('Local notebook delete failed', err);
      this.showToast(`Failed to delete notebook "${notebookName}" locally.`, 'error', 4000);
      return;
    }

    // Trigger auto background sync (which handles cascading deletions based on drive mappings)
    if (this.syncEnabled && this.googleConnected) {
      this.showToast(`Syncing notebook deletion to Google Drive...`, 'info', 3000);
      this.syncNotes();
    }
  }

  async toggleFavorite(path: string) {
    const isFav = this.favorites.includes(path);
    if (isFav) {
      this.favorites = this.favorites.filter(p => p !== path);
    } else {
      this.favorites = [...this.favorites, path];
    }
    localStorage.setItem('mynotes_favorites', JSON.stringify(this.favorites));

    // Also update the note file content to persist the pinned state
    const note = this.notes.find(n => n.path === path);
    if (note) {
      try {
        const parsed = parseHtmlMetadata(note.content);
        parsed.meta.pinned = !isFav;
        
        const updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        note.content = updatedContent;
        note.modified = Date.now();
        
        if (this.activeNotePath === path) {
          this.activeNoteContent = updatedContent;
        }
        
        await this.storage.writeNote(path, updatedContent);
        
        // Trigger sync
        if (this.syncEnabled && this.googleConnected) {
          this.triggerDebouncedSync();
        }
      } catch (e) {
        console.error('Failed to update favorite status in file metadata', e);
      }
    }
  }

  async renameNote(oldPath: string, newTitle: string) {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;

    // Compute new relative path
    const parts = oldPath.split('/');
    parts[parts.length - 1] = `${cleanTitle}.html`;
    const newPath = parts.join('/');

    if (newPath === oldPath) return;

    // Check if new path already exists
    if (this.notes.some(n => n.path === newPath)) {
      this.showToast('A note with this name already exists.', 'warning', 4000);
      return;
    }

    try {
      // Force save active editor content before renaming so disk is up-to-date
      if (this.activeNotePath === oldPath) {
        if (this.onForceSave) {
          await this.onForceSave();
        } else {
          await this.saveActiveNote(true);
        }
      }

      // Read note, update title in metadata, write back, rename note
      const notes = await this.storage.listNotes();
      const existing = notes.find(n => n.path === oldPath);
      let updatedContent = '';
      if (existing) {
        const parsed = parseHtmlMetadata(existing.content);
        parsed.meta.title = cleanTitle;
        updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        await this.storage.writeNote(oldPath, updatedContent);
      }
      // Perform storage rename
      await this.storage.renameNote(oldPath, newPath);

      // Update favorites path if it was favorited
      if (this.favorites.includes(oldPath)) {
        this.favorites = this.favorites.map(p => p === oldPath ? newPath : p);
        localStorage.setItem('mynotes_favorites', JSON.stringify(this.favorites));
      }

      // Update drive mappings if sync is enabled
      const mappings = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
      if (mappings[oldPath]) {
        mappings[newPath] = mappings[oldPath];
        delete mappings[oldPath];
        localStorage.setItem('mynotes_drive_mappings', JSON.stringify(mappings));
        this.driveMappings = mappings;
      }

      // Update in-memory notes array before refreshNotes/selection to prevent transient null activeNote
      const noteIdx = this.notes.findIndex(n => n.path === oldPath);
      if (noteIdx !== -1) {
        this.notes[noteIdx].path = newPath;
        this.notes[noteIdx].name = cleanTitle;
        if (updatedContent) {
          this.notes[noteIdx].content = updatedContent;
        }
      }

      // Set tracker and active path BEFORE refreshNotes to avoid transient nulls
      this.lastRenamedPath = { oldPath, newPath };
      if (this.activeNotePath === oldPath) {
        this.activeNotePath = newPath;
        this.activeNoteTitle = cleanTitle;
      }

      await this.refreshNotes();
      this.selectNote(newPath);

      // Trigger sync
      if (this.syncEnabled && this.googleConnected) {
        this.syncNotes();
      }
    } catch (e) {
      console.error('Failed to rename note:', e);
      this.showToast('Failed to rename note file.', 'error', 4000);
    }
  }

  async moveNote(oldPath: string, targetNotebook: string | null) {
    const filename = oldPath.split('/').pop() || '';
    if (!filename) return;

    const newPath = targetNotebook 
      ? `${targetNotebook}/${filename}`
      : filename;

    if (newPath === oldPath) return;

    if (this.notes.some(n => n.path === newPath)) {
      this.showToast('A note with this name already exists in the destination notebook.', 'warning', 4000);
      return;
    }

    try {
      if (this.activeNotePath === oldPath) {
        if (this.onForceSave) {
          await this.onForceSave();
        } else {
          await this.saveActiveNote(true);
        }
      }

      // Read note, update its meta.id to newPath, write back, rename note
      const notes = await this.storage.listNotes();
      const existing = notes.find(n => n.path === oldPath);
      let updatedContent = '';
      if (existing) {
        const parsed = parseHtmlMetadata(existing.content);
        parsed.meta.id = newPath;
        updatedContent = generateHtmlNote(parsed.meta, parsed.content);
        await this.storage.writeNote(oldPath, updatedContent);
      }

      await this.storage.renameNote(oldPath, newPath);

      if (this.favorites.includes(oldPath)) {
        this.favorites = this.favorites.map(p => p === oldPath ? newPath : p);
        localStorage.setItem('mynotes_favorites', JSON.stringify(this.favorites));
      }

      const mappings = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
      if (mappings[oldPath]) {
        mappings[newPath] = mappings[oldPath];
        delete mappings[oldPath];
        localStorage.setItem('mynotes_drive_mappings', JSON.stringify(mappings));
        this.driveMappings = mappings;
      }

      const noteIdx = this.notes.findIndex(n => n.path === oldPath);
      if (noteIdx !== -1) {
        this.notes[noteIdx].path = newPath;
        if (updatedContent) {
          this.notes[noteIdx].content = updatedContent;
        }
      }

      this.lastRenamedPath = { oldPath, newPath };
      if (this.activeNotePath === oldPath) {
        this.activeNotePath = newPath;
      }

      await this.refreshNotes();
      this.selectNote(newPath);
      this.showToast(`Moved note to ${targetNotebook || 'Root folder'}.`, 'success', 3000);

      if (this.syncEnabled && this.googleConnected) {
        this.syncNotes();
      }
    } catch (e) {
      console.error('Failed to move note:', e);
      this.showToast('Failed to move note.', 'error', 4000);
    }
  }

  async copyNote(notePath: string, targetNotebook: string | null) {
    const filenameWithExt = notePath.split('/').pop() || '';
    if (!filenameWithExt) return;

    const extIdx = filenameWithExt.lastIndexOf('.');
    const baseName = extIdx !== -1 ? filenameWithExt.substring(0, extIdx) : filenameWithExt;
    const ext = extIdx !== -1 ? filenameWithExt.substring(extIdx) : '.html';

    let targetTitle = baseName;
    let newPath = targetNotebook ? `${targetNotebook}/${targetTitle}${ext}` : `${targetTitle}${ext}`;

    let version = 1;
    while (this.notes.some(n => n.path === newPath)) {
      targetTitle = `${baseName} Copy${version > 1 ? ' ' + version : ''}`;
      newPath = targetNotebook ? `${targetNotebook}/${targetTitle}${ext}` : `${targetTitle}${ext}`;
      version++;
    }

    try {
      const notes = await this.storage.listNotes();
      const existing = notes.find(n => n.path === notePath);
      if (!existing) return;

      const parsed = parseHtmlMetadata(existing.content);
      parsed.meta.id = newPath;
      parsed.meta.title = targetTitle;
      parsed.meta.created = new Date().toISOString();
      parsed.meta.modified = new Date().toISOString();

      const newContent = generateHtmlNote(parsed.meta, parsed.content);
      await this.storage.writeNote(newPath, newContent);
      await this.refreshNotes();
      this.selectNote(newPath);
      this.showToast(`Copied note as "${targetTitle}" to ${targetNotebook || 'Root folder'}.`, 'success', 3000);

      if (this.syncEnabled && this.googleConnected) {
        this.syncNotes();
      }
    } catch (e) {
      console.error('Failed to copy note:', e);
      this.showToast('Failed to copy note.', 'error', 4000);
    }
  }

  async refreshCalcTags() {
    if (!this.calcTagDb) return;
    try {
      this.calcTags = await this.calcTagDb.listCalcTags();
    } catch (e) {
      console.error('[MyNotes] refreshCalcTags error:', e);
    }
  }

  async createCalcTag(name: string, color?: string): Promise<CalcTag> {
    if (!this.calcTagDb) throw new Error('Calculation database not initialized');
    const tag = await this.calcTagDb.addCalcTag(name, color);
    await this.refreshCalcTags();
    return tag;
  }

  async renameCalcTag(tagId: string, newName: string): Promise<void> {
    if (!this.calcTagDb) throw new Error('Calculation database not initialized');
    await this.calcTagDb.renameCalcTag(tagId, newName);
    await this.refreshCalcTags();
  }

  async deleteCalcTag(tagId: string): Promise<void> {
    if (!this.calcTagDb) throw new Error('Calculation database not initialized');
    await this.calcTagDb.deleteCalcTag(tagId);
    await this.refreshCalcTags();
  }

  async setCalcTagEnabled(tagId: string, enabled: boolean): Promise<void> {
    if (!this.calcTagDb) throw new Error('Calculation database not initialized');
    await this.calcTagDb.setTagEnabled(tagId, enabled);
    await this.refreshCalcTags();
  }

  async setCalcTagColor(tagId: string, color: string): Promise<void> {
    if (!this.calcTagDb) throw new Error('Calculation database not initialized');
    await this.calcTagDb.setTagColor(tagId, color);
    await this.refreshCalcTags();
  }

  async syncCalcTags(notesList: NoteFile[]): Promise<void> {
    if (!this.calcTagDb) return;
    try {
      const dbTags = await this.calcTagDb.listCalcTags();
      let dbUpdated = false;

      for (const note of notesList) {
        if (!note.content) continue;
        if (typeof DOMParser === 'undefined') continue;

        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(note.content, 'text/html');
          const metricsBlocks = doc.querySelectorAll('div[data-type="metrics"]');

          for (const block of metricsBlocks) {
            const tagsMetadataAttr = block.getAttribute('data-tags-metadata');
            if (!tagsMetadataAttr) continue;

            const remoteTags = JSON.parse(tagsMetadataAttr);
            if (Array.isArray(remoteTags)) {
              for (const remoteTag of remoteTags) {
                if (!remoteTag || !remoteTag.id || !remoteTag.name) continue;
                
                const exists = dbTags.some((t: CalcTag) => t.id === remoteTag.id);
                if (!exists) {
                  const newTag: CalcTag = {
                    id: remoteTag.id,
                    name: remoteTag.name,
                    normalizedName: remoteTag.name.toLowerCase(),
                    enabled: remoteTag.enabled !== false,
                    createdAt: remoteTag.createdAt || Date.now(),
                    color: remoteTag.color
                  };
                  await this.calcTagDb.upsertCalcTag(newTag);
                  dbTags.push(newTag);
                  dbUpdated = true;
                  console.log(`[MyNotes] Auto-imported budget category "${newTag.name}" (${newTag.id}) from note.`);
                }
              }
            }
          }
        } catch (err) {
          console.error(`[MyNotes] Failed to parse budget categories from note content: ${note.path}`, err);
        }
      }

      if (dbUpdated) {
        await this.refreshCalcTags();
      }
    } catch (e) {
      console.error('[MyNotes] Failed to sync calc tags:', e);
    }
  }

}

export const appState = new AppState();
