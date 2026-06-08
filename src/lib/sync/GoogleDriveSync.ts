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

  // Download a file's raw content
  async downloadFile(fileId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.apiCall(url);
    return res.text();
  }

  // Upload/Update file (Multipart upload for metadata + content)
  async uploadFile(filename: string, content: string, fileId?: string): Promise<{ id: string; modifiedTime: string }> {
    const folderId = await this.getOrCreateSyncFolder();
    
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
