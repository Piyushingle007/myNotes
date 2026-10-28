import { appState } from '../../stores/appState.svelte';
import type { EpubBook, ReadingProgress, ReaderSettings, TocItem } from '../types';
import { epubManager } from '../services/EpubManager';
import { loadReaderSettings, saveReaderSettings, generateReaderCSS, DEFAULT_READER_SETTINGS } from '../utils/readerTheme';
import { EpubEngine, type RelocateDetail } from '../engine/epubEngine';

class EpubReaderStore {
  // State
  book = $state<EpubBook | null>(null);
  progress = $state<ReadingProgress | null>(null);
  settings = $state<ReaderSettings>(loadReaderSettings());
  toc = $state<TocItem[]>([]);

  // Chrome & UI overlays
  isChromeVisible = $state<boolean>(true);
  isTocOpen = $state<boolean>(false);
  isSettingsOpen = $state<boolean>(false);
  isSearchOpen = $state<boolean>(false);

  // Current location
  cfi = $state<string | null>(null);
  percentage = $state<number>(0);
  chapterTitle = $state<string>('');
  chapterHref = $state<string>('');
  isFinished = $state<boolean>(false);

  // Rolling ETA
  estimatedMinutesLeftInBook = $state<number>(0);
  estimatedMinutesLeftInChapter = $state<number>(0);

  // Jump-back safety toast
  jumpHistory = $state<{ cfi: string | null; chapterTitle: string; percentage: number } | null>(null);
  showJumpBack = $state<boolean>(false);
  private jumpBackTimeout: any = null;

  // Footnote popover
  activeFootnote = $state<{ html: string; x: number; y: number } | null>(null);

  // Remote progress prompt from sync
  remoteProgressPrompt = $state<ReadingProgress | null>(null);

  // Search state
  searchQuery = $state<string>('');
  isSearching = $state<boolean>(false);
  searchResults = $state<Array<{ label: string; subitems: Array<{ cfi: string; excerpt: string }> }>>([]);
  searchProgress = $state<number>(0);
  private searchAbortController: AbortController | null = null;

  // Engine instance
  engine: EpubEngine | null = null;

  // Active time tracking & debounced save
  private activeTimerInterval: any = null;
  private lastUserInteraction: number = Date.now();
  private saveDebounceTimer: any = null;
  private wakeLockSentinel: any = null;
  private isRestoringLocation = false;
  private autoHideChromeTimer: any = null;

