<script lang="ts">
  import { AlertTriangle, Info, X } from 'lucide-svelte';
  import { slide } from 'svelte/transition';

  interface Props {
    message: string;
    title?: string;
    severity?: 'error' | 'warning' | 'info';
    retryAction?: (() => void | Promise<void>) | null;
    retryLabel?: string;
    dismissAction?: (() => void) | null;
    style?: string;
  }

  let {
    message,
    title = '',
    severity = 'error',
    retryAction = null,
    retryLabel = 'Retry',
    dismissAction = null,
    style = ''
  }: Props = $props();

  let isRetrying = $state(false);

  async function handleRetry() {
    if (!retryAction || isRetrying) return;
    isRetrying = true;
    try {
      await retryAction();
    } catch (e) {
      console.error('Retry action failed:', e);
    } finally {
      isRetrying = false;
    }
  }
</script>

<div
  class="error-banner flex-row {severity}"
  transition:slide={{ duration: 200 }}
  role={severity === 'error' ? 'alert' : 'status'}
  aria-live={severity === 'error' ? 'assertive' : 'polite'}
  {style}
>
  <div class="banner-icon-wrapper flex-row">
    {#if severity === 'info'}
      <Info size={16} class="banner-icon" />
    {:else}
      <AlertTriangle size={16} class="banner-icon" />
    {/if}
  </div>

  <div class="banner-body flex-col">
    {#if title}
      <span class="banner-title">{title}</span>
    {/if}
    <span class="banner-message">{message}</span>
  </div>

  <div class="banner-actions flex-row">
    {#if retryAction}
      <button
        type="button"
        class="banner-btn retry-btn flex-row"
        onclick={handleRetry}
        disabled={isRetrying}
      >
        {#if isRetrying}
          <svg class="retry-spinner spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
          </svg>
        {/if}
        <span>{isRetrying ? 'Retrying...' : retryLabel}</span>
      </button>
    {/if}

    {#if dismissAction}
      <button
        type="button"
        class="banner-btn close-btn flex-row"
        onclick={dismissAction}
        aria-label="Dismiss message"
      >
        <X size={14} />
      </button>
    {/if}
  </div>
</div>

<style>
  .error-banner {
    display: flex;
    width: 100%;
    background: color-mix(in srgb, var(--semantic-error) 8%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--semantic-error) 15%, var(--border-color));
    border-radius: var(--radius-standard);
    padding: var(--spacing-sm) var(--spacing-md);
    gap: var(--spacing-sm);
    align-items: flex-start;
    box-sizing: border-box;
  }

  .error-banner.warning {
    background: color-mix(in srgb, var(--semantic-warning) 8%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--semantic-warning) 15%, var(--border-color));
  }

  .error-banner.info {
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--accent) 15%, var(--border-color));
  }

  .banner-icon-wrapper {
    margin-top: 2px;
    flex-shrink: 0;
  }

  .error-banner.error :global(.banner-icon) {
    color: var(--semantic-error);
  }

  .error-banner.warning :global(.banner-icon) {
    color: var(--semantic-warning);
  }

  .error-banner.info :global(.banner-icon) {
    color: var(--accent);
  }

  .banner-body {
    flex-grow: 1;
    gap: var(--spacing-3xs);
    min-width: 0;
    text-align: left;
  }

  .banner-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-primary);
  }

  .banner-message {
    font-size: var(--font-size-xs);
    line-height: var(--line-height-normal);
    color: var(--text-secondary);
    word-break: break-word;
  }

  .banner-actions {
    flex-shrink: 0;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .banner-btn {
    appearance: none;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--text-primary) 3%, transparent);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    transition: all var(--motion-duration-standard) var(--motion-ease-standard);
  }

  .retry-btn {
    padding: var(--spacing-3xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    border-radius: var(--radius-pill);
    gap: var(--spacing-2xs);
    align-items: center;
  }

  .retry-btn:hover:not(:disabled) {
    background: var(--text-primary);
    color: var(--bg-base);
    border-color: var(--text-primary);
  }

  .close-btn {
    padding: var(--spacing-3xs);
    border-radius: var(--radius-circle);
    border: none;
    background: transparent;
    opacity: 0.6;
  }

  .close-btn:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
  }

  .spin {
    animation: banner-spin 1s linear infinite;
  }

  @keyframes banner-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
