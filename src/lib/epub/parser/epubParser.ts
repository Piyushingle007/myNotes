import JSZip from 'jszip';
import type { TocItem } from '../types';
import { createCoverThumbnail } from '../utils/coverThumbnail';

export interface ParsedEpubMetadata {
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  description: string;
  spineLength: number;
  tocItems: TocItem[];
  coverThumbnailBlob: Blob | null;
  isDrmProtected: boolean;
  status: 'ok' | 'drm-protected' | 'corrupt';
  errorDetails?: string;
}

const FONT_OBFUSCATION_URIS = [
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC'
];

/**
 * Checks META-INF/encryption.xml for true DRM vs font obfuscation.
 */
function checkDrm(encryptionXmlContent: string): boolean {
  if (!encryptionXmlContent) return false;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(encryptionXmlContent, 'application/xml');
    const encryptedDataNodes = doc.getElementsByTagNameNS('*', 'EncryptedData');

    for (let i = 0; i < encryptedDataNodes.length; i++) {
      const encNode = encryptedDataNodes[i];
      const methodNode = encNode.getElementsByTagNameNS('*', 'EncryptionMethod')[0];
      const algorithm = methodNode?.getAttribute('Algorithm') || '';

      // If algorithm is not font obfuscation, this book has content DRM!
      if (algorithm && !FONT_OBFUSCATION_URIS.some(uri => algorithm.includes(uri))) {
        return true;
      }
    }
    return false;
  } catch (err) {
    // Regex fallback
    const matches = encryptionXmlContent.match(/Algorithm="([^"]+)"/g) || [];
    for (const match of matches) {
      const algo = match.replace(/Algorithm="|"/g, '');
      if (algo && !FONT_OBFUSCATION_URIS.some(uri => algo.includes(uri))) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Resolve relative path against base directory.
 */
function resolvePath(baseDir: string, relativePath: string): string {
  if (!baseDir) return relativePath;
  const parts = (baseDir.replace(/\\/g, '/') + '/' + relativePath.replace(/\\/g, '/')).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

/**
 * Extracts metadata, cover image, and TOC from an EPUB file.
 */
export async function parseEpub(
  fileOrBlob: Blob | ArrayBuffer | Uint8Array,
  fallbackTitle: string = 'Untitled Book'
): Promise<ParsedEpubMetadata> {
  const result: ParsedEpubMetadata = {
    title: fallbackTitle,
    authors: [],
    language: 'en',
    publisher: '',
    description: '',
    spineLength: 0,
    tocItems: [],
    coverThumbnailBlob: null,
    isDrmProtected: false,
    status: 'ok'
  };

  try {
    let zip: JSZip;
    if (fileOrBlob instanceof Blob) {
      const buffer = await fileOrBlob.arrayBuffer();
      zip = await JSZip.loadAsync(buffer);
    } else {
      zip = await JSZip.loadAsync(fileOrBlob);
    }

    // 1. Check for DRM in META-INF/encryption.xml
    const encryptionFile = zip.file('META-INF/encryption.xml');
    if (encryptionFile) {
      const encContent = await encryptionFile.async('text');
      if (checkDrm(encContent)) {
        result.isDrmProtected = true;
        result.status = 'drm-protected';
        result.errorDetails = 'This book is protected by DRM (digital rights management) and cannot be opened.';
      }
    }

    // 2. Locate OPF file path via META-INF/container.xml
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) {
      result.status = 'corrupt';
      result.errorDetails = 'Missing META-INF/container.xml in EPUB archive.';
      return result;
    }

    const containerXml = await containerFile.async('text');
    let opfPath = '';

    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerXml, 'application/xml');
      const rootfile = containerDoc.querySelector('rootfile[media-type="application/oebps-package+xml"]') 
        || containerDoc.querySelector('rootfile');
      opfPath = rootfile?.getAttribute('full-path') || '';
    } else {
      const match = containerXml.match(/full-path="([^"]+)"/i);
      opfPath = match ? match[1] : '';
    }

    if (!opfPath) {
      result.status = 'corrupt';
      result.errorDetails = 'Cannot determine OPF package path from container.xml.';
      return result;
    }

    const opfFile = zip.file(opfPath);
    if (!opfFile) {
      result.status = 'corrupt';
      result.errorDetails = `Package file not found at ${opfPath}.`;
      return result;
    }

    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';
    const opfXml = await opfFile.async('text');

    if (typeof DOMParser === 'undefined') {
      // Regex fallback when DOMParser is not available (e.g. Node / Worker)
      const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
      if (titleMatch) result.title = titleMatch[1].trim();

      const creatorMatches = Array.from(opfXml.matchAll(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/gi));
      const authors = creatorMatches.map(m => m[1].trim()).filter(Boolean);
      if (authors.length > 0) result.authors = authors;

      const pubMatch = opfXml.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/i);
      if (pubMatch) result.publisher = pubMatch[1].trim();

      const langMatch = opfXml.match(/<dc:language[^>]*>([^<]+)<\/dc:language>/i);
      if (langMatch) result.language = langMatch[1].trim();

      const descMatch = opfXml.match(/<dc:description[^>]*>([^<]+)<\/dc:description>/i);
      if (descMatch) result.description = descMatch[1].replace(/<[^>]*>/g, '').trim();

      const spineItemMatches = Array.from(opfXml.matchAll(/<itemref\s+[^>]*idref="([^"]+)"/gi));
      result.spineLength = spineItemMatches.length;

      if (spineItemMatches.length > 0) {
        result.tocItems = spineItemMatches.map((m, idx) => ({
          id: m[1],
          label: `Chapter ${idx + 1}`,
          href: m[1]
        }));
      }

      return result;
    }

    const parser = new DOMParser();
    const opfDoc = parser.parseFromString(opfXml, 'application/xml');

    // 3. Extract Metadata
    const titles = Array.from(opfDoc.getElementsByTagNameNS('*', 'title'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);
    if (titles.length > 0) {
      result.title = titles[0];
    }

    const creators = Array.from(opfDoc.getElementsByTagNameNS('*', 'creator'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);
    result.authors = creators.length > 0 ? creators : ['Unknown Author'];

    const langEl = opfDoc.getElementsByTagNameNS('*', 'language')[0];
    if (langEl && langEl.textContent) {
      result.language = langEl.textContent.trim();
    }

    const pubEl = opfDoc.getElementsByTagNameNS('*', 'publisher')[0];
    if (pubEl && pubEl.textContent) {
      result.publisher = pubEl.textContent.trim();
    }

    const descEl = opfDoc.getElementsByTagNameNS('*', 'description')[0];
    if (descEl && descEl.textContent) {
      // Strip HTML tags if any from description
      result.description = descEl.textContent.replace(/<[^>]*>/g, '').trim();
    }

    // 4. Extract Spine Length & itemrefs
    const spineEl = opfDoc.getElementsByTagNameNS('*', 'spine')[0];
    const itemrefs = spineEl ? Array.from(spineEl.getElementsByTagNameNS('*', 'itemref')) : [];
    result.spineLength = itemrefs.length;

    // 5. Build Manifest Map
    interface ManifestEntry {
      id: string;
      href: string;
      fullPath: string;
      mediaType: string;
      properties: string;
    }
    const manifestMap = new Map<string, ManifestEntry>();
    const manifestItems = Array.from(opfDoc.getElementsByTagNameNS('*', 'item'));

    for (const item of manifestItems) {
      const id = item.getAttribute('id') || '';
      const href = item.getAttribute('href') || '';
      const mediaType = item.getAttribute('media-type') || '';
      const properties = item.getAttribute('properties') || '';
      if (id && href) {
        manifestMap.set(id, {
          id,
          href,
          fullPath: resolvePath(opfDir, href),
          mediaType,
          properties
        });
      }
    }

    // 6. Extract Cover Image
    let coverEntry: ManifestEntry | undefined;

    // A. Check properties="cover-image" (EPUB 3)
    coverEntry = Array.from(manifestMap.values()).find(m => m.properties.split(/\s+/).includes('cover-image'));

    // B. Check <meta name="cover" content="item_id"/> (EPUB 2)
    if (!coverEntry) {
      const metas = Array.from(opfDoc.getElementsByTagNameNS('*', 'meta'));
      const coverMeta = metas.find(m => m.getAttribute('name') === 'cover');
      const coverId = coverMeta?.getAttribute('content');
      if (coverId) {
        coverEntry = manifestMap.get(coverId);
      }
    }

    // C. Check ID = "cover" or "cover-image"
    if (!coverEntry) {
      coverEntry = manifestMap.get('cover') || manifestMap.get('cover-image') || manifestMap.get('cover_image');
    }

    // D. Check href matching /cover\.(jpg|jpeg|png|webp|svg)/i
    if (!coverEntry) {
      coverEntry = Array.from(manifestMap.values()).find(m => 
        m.mediaType.startsWith('image/') && /cover\.(jpe?g|png|webp|svg)$/i.test(m.href)
      );
    }

    if (coverEntry) {
      try {
        const coverZipFile = zip.file(coverEntry.fullPath) || zip.file(decodeURIComponent(coverEntry.fullPath));
        if (coverZipFile) {
          const rawBlob = await coverZipFile.async('blob');
          const downsized = await createCoverThumbnail(rawBlob);
          result.coverThumbnailBlob = downsized;
        }
      } catch (err) {
        console.warn('[EpubParser] Failed to extract cover image:', err);
      }
    }

    // 7. Extract Table of Contents
    // Try EPUB 3 nav document first
    const navEntry = Array.from(manifestMap.values()).find(m => m.properties.split(/\s+/).includes('nav'));
    if (navEntry) {
      try {
        const navFile = zip.file(navEntry.fullPath) || zip.file(decodeURIComponent(navEntry.fullPath));
        if (navFile) {
          const navHtml = await navFile.async('text');
          const navDir = navEntry.fullPath.includes('/') ? navEntry.fullPath.substring(0, navEntry.fullPath.lastIndexOf('/')) : '';
          result.tocItems = parseNavHtml(navHtml, navDir);
        }
      } catch (err) {
        console.warn('[EpubParser] Failed to parse EPUB 3 nav document:', err);
      }
    }

    // Try EPUB 2 NCX file if no TOC found yet
    if (result.tocItems.length === 0) {
      const ncxEntry = Array.from(manifestMap.values()).find(m => m.mediaType === 'application/x-dtbncx+xml')
        || manifestMap.get('ncx') 
        || manifestMap.get('toc');
      if (ncxEntry) {
        try {
          const ncxFile = zip.file(ncxEntry.fullPath) || zip.file(decodeURIComponent(ncxEntry.fullPath));
          if (ncxFile) {
            const ncxXml = await ncxFile.async('text');
            const ncxDir = ncxEntry.fullPath.includes('/') ? ncxEntry.fullPath.substring(0, ncxEntry.fullPath.lastIndexOf('/')) : '';
            result.tocItems = parseNcxXml(ncxXml, ncxDir);
          }
        } catch (err) {
          console.warn('[EpubParser] Failed to parse NCX TOC:', err);
        }
      }
    }

    // Fallback TOC if book has no TOC defined
    if (result.tocItems.length === 0 && itemrefs.length > 0) {
      result.tocItems = itemrefs.map((ref, idx) => {
        const idref = ref.getAttribute('idref') || '';
        const entry = manifestMap.get(idref);
        return {
          id: idref || `item-${idx}`,
          label: `Chapter ${idx + 1}`,
          href: entry?.fullPath || idref
        };
      });
    }

  } catch (err: any) {
    console.error('[EpubParser] Failed to parse EPUB file:', err);
    result.status = 'corrupt';
    result.errorDetails = err?.message || 'Failed to read EPUB archive.';
  }

  return result;
}