  // Initialize and open a book
  async openBook(bookId: string, container: HTMLElement): Promise<void> {
    this.reset();
    
    // 1. Fetch metadata & existing progress from IndexedDB
    const libStore = epubManager.getLibraryStore();
    const progStore = epubManager.getProgressStore();

    const book = await libStore.getBook(bookId);
    if (!book) {
      throw new Error(`Book with id ${bookId} not found in library`);
    }
    this.book = book;

    let prog = await progStore.getProgress(bookId);
    const now = Date.now();
    if (!prog) {
      prog = {
        bookId,
        cfi: null,
        percentage: 0,
        chapterHref: '',
        chapterTitle: '',
        lastReadAt: now,
        firstOpenedAt: now,
        finishedAt: null,
        totalActiveSeconds: 0,
        engineVersion: 'foliate-v1',
        locationsVersion: 1,
        updatedAt: now,
        recentPagesPerMinute: 1.0,
        avgWordsPerPage: 250,
      };
    }
    this.progress = prog;
    this.cfi = prog.cfi;
    this.percentage = prog.percentage || 0;
    this.chapterTitle = prog.chapterTitle || book.title;
    this.chapterHref = prog.chapterHref || '';
    this.isFinished = !!prog.finishedAt;

    // 2. Read EPUB binary file blob from storage
    if (!appState.storage?.readBlob) {
      throw new Error('Storage adapter does not support reading binary files');
    }
    const blob = await appState.storage.readBlob(book.filePath);
    if (!blob || blob.size === 0) {
      throw new Error(`EPUB file is empty (0 bytes) or missing at path: "${book.filePath}". Please remove and re-add this book to your library.`);
    }

    // 3. Initialize engine
    this.engine = new EpubEngine();
    await this.engine.initEngine(container);

    // Apply settings before opening
    this.engine.setFlow(this.settings.flow);
    this.engine.setSpread(this.settings.twoPageSpread);
    this.engine.setMargin(this.settings.marginPercent);
    this.engine.setAnimation(this.settings.animatePageTurn);

    // Open book in engine
    await this.engine.open(blob);

    // Populate TOC
    this.toc = this.engine.getToc();

    // Wire listeners
    this.engine.onRelocate((detail) => this.handleRelocate(detail));
    this.engine.onLoad(({ doc }) => this.handleSectionLoaded(doc));
    this.engine.onExternalLink((href) => this.handleExternalLink(href));
    this.engine.onInternalLink((href, preventDefault) => this.handleInternalLink(href, preventDefault));

    // Apply injected styles
    this.applyThemeStyles();

    // 4. Restore reading position (exact CFI first, then sectionIndex + fraction, fallback to text start)
    this.isRestoringLocation = true;
    try {
      let restored = false;
      if (this.cfi) {
        try {
          const res = await this.engine.goTo(this.cfi);
          if (res && res.index >= 0) restored = true;
        } catch (e) {
          console.warn('[EpubReader] Failed to navigate to saved CFI:', e);
        }
      }
      if (!restored && typeof prog.sectionIndex === 'number' && prog.sectionIndex >= 0) {
        try {
          const res = await this.engine.goTo({
            index: prog.sectionIndex,
            anchor: prog.sectionFraction ?? 0
          });
          if (res && res.index >= 0) restored = true;
        } catch (e) {
          console.warn('[EpubReader] Failed to navigate to saved section index:', e);
        }
      }
      if (!restored && typeof this.percentage === 'number' && this.percentage > 0.005) {
        try {
          await this.engine.goToFraction(this.percentage);
          restored = true;
        } catch (e) {
          console.warn('[EpubReader] Failed to navigate to fraction:', e);
        }
      }
      if (!restored) {
        await this.engine.renderLocation({ showTextStart: true });
      }
    } finally {
      // Keep isRestoringLocation guarded for 1000ms so initial layout reflows don't clobber location
      setTimeout(() => {
        this.isRestoringLocation = false;
      }, 1000);
    }

    // 5. Start active reading timer & wake lock
    this.startActiveTimer();
    this.initWakeLock();
    this.updateETA();
  }

  toggleChrome(): void {
    this.isChromeVisible = !this.isChromeVisible;
    if (!this.isChromeVisible) {
      this.isTocOpen = false;
      this.isSettingsOpen = false;
      this.isSearchOpen = false;
    }
  }

  showChrome(): void {
    this.isChromeVisible = true;
  }

  hideChrome(): void {
    this.isChromeVisible = false;
    this.isTocOpen = false;
    this.isSettingsOpen = false;
    this.isSearchOpen = false;
  }

  recordUserActivity(): void {
    this.lastUserInteraction = Date.now();
  }

  private handleRelocate(detail: RelocateDetail): void {
    if (this.isRestoringLocation) {
      return;
    }

    const detailIndex = (detail as any).index;
    const detailFraction = typeof detail.fraction === 'number' ? detail.fraction : this.percentage;

    // Guard against spurious 0% relocation events from initial iframe layouts
    if (detailIndex === 0 && detailFraction === 0 && this.percentage > 0.02) {
      const timeSinceUser = Date.now() - this.lastUserInteraction;
      if (timeSinceUser > 1500) {
        console.warn('[EpubReader] Ignoring spurious 0% relocate event while at', this.percentage);
        return;
      }
    }

    this.recordUserActivity();
    this.cfi = detail.cfi || this.cfi;
    this.percentage = Math.max(0, Math.min(1, detailFraction));

    if (detail.tocItem?.label) {
      this.chapterTitle = detail.tocItem.label;
      this.chapterHref = detail.tocItem.href || this.chapterHref;
    }

    // Auto mark finished if >= 98%
    if (this.percentage >= 0.98) {
      this.isFinished = true;
    } else if (this.percentage < 0.95 && this.isFinished) {
      // Reversible if jumping back
      this.isFinished = false;
    }

    // Update progress object
    if (this.progress) {
      this.progress.cfi = this.cfi;
      this.progress.percentage = this.percentage;
      if (typeof detailIndex === 'number') {
        this.progress.sectionIndex = detailIndex;
      }
      if (typeof detail.fraction === 'number') {
        this.progress.sectionFraction = detail.fraction;
      }
      this.progress.chapterTitle = this.chapterTitle;
      this.progress.chapterHref = this.chapterHref;
      this.progress.lastReadAt = Date.now();
      this.progress.updatedAt = Date.now();
      this.progress.finishedAt = this.isFinished ? (this.progress.finishedAt || Date.now()) : null;
    }

    this.updateETA();
    this.scheduleDebouncedSave();
  }

