<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { appState } from '../../stores/appState.svelte';
  import { mobileNav } from '../../stores/mobileNav.svelte';
  import { epubReader } from '../stores/epubReader.svelte';
  import EpubProgressBar from './EpubProgressBar.svelte';
  import EpubTocDrawer from './EpubTocDrawer.svelte';
  import EpubSettingsSheet from './EpubSettingsSheet.svelte';
  import EpubSearchPanel from './EpubSearchPanel.svelte';
  import EpubFootnotePopover from './EpubFootnotePopover.svelte';
  import EpubJumpBackChip from './EpubJumpBackChip.svelte';
  import EpubRemoteProgressChip from './EpubRemoteProgressChip.svelte';
  import { 
    ChevronLeft, ChevronRight, List, Settings, Search, Maximize2, Minimize2, 
    Loader2, AlertCircle 
  } from 'lucide-svelte';

  interface Props {
    bookId: string;
  }

  let { bookId }: Props = $props();

  let viewerContainer: HTMLDivElement | null = $state(null);
  let isLoading = $state<boolean>(true);
  let errorMessage = $state<string | null>(null);
  let isFullscreen = $state<boolean>(false);

  let unregisterMobileNav: (() => void) | null = null;

  async function initReader() {
    if (!viewerContainer) return;
    isLoading = true;
    errorMessage = null;

    try {
      await epubReader.openBook(bookId, viewerContainer);
    } catch (err: any) {
      console.error('[EpubReader] Failed to load EPUB:', err);
      errorMessage = err?.message || 'Failed to open book. The file may be corrupt or missing.';
    } finally {
      isLoading = false;
      // Guarantee layout re-calculation for cover SVGs and images so they render immediately
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
    }
  }

  async function handleExit() {
    await epubReader.closeReader();
    appState.closeEpubReader();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      isFullscreen = true;
    } else {
      document.exitFullscreen().catch(() => {});
      isFullscreen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // If typing in search input, don't trigger reader shortcuts
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
      e.preventDefault();
      epubReader.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
      e.preventDefault();
      epubReader.prev();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (epubReader.activeFootnote) {
        epubReader.activeFootnote = null;
      } else if (epubReader.isTocOpen) {
        epubReader.isTocOpen = false;
      } else if (epubReader.isSettingsOpen) {
        epubReader.isSettingsOpen = false;
      } else if (epubReader.isSearchOpen) {
        epubReader.isSearchOpen = false;
      } else {
        handleExit();
      }
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  }

  // Handle click on letterboxed margins or viewer container with debounce
  let lastContainerTapTime = 0;
  function handleContainerClick(e: MouseEvent) {
    const now = Date.now();
    if (now - lastContainerTapTime < 280) return;
    lastContainerTapTime = now;

    const target = e.target as HTMLElement;
    if (
      target.closest('.reader-chrome-top') || 
      target.closest('.reader-chrome-bottom') || 
      target.closest('dialog') || 
      target.closest('.error-overlay') || 
      target.closest('.loading-overlay')
    ) {
      return;
    }

    // Tapping anywhere toggles chrome controls cleanly (swipe is used for page turns)
    epubReader.toggleChrome();
  }

  // Window flush listeners
  function onVisibilityChange() {
    if (document.hidden) {
      epubReader.flushProgress();
    }
  }

  function onBeforeUnload() {
    epubReader.flushProgress();
  }

  function onWindowWheel(e: WheelEvent) {
    epubReader.handleWheel(e);
  }

  let appStateHandle: any = null;

  onMount(() => {
    requestAnimationFrame(() => {
      initReader();
    });

    // Listen for mobile background/pause to flush progress
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) {
            epubReader.flushProgress();
          }
        }).then(h => {
          appStateHandle = h;
        });
      }).catch(() => {});
    }

    // Register mobile hardware back button handling
    unregisterMobileNav = mobileNav.registerOverlay(() => {
      if (epubReader.activeFootnote) {
        epubReader.activeFootnote = null;
        return;
      }
      if (epubReader.isTocOpen) {
        epubReader.isTocOpen = false;
        return;
      }
      if (epubReader.isSettingsOpen) {
        epubReader.isSettingsOpen = false;
        return;
      }
      if (epubReader.isSearchOpen) {
        epubReader.isSearchOpen = false;
        return;
      }
      handleExit();
    });

    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('wheel', onWindowWheel, { passive: false });
    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onBeforeUnload);
    window.addEventListener('beforeunload', onBeforeUnload);
  });

  onDestroy(() => {
    appStateHandle?.remove?.();
    unregisterMobileNav?.();
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('wheel', onWindowWheel);
    window.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onBeforeUnload);
    window.removeEventListener('beforeunload', onBeforeUnload);
    epubReader.closeReader();
  });
