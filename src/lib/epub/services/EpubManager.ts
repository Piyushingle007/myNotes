import { appState } from '../../stores/appState.svelte';
import { IndexedDBAdapter } from '../../storage/StorageAdapter';
import type { EpubBook, ReadingProgress } from '../types';
import { EpubLibraryStore } from '../storage/EpubLibraryStore';
import { ReadingProgressStore } from '../storage/ReadingProgressStore';
import { computeBookId } from '../utils/bookHash';
import { parseEpub } from '../parser/epubParser';

export interface ImportResult {
  success: boolean;
  duplicate?: boolean;
  drmProtected?: boolean;
  book?: EpubBook;
  error?: string;
  message?: string;
}

export class EpubManagerClass {
  private libraryStore: EpubLibraryStore | null = null;
  private progressStore: ReadingProgressStore | null = null;
  private coverUrlCache: Map<string, string> = new Map();
  private currentVaultName: string = '';

  /**
   * Initializes or re-binds stores when the vault changes.
   */
  public init(vaultName: string = 'default'): void {
    if (this.currentVaultName === vaultName && this.libraryStore && this.progressStore) {
      return;
    }
    this.currentVaultName = vaultName;
    if (this.libraryStore) this.libraryStore.close();
    if (this.progressStore) this.progressStore.close();

    // Clear old blob URLs
    this.revokeAllCoverUrls();

    this.libraryStore = new EpubLibraryStore(vaultName);
    this.progressStore = new ReadingProgressStore(vaultName);
  }

  public getLibraryStore(): EpubLibraryStore {
    if (!this.libraryStore) {
      this.init(appState.vaultName || 'default');
    }
    return this.libraryStore!;
  }

  public getProgressStore(): ReadingProgressStore {
    if (!this.progressStore) {
      this.init(appState.vaultName || 'default');
    }
    return this.progressStore!;
  }

