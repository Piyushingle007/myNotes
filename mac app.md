# 🖥️ myNotes — Mac Desktop App

The Mac desktop app is built with **[@capacitor-community/electron](https://github.com/capacitor-community/electron)**,
so it reuses the exact same web build (`dist/`) and Capacitor plugins as the Android and web
versions. It lives in the [`electron/`](./electron) folder.

Google Drive sync uses the **same refresh-token flow as Android**: an Authorization Code + PKCE
sign-in with `access_type=offline` & `prompt=consent`, so you sign in once and stay permanently
logged in.

---

## Requirements
- **Node.js ≥ 22** (the Capacitor CLI requires it). This repo uses `nvm`:
  ```bash
  nvm use 22
  ```
- macOS with Xcode command line tools (for packaging/signing, optional for local runs).

## One-time setup
Dependencies for the desktop shell are installed separately inside `electron/`:
```bash
cd electron && npm install && cd ..
```

## Run the app (development)
From the project root:
```bash
npm run mac:run
```
This builds the web app, copies it into `electron/app`, then launches Electron.

## Package a distributable `.app` / `.dmg`
```bash
npm run mac:pack   # unpacked app in electron/dist (fast, for local testing)
npm run mac:make   # full electron-builder package (.dmg / .zip)
```

### Available scripts (root `package.json`)
| Script | Description |
| --- | --- |
| `npm run build:electron` | Build web app + copy into `electron/app` |
| `npm run mac:run` | Build + launch the desktop app |
| `npm run mac:pack` | Build + produce an unpacked app (`electron/dist`) |
| `npm run mac:make` | Build + produce a signed/packaged installer |

---

## 🔑 Google Drive sign-in (refresh token, same as Android)

The desktop app authenticates through a **local loopback redirect**, which Google's
**Desktop app** OAuth clients allow and which returns a long-lived **refresh token**.

**How it works**
1. The renderer generates a PKCE `verifier`/`challenge` (`GoogleDriveSync.generatePkce`).
2. The Electron **main process** (`electron/src/index.ts`, IPC `mynotes:google-oauth`) starts a
   one-shot HTTP server on `http://127.0.0.1:<random-port>`, opens your **system browser** to
   Google's consent screen (`access_type=offline&prompt=consent`), and waits for the redirect.
3. When Google redirects back to the loopback URL, the captured `code` + `redirectUri` are
   returned to the renderer via the preload bridge (`window.electronGoogleOAuth`).
4. The renderer exchanges the code for **access + refresh tokens**
   (`GoogleDriveSync.exchangeCodeForTokens`) — identical to Android's success path.

**To connect (in the app):**
1. Create an **OAuth Client ID** of type **Desktop app** in the
   [Google Cloud Console](https://console.cloud.google.com/) (see
   [GOOGLE_DRIVE_SETUP_GUIDE.md](./GOOGLE_DRIVE_SETUP_GUIDE.md)).
2. Open **Settings → Cloud Sync**, paste your **Client ID** and **Client Secret**
   (no redirect URI needed — the loopback is automatic).
3. Click **Connect with Google**, finish signing in in your browser, and you're done —
   the app renews access automatically in the background.

---

## Key files
| File | Purpose |
| --- | --- |
| `electron/src/index.ts` | Main process + `mynotes:google-oauth` loopback OAuth IPC handler |
| `electron/src/preload.ts` | Exposes `window.electronGoogleOAuth.authorize(...)` bridge |
| `electron/src/setup.ts` | Window/CSP setup (CSP allows Google OAuth + Drive endpoints) |
| `src/lib/stores/appState.svelte.ts` | `isElectronPlatform`, `startDesktopGoogleAuth()` |
| `src/lib/sync/GoogleDriveSync.ts` | Shared PKCE + token exchange + refresh logic |
| `src/lib/components/SettingsModal.svelte` | Desktop "Connect with Google" UI |

## Notes
- `electron/app`, `electron/build`, and `electron/dist` are generated and git-ignored.
- Regenerate the platform (rarely needed): `npx cap add @capacitor-community/electron`.
  If the project path contains a space, run `npm install` inside `electron/` manually
  afterwards (the community CLI doesn't quote paths).
