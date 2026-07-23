<script lang="ts">
  import { computePosition, offset, flip, shift, arrow as arrowMiddleware } from '@floating-ui/dom';
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    text: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    children: any;
  }
  let { text, placement = 'top', children }: Props = $props();

  let triggerEl: HTMLElement;
  let tooltipEl: HTMLDivElement;
  let arrowEl: HTMLDivElement;
  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  function show() {
    timer = setTimeout(async () => {
      visible = true;
      // We must wait for the DOM to update to render tooltipEl
      setTimeout(async () => {
        if (!tooltipEl || !triggerEl) return;
        const { x, y, middlewareData } = await computePosition(triggerEl, tooltipEl, {
          placement,
          middleware: [offset(8), flip(), shift({ padding: 4 }), arrowMiddleware({ element: arrowEl })]
        });
        tooltipEl.style.left = `${x}px`;
        tooltipEl.style.top = `${y}px`;
        if (middlewareData.arrow && arrowEl) {
          const { x: ax, y: ay } = middlewareData.arrow;
          Object.assign(arrowEl.style, {
            left: ax != null ? `${ax}px` : '',
            top: ay != null ? `${ay}px` : '',
            right: '',
            bottom: '',
          });
          
          // Position arrow on correct side
          const staticSide = {
            top: 'bottom',
            right: 'left',
            bottom: 'top',
            left: 'right'
          }[placement.split('-')[0]];
          
          if (staticSide) {
            arrowEl.style[staticSide as any] = '-4px';
          }
        }
      }, 0);
    }, 500);
  }

  function hide() {
    clearTimeout(timer);
    visible = false;
  }
</script>

<span bind:this={triggerEl} onmouseenter={show} onmouseleave={hide} onfocusin={show} onfocusout={hide} style="display: inline-block;">
  {@render children()}
</span>

{#if visible}
  <div bind:this={tooltipEl} class="tooltip-floating" role="tooltip">
    {text}
    <div bind:this={arrowEl} class="tooltip-arrow"></div>
  </div>
{/if}

<style>
  .tooltip-floating {
    position: absolute;
    z-index: 99999;
    padding: 6px 10px;
    background: var(--bg-surface-elevated, #1e2227);
    color: var(--text-normal, #e0e0e0);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    font-size: 0.75rem;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    top: 0;
    left: 0;
  }
  .tooltip-arrow {
    position: absolute;
    width: 8px;
    height: 8px;
    background: inherit;
    border: inherit;
    border-top-color: transparent;
    border-left-color: transparent;
    transform: rotate(45deg);
  }
</style>