  /**
   * Imports one or multiple EPUB files into the library.
   */
  public async importEpubFiles(
    files: Array<{ file: Blob; name: string }>,
    targetFolder: string | null = null
  ): Promise<ImportResult[]> {
    const libStore = this.getLibraryStore();
    const progStore = this.getProgressStore();
    const results: ImportResult[] = [];

    // Ensure Books directory exists
    try {
      await appState.storage.createDirectory('Books');
      await appState.storage.createDirectory('Books/__covers__');
    } catch (e) {
      // Directory creation is optional/no-op on flat storage
    }

    for (const { file, name } of files) {
      try {
        const cleanOriginalName = name.replace(/\.epub$/i, '').trim();

        // 1. Content-derived identity
        const bookId = await computeBookId(file);

        // 2. Duplicate Detection
        const existingBook = await libStore.getBook(bookId);
        if (existingBook) {
          results.push({
            success: false,
            duplicate: true,
            book: existingBook,
            message: `"${existingBook.title}" is already in your library.`
          });
          continue;
        }

        // 3. Parse Metadata, Cover, DRM
        const parsed = await parseEpub(file, cleanOriginalName);

        if (parsed.isDrmProtected) {
          results.push({
            success: false,
            drmProtected: true,
            error: 'This book is DRM-protected and cannot be opened.'
          });
          continue;
        }

        if (parsed.status === 'corrupt') {
          results.push({
            success: false,
            error: parsed.errorDetails || 'Failed to read corrupt EPUB archive.'
          });
          continue;
        }

        // 4. Construct safe file path
        const safeTitle = (parsed.title || cleanOriginalName)
          .replace(/[\\/:*?"<>|]/g, '_')
          .trim()
          .slice(0, 80);
        
        let basePath = targetFolder 
          ? `${targetFolder}/${safeTitle}.epub`
          : `Books/${safeTitle}.epub`;

        let version = 1;
        let finalPath = basePath;
        while (appState.notes.some(n => n.path === finalPath)) {
          finalPath = targetFolder
            ? `${targetFolder}/${safeTitle} (${version}).epub`
            : `Books/${safeTitle} (${version}).epub`;
          version++;
        }

        // 5. Save untouched binary EPUB file
        if (appState.storage.writeBlob) {
          await appState.storage.writeBlob(finalPath, file);
        } else {
          throw new Error('Storage adapter does not support binary writeBlob.');
        }

        // 6. Save cover thumbnail if extracted
        let coverThumbnailPath: string | undefined;
        if (parsed.coverThumbnailBlob && appState.storage.writeBlob) {
          coverThumbnailPath = `Books/__covers__/${bookId}.webp`;
          try {
            await appState.storage.writeBlob(coverThumbnailPath, parsed.coverThumbnailBlob);
          } catch (covErr) {
            console.warn('[EpubManager] Failed to write cover thumbnail:', covErr);
            coverThumbnailPath = undefined;
          }
        }

        // 7. Store metadata in EpubLibraryStore
        const now = Date.now();
        const book: EpubBook = {
          bookId,
          filePath: finalPath,
          title: parsed.title || cleanOriginalName,
          authors: parsed.authors.length > 0 ? parsed.authors : ['Unknown Author'],
          language: parsed.language || 'en',
          publisher: parsed.publisher || '',
          description: parsed.description || '',
          hasCover: !!coverThumbnailPath,
          coverThumbnailPath,
          tocItems: parsed.tocItems,
          spineLength: parsed.spineLength,
          fileSize: file.size,
          contentHash: bookId,
          addedAt: now,
          importedAt: now,
          status: 'ok',
          locationsVersion: 1,
          locationsData: null
        };

        await libStore.upsertBook(book);

        // 8. Create initial progress record
        const initialProgress: ReadingProgress = {
          bookId,
          cfi: null,
          percentage: 0,
          chapterHref: parsed.tocItems[0]?.href || '',
          chapterTitle: parsed.tocItems[0]?.label || '',
          lastReadAt: now,
          firstOpenedAt: now,
          finishedAt: null,
          totalActiveSeconds: 0,
          engineVersion: '1.0.0',
          locationsVersion: 1,
          updatedAt: now,
          recentPagesPerMinute: 1.0,
          avgWordsPerPage: 250
        };
        await progStore.saveProgress(initialProgress);

        // 9. In sandbox IndexedDB mode only, add stub entry to 'notes' store so NoteList can see it.
        // Never call writeNote on FileSystemAccessAdapter as that overwrites the binary file on disk with an empty string!
        if (appState.storage instanceof IndexedDBAdapter) {
          await appState.storage.writeNote(finalPath, '');
        }

        results.push({
          success: true,
          book,
          message: `Successfully added "${book.title}".`
        });

      } catch (err: any) {
        console.error(`[EpubManager] Failed to import ${name}:`, err);
        results.push({
          success: false,
          error: err?.message || `Failed to import ${name}.`
        });
      }
    }

    // Refresh app notes list so sidebar/notelist reflects new book
    await appState.refreshNotes();

    return results;
  }

  /**
   * Indexes an existing EPUB file already present in vault storage.
   * Never rewrites or duplicates the binary file.
   */
  public async registerExistingEpub(
    filePath: string,
    file: Blob,
    originalName?: string
  ): Promise<EpubBook> {
    const libStore = this.getLibraryStore();
    const progStore = this.getProgressStore();

    const cleanOriginalName = (originalName || filePath.split('/').pop() || 'Book')
      .replace(/\.epub$/i, '')
      .trim();

    // 1. Content-derived identity
    const bookId = await computeBookId(file);

    // 2. Check if already in library
    const existing = await libStore.getBook(bookId);
    if (existing) {
      if (existing.filePath !== filePath) {
        existing.filePath = filePath;
        await libStore.upsertBook(existing);
      }
      return existing;
    }

    // 3. Parse Metadata & Cover
    const parsed = await parseEpub(file, cleanOriginalName);

    let coverThumbnailPath: string | undefined;
    if (parsed.coverThumbnailBlob && appState.storage.writeBlob) {
      coverThumbnailPath = `Books/__covers__/${bookId}.webp`;
      try {
        await appState.storage.writeBlob(coverThumbnailPath, parsed.coverThumbnailBlob);
      } catch (covErr) {
        console.warn('[EpubManager] Failed to write cover thumbnail:', covErr);
        coverThumbnailPath = undefined;
      }
    }

    const now = Date.now();
    const book: EpubBook = {
      bookId,
      filePath,
      title: parsed.title || cleanOriginalName,
      authors: parsed.authors.length > 0 ? parsed.authors : ['Unknown Author'],
      language: parsed.language || 'en',
      publisher: parsed.publisher || '',
      description: parsed.description || '',
      hasCover: !!coverThumbnailPath,
      coverThumbnailPath,
      tocItems: parsed.tocItems,
      spineLength: parsed.spineLength,
      fileSize: file.size,
      contentHash: bookId,
      addedAt: now,
      importedAt: now,
      status: parsed.status === 'corrupt' ? 'corrupt' : parsed.isDrmProtected ? 'drm-protected' : 'ok',
      locationsVersion: 1,
      locationsData: null
    };

    await libStore.upsertBook(book);

    // 4. Create initial progress record if none exists
    const existingProg = await progStore.getProgress(bookId);
    if (!existingProg) {
      const initialProgress: ReadingProgress = {
        bookId,
        cfi: null,
        percentage: 0,
        chapterHref: parsed.tocItems[0]?.href || '',
        chapterTitle: parsed.tocItems[0]?.label || '',
        lastReadAt: now,
        firstOpenedAt: now,
        finishedAt: null,
        totalActiveSeconds: 0,
        engineVersion: '1.0.0',
        locationsVersion: 1,
        updatedAt: now,
        recentPagesPerMinute: 1.0,
        avgWordsPerPage: 250
      };
      await progStore.saveProgress(initialProgress);
    }

    return book;
  }

  /**
   * Retrieves or generates a transient Object URL for a book's cover image.
   */
  public async getCoverUrl(book: EpubBook): Promise<string | undefined> {
    if (!book.hasCover || !book.coverThumbnailPath) return undefined;

    if (this.coverUrlCache.has(book.bookId)) {
      return this.coverUrlCache.get(book.bookId);
    }

    try {
      if (appState.storage.readBlob) {
        const blob = await appState.storage.readBlob(book.coverThumbnailPath);
        const url = URL.createObjectURL(blob);
        this.coverUrlCache.set(book.bookId, url);
        return url;
      }
    } catch (e) {
      console.warn(`[EpubManager] Could not read cover for ${book.bookId}:`, e);
    }
    return undefined;
  }

  /**
   * Deletes a book from the library and storage.
   * Keeps reading progress by default unless explicitly specified.
   */
  public async deleteBook(bookId: string, deleteProgress: boolean = false): Promise<void> {
    const libStore = this.getLibraryStore();
    const progStore = this.getProgressStore();

    const book = await libStore.getBook(bookId);
    if (book) {
      // 1. Delete EPUB file
      try {
        await appState.storage.deleteNote(book.filePath);
      } catch (e) {
        console.warn('[EpubManager] Could not delete note file:', e);
      }

      // 2. Delete cover thumbnail
      if (book.coverThumbnailPath) {
        try {
          await appState.storage.deleteNote(book.coverThumbnailPath);
        } catch (e) {
          // ignore
        }
      }

      // 3. Revoke cached URL
      const cachedUrl = this.coverUrlCache.get(bookId);
      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        this.coverUrlCache.delete(bookId);
      }

      // 4. Delete from EpubLibraryStore
      await libStore.deleteBook(bookId);
    }

    // 5. Optionally delete progress
    if (deleteProgress) {
      await progStore.deleteProgress(bookId);
    }

    await appState.refreshNotes();
  }

  /**
   * Reads the raw EPUB binary Blob for the reader.
   * STRICTLY READ-ONLY: Never writes or mutates the EPUB file.
   */
  public async readEpubBinary(book: EpubBook): Promise<Blob> {
    if (!appState.storage.readBlob) {
      throw new Error('Storage adapter does not support readBlob.');
    }
    return await appState.storage.readBlob(book.filePath);
  }

  public revokeAllCoverUrls(): void {
    for (const url of this.coverUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.coverUrlCache.clear();
  }
}

export const EpubManager = new EpubManagerClass();
export const epubManager = EpubManager;
