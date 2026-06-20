<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { X } from 'lucide-svelte';
  import { mobileNav } from '../stores/mobileNav.svelte';

  interface Props {
    show: boolean;
    title?: string;
    closeOnEsc?: boolean;
    closeOnOverlay?: boolean;
    onClose: () => void;
    titleIcon?: import('svelte').Snippet;
    children?: import('svelte').Snippet;
    footer?: import('svelte').Snippet;
    style?: string;
    bodyStyle?: string;
    maxWidth?: string;
  }

  let {
    show,
    title = '',
    closeOnEsc = true,
    closeOnOverlay = true,
    onClose,
    titleIcon,
    children,
    footer,
    style = '',
    bodyStyle = '',
    maxWidth = '540px'
  }: Props = $props();

  let modalElement = $state<HTMLElement | null>(null);
  let triggerElement = $state<HTMLElement | null>(null);
  // UI-M-005: track the on-screen keyboard so the dialog (and its actions)
  // are never hidden behind it on mobile.
  let keyboardHeight = $state(0);

  // Keep the modal above the virtual keyboard using the visual viewport.
  $effect(() => {
    if (!show) { keyboardHeight = 0; return; }
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Ignore small viewport changes (browser chrome) — only react to a keyboard.
      keyboardHeight = kb > 120 ? kb : 0;
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  });

  // Register with the navigation model so the hardware/edge back button closes
  // the dialog first (UI-M-011).
  $effect(() => {
    if (!show) return;
    return mobileNav.registerOverlay(onClose);
  });

  // Manage body scroll lock and focus tracking
  $effect(() => {
    if (show) {
      triggerElement = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';
      
      // Focus first focusable element
      setTimeout(() => {
        if (modalElement) {
          const focusable = modalElement.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            (focusable[0] as HTMLElement).focus();
          } else {
            modalElement.focus();
          }
        }
      }, 50);
    } else {
      document.body.style.overflow = '';
      if (triggerElement) {
        triggerElement.focus();
        triggerElement = null;
      }
    }

    return () => {
      document.body.style.overflow = '';
    };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!show) return;

    if (e.key === 'Escape' && closeOnEsc) {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'Tab' && modalElement) {
      const focusable = modalElement.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (closeOnOverlay && e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <!-- Backdrop -->
  <div 
    class="modal-backdrop flex-row" 
    transition:fade={{ duration: 150 }}
    onclick={handleOverlayClick}
    role="presentation"
    style="padding-bottom: {keyboardHeight}px;"
  >
    <!-- Modal Card -->
    <div 
      bind:this={modalElement}
      class="modal-card flex-col"
      transition:fly={{ y: 20, duration: 250, easing: cubicOut }}
      tabindex="-1"
      style="{style}; max-width: {maxWidth};"
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <!-- Header -->
      <div class="modal-header flex-row">
        <div class="modal-title flex-row">
          {@render titleIcon?.()}
          <span class="modal-title-text">{title}</span>
        </div>
        <button 
          type="button"
          class="modal-close-btn flex-row" 
          onclick={onClose} 
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      <!-- Body Content -->
      <div class="modal-body flex-col" style={bodyStyle}>
        {@render children?.()}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="modal-footer flex-row">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    box-sizing: border-box;
    background: color-mix(in srgb, var(--bg-base) 60%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: var(--z-index-overlay, 1200);
    justify-content: center;
    align-items: center;
    display: flex;
    transition: padding-bottom 0.18s ease;
  }

  .modal-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    box-shadow: var(--elevation-5), 0 0 0 1px color-mix(in srgb, var(--text-primary) 5%, transparent);
    width: 90%;
    max-height: 90vh;
    outline: none;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    padding: var(--spacing-md) var(--spacing-lg) var(--spacing-sm);
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    flex-direction: row;
    flex-shrink: 0;
  }

  .modal-title {
    gap: var(--spacing-xs);
    align-items: center;
    display: flex;
    flex-direction: row;
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .modal-close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: 50%;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-close-btn:hover {
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
  }

  .modal-body {
    padding: var(--spacing-lg);
    overflow-y: auto;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
  }

  .modal-footer {
    padding: var(--spacing-md) var(--spacing-lg);
    border-top: 1px solid var(--border-color);
    justify-content: flex-end;
    gap: var(--spacing-sm);
    display: flex;
    flex-direction: row;
    flex-shrink: 0;
  }

  /* UI-M-005: mobile-friendly form controls inside any dialog.
     16px font prevents iOS auto-zoom on focus; 44px keeps targets tappable. */
  @media (max-width: 768px) {
    .modal-card {
      width: 92%;
    }

    .modal-body :global(input:not([type='checkbox']):not([type='radio'])),
    .modal-body :global(textarea),
    .modal-body :global(select) {
      font-size: 16px !important;
      min-height: 44px;
    }

    .modal-footer :global(button),
    .modal-body :global(.btn-pill) {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-backdrop {
      transition: none;
    }
  }
</style>
