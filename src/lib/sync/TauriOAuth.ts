import { isTauri } from '../utils/platform';

export class TauriOAuth {
  private static REFRESH_TOKEN_KEY = 'mynotes_tauri_google_refresh_token';

  /**
   * Performs OAuth 2.0 Authorization Code flow with PKCE via Tauri plugin or localhost server.
   */
  static async login(clientId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('TauriOAuth is only available in Tauri desktop/mobile environments');
    }

    try {
      // 1. Check if we have a stored refresh token
      const savedRefreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
      if (savedRefreshToken) {
        try {
          const newAccessToken = await this.refreshAccessToken(clientId, savedRefreshToken);
          return newAccessToken;
        } catch (e) {
          console.warn('Failed to refresh token using saved refresh token, falling back to full login', e);
          localStorage.removeItem(this.REFRESH_TOKEN_KEY);
        }
      }

      // 2. Import Tauri shell and opener/oauth
      const { open } = await import('@tauri-apps/plugin-shell');
      
      // Generate random state and code verifier
      const state = this.generateRandomString(32);
      const codeVerifier = this.generateRandomString(64);
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);

      // Start local OAuth server or deep link listener
      const redirectUri = 'http://localhost:1420/oauth-callback';

      const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file');
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${scope}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256` +
        `&state=${state}` +
        `&access_type=offline` +
        `&prompt=consent`;

      // Open default browser
      await open(authUrl);

      // Return promise waiting for token exchange
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('OAuth login timed out'));
        }, 120000); // 2 min timeout

        // Listen for callback event or window response
        const handleCallback = async (code: string) => {
          clearTimeout(timeout);
          try {
            const tokens = await this.exchangeCodeForTokens(clientId, code, codeVerifier, redirectUri);
            if (tokens.refresh_token) {
              localStorage.setItem(this.REFRESH_TOKEN_KEY, tokens.refresh_token);
            }
            resolve(tokens.access_token);
          } catch (err) {
            reject(err);
          }
        };

        // Expose global callback for loopback or deep link handler
        (window as any).__tauriOAuthCallback = (code: string) => handleCallback(code);
      });
    } catch (err) {
      console.error('Tauri OAuth login failed:', err);
      throw err;
    }
  }

  private static async exchangeCodeForTokens(
    clientId: string,
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<{ access_token: string; refresh_token?: string }> {
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    return await response.json();
  }

  private static async refreshAccessToken(clientId: string, refreshToken: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error('Refresh token request failed');
    }

    const data = await response.json();
    return data.access_token;
  }

  private static generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const values = new Uint8Array(length);
    crypto.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      result += charset[values[i] % charset.length];
    }
    return result;
  }

  private static async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
