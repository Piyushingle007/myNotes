import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  prosemirrorJSONToYDoc,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import type { Schema, Node as ProsemirrorNode } from '@tiptap/pm/model';
import { DOMSerializer, DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';

// ─── Types ────────────────────────────────────────────────────────

interface DocEntry {
  doc: Y.Doc;
  provider: IndexeddbPersistence;
  ready: boolean;
  readyPromise: Promise<void>;
}

// ─── Helpers: Uint8Array ↔ Base64 ─────────────────────────────────

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── NoteDocManager ───────────────────────────────────────────────

export class NoteDocManager {
  private docs = new Map<string, DocEntry>();

  /**
   * Get or create a Y.Doc for a note. Attaches y-indexeddb for local persistence.
   * Await the returned `readyPromise` before first use to ensure IndexedDB is synced.
   */
  getDoc(noteId: string): { doc: Y.Doc; readyPromise: Promise<void> } {
    let entry = this.docs.get(noteId);
    if (entry) {
      return { doc: entry.doc, readyPromise: entry.readyPromise };
    }

    const doc = new Y.Doc();
    const provider = new IndexeddbPersistence(`ydoc-${noteId}`, doc);

    const readyPromise = new Promise<void>((resolve) => {
      provider.once('synced', () => {
        entry!.ready = true;
        resolve();
      });
    });

    entry = { doc, provider, ready: false, readyPromise };
    this.docs.set(noteId, entry);

    return { doc, readyPromise };
  }

  /**
   * Get the Y.XmlFragment that Collaboration binds to.
   * Uses the default 'prosemirror' name expected by y-prosemirror.
   */
  getXmlFragment(doc: Y.Doc): Y.XmlFragment {
    return doc.getXmlFragment('prosemirror');
  }

  /** Encode the full Y.Doc state as a binary update. */
  exportUpdate(doc: Y.Doc): Uint8Array {
    return Y.encodeStateAsUpdate(doc);
  }

  /** Encode the state vector (used for diffing). */
  exportStateVector(doc: Y.Doc): Uint8Array {
    return Y.encodeStateVector(doc);
  }

  /**
   * Apply a remote update to the local doc. Idempotent and commutative.
   * Tagged with origin 'remote' so observers can distinguish from local edits.
   */
  applyRemoteUpdate(doc: Y.Doc, update: Uint8Array): void {
    Y.applyUpdate(doc, update, 'remote');
  }

  /**
   * Seed a Y.Doc from HTML content. Only runs if the doc's fragment is empty
   * (idempotent — safe to call multiple times).
   *
   * Uses ProseMirror DOM parsing to convert HTML → ProseMirror JSON → Y.XmlFragment.
   */
  seedFromHtml(doc: Y.Doc, htmlBody: string, schema: Schema): void {
    const fragment = this.getXmlFragment(doc);
    // Only seed if empty (no existing CRDT state)
    if (fragment.length > 0) return;

    // Parse HTML into a ProseMirror document
    const domParser = ProseMirrorDOMParser.fromSchema(schema);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlBody;
    const pmDoc = domParser.parse(tempDiv);

    // Convert ProseMirror JSON → Y.Doc, then copy the fragment contents
    const pmJson = pmDoc.toJSON();
    const seedDoc = prosemirrorJSONToYDoc(schema, pmJson, 'prosemirror');
    const seedFragment = seedDoc.getXmlFragment('prosemirror');

    // Apply the seed doc's state as an update to our doc
    const update = Y.encodeStateAsUpdate(seedDoc);
    Y.applyUpdate(doc, update);

    seedDoc.destroy();
  }

  /**
   * Convert a Y.Doc's ProseMirror fragment to HTML string.
   * Used for headless re-serialization after a merge (when note is not open in editor).
   */
  docToHtml(doc: Y.Doc, schema: Schema): string {
    const fragment = this.getXmlFragment(doc);
    const pmNode = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    const serializer = DOMSerializer.fromSchema(schema);
    const domFragment = serializer.serializeFragment(pmNode.content);
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(domFragment);
    return tempDiv.innerHTML;
  }

  /**
   * Destroy and clean up a doc entry. Frees memory and closes IndexedDB provider.
   */
  destroy(noteId: string): void {
    const entry = this.docs.get(noteId);
    if (!entry) return;
    entry.provider.destroy();
    entry.doc.destroy();
    this.docs.delete(noteId);
  }

  /** Destroy all cached docs. Call on app shutdown. */
  destroyAll(): void {
    for (const [noteId] of this.docs) {
      this.destroy(noteId);
    }
  }

  /** Check if a doc is currently cached. */
  has(noteId: string): boolean {
    return this.docs.has(noteId);
  }
}

// Singleton instance shared between Editor.svelte and appState
export const noteDocManager = new NoteDocManager();
