<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';
  import { X } from 'lucide-svelte';

  function close() {
    epubReader.activeFootnote = null;
  }
</script>

{#if epubReader.activeFootnote}
  <div class="footnote-backdrop" onclick={close} role="presentation">
    <div 
      class="footnote-card" 
      onclick={(e) => e.stopPropagation()} 
      role="dialog" 
      aria-label="Footnote"
    >
      <div class="footnote-header">
        <span class="footnote-title">Note</span>
        <button class="close-btn" onclick={close} aria-label="Close note">
          <X size={16} />
        </button>
      </div>

      <div class="footnote-content">
        {@html epubReader.activeFootnote.html}
      </div>
    </div>
  </div>
{/if}

<style>
  .footnote-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  .footnote-card {
    background: var(--bg-surface, var(--bg-base, #ffffff));
    color: var(--text-primary, #111827);
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 12px;
    width: 100%;
    max-width: 440px;
    max-height: 70vh;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .footnote-header {
    height: 44px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  }

  .footnote-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary, #4b5563);
  }

  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-primary, #111827);
  }

  .footnote-content {
    padding: 14px 16px;
    overflow-y: auto;
    font-size: 0.9rem;
    line-height: 1.55;
  }

  :global(.footnote-content p) {
    margin: 0 0 8px 0;
  }

  :global(.footnote-content a) {
    color: var(--accent, #3b82f6);
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
