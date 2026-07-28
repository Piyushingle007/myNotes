require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below
console.log('User Preload!');

import { contextBridge, ipcRenderer } from 'electron';

// Bridge that lets the renderer run the desktop Google OAuth (Authorization Code
// + PKCE) loopback flow in the main process. Mirrors the Android flow so the app
// receives a long-lived refresh token (access_type=offline&prompt=consent).
contextBridge.exposeInMainWorld('electronGoogleOAuth', {
  authorize: (opts: { clientId: string; scope?: string; codeChallenge: string }) =>
    ipcRenderer.invoke('mynotes:google-oauth', opts),
});
