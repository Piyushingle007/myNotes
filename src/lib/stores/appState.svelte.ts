import { type NoteFile, type StorageAdapter, IndexedDBAdapter, FileSystemAccessAdapter } from '../storage/StorageAdapter';
import { GoogleDriveSync } from '../sync/GoogleDriveSync';
import MiniSearch from 'minisearch';

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
  activeTag = $state<string | null>(null);
  activeTab = $state<'home' | 'search' | 'library' | 'daily'>('home');
  searchQuery = $state<string>('');
  showSettings = $state<boolean>(false);
  editorDirty = $state<boolean>(false);
  theme = $state<'dark' | 'black'>('dark');

  // Google Drive Sync Reactive States
  googleClientId = $state<string>(localStorage.getItem('mynotes_google_client_id') || '');
  googleConnected = $state<boolean>(false);
  googleUserEmail = $state<string | null>(null);
  syncStatus = $state<'idle' | 'syncing' | 'error'>('idle');
  lastSyncedTime = $state<number | null>(localStorage.getItem('mynotes_last_synced') ? Number(localStorage.getItem('mynotes_last_synced')) : null);
  syncEnabled = $state<boolean>(localStorage.getItem('mynotes_sync_enabled') === 'true');

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

  constructor() {
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

  notebooks = $derived.by(() => {
    const list = new Set<string>();
    this.notes.forEach(note => {
      const parts = note.path.split('/');
      if (parts.length > 1) {
        // Add all parent directories
        parts.slice(0, -1).forEach((_, idx) => {
          list.add(parts.slice(0, idx + 1).join('/'));
        });
      }
    });
    return Array.from(list).sort();
  });

  tags = $derived.by(() => {
    const map = new Map<string, number>();
    this.notes.forEach(note => {
      const hashTags = this.extractTags(note.content);
      hashTags.forEach(tag => {
        map.set(tag, (map.get(tag) || 0) + 1);
      });
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  });

  filteredNotes = $derived.by(() => {
    let list = this.notes;

    if (this.activeNotebook) {
      const prefix = this.activeNotebook.endsWith('/') ? this.activeNotebook : this.activeNotebook + '/';
      list = list.filter(n => n.path.startsWith(prefix) || n.path === this.activeNotebook);
    }

    if (this.activeTag) {
      list = list.filter(n => this.extractTags(n.content).includes(this.activeTag!));
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
    return list.sort((a, b) => b.modified - a.modified);
  });

  recentNotes = $derived.by(() => {
    // Return top 6 recently modified notes
    return [...this.notes].sort((a, b) => b.modified - a.modified).slice(0, 6);
  });

  activeNote = $derived.by(() => {
    if (!this.activeNotePath) return null;
    return this.notes.find(n => n.path === this.activeNotePath) || null;
  });

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

      // Map of drive files by name for faster lookup
      const driveFileMap = new Map(driveFiles.map(f => [f.name.replace(/\.md$/, '').toLowerCase(), f]));

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

        // Match by ID, or fallback to name
        const driveFile = remoteId 
          ? driveFiles.find(f => f.id === remoteId)
          : driveFileMap.get(note.name.toLowerCase());

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
              const uploadRes = await this.syncService.uploadFile(`${note.name}.md`, note.content, driveFile.id);
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
            const uploadRes = await this.syncService.uploadFile(`${note.name}.md`, note.content, driveFile.id);
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
            const uploadRes = await this.syncService.uploadFile(`${note.name}.md`, note.content);
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
        const localPath = Object.keys(mappings).find(key => {
          const mapVal = mappings[key];
          const id = typeof mapVal === 'string' ? mapVal : mapVal.id;
          return id === remote.id;
        });
        const cleanName = remote.name.replace(/\.md$/, '');

        if (!localPath) {
          console.log(`New remote file found: ${remote.name} (ID: ${remote.id})`);
          const existingLocal = this.notes.find(n => n.name.toLowerCase() === cleanName.toLowerCase());
          if (existingLocal) {
            console.log(`  Matching local file found by name: ${existingLocal.path}. Pairing.`);
            const remoteTime = new Date(remote.modifiedTime).getTime();
            activeMappings[existingLocal.path] = {
              id: remote.id,
              lastSyncLocalTime: existingLocal.modified,
              lastSyncRemoteTime: remoteTime
            };
          } else {
            console.log('  No matching local file. Downloading...');
            const remoteContent = await this.syncService.downloadFile(remote.id);
            const newLocalPath = `${cleanName}.md`;
            await this.storage.writeNote(newLocalPath, remoteContent);
            const remoteTime = new Date(remote.modifiedTime).getTime();
            activeMappings[newLocalPath] = {
              id: remote.id,
              lastSyncLocalTime: Date.now(),
              lastSyncRemoteTime: remoteTime
            };
          }
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
    this.storage = new IndexedDBAdapter();
    const name = await this.storage.selectDirectory();
    this.vaultName = name;
    
    // Seed basic notes if sandbox is empty
    const list = await this.storage.listNotes();
    if (list.length === 0) {
      await this.storage.writeNote('Welcome.md', '# Welcome to myNotes 🎵\n\nThis is a dark, local-first markdown note-taking app styled like a music player.\n\n### Features\n- **Playlists are Notebooks**: Group your notes inside folders.\n- **Achromatic Design**: Elegant black and gray palette with subtle green accents.\n- **Wikilinks**: Connect pages with `[[Welcome]]` style wiki-links.\n- **Graph View**: Navigate your notes visually.\n\nEnjoy writing in the dark! #notes #welcome');
      await this.storage.writeNote('Recipes/Pizza.md', '# Perfect Pizza Dough 🍕\n\nIngredients:\n- 500g Flour\n- 325ml Water\n- 7g Yeast\n- 10g Salt\n\nMix, knead, let rise for 24h. Bake at max temp! #recipes #cooking');
      await this.storage.writeNote('Daily Notes/2026-06-08.md', '# Daily Log: June 8, 2026 🗓️\n\n- Completed scaffolding myNotes project!\n- Successfully integrated Svelte 5 global stores and IndexedDB fallback storage.\n- Next step: build the canvas force-directed note graph.\n\nFeeling productive! #journal #dev');
    }
    
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
    
    // Select welcome note by default
    const welcome = this.notes.find(n => n.path === 'Welcome.md');
    if (welcome) {
      this.selectNote(welcome.path);
    } else if (this.notes.length > 0) {
      this.selectNote(this.notes[0].path);
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

      if (this.notes.length > 0) {
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
    }
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

  // Tag utility helper
  private extractTags(content: string): string[] {
    const matches = content.match(/#\w+/g);
    if (!matches) return [];
    return Array.from(new Set(matches.map(m => m.slice(1).toLowerCase())));
  }
}

export const appState = new AppState();
