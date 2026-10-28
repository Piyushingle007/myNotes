// @ts-nocheck
import type { TocItem } from '../types';

export interface RelocateDetail {
  cfi: string;
  fraction: number;
  location?: number;
  tocItem?: { label: string; href: string } | null;
  pageItem?: any;
  range?: Range;
}

let foliateInitialized = false;

async function ensureFoliateLoaded() {
  if (!foliateInitialized) {
    await import('./foliate/view.js');
    foliateInitialized = true;
  }
}

function normalizeToc(items: any[] = []): TocItem[] {
  return items.map((item, idx) => ({
    id: item.id || `toc-${idx}`,
    href: item.href || '',
    label: (item.label || item.title || `Chapter ${idx + 1}`).trim(),
    children: item.subitems && item.subitems.length ? normalizeToc(item.subitems) : undefined,
  }));
}

export class EpubEngine {
  private viewEl: any = null;
  private container: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];
  public book: any = null;
  public isFixedLayout: boolean = false;
  private pendingFlow?: 'paginated' | 'scrolled';
  private pendingSpread?: boolean;
  private pendingMargin?: number;
  private pendingAnimation?: boolean;
  private pendingStyles?: string;

  async initEngine(container: HTMLElement): Promise<void> {
    await ensureFoliateLoaded();
    this.container = container;
    this.viewEl = document.createElement('foliate-view');
    this.viewEl.style.width = '100%';
    this.viewEl.style.height = '100%';
    this.viewEl.style.display = 'block';
    this.viewEl.style.overflow = 'hidden';
    this.viewEl.style.position = 'relative';
    this.container.appendChild(this.viewEl);
  }

  async open(blob: Blob): Promise<void> {
    if (!this.viewEl) {
      throw new Error('EpubEngine not mounted');
    }
    await this.viewEl.open(blob);
    this.book = this.viewEl.book;
    this.isFixedLayout = this.viewEl.isFixedLayout || false;

    // Apply any layout, animation, and theme style settings configured before open
    if (this.pendingFlow) this.setFlow(this.pendingFlow);
    if (this.pendingSpread !== undefined) this.setSpread(this.pendingSpread);
    if (this.pendingMargin !== undefined) this.setMargin(this.pendingMargin);
    if (this.pendingAnimation !== undefined) this.setAnimation(this.pendingAnimation);
    if (this.pendingStyles) this.setStyles(this.pendingStyles);
  }

  async renderLocation(options: { lastLocation?: any; showTextStart?: boolean } = {}): Promise<void> {
    if (!this.viewEl) return;
    await this.viewEl.init(options);
  }

  getToc(): TocItem[] {
    if (this.book?.toc && this.book.toc.length > 0) {
      return normalizeToc(this.book.toc);
    }
    // Fallback: construct from spine sections if TOC is missing/broken
    if (this.book?.sections && this.book.sections.length > 0) {
      return this.book.sections.map((section: any, idx: number) => ({
        id: section.id || `section-${idx}`,
        href: section.href || section.id || String(idx),
        label: `Section ${idx + 1}`,
      }));
    }
    return [];
  }

  async next(distance?: number): Promise<void> {
    if (this.viewEl) await this.viewEl.next(distance);
  }

  async prev(distance?: number): Promise<void> {
    if (this.viewEl) await this.viewEl.prev(distance);
  }

  async goLeft(): Promise<void> {
    if (this.viewEl) await this.viewEl.goLeft();
  }

  async goRight(): Promise<void> {
    if (this.viewEl) await this.viewEl.goRight();
  }

  async goTo(target: any): Promise<any> {
    if (!this.viewEl) return;
    return await this.viewEl.goTo(target);
  }

  async goToFraction(fraction: number): Promise<void> {
    if (!this.viewEl) return;
    await this.viewEl.goToFraction(fraction);
  }

  setStyles(css: string): void {
    this.pendingStyles = css;
    if (this.viewEl?.renderer?.setStyles) {
      this.viewEl.renderer.setStyles(css);
    }
  }

  setFlow(flow: 'paginated' | 'scrolled'): void {
    this.pendingFlow = flow;
    if (this.viewEl?.renderer && !this.isFixedLayout) {
      this.viewEl.renderer.setAttribute('flow', flow);
    }
  }

  setSpread(twoPage: boolean): void {
    this.pendingSpread = twoPage;
    if (this.viewEl?.renderer && !this.isFixedLayout) {
      this.viewEl.renderer.setAttribute('max-column-count', twoPage ? '2' : '1');
    }
  }

  setMargin(marginPercent: number): void {
    this.pendingMargin = marginPercent;
    if (this.viewEl?.renderer && !this.isFixedLayout) {
      this.viewEl.renderer.setAttribute('margin', `${Math.round(marginPercent * 2.4)}px`);
      this.viewEl.renderer.setAttribute('gap', `${Math.max(2, Math.round(marginPercent * 0.6))}%`);
    }
  }

  setAnimation(animated: boolean): void {
    this.pendingAnimation = animated;
    if (this.viewEl?.renderer && !this.isFixedLayout) {
      if (animated) {
        this.viewEl.renderer.setAttribute('animated', '');
      } else {
        this.viewEl.renderer.removeAttribute('animated');
      }
    }
  }

  onRelocate(callback: (detail: RelocateDetail) => void): () => void {
    if (!this.viewEl) return () => {};
    const handler = (e: CustomEvent) => {
      const d = e.detail || {};
      callback({
        cfi: d.cfi || '',
        fraction: typeof d.fraction === 'number' ? d.fraction : 0,
        location: d.location,
        tocItem: d.tocItem,
        pageItem: d.pageItem,
        range: d.range,
      });
    };
    this.viewEl.addEventListener('relocate', handler);
    const cleanup = () => this.viewEl?.removeEventListener('relocate', handler);
    this.cleanupFns.push(cleanup);
    return cleanup;
  }

  onLoad(callback: (detail: { doc: Document; index: number }) => void): () => void {
    if (!this.viewEl) return () => {};
    const handler = (e: CustomEvent) => callback(e.detail);
    this.viewEl.addEventListener('load', handler);
    const cleanup = () => this.viewEl?.removeEventListener('load', handler);
    this.cleanupFns.push(cleanup);
    return cleanup;
  }

  onExternalLink(callback: (href: string) => void): () => void {
    if (!this.viewEl) return () => {};
    const handler = (e: CustomEvent) => {
      e.preventDefault();
      const href = e.detail?.href_ || e.detail?.a?.getAttribute?.('href');
      if (href) callback(href);
    };
    this.viewEl.addEventListener('external-link', handler);
    const cleanup = () => this.viewEl?.removeEventListener('external-link', handler);
    this.cleanupFns.push(cleanup);
    return cleanup;
  }

  onInternalLink(callback: (href: string, preventDefault: () => void) => void): () => void {
    if (!this.viewEl) return () => {};
    const handler = (e: CustomEvent) => {
      const href = e.detail?.href;
      callback(href, () => e.preventDefault());
    };
    this.viewEl.addEventListener('link', handler);
    const cleanup = () => this.viewEl?.removeEventListener('link', handler);
    this.cleanupFns.push(cleanup);
    return cleanup;
  }

  async *search(query: string): AsyncIterable<any> {
    if (!this.viewEl) return;
    for await (const result of this.viewEl.search({ query })) {
      yield result;
    }
  }

  clearSearch(): void {
    if (this.viewEl) {
      this.viewEl.clearSearch();
    }
  }

  destroy(): void {
    for (const fn of this.cleanupFns) {
      try { fn(); } catch { /* ignore */ }
    }
    this.cleanupFns = [];
    if (this.viewEl) {
      try { this.viewEl.close(); } catch { /* ignore */ }
      try { this.viewEl.remove(); } catch { /* ignore */ }
      this.viewEl = null;
    }
    this.container = null;
    this.book = null;
  }
}
