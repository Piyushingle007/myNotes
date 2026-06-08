import { type NoteFile, type StorageAdapter, IndexedDBAdapter, FileSystemAccessAdapter } from '../storage/StorageAdapter';
import { GoogleDriveSync } from '../sync/GoogleDriveSync';
import MiniSearch from 'minisearch';

declare const google: any;

export interface SyncMapping {
  id: string;
  lastSyncRemoteTime: number;
  lastSyncLocalTime: number;
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
  searchQuery = $state<string>('');
  showSettings = $state<boolean>(false);
  editorDirty = $state<boolean>(false);
  theme = $state<string>(localStorage.getItem('mynotes_theme') || 'steel');
  customDriveFolderId = $state<string | null>(localStorage.getItem('mynotes_custom_drive_folder_id') || null);
  customDriveFolderName = $state<string | null>(localStorage.getItem('mynotes_custom_drive_folder_name') || null);
  googleDriveFolders = $state<any[]>([]);
  fetchingFolders = $state<boolean>(false);

  // Layout States
  sidebarWidth = $state<number>(Number(localStorage.getItem('mynotes_sidebar_width')) || 260);
  sidebarCollapsed = $state<boolean>(localStorage.getItem('mynotes_sidebar_collapsed') === 'true');
  notelistWidth = $state<number>(Number(localStorage.getItem('mynotes_notelist_width')) || 340);
  notelistCollapsed = $state<boolean>(localStorage.getItem('mynotes_notelist_collapsed') === 'true');
  editorCollapsed = $state<boolean>(localStorage.getItem('mynotes_editor_collapsed') === 'true');

  themes = [
    { id: 'steel', name: 'Steel Minimalist', bg: '#111317', accent: '#00adb5' },
    { id: 'nordic', name: 'Nordic Frost', bg: '#0f141c', accent: '#58a6ff' },
    { id: 'dracula', name: 'Dracula Vampire', bg: '#1e1f29', accent: '#ff79c6' },
    { id: 'sepia', name: 'Sepia Warmth', bg: '#1b1712', accent: '#d97706' },
    { id: 'emerald', name: 'Emerald Forest', bg: '#0a0f0d', accent: '#10b981' },
    { id: 'black', name: 'Amoled Black', bg: '#000000', accent: '#ffffff' },
    { id: 'dark', name: 'Standard Dark', bg: '#121212', accent: '#1ed760' }
  ];

