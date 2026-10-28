<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';
  import { ArrowLeft, X } from 'lucide-svelte';

  function dismiss(e: MouseEvent) {
    e.stopPropagation();
    epubReader.showJumpBack = false;
  }
</script>

{#if epubReader.showJumpBack && epubReader.jumpHistory}
  <div class="jump-chip-wrapper">
    <div 
      class="jump-chip" 
      onclick={() => epubReader.jumpBack()}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && epubReader.jumpBack()}
      aria-label="Return to previous location"
    >
      <ArrowLeft size={14} />
      <span class="jump-label">
        Return to {epubReader.jumpHistory.chapterTitle || `${Math.round(epubReader.jumpHistory.percentage * 100)}%`}
      </span>
      <button class="chip-dismiss-btn" onclick={dismiss} aria-label="Dismiss">
        <X size={12} />
      </button>
    </div>
  </div>
{/if}

<style>
  .jump-chip-wrapper {
    position: fixed;
    bottom: 84px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9998;
    animation: slideUpFade 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .jump-chip {
    background: var(--bg-surface, #1e1e1e);
    color: var(--text-primary, #ffffff);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
    border-radius: 20px;
    padding: 7px 14px;
    font-size: 0.82rem;
    font-weight: 500;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }

  .jump-chip:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }

  .jump-label {
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-dismiss-btn {
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    padding: 2px;
    margin-left: 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .chip-dismiss-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }

  @keyframes slideUpFade {
    from {
      opacity: 0;
      transform: translate(-50%, 12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
