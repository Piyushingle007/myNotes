import { type NoteFile, type StorageAdapter, IndexedDBAdapter, FileSystemAccessAdapter } from '../storage/StorageAdapter';
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
}

export function parseHtmlMetadata(html: string): { meta: any; content: string } {
  const meta: any = {
    id: '',
    title: '',
    tags: [],
    pinned: false,
    created: '',
    modified: ''
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
  notes = $state<NoteFile[]>([]);
  activeNotePath = $state<string | null>(null);
  activeNoteContent = $state<string>('');
  activeNoteTitle = $state<string>('');
  activeNotebook = $state<string | null>(null);
  activeTab = $state<'home' | 'search' | 'library' | 'daily'>('home');
  favorites = $state<string[]>(JSON.parse(localStorage.getItem('mynotes_favorites') || '[]'));
  searchQuery = $state<string>('');
  showSettings = $state<boolean>(false);
  settingsActiveTab = $state<'sync' | 'styling' | 'editor'>('sync');
  isReadOnly = $state<boolean>(false);
  sourceMode = $state<boolean>(localStorage.getItem('mynotes_editor_source_mode') === 'true');
  editorDirty = $state<boolean>(false);
  theme = $state<string>(localStorage.getItem('mynotes_theme') || 'steel');
  customDriveFolderId = $state<string | null>(localStorage.getItem('mynotes_custom_drive_folder_id') || null);
  customDriveFolderName = $state<string | null>(localStorage.getItem('mynotes_custom_drive_folder_name') || null);
  googleDriveFolders = $state<any[]>([]);
  fetchingFolders = $state<boolean>(false);
  onForceSave = null as (() => Promise<void>) | null;
  lastRenamedPath = null as { oldPath: string; newPath: string } | null;

  // Layout States
  sidebarWidth = $state<number>(Number(localStorage.getItem('mynotes_sidebar_width')) || 260);
  sidebarCollapsed = $state<boolean>(localStorage.getItem('mynotes_sidebar_collapsed') === 'true');
  notelistWidth = $state<number>(Number(localStorage.getItem('mynotes_notelist_width')) || 340);
  notelistCollapsed = $state<boolean>(localStorage.getItem('mynotes_notelist_collapsed') === 'true');
  editorCollapsed = $state<boolean>(localStorage.getItem('mynotes_editor_collapsed') === 'true');

  // Diagram Editor Preference: 'native' (built-in), 'drawio' (embed diagrams.net), or 'mermaid'
  diagramEditorType = $state<'native' | 'drawio' | 'mermaid'>((localStorage.getItem('mynotes_diagram_editor') as 'native' | 'drawio' | 'mermaid') || 'drawio');

  setDiagramEditorType(type: 'native' | 'drawio' | 'mermaid') {
    this.diagramEditorType = type;
    localStorage.setItem('mynotes_diagram_editor', type);
  }

  setSourceMode(val: boolean) {
    this.sourceMode = val;
    localStorage.setItem('mynotes_editor_source_mode', String(val));
  }

  toggleReadMode() {
    this.isReadOnly = !this.isReadOnly;
  }

  themes = [
    { id: 'steel', name: 'Steel Minimalist 🛡️', bg: '#111317', accent: '#00adb5' },
    { id: 'nordic', name: 'Nordic Frost 🏔️', bg: '#0f141c', accent: '#58a6ff' },
    { id: 'dracula', name: 'Dracula Vampire 🧛', bg: '#1e1f29', accent: '#ff79c6' },
    { id: 'synthwave', name: 'Synthwave 1984 🎸', bg: '#170621', accent: '#ff007f' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon ⚡', bg: '#0b0813', accent: '#00ffff' },
    { id: 'black', name: 'Amoled Black 🌌', bg: '#000000', accent: '#ffffff' },
    { id: 'paper', name: 'Paper Lite 📝', bg: '#fcfbf9', accent: '#2b2a27' },
    { id: 'sakura', name: 'Sakura Breeze 🌸', bg: '#fff0f3', accent: '#ff758f' },
    { id: 'matcha', name: 'Matcha Latte 🍵', bg: '#f7f4eb', accent: '#606c38' }
  ];

  // Google Drive Sync Reactive States
  googleClientId = $state<string>(localStorage.getItem('mynotes_google_client_id') || '');
  googleConnected = $state<boolean>(false);
  googleUserEmail = $state<string | null>(null);
  syncStatus = $state<'idle' | 'syncing' | 'error'>('idle');
  lastSyncedTime = $state<number | null>(localStorage.getItem('mynotes_last_synced') ? Number(localStorage.getItem('mynotes_last_synced')) : null);
  syncEnabled = $state<boolean>(localStorage.getItem('mynotes_sync_enabled') === 'true');
  editorViewMode = $state<'edit' | 'split' | 'preview'>((localStorage.getItem('mynotes_editor_view_mode') as any) || 'edit');
  driveMappings = $state<Record<string, SyncMapping>>({});
  toasts = $state<Toast[]>([]);
  focusModeEnabled = $state<boolean>(localStorage.getItem('mynotes_focus_mode') === 'true');
  typewriterScrollEnabled = $state<boolean>(localStorage.getItem('mynotes_typewriter_scroll') === 'true');

  showToast(message: string, type: 'success' | 'info' | 'error' | 'warning' = 'info', duration = 4000, title?: string, loading = false): string {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = { id, message, type, title, loading, duration };
    this.toasts = [...this.toasts, newToast];

    if (duration > 0 && !loading) {
      setTimeout(() => {
        this.dismissToast(id);
      }, duration);
    }
    return id;
  }

  updateToast(id: string, updates: Partial<Omit<Toast, 'id'>>) {
    this.toasts = this.toasts.map(t => {
      if (t.id === id) {
        const updated = { ...t, ...updates };
        if (t.loading && !updated.loading && updated.duration && updated.duration > 0) {
          setTimeout(() => {
            this.dismissToast(id);
          }, updated.duration);
        }
        return updated;
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
    if (typeof google !== 'undefined') return;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (typeof google !== 'undefined') {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Google Identity Services SDK failed to load.'));
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

    if (this.searchQuery.trim()) {
      try {
        const results = this.searchIndex.search(this.searchQuery);
        const paths = results.map(r => r.id);
        list = list.filter(n => paths.includes(n.path));
      } catch (e) {
        // Fail-safe search fallback
        const q = this.searchQuery.toLowerCase();
        list = list.filter(n => n.name.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
      }
    }

    // Sort by modified date descending
    return [...list].sort((a, b) => b.modified - a.modified);
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

  setSyncEnabled(enabled: boolean) {
    this.syncEnabled = enabled;
    localStorage.setItem('mynotes_sync_enabled', String(enabled));
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

  async disconnectGoogleDrive() {
    this.syncService.clearToken();
    localStorage.removeItem('mynotes_google_access_token');
    localStorage.removeItem('mynotes_google_token_expiry');
    this.googleConnected = false;
    this.googleUserEmail = null;
    this.setSyncEnabled(false);
    this.syncStatus = 'idle';
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
    
    await this.storage.writeNote(this.activeNotePath, this.activeNoteContent);
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
      tags: [],
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

  toggleFavorite(path: string) {
    if (this.favorites.includes(path)) {
      this.favorites = this.favorites.filter(p => p !== path);
    } else {
      this.favorites = [...this.favorites, path];
    }
    localStorage.setItem('mynotes_favorites', JSON.stringify(this.favorites));
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
      alert('A note with this name already exists.');
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
      alert('Failed to rename note file.');
    }
  }

}

export const appState = new AppState();
