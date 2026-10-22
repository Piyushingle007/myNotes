# 🖥️ macOS Desktop App Setup & Packaging

The **myNotes** desktop application is built with **[@capacitor-community/electron](https://github.com/capacitor-community/electron)**. It reuses the exact same high-performance Svelte 5 web build (`dist/`) and Capacitor plugins as the Android and web versions, contained within the [`electron/`](../electron) directory.

Google Drive synchronization uses the **Authorization Code + PKCE loopback redirect** flow (`access_type=offline` and `prompt=consent`), allowing you to authenticate once through your default desktop browser and remain permanently authenticated with background token renewals.

---

## 📋 Prerequisites

- **Node.js ≥ 22** (Capacitor CLI requirement):
  ```bash
  nvm use 22 # or your preferred Node version manager
  ```
- **macOS** with Xcode Command Line Tools installed (recommended for code signing and building `.dmg` packages).

---

## 🚀 One-Time Setup

Desktop shell dependencies are maintained within the `electron/` directory:

```bash
cd electron && npm install && cd ..
```

---

## 💻 Development Mode

To build the web application, bundle it into the Electron application directory, and launch the Electron desktop window:

```bash
npm run mac:run
```

---

## 📦 Packaging & Distribution

You can build distributable `.app` bundles or packaged installers (`.dmg`, `.zip`):

```bash
# Fast unpacked build for local testing (outputs to electron/dist/mac-arm64)
npm run mac:pack

# Full installer packaging (.dmg / .zip via electron-builder)
npm run mac:make
```

### Available NPM Scripts

| Command | Action |
| :--- | :--- |
| `npm run build:electron` | Builds the web application and synchronizes it to `electron/app/` |
| `npm run mac:run` | Builds the web application and launches the Electron desktop shell |
| `npm run mac:pack` | Produces an unpacked `.app` bundle inside `electron/dist/` |
| `npm run mac:make` | Produces production distributable `.dmg` and `.zip` installers |

---

## 🔑 Google Drive Cloud Sync Configuration

The desktop client authenticates via a **local loopback redirect** (`http://127.0.0.1:<random-port>`), which is officially supported by Google's **Desktop app** OAuth client type:

1. **Authentication Flow**:
   - The renderer initiates a PKCE `verifier` and `challenge` via `GoogleDriveSync.generatePkce`.
   - The Electron main process (`electron/src/index.ts`, IPC `mynotes:google-oauth`) starts an ephemeral loopback HTTP server and opens your default system browser to Google's consent screen.
   - Upon successful authorization, Google redirects to the local server, which captures the authorization code.
   - The code is exchanged for long-lived access and refresh tokens, stored securely in the app.

2. **Step-by-Step Connection**:
   - Create a Google Cloud project and an **OAuth Client ID** of type **Desktop app** (see [GOOGLE_DRIVE_SETUP_GUIDE.md](../GOOGLE_DRIVE_SETUP_GUIDE.md)).
   - In myNotes, navigate to **Settings ➔ Cloud Sync**.
   - Enter your **Client ID** and **Client Secret**.
   - Click **Connect with Google**, complete sign-in in your browser, and synchronization will begin automatically.

---

## 📁 Architecture & Key Files

| Path | Purpose |
| :--- | :--- |
| `electron/src/index.ts` | Main process lifecycle and loopback OAuth IPC handler |
| `electron/src/preload.ts` | Context bridge exposing `window.electronGoogleOAuth` |
| `electron/src/setup.ts` | Window creation and Content Security Policy (CSP) configuration |
| `src/lib/stores/appState.svelte.ts` | Platform detection (`isElectronPlatform`) and OAuth orchestration |
| `src/lib/sync/GoogleDriveSync.ts` | Shared PKCE generation, token exchange, and refresh logic |
| `src/lib/components/SettingsModal.svelte` | Settings UI for credential entry and connection status |