  private wheelAccumulator = 0;
  private isWheelLocked = false;
  private wheelResetTimer: any = null;

  public handleWheel(e: WheelEvent): void {
    if (appState.isMobile) return;
    if (this.settings.flow !== 'paginated') return;

    const dx = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    const dy = e.deltaY;

    // Check if horizontal intent is dominant or shift key is held
    if (!e.shiftKey && Math.abs(dx) <= Math.abs(dy)) {
      return;
    }

    if (Math.abs(dx) > 4 && e.cancelable) {
      // Prevent browser / Electron back-forward navigation swipe gesture
      e.preventDefault();
    }

    if (this.isWheelLocked) {
      return;
    }

    this.wheelAccumulator += dx;

    if (this.wheelResetTimer) {
      clearTimeout(this.wheelResetTimer);
    }
    this.wheelResetTimer = setTimeout(() => {
      this.wheelAccumulator = 0;
    }, 250);

    const THRESHOLD = 38;
    if (this.wheelAccumulator >= THRESHOLD) {
      this.isWheelLocked = true;
      this.wheelAccumulator = 0;
      this.next();
      setTimeout(() => {
        this.isWheelLocked = false;
      }, 350);
    } else if (this.wheelAccumulator <= -THRESHOLD) {
      this.isWheelLocked = true;
      this.wheelAccumulator = 0;
      this.prev();
      setTimeout(() => {
        this.isWheelLocked = false;
      }, 350);
    }
  }

