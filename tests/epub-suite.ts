import assert from 'node:assert/strict';
import { computeBookId } from '../src/lib/epub/utils/bookHash';
import { generateReaderCSS, getThemeColors, DEFAULT_READER_SETTINGS, loadReaderSettings } from '../src/lib/epub/utils/readerTheme';
import { mergeProgressMaps } from '../src/lib/epub/sync/epubProgressSync';
import { parseEpub } from '../src/lib/epub/parser/epubParser';
import JSZip from 'jszip';
import type { ReadingProgress } from '../src/lib/epub/types';

export async function runSuite() {
  console.log('--- TEST 1: computeBookId Determinism & Performance ---');
  const bufA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const bufB = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const bufC = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);

  const hashA = await computeBookId(bufA);
  const hashB = await computeBookId(bufB);
  const hashC = await computeBookId(bufC);

  assert.equal(hashA, hashB, 'Identical content must produce identical hash');
  assert.notEqual(hashA, hashC, 'Different content must produce different hash');
  assert.match(hashA, /^epub_[a-f0-9]{64}$/, 'Hash must be SHA-256 with epub_ prefix');
  console.log('✓ PASS: computeBookId is deterministic and SHA-256 compliant.');

  console.log('--- TEST 2: readerTheme CSS Generation & 30+ Themes Compatibility ---');
  const paper = getThemeColors('paper');
  assert.equal(paper.bg, '#f7f4ec');
  assert.equal(paper.text, '#2c2b29');
  assert.equal(paper.isDark, false);

  const oled = getThemeColors('black');
  assert.equal(oled.bg, '#000000');
  assert.equal(oled.isDark, true);

  const css = generateReaderCSS({
    ...DEFAULT_READER_SETTINGS,
    theme: 'dark',
    fontSize: 20,
    lineHeight: 1.7,
    fontFamily: 'dyslexic',
    textAlign: 'justify',
    hyphenation: true,
    invertImagesInDark: true,
  });

  assert.ok(css.includes('font-size: 20px !important;'), 'Should inject 20px font size');
  assert.ok(css.includes('line-height: 1.7 !important;'), 'Should inject 1.7 line height');
  assert.ok(css.includes('OpenDyslexic'), 'Should inject OpenDyslexic');
  assert.ok(css.includes('text-align: justify !important;'), 'Should inject justify');
  assert.ok(css.includes('filter: brightness(0.8)'), 'Should dim images in dark mode');
  console.log('✓ PASS: readerTheme generates accurate CSS tokens, dark OLED colors, and dyslexia fonts.');

  console.log('--- TEST 3: EPUB Parser & ZIP Extraction ---');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`
  );

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Frankenstein</dc:title>
        <dc:creator>Mary Shelley</dc:creator>
        <dc:language>en</dc:language>
        <dc:publisher>Standard Ebooks</dc:publisher>
        <dc:description>A classic novel.</dc:description>
      </metadata>
      <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter1"/>
      </spine>
    </package>`
  );

  const epubBlob = await zip.generateAsync({ type: 'blob' });
  const meta = await parseEpub(epubBlob);

  assert.equal(meta.title, 'Frankenstein');
  assert.deepEqual(meta.authors, ['Mary Shelley']);
  assert.equal(meta.language, 'en');
  assert.equal(meta.publisher, 'Standard Ebooks');
  assert.equal(meta.status, 'ok');
  assert.equal(meta.spineLength, 1);
  console.log('✓ PASS: parseEpub correctly extracts metadata and spine sections.');

  console.log('--- TEST 4: Google Drive Reading Progress Sync Merge ---');
  const localMap: Record<string, ReadingProgress> = {
    'book-1': {
      bookId: 'book-1',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      percentage: 0.1,
      chapterHref: 'c1.html',
      chapterTitle: 'C1',
      lastReadAt: 1000,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 100,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 1000,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
    'book-local-only': {
      bookId: 'book-local-only',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      percentage: 0.3,
      chapterHref: 'c2.html',
      chapterTitle: 'C2',
      lastReadAt: 1500,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 200,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 1500,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
  };

  const remoteMap: Record<string, ReadingProgress> = {
    'book-1': {
      bookId: 'book-1',
      cfi: 'epubcfi(/6/6!/4/2:0)',
      percentage: 0.6,
      chapterHref: 'c3.html',
      chapterTitle: 'C3',
      lastReadAt: 2500,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 500,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 2500,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
    'book-remote-only': {
      bookId: 'book-remote-only',
      cfi: 'epubcfi(/6/4!/4/2:0)',
      percentage: 0.99,
      chapterHref: 'c4.html',
      chapterTitle: 'C4',
      lastReadAt: 2000,
      firstOpenedAt: 500,
      finishedAt: 2000,
      totalActiveSeconds: 800,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 2000,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
  };

  const { merged, hasLocalChangesToUpload, remoteAdvanced } = mergeProgressMaps(localMap, remoteMap);

  assert.equal(merged['book-1'].percentage, 0.6, 'Remote must win when remote.updatedAt > local.updatedAt');
  assert.ok(remoteAdvanced['book-1'], 'Book-1 must be flagged as remote advance for chip prompt');
  assert.equal(merged['book-local-only'].percentage, 0.3, 'Local-only book must be retained');
  assert.equal(hasLocalChangesToUpload, true, 'Local changes must trigger Drive upload');
  assert.equal(merged['book-remote-only'].percentage, 0.99, 'Remote-only book must be retained');
  console.log('✓ PASS: mergeProgressMaps correctly merges progress and flags remote advances.');

  console.log('--- TEST 5: ReadingProgressStore Synchronous LocalStorage Cache ---');
  const { ReadingProgressStore } = await import('../src/lib/epub/storage/ReadingProgressStore');
  const progStore = new ReadingProgressStore('test_vault');
  const testProg: ReadingProgress = {
    bookId: 'test-sync-book',
    cfi: 'epubcfi(/6/10!/4/2:12)',
    percentage: 0.42,
    sectionIndex: 3,
    sectionFraction: 0.15,
    chapterHref: 'chapter3.html',
    chapterTitle: 'Chapter 3',
    lastReadAt: Date.now(),
    firstOpenedAt: Date.now() - 60000,
    finishedAt: null,
    totalActiveSeconds: 300,
    engineVersion: '1.0.0',
    locationsVersion: 1,
    updatedAt: Date.now(),
    recentPagesPerMinute: 1.2,
    avgWordsPerPage: 260
  };

  // Test synchronous localStorage write and retrieval
  (progStore as any).writeToLocalStorage(testProg);
  const loadedFromLocal = (progStore as any).readFromLocalStorage('test-sync-book');
  assert.ok(loadedFromLocal, 'Must read synchronously from localStorage cache');
  assert.equal(loadedFromLocal.percentage, 0.42, 'Cached percentage must match');
  assert.equal(loadedFromLocal.sectionIndex, 3, 'Cached sectionIndex must match');
  assert.equal(loadedFromLocal.sectionFraction, 0.15, 'Cached sectionFraction must match');
  assert.equal(loadedFromLocal.cfi, 'epubcfi(/6/10!/4/2:12)', 'Cached CFI must match');
  console.log('✓ PASS: ReadingProgressStore correctly caches progress synchronously in localStorage.');

  console.log('--- TEST 6: Desktop Horizontal Wheel Scroll Pagination Logic ---');
  const { epubReader } = await import('../src/lib/epub/stores/epubReader.svelte');
  epubReader.settings.flow = 'paginated';

  let nextCalled = 0;
  let prevCalled = 0;
  (epubReader as any).next = async () => { nextCalled++; };
  (epubReader as any).prev = async () => { prevCalled++; };

  // 1. Pure vertical scroll should be ignored in paginated mode
  epubReader.handleWheel({ deltaX: 0, deltaY: 50, shiftKey: false, cancelable: true, preventDefault: () => {} } as any);
  assert.equal(nextCalled, 0, 'Vertical scroll should not trigger next in paginated mode');
  assert.equal(prevCalled, 0, 'Vertical scroll should not trigger prev in paginated mode');

  // 2. Horizontal scroll to the right (deltaX > 0) above threshold triggers next
  epubReader.handleWheel({ deltaX: 45, deltaY: 2, shiftKey: false, cancelable: true, preventDefault: () => {} } as any);
  assert.equal(nextCalled, 1, 'Horizontal scroll right should trigger next page');

  // 3. Locked during cooldown (rapid swipe events ignored)
  epubReader.handleWheel({ deltaX: 45, deltaY: 2, shiftKey: false, cancelable: true, preventDefault: () => {} } as any);
  assert.equal(nextCalled, 1, 'Rapid swipe events during cooldown must be locked');

  // Fast forward cooldown lock
  (epubReader as any).isWheelLocked = false;
  (epubReader as any).wheelAccumulator = 0;

  // 4. Horizontal scroll to the left (deltaX < 0) triggers prev
  epubReader.handleWheel({ deltaX: -45, deltaY: 1, shiftKey: false, cancelable: true, preventDefault: () => {} } as any);
  assert.equal(prevCalled, 1, 'Horizontal scroll left should trigger prev page');

  // Fast forward cooldown lock
  (epubReader as any).isWheelLocked = false;
  (epubReader as any).wheelAccumulator = 0;

  // 5. Shift + vertical wheel triggers horizontal scroll
  epubReader.handleWheel({ deltaX: 0, deltaY: 45, shiftKey: true, cancelable: true, preventDefault: () => {} } as any);
  assert.equal(nextCalled, 2, 'Shift + vertical wheel should trigger horizontal page turn');

  console.log('✓ PASS: Horizontal scroll navigation accurately triggers page turns with debounced thresholds.');

  console.log('--- TEST 7: Page-Turn Animation Settings & Engine Integration ---');
  assert.equal(DEFAULT_READER_SETTINGS.animatePageTurn, true, 'Page turn animations must be enabled by default');

  // Test updating settings
  epubReader.updateSettings({ animatePageTurn: false });
  assert.equal(epubReader.settings.animatePageTurn, false, 'Setting must update to false');
  const storedSettings1 = loadReaderSettings();
  assert.equal(storedSettings1.animatePageTurn, false, 'Setting must persist to localStorage');

  epubReader.updateSettings({ animatePageTurn: true });
  assert.equal(epubReader.settings.animatePageTurn, true, 'Setting must update to true');
  const storedSettings2 = loadReaderSettings();
  assert.equal(storedSettings2.animatePageTurn, true, 'Setting must persist to localStorage');

  // Test EpubEngine setAnimation attribute binding
  const { EpubEngine } = await import('../src/lib/epub/engine/epubEngine');
  const engine = new EpubEngine();
  const mockRenderer = {
    attributes: new Map<string, string>(),
    setAttribute(key: string, val: string) { this.attributes.set(key, val); },
    removeAttribute(key: string) { this.attributes.delete(key); },
    hasAttribute(key: string) { return this.attributes.has(key); }
  };
  (engine as any).viewEl = { renderer: mockRenderer };
  engine.setAnimation(true);
  assert.equal(mockRenderer.hasAttribute('animated'), true, 'Engine must set animated attribute on renderer');

  engine.setAnimation(false);
  assert.equal(mockRenderer.hasAttribute('animated'), false, 'Engine must remove animated attribute when disabled');
  console.log('✓ PASS: Page-turn animation settings and engine renderer attributes integrate correctly.');
}
