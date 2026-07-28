declare const google: any;

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string; // ISO String
  path?: string;
}

export class GoogleDriveSync {
  private clientId: string;
  private clientSecret: string | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;
  private folderId: string | null = null;

  constructor(clientId: string, clientSecret: string | null = null) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  setClientId(clientId: string) {
    this.clientId = clientId;
  }

  // For Google "Desktop app" (installed) OAuth clients, Google requires the
  // client_secret in the token exchange even though it is explicitly documented
  // as non-confidential for installed apps.
  setClientSecret(clientSecret: string | null) {
    this.clientSecret = clientSecret ? clientSecret.trim() : null;
  }

  // ─────────────────────────── PKCE helpers ───────────────────────────
  private static base64UrlEncode(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Generate a PKCE code_verifier and its S256 code_challenge.
  static async generatePkce(): Promise<{ verifier: string; challenge: string }> {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const verifier = GoogleDriveSync.base64UrlEncode(randomBytes);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = GoogleDriveSync.base64UrlEncode(new Uint8Array(digest));
    return { verifier, challenge };
  }

  // Exchange an authorization code (from the PKCE flow) for access + refresh tokens.
  async exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Token exchange failed (${res.status}): ${errBody || res.statusText}`);
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new Error('Token exchange did not return an access token.');
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    localStorage.setItem('mynotes_google_access_token', data.access_token);
    localStorage.setItem('mynotes_google_token_expiry', String(this.tokenExpiry));

    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
      localStorage.setItem('mynotes_google_refresh_token', data.refresh_token);
      console.log('[GoogleDriveSync] Refresh token acquired and stored.');
    } else {
      console.warn('[GoogleDriveSync] No refresh_token returned. Ensure access_type=offline and prompt=consent were used, and that the OAuth client is a public (Desktop app) client.');
    }

    return data.access_token;
  }

  clearToken() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  setTokenExpiry(expiry: number) {
    this.tokenExpiry = expiry;
  }

  isTokenExpired(): boolean {
    if (!this.tokenExpiry) return false;
    return Date.now() >= (this.tokenExpiry - 120 * 1000); // 2 min buffer
  }

  // Attempt background refresh using refresh_token or silent web prompt
  async refreshAccessToken(): Promise<string> {
    console.log('[GoogleDriveSync] Attempting background access token refresh...');

    // 1. Try refresh_token via Google OAuth endpoint if available
    if (this.refreshToken) {
      try {
        const body = new URLSearchParams({
          client_id: this.clientId,
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        });
        if (this.clientSecret) {
          body.set('client_secret', this.clientSecret);
        }

        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.access_token) {
            this.accessToken = data.access_token;
            this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
            if (data.refresh_token) {
              this.refreshToken = data.refresh_token;
              localStorage.setItem('mynotes_google_refresh_token', data.refresh_token);
            }
            localStorage.setItem('mynotes_google_access_token', data.access_token);
            localStorage.setItem('mynotes_google_token_expiry', String(this.tokenExpiry));
            console.log('[GoogleDriveSync] Access Token refreshed successfully via refresh_token.');
            return data.access_token;
          }
        } else {
          const errBody = await res.text().catch(() => '');
          console.warn(`[GoogleDriveSync] Refresh token endpoint returned ${res.status}: ${errBody}`);
        }
      } catch (e) {
        console.warn('[GoogleDriveSync] Failed to refresh token via OAuth endpoint:', e);
      }
    }

    // 2. Fallback for Web Browser: Silent Token Request via Google Identity Services (prompt: 'none')
    return new Promise((resolve, reject) => {
      if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        return reject(new Error('Google Identity Services SDK not loaded'));
      }

      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: 'https://www.googleapis.com/auth/drive',
          callback: (response: any) => {
            if (response.access_token) {
              this.accessToken = response.access_token;
              this.tokenExpiry = Date.now() + 3500 * 1000;
              localStorage.setItem('mynotes_google_access_token', response.access_token);
              localStorage.setItem('mynotes_google_token_expiry', String(this.tokenExpiry));
              console.log('[GoogleDriveSync] Access Token acquired via silent prompt: none.');
              resolve(response.access_token);
            } else {
              reject(new Error(response.error || 'Silent token refresh failed'));
            }
          },
          error_callback: (err: any) => reject(err),
        });
        client.requestAccessToken({ prompt: 'none' });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Initialize GIS and request token
  login(onSuccess: (token: string) => void, onFailure: (error: any) => void): void {
    if (typeof google === 'undefined') {
      return onFailure(new Error('Google Identity Services SDK not loaded yet.'));
    }

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive',
        callback: (response: any) => {
          console.log('Google OAuth Response:', response);
          if (response.error) {
            onFailure(response);
          } else if (response.access_token) {
            this.accessToken = response.access_token;
            this.tokenExpiry = Date.now() + 3500 * 1000;
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

  // Utility to make authenticated requests with automatic token refresh
  private async apiCall(url: string, options: RequestInit = {}): Promise<Response> {
    console.log('Making Drive API Call to:', url.split('?')[0]);

    if (!this.accessToken || this.isTokenExpired()) {
      try {
        await this.refreshAccessToken();
      } catch (e) {
        console.warn('[GoogleDriveSync] Pre-call token refresh attempt failed:', e);
      }
    }

    if (!this.accessToken) {
      console.error('No access token available before API call.');
      throw new Error('No access token available. Login first.');
    }
    
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    
    let res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      console.warn('Google API returned 401 Unauthorized. Attempting automatic token refresh...');
      try {
        const newToken = await this.refreshAccessToken();
        headers.set('Authorization', `Bearer ${newToken}`);
        res = await fetch(url, { ...options, headers });
      } catch (e) {
        console.error('[GoogleDriveSync] Token refresh after 401 failed:', e);
        throw new Error('UNAUTHORIZED'); // Signals app state to refresh token
      }
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
    const candidates: Array<{ id: string; name: string }> = data.files || [];

    if (candidates.length === 1) {
      this.folderId = candidates[0].id;
      return this.folderId!;
    }

    if (candidates.length > 1) {
      // Multiple 'MyNotes' folders can exist (e.g. created by different OAuth
      // client IDs). Pick the one that actually contains the most items so we
      // don't sync into an empty duplicate and appear to "lose" the old data.
      let best = candidates[0];
      let bestCount = -1;
      for (const folder of candidates) {
        const childQuery = encodeURIComponent(`'${folder.id}' in parents and trashed = false`);
        const childUrl = `https://www.googleapis.com/drive/v3/files?q=${childQuery}&fields=files(id)&pageSize=1000`;
        try {
          const childRes = await this.apiCall(childUrl);
          const childData = await childRes.json();
          const count = (childData.files || []).length;
          if (count > bestCount) {
            bestCount = count;
            best = folder;
          }
        } catch {
          // Ignore a failed count and keep scanning the remaining candidates.
        }
      }
      console.log(`[GoogleDriveSync] Found ${candidates.length} 'MyNotes' folders; selected the one with the most items (${bestCount}).`);
      this.folderId = best.id;
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

  // Get user profile email using Drive about endpoint (already authorized by the drive scope)
  async getUserEmail(): Promise<string> {
    const url = 'https://www.googleapis.com/drive/v3/about?fields=user';
    const res = await this.apiCall(url);
    const data = await res.json();
    return data.user?.emailAddress || 'Google User';
  }
}
