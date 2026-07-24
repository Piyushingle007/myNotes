import { appState } from './appState.svelte';

export type MobileTab = 'home' | 'tags' | 'library' | 'num' | 'focus' | 'budget';

/**
 * MobileNav — centralized mobile navigation model (UI-M-001).
 *
 * Provides a single, predictable source of truth for *how* the mobile app
 * navigates, on top of the existing `appState` fields. It encodes the mobile
 * Information Architecture as a per-tab navigation hierarchy and exposes one
 * consistent `back()` operation that every back affordance (UI button, Android
 * hardware back button, browser/gesture back) funnels through.
 *
 * Navigation hierarchy (depth) within the active tab:
 *   0  tab root      → home / library / tags / daily
 *   1  sub-view      → library ▸ notebook,  tags ▸ tag detail
 *   2  editor overlay → a note is open full-screen
 *
 * Back always pops exactly one level following this hierarchy, persisting any
 * unsaved editor content first so edits are never lost.
 */
class MobileNav {
  /** Bottom-navigation tabs in display order. */
  readonly tabs: MobileTab[] = ['home', 'tags', 'library', 'num', 'budget', 'focus'];

  // ───────────────────────── Derived position ─────────────────────────

  /** Current navigation depth within the active tab's stack (0–2). */
  get depth(): number {
    if (appState.activeNotePath) return 2;
    if (appState.activeTab === 'library' && appState.activeNotebook) return 1;
    if (appState.activeTab === 'tags' && appState.selectedTag) return 1;
    return 0;
  }

  /** True when there is somewhere to go back to within the app. */
  get canGoBack(): boolean {
    return this.depth > 0 || appState.activeTab !== 'home';
  }

  // ─────────────────────── Forward navigation ───────────────────────
  // Semantic methods the UI calls so that view-state transitions (and the
  // associated cleanup of search/selection) stay consistent everywhere.

  /** Switch to a top-level tab, resetting transient view + selection state. */
  goToTab(tab: MobileTab) {
    appState.activeNotePath = null;
    appState.activeTab = tab;
    appState.activeNotebook = null;
    appState.selectedTag = null;
    appState.searchQuery = '';
    if (appState.selectMode) appState.toggleSelectMode();
  }

  /** Open a notebook sub-view inside the Library tab. */
  openNotebook(notebook: string) {
    appState.activeTab = 'library';
    appState.activeNotebook = notebook;
  }

  /** Return from a notebook sub-view to the Library root. */
  closeNotebook() {
    appState.activeNotebook = null;
  }

  /** Open a tag detail sub-view inside the Tags tab. */
  openTag(tag: string) {
    appState.activeTab = 'tags';
    appState.selectedTag = tag;
  }

  /** Return from a tag detail sub-view to the Tags root. */
  closeTag() {
    appState.selectedTag = null;
  }

  /** Close the full-screen editor overlay, persisting unsaved edits first. */
  async closeEditor() {
    await this.flushPendingSave();
    appState.activeNotePath = null;
  }

  /**
   * Persist any unsaved editor content before navigating away from a note.
   * Mirrors the canonical save-before-leave pattern used in `appState`.
   */
  async flushPendingSave() {
    if (!appState.editorDirty) return;
    try {
      if (appState.onForceSave) {
        await appState.onForceSave();
      } else {
        await appState.saveActiveNote(true);
      }
    } catch (e) {
      console.error('[MobileNav] Failed to save before navigating back:', e);
    }
  }

  // ─────────────────────── Back navigation ───────────────────────

  /**
   * Stack of dismissible overlays (bottom sheets, drawers, modals). The most
   * recently opened overlay is closed first when the user presses back, so a
   * back gesture/button never skips past an open sheet to navigate the app.
   */
  private overlays: Array<() => void> = [];

  /** Register an open overlay; returns an unregister function. */
  registerOverlay(close: () => void): () => void {
    this.overlays.push(close);
    return () => {
      this.overlays = this.overlays.filter((c) => c !== close);
    };
  }

  /** True when at least one dismissible overlay is open. */
  get hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  private dismissTopOverlay(): boolean {
    const close = this.overlays.pop();
    if (close) {
      try { close(); } catch { /* ignore */ }
      return true;
    }
    return false;
  }

  /**
   * Perform exactly one "back" step. Open overlays (sheets/drawers/modals) are
   * dismissed first; otherwise we follow the navigation hierarchy.
   * Returns `true` if a step was handled in-app, or `false` if already at the
   * home root (in which case the platform may choose to exit the app).
   */
  async back(): Promise<boolean> {
    // 3 → dismiss the topmost open overlay before any navigation.
    if (this.overlays.length > 0) {
      return this.dismissTopOverlay();
    }
    // Switch from canvas mode to text mode before closing the editor
    if (__FEATURE_CANVAS__ && appState.activeNotePath && appState.editorMode === 'canvas') {
      appState.editorMode = 'text';
      return true;
    }
    // 2 → close editor overlay (retains the sub-view it was opened from).
    if (appState.activeNotePath) {
      await this.closeEditor();
      return true;
    }
    // 1 → leave a sub-view back to the tab root.
    if (appState.activeTab === 'library' && appState.activeNotebook) {
      this.closeNotebook();
      return true;
    }
    if (appState.activeTab === 'tags' && appState.selectedTag) {
      this.closeTag();
      return true;
    }
    // 0 (non-home) → fall back to the Home root.
    if (appState.activeTab !== 'home') {
      this.goToTab('home');
      return true;
    }
    // Already at the home root — nothing left to pop.
    return false;
  }

  // ───────────────── Platform back-button integration ─────────────────

  private cleanupFns: Array<() => void> = [];
  private registered = false;

  /** True when running inside a native Capacitor shell (Android/iOS). */
  get isNative(): boolean {
    return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
  }

  /**
   * Wire up the Android hardware back button via the Capacitor App plugin.
   *
   * Note: on the web (and inside the Capacitor WebView) the browser/gesture
   * back button is already handled by the existing hash-history sync in
   * `App.svelte`, so we deliberately do NOT add a `popstate` listener here to
   * avoid double-handling a single back gesture. Registering a Capacitor
   * `backButton` listener overrides Capacitor's default history behaviour, so
   * this handler becomes the single, consistent entry point on native.
   *
   * Idempotent and safe to call on web (where it is a no-op). Returns a cleanup
   * function.
   */
  async registerBackHandlers(): Promise<() => void> {
    if (this.registered) return () => this.unregister();
    this.registered = true;

    if (this.isNative) {
      try {
        const capPkg = '@capacitor/app';
        const { App } = await import(/* @vite-ignore */ capPkg);
        const handle = await App.addListener('backButton', () => {
          void this.handleHardwareBack();
        });
        this.cleanupFns.push(() => { void handle.remove(); });
      } catch (e) {
        console.warn('[MobileNav] Capacitor hardware back button unavailable:', e);
      }
    }

    return () => this.unregister();
  }

  private async handleHardwareBack() {
    const handled = await this.back();
    if (!handled && this.isNative) {
      // At the home root on a native device → exit the app.
      try {
        const capPkg = '@capacitor/app';
        const { App } = await import(/* @vite-ignore */ capPkg);
        await App.exitApp();
      } catch {
        /* ignore — plugin unavailable */
      }
    }
  }

  private unregister() {
    this.cleanupFns.forEach((fn) => {
      try { fn(); } catch { /* ignore */ }
    });
    this.cleanupFns = [];
    this.registered = false;
  }
}

export const mobileNav = new MobileNav();

