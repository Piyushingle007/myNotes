<script lang="ts">
  import { onMount } from 'svelte';
  import '@excalidraw/excalidraw/index.css';

  interface Props {
    initialData?: any;
    autoFocus?: boolean;
    className?: string;
    style?: string;
    onMountCb?: (api: any) => void;
    onChange?: (elements: any[], appState: any, files: any) => void;
  }

  let { 
    initialData,
    autoFocus = false, 
    className = '', 
    style = '', 
    onMountCb,
    onChange 
  }: Props = $props();
  
  let container = $state<HTMLDivElement | null>(null);
  let root: any = null;
  let excalidrawApi: any = null;
  let isLoaded = $state(false);
  let loadError = $state<string | null>(null);

  onMount(() => {
    let mounted = true;
    if (container) {
      Promise.all([
        import('react'),
        import('react-dom/client'),
        import('@excalidraw/excalidraw'),
      ]).then(([ReactModule, ReactDOMClient, ExcalidrawModule]) => {
        if (!mounted) return;
        const React = ReactModule.default || ReactModule;
        const createRoot = ReactDOMClient.createRoot;
        const { Excalidraw } = ExcalidrawModule;

        root = createRoot(container!);

        let changeTimeout: any;

        const excalidrawProps: any = {
          autoFocus,
          theme: 'dark',
          initialData: initialData || undefined,
          onChange: (elements: any[], state: any) => {
            if (!onChange || !mounted) return;
            clearTimeout(changeTimeout);
            changeTimeout = setTimeout(() => {
              if (!mounted) return;
              const files = excalidrawApi?.getFiles?.() || {};
              onChange(elements, state, files);
            }, 300);
          },
          excalidrawAPI: (api: any) => {
            excalidrawApi = api;
            if (onMountCb) onMountCb(api);
          }
        };

        class ErrorBoundary extends React.Component<any, any> {
          constructor(props: any) {
            super(props);
            this.state = { hasError: false, error: null };
          }
          static getDerivedStateFromError(error: any) {
            return { hasError: true, error };
          }
          componentDidCatch(error: any, errorInfo: any) {
            console.error("Excalidraw crashed:", error, errorInfo);
          }
          render() {
            if ((this.state as any).hasError) {
              return React.createElement('div', { style: { color: '#ff4444', padding: '20px', fontFamily: 'sans-serif' } }, 
                React.createElement('h3', null, 'Excalidraw crashed'),
                React.createElement('p', null, String((this.state as any).error))
              );
            }
            return (this.props as any).children;
          }
        }

        const excalidrawElement = React.createElement(Excalidraw, excalidrawProps);
        const element = React.createElement(ErrorBoundary, null, excalidrawElement);
        root.render(element);
        isLoaded = true;
      }).catch((error) => {
        if (!mounted) return;
        console.error('Failed to load Excalidraw', error);
        loadError = error instanceof Error ? error.message : String(error);
      });
    }

    return () => {
      mounted = false;
      if (root) {
        setTimeout(() => {
          try { root.unmount(); } catch (e) { /* ignore */ }
        }, 0);
      }
    };
  });
</script>

<div class="excalidraw-svelte-wrapper {className}" style="width: 100%; height: 100%; position: relative; background: var(--bg-surface); overflow: hidden; {style}">
  {#if loadError}
    <div class="loading-state flex-col" style="width: 100%; height: 100%; align-items: center; justify-content: center; color: var(--semantic-error, #ff4444); font-size: 0.85rem; padding: 16px; text-align: center;">
      <div style="font-weight: 600; margin-bottom: 8px;">Sketch failed to load</div>
      <div>{loadError}</div>
    </div>
  {:else if !isLoaded}
    <div class="loading-state flex-col" style="width: 100%; height: 100%; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.85rem;">
      <div class="spinner" style="margin-bottom: 8px;"></div>
      Loading Excalidraw...
    </div>
  {/if}
  <div bind:this={container} style="width: 100%; height: 100%; background: var(--bg-surface);"></div>
</div>
