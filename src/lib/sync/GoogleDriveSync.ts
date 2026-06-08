declare const google: any;

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string; // ISO String
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

  // Find or create the myNotes directory
  async getOrCreateSyncFolder(): Promise<string> {
    if (this.folderId) return this.folderId;

    const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and name = 'myNotes' and trashed = false");
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
        name: 'myNotes',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await createRes.json();
    this.folderId = folder.id;
    return this.folderId!;
  }

  // List all markdown files in sync folder
  async listFiles(folderId: string): Promise<DriveFileMeta[]> {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)&pageSize=1000`;
    
    const res = await this.apiCall(url);
    const data = await res.json();
    const files: DriveFileMeta[] = data.files || [];
    return files.filter(f => f.name.toLowerCase().endsWith('.md'));
  }

  // List all subfolders under a folder
  async listSubfolders(parentFolderId: string): Promise<Array<{ id: string; name: string }>> {
    const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
    const res = await this.apiCall(url);
    const data = await res.json();
    return data.files || [];
  }

  // Download a file's raw content
  async downloadFile(fileId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.apiCall(url);
    return res.text();
  }

  // Find or create a subfolder hierarchy recursively on Google Drive
  async getOrCreateSubfolders(dirPath: string, parentId: string): Promise<string> {
    const parts = dirPath.split('/').filter(Boolean);
    let currentParentId = parentId;

    for (const part of parts) {
      const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${part.replace(/'/g, "\\'")}' and '${currentParentId}' in parents and trashed = false`);
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
      
      const res = await this.apiCall(searchUrl);
      const data = await res.json();
      
      if (data.files && data.files.length > 0) {
        currentParentId = data.files[0].id;
      } else {
        // Create folder
        const createUrl = 'https://www.googleapis.com/drive/v3/files';
        const createRes = await this.apiCall(createUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: part,
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

  // List all markdown files in sync folder recursively
  async listAllFilesRecursively(vaultFolderId: string): Promise<Array<DriveFileMeta & { path: string }>> {
    const url = `https://www.googleapis.com/drive/v3/files?fields=files(id,name,modifiedTime,parents,mimeType)&pageSize=1000&q=trashed=false`;
    const res = await this.apiCall(url);
    const data = await res.json();
    const allItems: any[] = data.files || [];

    const itemMap = new Map<string, { name: string; parents?: string[]; mimeType: string }>();
    for (const item of allItems) {
      itemMap.set(item.id, {
        name: item.name,
        parents: item.parents,
        mimeType: item.mimeType
      });
    }

    const resolvePath = (itemId: string): string | null => {
      let currentId = itemId;
      const pathParts: string[] = [];

      while (true) {
        if (currentId === vaultFolderId) {
          return pathParts.reverse().join('/');
        }
        
        const item = itemMap.get(currentId);
        if (!item) return null;

        pathParts.push(item.name);

        if (!item.parents || item.parents.length === 0) {
          return null;
        }
        currentId = item.parents[0];
      }
    };

    const results: Array<DriveFileMeta & { path: string }> = [];
    for (const item of allItems) {
      if (item.mimeType !== 'application/vnd.google-apps.folder' && item.name.toLowerCase().endsWith('.md')) {
        const relativePath = resolvePath(item.id);
        if (relativePath) {
          results.push({
            id: item.id,
            name: item.name,
            modifiedTime: item.modifiedTime,
            path: relativePath
          });
        }
      }
    }

    return results;
  }

  // Upload/Update file (Multipart upload for metadata + content)
  async uploadFile(filename: string, content: string, fileId?: string, parentFolderId?: string): Promise<{ id: string; modifiedTime: string }> {
    const resolvedParentId = parentFolderId || await this.getOrCreateSyncFolder();
    
    const metadata: any = {
      name: filename
    };
    if (!fileId) {
      metadata.parents = [resolvedParentId];
    }

    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';

    const boundary = 'mynotes_multipart_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody = 
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
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
}
