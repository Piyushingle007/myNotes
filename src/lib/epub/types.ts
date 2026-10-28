export interface TocItem {
  href: string;
  label: string;
  id: string;
  children?: TocItem[];
}

export interface EpubBook {
  bookId: string;               // SHA-256 content-derived hash
  filePath: string;             // Storage path, e.g. "Books/Pride_and_Prejudice.epub"
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  description: string;
  hasCover: boolean;
  coverThumbnailPath?: string;  // Storage path to thumbnail, e.g. "Books/__covers__/epub_xxx.webp"
  coverUrl?: string;            // In-memory object URL for UI rendering
  tocItems: TocItem[];
  spineLength: number;
  fileSize: number;
  contentHash: string;
  addedAt: number;
  importedAt: number;
  status: 'ok' | 'missing' | 'drm-protected' | 'corrupt';
  locationsVersion: number;
  locationsData: string | null; // Cached serialized locations array
}

export interface ReadingProgress {
  bookId: string;
  cfi: string | null;           // EPUB CFI location
  percentage: number;           // 0.0 to 1.0
  sectionIndex?: number;        // Spine section index
  sectionFraction?: number;      // Fraction within section (0.0 to 1.0)
  chapterHref: string;
  chapterTitle: string;
  lastReadAt: number;           // epoch ms
  firstOpenedAt: number;        // epoch ms
  finishedAt: number | null;    // epoch ms when completed
  totalActiveSeconds: number;   // active reading duration
  engineVersion: string;
  locationsVersion: number;
  updatedAt: number;            // epoch ms for sync resolution
  recentPagesPerMinute: number;
  avgWordsPerPage: number;
}

export interface ReadingProgressSyncFile {
  schemaVersion: number;
  exportedAt: string;
  progress: Record<string, ReadingProgress>;
}

export interface ReaderSettings {
  flow: 'paginated' | 'scrolled';
  twoPageSpread: boolean;
  fontFamily: 'publisher' | 'serif' | 'sans' | 'mono' | 'dyslexic';
  fontSize: number;             // px (12 - 36)
  lineHeight: number;           // multiplier (1.2 - 2.2)
  paragraphSpacing: number;     // em (0 - 2)
  textAlign: 'publisher' | 'left' | 'justify';
  hyphenation: boolean;
  marginPercent: number;        // percentage (5 - 30)
  animatePageTurn: boolean;
  theme: 'app' | 'paper' | 'sepia' | 'dark' | 'black';
  invertImagesInDark: boolean;
  brightness: number;           // 50 - 100%
  keepScreenAwake: boolean;
}
