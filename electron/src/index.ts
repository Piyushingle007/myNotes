import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';

// Graceful handling of unhandled errors.
unhandled();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

// Run Application
(async () => {
  // Wait for electron app to be ready.
  await app.whenReady();
  // Security - Set Content-Security-Policy based on whether or not we are in dev mode.
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());
  // Initialize our app, build windows, and load content.
  await myCapacitorApp.init();
  // Check for updates if we are in a packaged app.
  autoUpdater.checkForUpdatesAndNotify();
})();

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line
import { ipcMain, shell } from 'electron';
import * as http from 'http';
import type { AddressInfo } from 'net';

interface GoogleOAuthArgs {
  clientId: string;
  scope?: string;
  codeChallenge: string;
}

interface GoogleOAuthResult {
  code?: string;
  redirectUri?: string;
  error?: string;
}

// Desktop Google OAuth (Authorization Code + PKCE) using a one-shot loopback
// server. Google "Desktop app" clients permit any http://127.0.0.1:<port>
// redirect, and access_type=offline + prompt=consent yields a refresh token,
// exactly like the Android flow. The renderer then exchanges the returned code
// (using the same redirectUri) for access + refresh tokens.
ipcMain.handle('mynotes:google-oauth', async (_event, args: GoogleOAuthArgs): Promise<GoogleOAuthResult> => {
  const clientId = args?.clientId?.trim();
  const codeChallenge = args?.codeChallenge;
  const scope = args?.scope || 'https://www.googleapis.com/auth/drive';

  if (!clientId) return { error: 'Missing Google OAuth Client ID.' };
  if (!codeChallenge) return { error: 'Missing PKCE code challenge.' };

  return await new Promise<GoogleOAuthResult>((resolve) => {
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let redirectUri = '';

    const finish = (result: GoogleOAuthResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const respondHtml = (res: http.ServerResponse, title: string, message: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
          `<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;` +
          `display:flex;align-items:center;justify-content:center;height:100vh;margin:0}` +
          `.card{text-align:center;max-width:420px;padding:32px}h1{font-size:20px;margin:0 0 8px}` +
          `p{color:#94a3b8;margin:0}</style></head><body><div class="card"><h1>${title}</h1>` +
          `<p>${message}</p></div></body></html>`
      );
    };

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== '/') {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        if (error) {
          respondHtml(res, 'Sign-in failed', 'You can close this window and return to myNotes.');
          finish({ error });
        } else if (code) {
          respondHtml(res, 'myNotes connected \u2713', 'Sign-in complete. You can close this window and return to myNotes.');
          finish({ code, redirectUri });
        } else {
          respondHtml(res, 'Waiting for sign-in', 'You can close this window and return to myNotes.');
        }
      } catch (e: any) {
        res.writeHead(500);
        res.end();
        finish({ error: e?.message || 'Loopback server error.' });
      }
    });

    server.on('error', (e: any) => {
      finish({ error: e?.message || 'Failed to start loopback server.' });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      redirectUri = `http://127.0.0.1:${port}`;
      const authUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
      void shell.openExternal(authUrl);
    });

    // Abandon the attempt if the user never completes sign-in.
    timeoutHandle = setTimeout(() => finish({ error: 'Timed out waiting for Google sign-in.' }), 5 * 60 * 1000);
  });
});
