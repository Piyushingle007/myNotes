<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { AiService } from '../services/ai/AiService';
  
  let { currentText, onSelectTag } = $props<{
    currentText: string;
    onSelectTag: (tag: string) => void;
  }>();
  
  let suggestedTags = $state<string[]>([]);
  let loading = $state(false);
  let timeout: any = null;
  
  async function generateSuggestions(text: string) {
    if (!appState.aiFeaturesEnabled || !text || text.length < 10) {
      suggestedTags = [];
      return;
    }
    
    loading = true;
    try {
      const allTags = Array.from(appState.tags).map(t => t.name);
      if (allTags.length === 0) {
        suggestedTags = [];
        return;
      }
      
      const textEmb = await AiService.embed(text);
      const scored = [];
      
      for (const tag of allTags) {
        const tagEmb = await AiService.embed(tag);
        const score = AiService.dotProduct(textEmb, tagEmb);
        scored.push({ tag, score });
      }
      
      scored.sort((a, b) => b.score - a.score);
      suggestedTags = scored.slice(0, 3).filter(t => t.score > 0.1).map(t => t.tag);
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    clearTimeout(timeout);
    const text = currentText;
    timeout = setTimeout(() => {
      generateSuggestions(text);
    }, 1500);
  });
</script>

{#if loading}
  <div class="tag-suggestions-loading">
    <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
    AI suggesting tags...
  </div>
{:else if suggestedTags.length > 0}
  <div class="tag-suggestions">
    <span class="tag-suggestions-label">AI Suggestions:</span>
    {#each suggestedTags as tag}
      <button class="tag-suggestion-btn" onclick={() => onSelectTag(tag)}>
        +{tag}
      </button>
    {/each}
  </div>
{/if}

<style>
  .tag-suggestions-loading {
    font-size: 11px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
  }
  .tag-suggestions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .tag-suggestions-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    opacity: 0.8;
  }
  .tag-suggestion-btn {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    border: 1px dashed color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .tag-suggestion-btn:hover {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    border-color: var(--accent);
  }
</style>