  private handleSectionLoaded(doc: Document): void {
    // Re-apply active theme and font typography to newly loaded section
    this.applyThemeStyles();

    // Listen to touch/pointer on iframe document to record user activity
    doc.addEventListener('pointerdown', () => {
      this.recordUserActivity();
    }, { passive: true });

    doc.addEventListener('scroll', () => {
      this.recordUserActivity();
    }, { passive: true });

    // Horizontal scroll / trackpad pagination on PC & Web
    doc.addEventListener('wheel', (e: WheelEvent) => {
      this.handleWheel(e);
    }, { passive: false });

    // Handle tap on reading surface: toggle UI controls cleanly (swipe is used for page turns)
    let lastDocTapTime = 0;
    doc.addEventListener('click', (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastDocTapTime < 280) return;
      lastDocTapTime = now;

      // Check if user clicked a link or selected text
      const target = e.target as HTMLElement | null;
      if (target?.closest('a') || doc.defaultView?.getSelection()?.toString().trim()) {
        return;
      }

      this.toggleChrome();
    });
  }

  private handleExternalLink(href: string): void {
    try {
      window.open(href, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.warn('[EpubReader] Failed to open external link:', href, e);
    }
  }

  private handleInternalLink(href: string, preventDefault: () => void): void {
    // Record jump back position before navigating
    this.pushJumpHistory();

    // Check if link points to a footnote or citation
    if (href.includes('#')) {
      const hash = href.split('#')[1];
      if (this.engine?.book) {
        try {
          const doc = this.engine.book.sections?.find((s: any) => s.href?.includes(href.split('#')[0]))?.document;
          const footnoteEl = doc?.getElementById(hash) || document.getElementById(hash);
          if (footnoteEl && (footnoteEl.matches('aside, [role="doc-footnote"], [role="doc-endnote"], .footnote, .note') || footnoteEl.parentElement?.matches('aside, [role="doc-footnote"]'))) {
            preventDefault();
            this.activeFootnote = {
              html: footnoteEl.innerHTML,
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            };
            return;
          }
        } catch {
          // Continue normal link jump
        }
      }
    }

    // Normal internal navigation
    this.goTo(href);
  }

  pushJumpHistory(): void {
    this.jumpHistory = {
      cfi: this.cfi,
      chapterTitle: this.chapterTitle,
      percentage: this.percentage,
    };
    this.showJumpBack = true;
    if (this.jumpBackTimeout) clearTimeout(this.jumpBackTimeout);
    this.jumpBackTimeout = setTimeout(() => {
      this.showJumpBack = false;
    }, 8000);
  }

  async jumpBack(): Promise<void> {
    if (!this.jumpHistory) return;
    const target = this.jumpHistory.cfi || { fraction: this.jumpHistory.percentage };
    this.showJumpBack = false;
    this.jumpHistory = null;
    await this.goTo(target);
  }

  checkRemoteProgressUpdate(remote: ReadingProgress): void {
    if (this.book && this.book.bookId === remote.bookId) {
      if ((remote.updatedAt || 0) > (this.progress?.updatedAt || 0)) {
        if ((remote.percentage || 0) > this.percentage || remote.cfi !== this.cfi) {
          this.remoteProgressPrompt = remote;
        }
      }
    }
  }

  async acceptRemoteProgress(): Promise<void> {
    if (!this.remoteProgressPrompt) return;
    const target = this.remoteProgressPrompt;
    this.remoteProgressPrompt = null;
    this.progress = target;
    this.cfi = target.cfi;
    this.percentage = target.percentage;
    this.chapterTitle = target.chapterTitle || this.chapterTitle;
    this.chapterHref = target.chapterHref || this.chapterHref;
    if (target.cfi) {
      await this.goTo(target.cfi);
    } else if (typeof target.percentage === 'number') {
      await this.goToFraction(target.percentage);
    }
  }

  dismissRemoteProgress(): void {
    this.remoteProgressPrompt = null;
  }

  async next(): Promise<void> {
    this.recordUserActivity();
    if (this.engine) await this.engine.next();
  }

  async prev(): Promise<void> {
    this.recordUserActivity();
    if (this.engine) await this.engine.prev();
  }

  async goTo(target: any): Promise<void> {
    this.recordUserActivity();
    if (this.engine) await this.engine.goTo(target);
  }

  async goToFraction(fraction: number): Promise<void> {
    this.recordUserActivity();
    if (this.engine) await this.engine.goToFraction(fraction);
  }

  // Typography & Theme Settings
  updateSettings(partial: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...partial };
    saveReaderSettings(this.settings);

    if (this.engine) {
      if (partial.flow) {
        this.engine.setFlow(this.settings.flow);
      }
      if (partial.twoPageSpread !== undefined) {
        this.engine.setSpread(this.settings.twoPageSpread);
      }
      if (partial.marginPercent !== undefined) {
        this.engine.setMargin(this.settings.marginPercent);
      }
      if (partial.animatePageTurn !== undefined) {
        this.engine.setAnimation(this.settings.animatePageTurn);
      }
      this.applyThemeStyles();
    }

    if (partial.keepScreenAwake !== undefined) {
      if (this.settings.keepScreenAwake) {
        this.initWakeLock();
      } else {
        this.releaseWakeLock();
      }
    }
  }

  applyThemeStyles(): void {
    if (!this.engine) return;
    const css = generateReaderCSS(this.settings);
    this.engine.setStyles(css);
  }

  resetSettingsToDefault(): void {
    this.updateSettings(DEFAULT_READER_SETTINGS);
  }

  // In-book search
  async performSearch(query: string): Promise<void> {
    if (!this.engine || !query.trim()) return;
    this.cancelSearch();

    this.searchQuery = query;
    this.isSearching = true;
    this.searchResults = [];
    this.searchProgress = 0;

    try {
      for await (const result of this.engine.search(query)) {
        if (!this.isSearching) break;
        if (result === 'done') break;
        if (typeof result.progress === 'number') {
          this.searchProgress = result.progress;
        } else if (result.subitems && result.subitems.length > 0) {
          this.searchResults.push({
            label: result.label || `Chapter ${this.searchResults.length + 1}`,
            subitems: result.subitems,
          });
        }
      }
    } catch (e) {
      console.warn('[EpubReader] Search error:', e);
    } finally {
      this.isSearching = false;
      this.searchProgress = 1;
    }
  }

  cancelSearch(): void {
    this.isSearching = false;
    if (this.engine) {
      this.engine.clearSearch();
    }
  }

  // Active reading timer & ETA calculations
  private startActiveTimer(): void {
    if (this.activeTimerInterval) clearInterval(this.activeTimerInterval);
    this.activeTimerInterval = setInterval(() => {
      // Only count if page is visible and user interacted in last 60 seconds
      if (typeof document !== 'undefined' && !document.hidden) {
        const timeSinceInteraction = Date.now() - this.lastUserInteraction;
        if (timeSinceInteraction < 60000) {
          if (this.progress) {
            this.progress.totalActiveSeconds = (this.progress.totalActiveSeconds || 0) + 1;
          }
        }
      }
    }, 1000);
  }

  private updateETA(): void {
    if (!this.progress) return;
    const activeSec = this.progress.totalActiveSeconds || 0;
    const frac = Math.max(0.01, this.percentage);

    if (activeSec > 30 && frac > 0.02) {
      const totalEstimatedSeconds = activeSec / frac;
      const remainingSeconds = Math.max(0, (1 - frac) * totalEstimatedSeconds);
      this.estimatedMinutesLeftInBook = Math.max(1, Math.round(remainingSeconds / 60));
    } else {
      // Baseline estimate: 2.5 minutes per section/chapter or ~200 WPM
      const spineCount = this.book?.spineLength || 20;
      const remainingSections = Math.max(1, Math.round(spineCount * (1 - frac)));
      this.estimatedMinutesLeftInBook = Math.round(remainingSections * 3);
    }

    // Estimate for current chapter
    this.estimatedMinutesLeftInChapter = Math.max(1, Math.min(this.estimatedMinutesLeftInBook, 4));
  }

  // Debounced progress saving
  private scheduleDebouncedSave(): void {
    // Immediately write to synchronous localStorage cache so sudden exits never lose location
    if (this.progress) {
      this.progress.lastReadAt = Date.now();
      this.progress.updatedAt = Date.now();
      try {
        // saveProgress writes to localStorage synchronously and queues IndexedDB
        epubManager.getProgressStore().saveProgress(this.progress).catch(() => {});
      } catch {}
    }

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.flushProgress();
    }, 1000);
  }

  // Guaranteed immediate flush of progress
  async flushProgress(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    if (!this.progress) return;

    this.progress.lastReadAt = Date.now();
    this.progress.updatedAt = Date.now();
    try {
      await epubManager.getProgressStore().saveProgress(this.progress);
    } catch (e) {
      console.error('[EpubReader] Failed to flush progress:', e);
    }
  }

  // Screen Wake Lock
  private async initWakeLock(): Promise<void> {
    if (!this.settings.keepScreenAwake || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    } catch {
      // Ignore wake lock failure (low battery or unsupported)
    }
  }

  private releaseWakeLock(): void {
    try {
      this.wakeLockSentinel?.release();
    } catch {
      // ignore
    }
    this.wakeLockSentinel = null;
  }

  private isClosing = false;

  // Clean tear-down when exiting reader
  async closeReader(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;
    try {
      await this.flushProgress();
      this.releaseWakeLock();
      if (this.activeTimerInterval) {
        clearInterval(this.activeTimerInterval);
        this.activeTimerInterval = null;
      }
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
      if (this.engine) {
        this.engine.destroy();
        this.engine = null;
      }
      this.reset();
    } finally {
      this.isClosing = false;
    }
  }

  private reset(): void {
    this.wheelAccumulator = 0;
    this.isWheelLocked = false;
    if (this.wheelResetTimer) {
      clearTimeout(this.wheelResetTimer);
      this.wheelResetTimer = null;
    }
    this.book = null;
    this.progress = null;
    this.toc = [];
    this.cfi = null;
    this.percentage = 0;
    this.chapterTitle = '';
    this.chapterHref = '';
    this.isFinished = false;
    this.isChromeVisible = true;
    this.isTocOpen = false;
    this.isSettingsOpen = false;
    this.isSearchOpen = false;
    this.activeFootnote = null;
    this.jumpHistory = null;
    this.showJumpBack = false;
    this.searchResults = [];
    this.isSearching = false;
  }
}

export const epubReader = new EpubReaderStore();