  // Google Drive Sync Reactive States
  googleClientId = $state<string>(localStorage.getItem('mynotes_google_client_id') || '');
  googleConnected = $state<boolean>(false);
  googleUserEmail = $state<string | null>(null);
  syncStatus = $state<'idle' | 'syncing' | 'error'>('idle');
  lastSyncedTime = $state<number | null>(localStorage.getItem('mynotes_last_synced') ? Number(localStorage.getItem('mynotes_last_synced')) : null);
  syncEnabled = $state<boolean>(localStorage.getItem('mynotes_sync_enabled') === 'true');
  editorViewMode = $state<'edit' | 'split' | 'preview'>((localStorage.getItem('mynotes_editor_view_mode') as any) || 'edit');

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
      console.log('Existing sync timer cleared. Restarting 15s debounce...');
      clearTimeout(this.syncDebounceTimer);
    } else {
      console.log('Starting 15s debounce timer for Google Drive sync...');
    }

    this.syncDebounceTimer = window.setTimeout(async () => {
      console.log('Debounce timer fired. Initiating remote sync now...');
      this.syncDebounceTimer = null;
      await this.syncNotes();
    }, 15000); // 15 seconds debounce
  }

  async syncNotes() {
    if (!this.syncEnabled || !this.googleConnected || !this.syncService) return;

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

        console.log(`Sync check for: ${note.path}`);
        if (driveFile) {
          const remoteTime = new Date(driveFile.modifiedTime).getTime();
          console.log(`  Remote file found: ${driveFile.name} (ID: ${driveFile.id})`);
          console.log(`  Local modified: ${note.modified} (Last sync local: ${lastSyncLocalTime})`);
          console.log(`  Remote modified: ${remoteTime} (Last sync remote: ${lastSyncRemoteTime})`);
          
          const localChanged = note.modified > lastSyncLocalTime + 2000;
          const remoteChanged = remoteTime > lastSyncRemoteTime + 2000;
          console.log(`  localChanged: ${localChanged}, remoteChanged: ${remoteChanged}`);

          if (localChanged && remoteChanged) {
            // Conflict! Resolving via Last Modified Wins
            console.log('  Conflict detected! Resolving via Last Modified Wins.');
            if (note.modified > remoteTime) {
              console.log('  Local is newer. Uploading note...');
              const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.md`, note.content, driveFile.id);
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
            const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.md`, note.content, driveFile.id);
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
            await this.storage.deleteNote(note.path);
          } else {
            console.log('  New local note found. Uploading to Google Drive...');
            const uploadRes = await uploadNoteToDrive(note.path, `${note.name}.md`, note.content);
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
          } catch (e) {
            console.error(`Failed to delete remote file ${remote.id}:`, e);
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
      console.log('Mappings updated:', activeMappings);
      
      await this.refreshNotes();
      this.lastSyncedTime = Date.now();
      localStorage.setItem('mynotes_last_synced', String(this.lastSyncedTime));
      this.syncStatus = 'idle';
      console.log('--- SYNC CYCLE COMPLETED SUCCESSFULLY ---');
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



  async initSandbox() {
    console.log('[MyNotes] initSandbox started');
    try {
      this.storage = new IndexedDBAdapter();
      console.log('[MyNotes] IndexedDBAdapter instance created');
      const name = await this.storage.selectDirectory();
      console.log('[MyNotes] selectDirectory returned:', name);
      this.vaultName = name;
      
      // Clean up existing default files if they are in the storage
      console.log('[MyNotes] listNotes starting...');
      const list = await this.storage.listNotes();
      console.log('[MyNotes] listNotes completed, count:', list?.length);
      const defaultFiles = ['Welcome.md', 'Recipes/Pizza.md', 'Daily Notes/2026-06-08.md'];
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
      
      // Select first note by default on desktop if any, but keep dashboard open on mobile
      const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 768;
      if (!isMobileViewport) {
        if (this.notes && this.notes.length > 0) {
          this.selectNote(this.notes[0].path);
        }
      } else {
        this.activeNotePath = null;
      }
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

      const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 768;
      if (!isMobileViewport && this.notes.length > 0) {
        this.selectNote(this.notes[0].path);
      } else {
        this.activeNotePath = null;
        this.activeNoteContent = '';
        this.activeNoteTitle = '';
      }
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
      content: note.content
    }));
    this.searchIndex.addAll(searchDocs);
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
    let path = `${cleanTitle}.md`;
    if (folder) {
      path = `${folder}/${cleanTitle}.md`;
    }
    
    // Ensure unique path
    let version = 1;
    let finalPath = path;
    while (this.notes.some(n => n.path === finalPath)) {
      finalPath = folder 
        ? `${folder}/${cleanTitle} (${version}).md`
        : `${cleanTitle} (${version}).md`;
      version++;
    }

    const initialContent = `# ${cleanTitle.replace(/\.md$/, '')}\n\n`;
    await this.storage.writeNote(finalPath, initialContent);
    await this.refreshNotes();
    this.selectNote(finalPath);

    // Trigger auto background sync
    if (this.syncEnabled && this.googleConnected) {
      this.syncNotes();
    }
  }

  async deleteNote(path: string) {
    // Read mapping before deleting note to enable deleting on Drive
    const mappings = JSON.parse(localStorage.getItem('mynotes_drive_mappings') || '{}');
    const remoteId = mappings[path];

    await this.storage.deleteNote(path);
    await this.refreshNotes();
    
    if (this.activeNotePath === path) {
      if (this.notes.length > 0) {
        this.selectNote(this.notes[0].path);
      } else {
        this.activeNotePath = null;
        this.activeNoteContent = '';
        this.activeNoteTitle = '';
      }
    }

    // Trigger remote deletion & update mappings
    if (this.syncEnabled && this.googleConnected && this.syncService && remoteId) {
      try {
        await this.syncService.deleteFile(remoteId);
        const activeMappings = { ...mappings };
        delete activeMappings[path];
        localStorage.setItem('mynotes_drive_mappings', JSON.stringify(activeMappings));
      } catch (e) {
        console.error('Remote delete failed', e);
      }
    }
  }

  async createNotebook(name: string) {
    const cleanName = name.trim();
    if (!cleanName) return;
    await this.storage.createDirectory(cleanName);
    await this.storage.writeNote(`${cleanName}/ReadMe.md`, `# ${cleanName} Notebook 📂\n\nFolder created. Add your notes here!`);
    await this.refreshNotes();
    this.activeNotebook = cleanName;

    // Trigger auto background sync
    if (this.syncEnabled && this.googleConnected) {
      this.syncNotes();
    }
  }

  async deleteNotebook(path: string) {
    await this.storage.deleteDirectory(path);
    await this.refreshNotes();
    if (this.activeNotebook === path) {
      this.activeNotebook = null;
    }

    // Trigger auto background sync (which handles cascading deletions based on drive mappings)
    if (this.syncEnabled && this.googleConnected) {
      this.syncNotes();
    }
  }


}

export const appState = new AppState();
