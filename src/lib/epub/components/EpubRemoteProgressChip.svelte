<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';
  import { Smartphone, Check, X } from 'lucide-svelte';

  let prompt = $derived(epubReader.remoteProgressPrompt);
  let remotePercent = $derived(
    prompt ? Math.round((prompt.percentage || 0) * 100) : 0
  );
</script>

{#if prompt}
  <div class="remote-chip-wrapper">
    <div class="remote-chip">
      <Smartphone size={15} class="phone-icon" />
      <span class="chip-text">
        Continue from other device? ({remotePercent}% · {prompt.chapterTitle || 'Next page'})
      </span>
      <div class="chip-actions">
        <button 
          class="btn-accept" 
          onclick={() => epubReader.acceptRemoteProgress()} 
          aria-label="Accept remote position"
        >
          <Check size={13} />
          <span>Jump</span>
        </button>
        <button 
          class="btn-dismiss" 
          onclick={() => epubReader.dismissRemoteProgress()} 
          aria-label="Dismiss prompt"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .remote-chip-wrapper {
    position: fixed;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9998;
    animation: dropDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .remote-chip {
    background: var(--bg-surface, #ffffff);
    color: var(--text-primary, #111827);
    border: 1px solid var(--accent, #3b82f6);
    border-radius: 24px;
    padding: 6px 14px;
    font-size: 0.82rem;
    font-weight: 500;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .phone-icon {
    color: var(--accent, #3b82f6);
    flex-shrink: 0;
  }

  .chip-text {
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-accept {
    background: var(--accent, #3b82f6);
    color: #ffffff;
    border: none;
    border-radius: 14px;
    padding: 3px 9px;
    font-size: 0.75rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  .btn-accept:hover {
    filter: brightness(1.1);
  }

  .btn-dismiss {
    background: none;
    border: none;
    color: var(--text-secondary, #6b7280);
    padding: 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .btn-dismiss:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.08));
    color: var(--text-primary, #111827);
  }

  @keyframes dropDown {
    from {
      opacity: 0;
      transform: translate(-50%, -10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