/**
 * Parses EPUB 3 Navigation Document (nav element with epub:type="toc" or id="toc").
 */
function parseNavHtml(html: string, navDir: string): TocItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const navEl = doc.querySelector('nav[epub\\:type="toc"]') 
    || doc.querySelector('nav#toc') 
    || doc.querySelector('nav');
  if (!navEl) return [];

  const topOl = navEl.querySelector('ol');
  if (!topOl) return [];

  return parseOlToToc(topOl, navDir);
}

function parseOlToToc(olEl: Element, baseDir: string): TocItem[] {
  const items: TocItem[] = [];
  const liElements = Array.from(olEl.children).filter(el => el.tagName.toLowerCase() === 'li');

  for (const li of liElements) {
    const a = li.querySelector(':scope > a') || li.querySelector('a');
    if (!a) continue;

    const label = a.textContent?.trim() || 'Untitled Chapter';
    const rawHref = a.getAttribute('href') || '';
    const href = rawHref ? resolvePath(baseDir, rawHref) : '';
    const id = a.getAttribute('id') || `toc_${Math.random().toString(36).substring(2, 8)}`;

    const childOl = li.querySelector(':scope > ol') || li.querySelector('ol');
    const children = childOl ? parseOlToToc(childOl, baseDir) : undefined;

    items.push({
      id,
      label,
      href,
      ...(children && children.length > 0 ? { children } : {})
    });
  }

  return items;
}

