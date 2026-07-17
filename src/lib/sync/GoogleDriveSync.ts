declare const google: any;

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string; // ISO String
  path?: string;
}

export class GoogleDriveSync {
  private clientId: string;
  private accessToken: string | null = null;
  private folderId: string | null = null;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  setClientId(clientId: string) {
    this.clientId = clientId;
  }

  clearToken() {
    this.accessToken = null;
  }

  // Initialize GIS and request token
  login(onSuccess: (token: string) => void, onFailure: (error: any) => void): void {
    if (typeof google === 'undefined') {
      return onFailure(new Error('Google Identity Services SDK not loaded yet.'));
    }

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response: any) => {
          console.log('Google OAuth Response:', response);
          if (response.error) {
            onFailure(response);
          } else if (response.access_token) {
            this.accessToken = response.access_token;
            console.log('Access Token acquired successfully.');
            onSuccess(response.access_token);
          }
        },
        error_callback: (err: any) => {
          onFailure(err);
        }
      });
      client.requestAccessToken({ prompt: '' });
    } catch (e) {
      onFailure(e);
    }
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  hasToken(): boolean {
    return !!this.accessToken;
  }

  // Utility to make authenticated requests
  private async apiCall(url: string, options: RequestInit = {}): Promise<Response> {
    console.log('Making Drive API Call to:', url.split('?')[0]);
    if (!this.accessToken) {
      console.error('No access token available before API call.');
      throw new Error('No access token available. Login first.');
    }
    
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      console.warn('Google API returned 401 Unauthorized.');
      throw new Error('UNAUTHORIZED'); // Signals app state to refresh token
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google API Error (${res.status}): ${body || res.statusText}`);
    }
    return res;
  }

  setFolderId(id: string | null) {
    this.folderId = id;
  }

  // Find or create the MyNotes directory
  async getOrCreateSyncFolder(): Promise<string> {
    if (this.folderId) return this.folderId;

    const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and name = 'MyNotes' and trashed = false");
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
    
    const res = await this.apiCall(searchUrl);
    const data = await res.json();
    
    if (data.files && data.files.length > 0) {
      this.folderId = data.files[0].id;
      return this.folderId!;
    }

    // Create folder
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await this.apiCall(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'MyNotes',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await createRes.json();
    this.folderId = folder.id;
    return this.folderId!;
  }

  // List all folders on the user's drive
  async listFolders(): Promise<DriveFileMeta[]> {
    const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)&pageSize=100`;
    const res = await this.apiCall(url);
    const data = await res.json();
    return data.files || [];
  }

  // Create a new folder
  async createFolder(name: string): Promise<string> {
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await this.apiCall(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await createRes.json();
    return folder.id;
  }

  // Resolve or create nested subfolders recursively on Google Drive
  async getOrCreateSubfolders(parentFolderId: string, folderNames: string[]): Promise<string> {
    let currentParentId = parentFolderId;
    for (const name of folderNames) {
      const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and '${currentParentId}' in parents and trashed = false`);
      const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
      const res = await this.apiCall(url);
      const data = await res.json();
      
      if (data.files && data.files.length > 0) {
        currentParentId = data.files[0].id;
      } else {
        // Create folder inside currentParentId
        const createUrl = 'https://www.googleapis.com/drive/v3/files';
        const createRes = await this.apiCall(createUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [currentParentId]
          })
        });
        const folder = await createRes.json();
        currentParentId = folder.id;
      }
    }
    return currentParentId;
  }

  // List all files and folders created by this app (paginated)
  async listAllFilesAndFolders(): Promise<any[]> {
    let allItems: any[] = [];
    let nextPageToken: string | null = null;
    do {
      let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent('trashed = false')}&fields=nextPageToken,files(id,name,mimeType,parents,modifiedTime)&pageSize=1000`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }
      const res = await this.apiCall(url);
      const data = await res.json();
      const files = data.files || [];
      allItems = allItems.concat(files);
      nextPageToken = data.nextPageToken || null;
    } while (nextPageToken);
    return allItems;
  }

  // List all markdown files under rootFolderId recursively, computing relative paths
  async listFiles(rootFolderId: string): Promise<DriveFileMeta[]> {
    const allItems = await this.listAllFilesAndFolders();
    
    // Create a map of items by ID for O(1) parent lookup
    const itemMap = new Map<string, any>();
    for (const item of allItems) {
      itemMap.set(item.id, item);
    }

    // Helper to resolve the relative path of an item recursively
    const resolvePath = (itemId: string, visited = new Set<string>()): string | null => {
      if (visited.has(itemId)) return null; // Cycle detected
      visited.add(itemId);
      const item = itemMap.get(itemId);
      if (!item) return null;
      if (item.id === rootFolderId) return '';
      if (!item.parents || item.parents.length === 0) return null;
      
      const parentId = item.parents[0];
      if (parentId === rootFolderId) {
        return item.name;
      }
      
      const parentPath = resolvePath(parentId, visited);
      if (parentPath === null) return null;
      return parentPath ? `${parentPath}/${item.name}` : item.name;
    };

    // Filter only markdown files that belong to our root folder tree
    const driveFiles: DriveFileMeta[] = [];
    for (const item of allItems) {
      if (item.mimeType !== 'application/vnd.google-apps.folder' && (item.name.toLowerCase().endsWith('.html') || item.name.toLowerCase().endsWith('.md') || item.name.toLowerCase().endsWith('.notebook.json'))) {
        const relativePath = resolvePath(item.id);
        if (relativePath !== null) {
          driveFiles.push({
            id: item.id,
            name: item.name,
            modifiedTime: item.modifiedTime,
            path: relativePath
          });
        }
      }
    }
    return driveFiles;
  }

  // Download a file's raw content
  async downloadFile(fileId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.apiCall(url);
    return res.text();
  }

  // Upload/Update file (Multipart upload for metadata + content)
  async uploadFile(filename: string, content: string, fileId?: string, parentFolderId?: string): Promise<{ id: string; modifiedTime: string }> {
    const rootFolderId = await this.getOrCreateSyncFolder();
    const folderId = parentFolderId || rootFolderId;
    
    const metadata: any = {
      name: filename
    };
    if (!fileId) {
      metadata.parents = [folderId];
    }

    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';

    const boundary = 'mynotes_multipart_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    let contentType = 'text/markdown';
    if (filename.toLowerCase().endsWith('.html')) {
      contentType = 'text/html';
    } else if (filename.toLowerCase().endsWith('.notebook.json')) {
      contentType = 'application/json';
    }
    const multipartBody = 
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${contentType}; charset=UTF-8\r\n\r\n` +
      content +
      closeDelimiter;

    const res = await this.apiCall(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    });

    const file = await res.json();
    return { id: file.id, modifiedTime: file.modifiedTime };
  }

  // Delete remote file
  async deleteFile(fileId: string): Promise<void> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
    await this.apiCall(url, {
      method: 'DELETE'
    });
  }

  // Get user profile email using Drive about endpoint (already authorized by drive.file scope)
  async getUserEmail(): Promise<string> {
    const url = 'https://www.googleapis.com/drive/v3/about?fields=user';
    const res = await this.apiCall(url);
    const data = await res.json();
    return data.user?.emailAddress || 'Google User';
  }

  // ─── Binary download/upload for Yjs .ydoc blobs ──────────────────

  async downloadFileBinary(fileId: string): Promise<Uint8Array> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.apiCall(url);
    return new Uint8Array(await res.arrayBuffer());
  }

  async uploadFileBinary(
    filename: string,
    bytes: Uint8Array,
    fileId?: string,
    parentFolderId?: string
  ): Promise<{ id: string; modifiedTime: string }> {
    const rootFolderId = await this.getOrCreateSyncFolder();
    const folderId = parentFolderId || rootFolderId;

    const metadata: any = { name: filename };
    if (!fileId) {
      metadata.parents = [folderId];
    }

    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';

    const boundary = 'mynotes_binary_boundary';
    // Build multipart body as Blob to avoid binary corruption
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      bytes,
      `\r\n--${boundary}--`,
    ]);

    const res = await this.apiCall(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });

    const file = await res.json();
    return { id: file.id, modifiedTime: file.modifiedTime };
  }

  /** Find a file by name within a specific folder. Returns null if not found. */
  async findFileByName(parentFolderId: string, name: string): Promise<DriveFileMeta | null> {
    const escapedName = name.replace(/'/g, "\\'");
    const query = `'${parentFolderId}' in parents and name = '${escapedName}' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&pageSize=1`;
    const res = await this.apiCall(url);
    const data = await res.json();
    return data.files?.length > 0 ? data.files[0] : null;
  }
}
