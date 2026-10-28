/**
 * Computes a content-derived unique book identity (SHA-256).
 * 
 * Rules:
 * - Deterministic: renaming, moving or re-importing the same book always gives the same ID.
 * - Efficient: for files > 256 KB, hashes file.size + first 64 KB + last 64 KB.
 * - For files <= 256 KB, hashes the entire file.
 * - Prefix with "epub_" for clear namespacing.
 */
export async function computeBookId(blobOrBuffer: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let size = 0;
  let firstChunk: Uint8Array;
  let lastChunk: Uint8Array;

  const CHUNK_SIZE = 64 * 1024; // 64 KB

  if (blobOrBuffer instanceof Blob) {
    size = blobOrBuffer.size;
    if (size <= CHUNK_SIZE * 2) {
      const fullBuffer = await blobOrBuffer.arrayBuffer();
      return hashBytes(new Uint8Array(fullBuffer));
    }
    const firstBlob = blobOrBuffer.slice(0, CHUNK_SIZE);
    const lastBlob = blobOrBuffer.slice(Math.max(0, size - CHUNK_SIZE), size);
    firstChunk = new Uint8Array(await firstBlob.arrayBuffer());
    lastChunk = new Uint8Array(await lastBlob.arrayBuffer());
  } else {
    const u8 = blobOrBuffer instanceof Uint8Array ? blobOrBuffer : new Uint8Array(blobOrBuffer);
    size = u8.byteLength;
    if (size <= CHUNK_SIZE * 2) {
      return hashBytes(u8);
    }
    firstChunk = u8.subarray(0, CHUNK_SIZE);
    lastChunk = u8.subarray(Math.max(0, size - CHUNK_SIZE), size);
  }

  // Combine size (as 8-byte big-endian) + firstChunk + lastChunk
  const combined = new Uint8Array(8 + firstChunk.byteLength + lastChunk.byteLength);
  const dataView = new DataView(combined.buffer);
  dataView.setBigUint64(0, BigInt(size), false);
  combined.set(firstChunk, 8);
  combined.set(lastChunk, 8 + firstChunk.byteLength);

  return hashBytes(combined);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const hashBuf = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    const hashArray = Array.from(new Uint8Array(hashBuf));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `epub_${hex}`;
  }

  // Fallback FNV-1a 64-bit combined with length if crypto.subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
    if (i % 2 === 0) {
      h2 ^= bytes[i];
      h2 = Math.imul(h2, 0x01000193);
    }
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return `epub_fallback_${bytes.length}_${hex}`;
}
