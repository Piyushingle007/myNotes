import { Node, mergeAttributes } from '@tiptap/core';

export const TldrawExtension = Node.create({
  name: 'tldraw',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      snapshot: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="tldraw"]',
        getAttrs: (dom) => {
          if (typeof dom === 'string') return {};
          const snapshotData = dom.getAttribute('data-snapshot');
          try {
            return {
              snapshot: snapshotData ? JSON.parse(decodeURIComponent(snapshotData)) : null,
            };
          } catch (e) {
            console.error('Failed to parse excalidraw snapshot', e);
            return { snapshot: null };
          }
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    let snapshotStr = '';
    if (HTMLAttributes.snapshot) {
      try {
        snapshotStr = encodeURIComponent(JSON.stringify(HTMLAttributes.snapshot));
      } catch (e) {
        console.error('Failed to stringify excalidraw snapshot', e);
      }
    }
    
    return ['div', mergeAttributes(
      { 'data-type': 'tldraw', 'data-snapshot': snapshotStr },
      // Omit the complex snapshot object from standard HTMLAttributes injection
      { class: 'tldraw-block-node' }
    )];
  },
});