</script>

<div 
  class="epub-reader-root theme-{epubReader.settings.theme}" 
  tabindex="-1"
  onclick={handleContainerClick}
  role="presentation"
>
  <!-- Main Foliate Engine container -->
  <div bind:this={viewerContainer} class="viewer-mount"></div>

  <!-- Desktop & Web Page Turn Navigation Arrows -->
  {#if !appState.isMobile}
    <button
      type="button"
      class="nav-arrow nav-arrow-prev"
      class:visible={epubReader.isChromeVisible}
      onclick={(e) => { e.stopPropagation(); epubReader.prev(); }}
      aria-label="Previous page"
      title="Previous page (Left arrow / Scroll left)"
    >
      <ChevronLeft size={22} />
    </button>

    <button
      type="button"
      class="nav-arrow nav-arrow-next"
      class:visible={epubReader.isChromeVisible}
      onclick={(e) => { e.stopPropagation(); epubReader.next(); }}
      aria-label="Next page"
      title="Next page (Right arrow / Scroll right)"
    >
      <ChevronRight size={22} />
    </button>
  {/if}

  <!-- Loading State -->
  {#if isLoading}
    <div class="loading-overlay">
      <Loader2 size={36} class="spin" />
      <div class="loading-text">Opening book...</div>
    </div>
  {/if}

  <!-- Error State -->
  {#if errorMessage}
    <div class="error-overlay">
      <AlertCircle size={40} color="#ef4444" />
      <div class="error-title">Could not load EPUB</div>
      <div class="error-desc">{errorMessage}</div>
      <button class="btn-primary" onclick={handleExit}>Back to Library</button>
    </div>
  {/if}

  <!-- Top Minimal Chrome Bar -->
  <header 
    class="reader-chrome-top {epubReader.isChromeVisible ? 'visible' : 'hidden'}"
    onclick={(e) => e.stopPropagation()}
    role="banner"
  >
    <div class="top-left">
      <button class="action-btn" onclick={handleExit} aria-label="Exit reader" title="Back to library">
        <ChevronLeft size={22} />
      </button>
      <div class="book-title" title={epubReader.book?.title || 'Book'}>
        {epubReader.book?.title || 'Book'}
      </div>
    </div>

    <div class="top-actions">
      <button 
        class="action-btn {epubReader.isTocOpen ? 'active' : ''}" 
        onclick={() => { epubReader.isTocOpen = !epubReader.isTocOpen; epubReader.isSettingsOpen = false; epubReader.isSearchOpen = false; }}
        aria-label="Table of contents"
        title="Contents"
      >
        <List size={20} />
      </button>

      <button 
        class="action-btn {epubReader.isSearchOpen ? 'active' : ''}" 
        onclick={() => { epubReader.isSearchOpen = !epubReader.isSearchOpen; epubReader.isTocOpen = false; epubReader.isSettingsOpen = false; }}
        aria-label="Search within book"
        title="Search"
      >
        <Search size={19} />
      </button>

      <button 
        class="action-btn {epubReader.isSettingsOpen ? 'active' : ''}" 
        onclick={() => { epubReader.isSettingsOpen = !epubReader.isSettingsOpen; epubReader.isTocOpen = false; epubReader.isSearchOpen = false; }}
        aria-label="Reader settings"
        title="Settings"
      >
        <Settings size={19} />
      </button>

      <button 
        class="action-btn desktop-only" 
        onclick={toggleFullscreen} 
        aria-label="Toggle fullscreen"
        title="Fullscreen (F)"
      >
        {#if isFullscreen}
          <Minimize2 size={19} />
        {:else}
          <Maximize2 size={19} />
        {/if}
      </button>
    </div>
  </header>

  <!-- Bottom Minimal Chrome Bar (Progress Bar) -->
  <footer 
    class="reader-chrome-bottom {epubReader.isChromeVisible ? 'visible' : 'hidden'}"
    onclick={(e) => e.stopPropagation()}
    role="contentinfo"
  >
    <EpubProgressBar />
  </footer>

  <!-- Jump Back Safety Chip -->
  <EpubJumpBackChip />

  <!-- Remote Device Progress Notification Chip -->
  <EpubRemoteProgressChip />

  <!-- Footnote Popover -->
  <EpubFootnotePopover />

  <!-- Drawers / Overlays -->
  {#if epubReader.isTocOpen}
    <EpubTocDrawer />
  {/if}

  {#if epubReader.isSettingsOpen}
    <EpubSettingsSheet />
  {/if}

  {#if epubReader.isSearchOpen}
    <EpubSearchPanel />
  {/if}
</div>

<style>
  .epub-reader-root {
    position: fixed;
    inset: 0;
    z-index: 9990;
    background: var(--bg-base, #ffffff);
    color: var(--text-primary, #111827);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }

  .theme-paper {
    background: #f7f4ec !important;
    color: #2c2b29 !important;
  }

  .theme-sepia {
    background: #f4ecd8 !important;
    color: #5b4636 !important;
  }

  .theme-dark {
    background: #1c1c1e !important;
    color: #e0e0e0 !important;
  }

  .theme-black {
    background: #000000 !important;
    color: #a0a0a0 !important;
  }

  .viewer-mount {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    z-index: 1;
  }

  /* Desktop Floating Page Navigation Arrows */
  .nav-arrow {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg-surface, #ffffff) 88%, transparent);
    color: var(--text-primary, #111827);
    border: 1px solid var(--border-color, rgba(128, 128, 128, 0.2));
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    cursor: pointer;
    z-index: 9992;
    opacity: 0.28;
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), 
                transform 0.15s ease, 
                background-color 0.15s ease,
                box-shadow 0.15s ease,
                color 0.15s ease;
    user-select: none;
    -webkit-user-select: none;
  }

  .nav-arrow.visible {
    opacity: 0.82;
  }

  .nav-arrow:hover {
    opacity: 1 !important;
    background: var(--bg-surface, #ffffff);
    color: var(--accent, #3b82f6);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
    transform: translateY(-50%) scale(1.1);
  }

  .nav-arrow:active {
    transform: translateY(-50%) scale(0.95);
  }

  .nav-arrow-prev {
    left: 20px;
  }

  .nav-arrow-next {
    right: 20px;
  }

  .theme-paper .nav-arrow {
    background: rgba(247, 244, 236, 0.88);
    color: #2c2b29;
    border-color: rgba(44, 43, 41, 0.18);
  }
  .theme-paper .nav-arrow:hover {
    background: #f7f4ec;
    color: #2c2b29;
  }

  .theme-sepia .nav-arrow {
    background: rgba(244, 236, 216, 0.88);
    color: #5b4636;
    border-color: rgba(91, 70, 54, 0.18);
  }
  .theme-sepia .nav-arrow:hover {
    background: #f4ecd8;
    color: #5b4636;
  }

  .theme-dark .nav-arrow {
    background: rgba(44, 44, 46, 0.88);
    color: #e0e0e0;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .theme-dark .nav-arrow:hover {
    background: #2c2c2e;
    color: #ffffff;
  }

  .theme-black .nav-arrow {
    background: rgba(26, 26, 26, 0.88);
    color: #a0a0a0;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .theme-black .nav-arrow:hover {
    background: #1a1a1a;
    color: #ffffff;
  }

  @media (max-width: 768px) {
    .nav-arrow {
      display: none !important;
    }
  }

  :global(.viewer-mount foliate-view) {
    width: 100%;
    height: 100%;
    display: block;
  }

  .reader-chrome-top {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 52px;
    padding: 0 12px;
    padding-top: env(safe-area-inset-top, 0px);
    background: var(--bg-surface, var(--bg-base, rgba(255, 255, 255, 0.95)));
    color: var(--text-primary, #111827);
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
    display: flex;
    align-items: center;
    justify-content: space-between;
    z-index: 9995;
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  .reader-chrome-bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9995;
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
    pointer-events: auto;
  }

  .reader-chrome-top.hidden {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
  }

  .reader-chrome-bottom.hidden {
    transform: translateY(100%);
    opacity: 0;
    pointer-events: none;
  }

  .top-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 65%;
  }

  .book-title {
    font-size: 0.9rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary, #111827);
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #4b5563);
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  .action-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-primary, #111827);
  }

  .action-btn.active {
    background: var(--active-bg, rgba(59, 130, 246, 0.15));
    color: var(--accent, #3b82f6);
  }

  .desktop-only {
    display: flex;
  }

  @media (max-width: 640px) {
    .desktop-only {
      display: none;
    }
  }

  .loading-overlay, .error-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: var(--bg-base, #ffffff);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
  }

  .loading-text {
    font-size: 0.95rem;
    color: var(--text-secondary, #6b7280);
    font-weight: 500;
  }

  .error-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary, #111827);
  }

  .error-desc {
    font-size: 0.88rem;
    color: var(--text-secondary, #6b7280);
    max-width: 380px;
    line-height: 1.5;
  }

  .btn-primary {
    margin-top: 8px;
    background: var(--accent, #3b82f6);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 8px 18px;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
  }

  .spin {
    animation: spin 1s linear infinite;
    color: var(--accent, #3b82f6);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
