<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

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
  let isLoaded = $state(false);

  onMount(() => {
    let mounted = true;
    if (container) {
      // Lazy load massive dependencies
      Promise.all([
        import('react'),
        import('react-dom/client'),
        import('tldraw'),
        import('tldraw/tldraw.css')
      ]).then(([ReactModule, ReactDOMClient, TldrawModule]) => {
        if (!mounted) return;
        const React = ReactModule.default || ReactModule;
        const createRoot = ReactDOMClient.createRoot;
        const { Tldraw, getSnapshot, loadSnapshot } = TldrawModule;

        root = createRoot(container!);
        
        const handleMount = (editor: any) => {
          editorInstance = editor;
          
          if (initialSnapshot && !persistenceKey) {
            try {
              loadSnapshot(editor.store, initialSnapshot);
            } catch (e) {
              console.error("Failed to load tldraw snapshot", e);
            }
          }

          if (onChange) {
            let timeoutId: any;
            unsubscribe = editor.store.listen(() => {
              if (timeoutId) clearTimeout(timeoutId);
              timeoutId = setTimeout(() => {
                if (mounted && editorInstance) {
                  onChange(getSnapshot(editorInstance.store));
                }
              }, 300);
            }, { scope: 'document', source: 'user' });
          }

          if (onMountCb) {
            onMountCb(editor);
          }
        };

        class ErrorBoundary extends React.Component {
          constructor(props) {
            super(props);
            this.state = { hasError: false, error: null };
          }
          static getDerivedStateFromError(error) {
            return { hasError: true, error };
          }
          componentDidCatch(error, errorInfo) {
            console.error("Tldraw crashed:", error, errorInfo);
          }
          render() {
            if (this.state.hasError) {
              return React.createElement('div', { style: { color: '#ff4444', padding: '20px', fontFamily: 'sans-serif' } }, 
                React.createElement('h3', null, 'Tldraw crashed'),
                React.createElement('p', null, String(this.state.error))
              );
            }
            return this.props.children;
          }
        }

        const tldrawProps = {
          persistenceKey,
          autoFocus,
          onMount: handleMount,
          licenseKey: "open-source"
        };

        const tldrawElement = React.createElement(Tldraw, tldrawProps);
        const element = React.createElement(ErrorBoundary, null, tldrawElement);
        root.render(element);
        isLoaded = true;
      });
    }

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
      if (root) {
        // Need to wait for next tick to unmount React safely if it was just rendering
        setTimeout(() => {
          // try { root.unmount(); } catch (e) {}
        }, 0);
      }
    };
  });

  $effect(() => {
    if (container) {
      const interval = setInterval(() => {
        if (container.children.length === 0 && isLoaded) {
          console.error("TLDRAW CONTAINER IS EMPTY! React unmounted the tree or crashed!");
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  });
</script>

<div class="tldraw-svelte-wrapper {className}" style="width: 100%; height: 100%; position: relative; {style}">
  {#if !isLoaded}
    <div class="loading-state flex-col" style="width: 100%; height: 100%; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.85rem;">
      <div class="spinner" style="margin-bottom: 8px;"></div>
      Loading Tldraw...
    </div>
  {/if}
  <div bind:this={container} style="width: 100%; height: 100%;"></div>
</div>
