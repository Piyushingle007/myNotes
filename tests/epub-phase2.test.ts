import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { computeBookId } from '../src/lib/epub/utils/bookHash.ts';
import { parseEpub } from '../src/lib/epub/parser/epubParser.ts';

test('Book ID Hashing - Deterministic and Content-derived', async () => {
  const contentA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const contentB = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const contentC = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 99]);

  const idA = await computeBookId(contentA);
  const idB = await computeBookId(contentB);
  const idC = await computeBookId(contentC);

  assert.equal(idA, idB, 'Identical content must produce identical bookId');
  assert.notEqual(idA, idC, 'Different content must produce different bookId');
  assert.match(idA, /^epub_[a-f0-9]{64}$/, 'bookId must be SHA-256 hex prefixed with epub_');
});

test('Book ID Hashing - Large file chunk handling', async () => {
  // Create a 200 KB mock file
  const size = 200 * 1024;
  const large1 = new Uint8Array(size);
  large1[0] = 42;
  large1[size - 1] = 99;

  const large2 = new Uint8Array(size);
  large2[0] = 42;
  large2[size - 1] = 99;

  const large3 = new Uint8Array(size);
  large3[0] = 42;
  large3[size - 1] = 100;

  const id1 = await computeBookId(large1);
  const id2 = await computeBookId(large2);
  const id3 = await computeBookId(large3);

  assert.equal(id1, id2, 'Identical large files must produce identical bookId');
  assert.notEqual(id1, id3, 'Different last chunk must produce different bookId');
});

test('DRM Detection - Font Obfuscation vs Actual DRM', async () => {
  // 1. EPUB with font obfuscation only (IDPF / Adobe) -> Not DRM!
  const fontObfZip = new JSZip();
  fontObfZip.file('mimetype', 'application/epub+zip');
  fontObfZip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`);
  fontObfZip.file('META-INF/encryption.xml', `<?xml version="1.0"?>
    <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData>
        <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
        <enc:CipherData><enc:CipherReference URI="fonts/font.otf"/></enc:CipherData>
      </enc:EncryptedData>
    </encryption>`);
  fontObfZip.file('content.opf', `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Font Obfuscated Book</dc:title>
        <dc:creator>Test Author</dc:creator>
      </metadata>
      <manifest>
        <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`);

  const fontObfBuffer = await fontObfZip.generateAsync({ type: 'uint8array' });
  const fontObfParsed = await parseEpub(fontObfBuffer);
  assert.equal(fontObfParsed.isDrmProtected, false, 'Font obfuscation should NOT be treated as DRM');
  assert.equal(fontObfParsed.title, 'Font Obfuscated Book');

  // 2. EPUB with true content DRM -> Must be detected!
  const drmZip = new JSZip();
  drmZip.file('mimetype', 'application/epub+zip');
  drmZip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`);
  drmZip.file('META-INF/encryption.xml', `<?xml version="1.0"?>
    <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData>
        <enc:EncryptionMethod Algorithm="http://ns.adobe.com/adept"/>
        <enc:CipherData><enc:CipherReference URI="OEBPS/chapter1.xhtml"/></enc:CipherData>
      </enc:EncryptedData>
    </encryption>`);
  drmZip.file('content.opf', `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Adobe DRM Protected Book</dc:title>
      </metadata>
      <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`);

  const drmBuffer = await drmZip.generateAsync({ type: 'uint8array' });
  const drmParsed = await parseEpub(drmBuffer);
  assert.equal(drmParsed.isDrmProtected, true, 'Adobe adept content encryption must be flagged as DRM');
  assert.equal(drmParsed.status, 'drm-protected');
});

test('EPUB Parser - Metadata, Spine, and Fallbacks', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`);
  zip.file('OEBPS/package.opf', `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Pride and Prejudice</dc:title>
        <dc:creator>Jane Austen</dc:creator>
        <dc:language>en</dc:language>
        <dc:publisher>T. Egerton</dc:publisher>
        <dc:description>Classic romance novel.</dc:description>
      </metadata>
      <manifest>
        <item id="c1" href="chap1.html" media-type="application/xhtml+xml"/>
        <item id="c2" href="chap2.html" media-type="application/xhtml+xml"/>
        <item id="c3" href="chap3.html" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="c1"/>
        <itemref idref="c2"/>
        <itemref idref="c3"/>
      </spine>
    </package>`);

  const buffer = await zip.generateAsync({ type: 'uint8array' });
  const parsed = await parseEpub(buffer);

  assert.equal(parsed.title, 'Pride and Prejudice');
  assert.deepEqual(parsed.authors, ['Jane Austen']);
  assert.equal(parsed.publisher, 'T. Egerton');
  assert.equal(parsed.spineLength, 3);
  assert.equal(parsed.tocItems.length, 3, 'Missing TOC should fall back to spine items');
  assert.equal(parsed.tocItems[0].label, 'Chapter 1');
});
