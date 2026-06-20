<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { mobileNav } from '../stores/mobileNav.svelte';

  interface Props {
    show: boolean;
    onClose: () => void;
    title?: string;
    /** Maximum height of the sheet panel. */
    maxHeight?: string;
    closeOnBackdrop?: boolean;
    children?: import('svelte').Snippet;
    /** Accessible label when no visible title is provided. */
    ariaLabel?: string;
  }

  let {
    show,
    onClose,
    title = '',
    maxHeight = '80vh',
    closeOnBackdrop = true,
    children,
    ariaLabel,
  }: Props = $props();

  // Drag-to-dismiss state
  let dragY = $state(0);
  let dragging = $state(false);
  let startY = 0;
  const DISMISS_THRESHOLD = 90;

  // Register with the navigation model so the hardware/edge back button and
  // gestures close this sheet first (UI-M-010 / UI-M-011).
  $effect(() => {
    if (!show) return;
    const unregister = mobileNav.registerOverlay(onClose);
    return unregister;
  });

  // Reset drag offset whenever the sheet is (re)opened.
  $effect(() => {
    if (show) dragY = 0;
  });

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    dragging = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!dragging) return;
    const delta = e.touches[0].clientY - startY;
    dragY = Math.max(0, delta);
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;
    if (dragY > DISMISS_THRESHOLD) {
      onClose();
    } else {
      dragY = 0;
    }
  }

  function onBackdrop() {
    if (closeOnBackdrop) onClose();
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sheet-backdrop"
    transition:fade={{ duration: 160 }}
    onclick={onBackdrop}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="presentation"
  ></div>
  <div
    class="sheet-panel flex-col"
    class:dragging
    role="dialog"
    aria-modal="true"
    aria-label={title || ariaLabel}
    transition:fly={{ y: 240, duration: 240, easing: cubicOut }}
    style="max-height: {maxHeight}; transform: translateY({dragY}px);"
  >
    <!-- Drag handle / grabber -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sheet-grab-zone"
      ontouchstart={onTouchStart}
      ontouchmove={onTouchMove}
      ontouchend={onTouchEnd}
      ontouchcancel={onTouchEnd}
    >
      <div class="sheet-grabber" aria-hidden="true"></div>
      {#if title}
        <span class="sheet-title">{title}</span>
      {/if}
    </div>

    <div class="sheet-body flex-col">
      {@render children?.()}
    </div>
  </div>
{/if}

<style>
  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg-base) 55%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 9998;
  }

  .sheet-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-color);
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    box-shadow: 0 -8px 32px color-mix(in srgb, var(--bg-base) 50%, transparent);
    padding-bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom, 0px));
    overflow: hidden;
    will-change: transform;
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .sheet-panel.dragging {
    transition: none;
  }

  .sheet-grab-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md) var(--spacing-2xs);
    cursor: grab;
    touch-action: none;
    flex-shrink: 0;
  }

  .sheet-grabber {
    width: 40px;
    height: 4px;
    border-radius: var(--radius-pill);
    background-color: var(--border-highlight);
  }

  .sheet-title {
    margin-top: var(--spacing-sm);
    font-size: var(--font-size-sm);
    font-weight: 800;
    color: var(--text-primary);
    align-self: stretch;
    padding: 0 var(--spacing-2xs);
  }

  .sheet-body {
    padding: var(--spacing-2xs) var(--spacing-md) 0;
    overflow-y: auto;
    gap: var(--spacing-2xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet-panel {
      transition: none;
    }
  }
</style>

