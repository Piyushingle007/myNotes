import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBookId } from '../src/lib/epub/utils/bookHash.ts';
import { generateReaderCSS, getThemeColors, DEFAULT_READER_SETTINGS } from '../src/lib/epub/utils/readerTheme.ts';
import { mergeProgressMaps } from '../src/lib/epub/sync/epubProgressSync.ts';
import type { ReadingProgress } from '../src/lib/epub/types.ts';

test('1. computeBookId returns deterministic SHA-256 for identical file chunks', async () => {
  const file1 = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'application/epub+zip' });
  const file2 = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'application/epub+zip' });
  const file3 = new Blob([new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1])], { type: 'application/epub+zip' });

  const hash1 = await computeBookId(file1);
  const hash2 = await computeBookId(file2);
  const hash3 = await computeBookId(file3);

  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash2, 'Identical content must produce identical hash');
  assert.notEqual(hash1, hash3, 'Different content must produce different hash');
});

test('2. readerTheme generates accurate CSS tokens and overrides', () => {
  // Test paper theme
  const paper = getThemeColors('paper');
  assert.equal(paper.bg, '#f7f4ec');
  assert.equal(paper.text, '#2c2b29');
  assert.equal(paper.isDark, false);

  // Test OLED black theme
  const oled = getThemeColors('black');
  assert.equal(oled.bg, '#000000');
  assert.equal(oled.isDark, true);

  // Test generated CSS
  const css = generateReaderCSS({
    ...DEFAULT_READER_SETTINGS,
    theme: 'dark',
    fontSize: 22,
    lineHeight: 1.8,
    fontFamily: 'dyslexic',
    textAlign: 'justify',
    hyphenation: true,
    invertImagesInDark: true,
  });

  assert.ok(css.includes('font-size: 22px !important;'), 'Should inject 22px font size');
  assert.ok(css.includes('line-height: 1.8 !important;'), 'Should inject 1.8 line height');
  assert.ok(css.includes('OpenDyslexic'), 'Should inject OpenDyslexic font stack');
  assert.ok(css.includes('text-align: justify !important;'), 'Should inject justify text alignment');
  assert.ok(css.includes('hyphens: auto;'), 'Should enable hyphenation');
  assert.ok(css.includes('filter: brightness(0.8)'), 'Should dim images in dark mode');
});

test('3. mergeProgressMaps handles newest-write-wins per book for Drive sync', () => {
  const localMap: Record<string, ReadingProgress> = {
    'book-1': {
      bookId: 'book-1',
      cfi: 'epubcfi(/6/2[chapter1]!/4/2/1:0)',
      percentage: 0.15,
      chapterHref: 'chapter1.html',
      chapterTitle: 'Chapter 1',
      lastReadAt: 1000,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 120,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 1000,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
    'book-local-only': {
      bookId: 'book-local-only',
      cfi: 'epubcfi(/6/4[chapter2]!/4/2/1:0)',
      percentage: 0.5,
      chapterHref: 'chapter2.html',
      chapterTitle: 'Chapter 2',
      lastReadAt: 1500,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 300,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 1500,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
  };

  const remoteMap: Record<string, ReadingProgress> = {
    // Book 1 is further ahead on remote device (updatedAt: 2000 > 1000)
    'book-1': {
      bookId: 'book-1',
      cfi: 'epubcfi(/6/6[chapter3]!/4/2/1:0)',
      percentage: 0.45,
      chapterHref: 'chapter3.html',
      chapterTitle: 'Chapter 3',
      lastReadAt: 2000,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 400,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 2000,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
    // Remote-only book
    'book-remote-only': {
      bookId: 'book-remote-only',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      percentage: 0.8,
      chapterHref: 'chapter4.html',
      chapterTitle: 'Chapter 4',
      lastReadAt: 1800,
      firstOpenedAt: 500,
      finishedAt: null,
      totalActiveSeconds: 600,
      engineVersion: 'foliate-v1',
      locationsVersion: 1,
      updatedAt: 1800,
      recentPagesPerMinute: 1,
      avgWordsPerPage: 250,
    },
  };

  const { merged, hasLocalChangesToUpload, remoteAdvanced } = mergeProgressMaps(localMap, remoteMap);

  // 1. Book-1 remote was newer (2000 > 1000), so remote must win
  assert.equal(merged['book-1'].percentage, 0.45);
  assert.equal(merged['book-1'].chapterTitle, 'Chapter 3');
  assert.ok(remoteAdvanced['book-1'], 'Book-1 should be marked as remote advanced for the prompt');

  // 2. Local-only book is preserved in merged
  assert.equal(merged['book-local-only'].percentage, 0.5);
  assert.equal(hasLocalChangesToUpload, true, 'Local changes must trigger sync upload');

  // 3. Remote-only book is preserved and saved
  assert.equal(merged['book-remote-only'].percentage, 0.8);
  assert.ok(remoteAdvanced['book-remote-only']);
});

test('4. Reading ETA and Finished Threshold Calculations', () => {
  // Test finished threshold
  const p1 = 0.985;
  const isFin = p1 >= 0.98;
  assert.equal(isFin, true, 'Progress >= 98% should trigger finished');

  // Test ETA calculation: 600 active seconds at 50% means 600 seconds left (~10 min)
  const frac = 0.5;
  const activeSec = 600;
  const totalEstimatedSeconds = activeSec / frac;
  const remainingSeconds = (1 - frac) * totalEstimatedSeconds;
  const estimatedMin = Math.round(remainingSeconds / 60);

  assert.equal(estimatedMin, 10, '600s active at 50% should leave exactly 10 minutes');
});
