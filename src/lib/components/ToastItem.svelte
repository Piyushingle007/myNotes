<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { CheckCircle, AlertTriangle, Info, X } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { appState, type Toast } from '../stores/appState.svelte';

  interface Props {
    toast: Toast;
  }

  let { toast }: Props = $props();

  let remaining = $state(toast.duration || 4000);
  let isPaused = $state(false);
  let timerId: any = null;
  let lastTick = Date.now();
  let progressWidth = $derived(
    toast.duration && toast.duration > 0
      ? Math.max(0, Math.min(100, (remaining / toast.duration) * 100))
      : 0
  );

  function startTimer() {
    if (toast.loading || !toast.duration || toast.duration <= 0) return;
    lastTick = Date.now();
    timerId = setInterval(() => {
      if (!isPaused) {
        const now = Date.now();
        const delta = now - lastTick;
        remaining -= delta;
        if (remaining <= 0) {
          clearInterval(timerId);
          appState.dismissToast(toast.id);
        }
      }
      lastTick = Date.now();
    }, 50);
  }

  function pauseTimer() {
    isPaused = true;
  }

  function resumeTimer() {
    isPaused = false;
    lastTick = Date.now();
  }

  async function handleActionClick() {
    if (!toast.action) return;
    try {
      await toast.action.callback();
    } catch (e) {
      console.error('Toast action failed:', e);
    } finally {
      appState.dismissToast(toast.id);
    }
  }

  $effect(() => {
    // If the toast updates from loading to completed, start the timer
    if (!toast.loading && toast.duration && toast.duration > 0 && !timerId) {
      remaining = toast.duration;
      startTimer();
    }
  });

  onMount(() => {
    if (!toast.loading && toast.duration && toast.duration > 0) {
      startTimer();
    }
  });

  onDestroy(() => {
    if (timerId) clearInterval(timerId);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div 
  class="toast-item {toast.type} flex-row" 
  class:loading={toast.loading}
  role={toast.type === 'error' ? 'alert' : 'status'}
  aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
  transition:fly={{ x: 300, duration: 250 }}
  onmouseenter={pauseTimer}
  onmouseleave={resumeTimer}
  onfocusin={pauseTimer}
  onfocusout={resumeTimer}
  tabindex="0"
>
  <div class="toast-icon-wrapper flex-row">
    {#if toast.loading}
      <svg class="toast-spinner spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="8.46" y2="8.46"></line>
        <line x1="15.54" y1="15.54" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="8.46" y2="15.54"></line>
        <line x1="15.54" y1="8.46" x2="19.07" y2="4.93"></line>
      </svg>
    {:else if toast.type === 'success'}
      <CheckCircle size={16} class="toast-icon success" />
    {:else if toast.type === 'info'}
      <Info size={16} class="toast-icon info" />
    {:else}
      <AlertTriangle size={16} class="toast-icon {toast.type}" />
    {/if}
  </div>

  <div class="toast-body flex-col">
    {#if toast.title}
      <span class="toast-title">{toast.title}</span>
    {/if}
    <span class="toast-message">{toast.message}</span>

    {#if toast.action}
      <button 
        type="button" 
        class="toast-action-btn" 
        onclick={handleActionClick}
      >
        {toast.action.label}
      </button>
    {/if}
  </div>

  <button 
    class="toast-close-btn flex-row" 
    onclick={() => appState.dismissToast(toast.id)} 
    aria-label="Close notification"
  >
    <X size={14} />
  </button>

  {#if !toast.loading && toast.duration && toast.duration > 0}
    <div 
      class="toast-progress-bar {toast.type}" 
      style="width: {progressWidth}%"
    ></div>
  {/if}
</div>

<style>
  .toast-item {
    pointer-events: auto;
    background: color-mix(in srgb, var(--bg-surface) 85%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard, 10px);
    padding: var(--spacing-sm) var(--spacing-md) calc(var(--spacing-sm) + 2px) var(--spacing-md);
    box-shadow: 0 10px 30px -5px color-mix(in srgb, var(--bg-base) 50%, transparent);
    color: var(--text-primary);
    gap: var(--spacing-sm);
    align-items: flex-start;
    transition: opacity 0.25s, transform 0.25s, border-color 0.25s;
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
    width: 100%;
    outline: none;
  }

  .toast-item:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent), var(--shadow-heavy);
  }

  /* Success Theme */
  .toast-item.success {
    border-left: 4px solid var(--semantic-success);
    background: color-mix(in srgb, var(--semantic-success) 8%, var(--bg-surface));
  }
  .toast-icon.success {
    color: var(--semantic-success);
  }

  /* Error Theme */
  .toast-item.error {
    border-left: 4px solid var(--semantic-error);
    background: color-mix(in srgb, var(--semantic-error) 8%, var(--bg-surface));
  }
  .toast-icon.error {
    color: var(--semantic-error);
  }

  /* Warning Theme */
  .toast-item.warning {
    border-left: 4px solid var(--semantic-warning);
    background: color-mix(in srgb, var(--semantic-warning) 8%, var(--bg-surface));
  }
  .toast-icon.warning {
    color: var(--semantic-warning);
  }

  /* Info Theme */
  .toast-item.info {
    border-left: 4px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface));
  }
  .toast-icon.info {
    color: var(--accent);
  }

  /* Loading State Spinner */
  .toast-item.loading {
    border-left: 4px solid var(--accent);
  }
  .toast-spinner {
    color: var(--accent);
  }

  .toast-icon-wrapper {
    flex-shrink: 0;
    margin-top: var(--spacing-3xs);
  }

  .toast-body {
    flex-grow: 1;
    gap: var(--spacing-3xs);
    min-width: 0;
    text-align: left;
  }

  .toast-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-primary);
  }

  .toast-message {
    font-size: var(--font-size-xs);
    line-height: var(--line-height-normal);
    color: var(--text-secondary);
    word-break: break-word;
  }

  .toast-action-btn {
    appearance: none;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--font-size-xs);
    font-weight: 600;
    padding: var(--spacing-3xs) var(--spacing-sm);
    border-radius: var(--radius-pill);
    margin-top: var(--spacing-2xs);
    transition: all var(--motion-duration-standard) var(--motion-ease-standard);
    align-self: flex-start;
  }

  .toast-action-btn:hover {
    background: var(--text-primary);
    color: var(--bg-base);
    border-color: var(--text-primary);
  }

  .toast-close-btn {
    background: transparent;
    border: none;
    padding: var(--spacing-2xs);
    margin: calc(-1 * var(--spacing-2xs));
    color: var(--text-secondary);
    opacity: 0.5;
    cursor: pointer;
    border-radius: 4px;
    transition: opacity 0.2s, background-color 0.2s;
    flex-shrink: 0;
  }

  .toast-close-btn:hover {
    opacity: 1;
    background-color: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
  }

  /* Progress Countdown Bar */
  .toast-progress-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    background: var(--accent);
    transition: width 50ms linear;
  }

  .toast-progress-bar.success {
    background: var(--semantic-success);
  }

  .toast-progress-bar.error {
    background: var(--semantic-error);
  }

  .toast-progress-bar.warning {
    background: var(--semantic-warning);
  }

  .toast-progress-bar.info {
    background: var(--accent);
  }

  .spin {
    animation: toast-spin-key 1s linear infinite;
  }

  @keyframes toast-spin-key {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
