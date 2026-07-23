<script lang="ts">
  import { computePosition, offset, flip, shift } from '@floating-ui/dom';
  import { appState, parseHtmlMetadata } from '../stores/appState.svelte';
  import { onMount } from 'svelte';

  interface Props {
    targetElement: HTMLElement;
    href: string;
    onDismiss: () => void;
  }
  let { targetElement, href, onDismiss }: Props = $props();

  let popover: HTMLDivElement;
  let previewTitle = $state('');
  let previewContent = $state('');
  let visible = $state(false);

  onMount(() => {
    // Resolve the link
    if (href.startsWith('[[') || (!href.startsWith('http') && !href.startsWith('mailto:'))) {
      // Wiki-link or internal link — find the note
      const linkText = href.replace(/^\[\[|\]\]$/g, '');
      const note = appState.notes.find(n => 
        n.name.toLowerCase() === linkText.toLowerCase() ||
        n.path.toLowerCase().includes(linkText.toLowerCase())
      );
      if (note) {
        const parsed = parseHtmlMetadata(note.content || '');
        previewTitle = note.name;
        previewContent = (parsed.content || '').replace(/<[^>]+>/g, '').slice(0, 200) + '...';
      } else {
        previewTitle = linkText;
        previewContent = 'Note not found';
      }
    } else {
      previewTitle = href;
      previewContent = 'External link';
    }

    // Position with Floating UI
    setTimeout(async () => {
      if (!popover || !targetElement) return;
      const { x, y } = await computePosition(targetElement, popover, {
        placement: 'top',
        middleware: [offset(8), flip(), shift({ padding: 8 })]
      });
      popover.style.left = `${x}px`;
      popover.style.top = `${y}px`;
      visible = true;
    }, 0);
  });
</script>

<div 
  bind:this={popover} 
  class="link-preview-popover"
  class:visible
  onmouseleave={onDismiss}
  role="tooltip"
>
  {#if previewTitle}
    <div class="preview-title">{previewTitle}</div>
    <div class="preview-content">{previewContent}</div>
  {/if}
</div>

<style>
  .link-preview-popover {
    position: absolute;
    z-index: 9999;
    max-width: 300px;
    padding: 10px 14px;
    background: var(--bg-surface-elevated, #1e2227);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: auto;
    top: 0;
    left: 0;
  }
  .link-preview-popover.visible { opacity: 1; }
  .preview-title { font-weight: 600; font-size: 0.85rem; color: var(--text-normal); margin-bottom: 4px; }
  .preview-content { font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; }
</style>