/**
 * Parses EPUB 2 NCX file (<navMap>).
 */
function parseNcxXml(xml: string, ncxDir: string): TocItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const navMap = doc.getElementsByTagNameNS('*', 'navMap')[0];
  if (!navMap) return [];

  const navPoints = Array.from(navMap.children).filter(el => el.localName === 'navPoint');
  return navPoints.map((np, idx) => parseNavPoint(np, ncxDir, idx));
}

function parseNavPoint(navPoint: Element, baseDir: string, index: number): TocItem {
  const labelEl = navPoint.getElementsByTagNameNS('*', 'text')[0];
  const label = labelEl?.textContent?.trim() || `Chapter ${index + 1}`;

  const contentEl = navPoint.getElementsByTagNameNS('*', 'content')[0];
  const rawSrc = contentEl?.getAttribute('src') || '';
  const href = rawSrc ? resolvePath(baseDir, rawSrc) : '';
  const id = navPoint.getAttribute('id') || `navPoint_${index}`;

  const childPoints = Array.from(navPoint.children).filter(el => el.localName === 'navPoint');
  const children = childPoints.map((cp, cIdx) => parseNavPoint(cp, baseDir, cIdx));

  return {
    id,
    label,
    href,
    ...(children.length > 0 ? { children } : {})
  };
}
