<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { Tldraw } from 'tldraw';
  import 'tldraw/tldraw.css';

  interface Props {
    persistenceKey?: string;
    initialSnapshot?: any;
    autoFocus?: boolean;
    className?: string;
    style?: string;
    onMountCb?: (editor: any) => void;
    onChange?: (snapshot: any) => void;
  }

  let { 
    persistenceKey,
    initialSnapshot,
    autoFocus = false, 
    className = '', 
    style = '', 
    onMountCb,
    onChange 
  }: Props = $props();
  
  let container = $state<HTMLDivElement | null>(null);
  let root: any = null;
  let editorInstance: any = null;
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    if (container) {
      root = createRoot(container);
      
      const handleMount = (editor: any) => {
        editorInstance = editor;
        
        if (initialSnapshot && !persistenceKey) {
          try {
            editor.store.loadSnapshot(initialSnapshot);
          } catch (e) {
            console.error("Failed to load tldraw snapshot", e);
          }
        }

        if (onChange) {
          unsubscribe = editor.store.listen(() => {
            onChange(editor.store.getSnapshot());
          });
        }

        if (onMountCb) {
          onMountCb(editor);
        }
      };

      const tldrawProps = {
        persistenceKey,
        autoFocus,
        onMount: handleMount
      };

      const el = React.createElement(Tldraw, tldrawProps);
      root.render(el);
    }
    
    return () => {
      if (unsubscribe) unsubscribe();
      if (root) {
        root.unmount();
      }
    };
  });
</script>

<div bind:this={container} class={className} style="width: 100%; height: 100%; position: relative; {style}"></div>
