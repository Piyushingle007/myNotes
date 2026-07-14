<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Writable } from 'svelte/store';
  import { NumbatEngine } from '../services/NumbatEngine';
  import { Trash2 } from 'lucide-svelte';

  interface Props {
    nodeStore: Writable<any>;
    getPos: () => number | null | undefined;
    editor: any;
    updateAttributes: (attrs: any) => void;
  }
  let { nodeStore, getPos, editor, updateAttributes }: Props = $props();

  let code = $state($nodeStore.attrs.code || '');
  let results = $state<any[]>([]);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let isFocused = $state(false);

  function evaluate() {
    if (!NumbatEngine.isReady()) return;
    const lines = code.split('\n');
    let res = [];
    for (const line of lines) {
      if (!line.trim()) {
        res.push({ output: '', isError: false });
        continue;
      }
      const evalRes = NumbatEngine.interpret(line);
      res.push(evalRes);
    }
    results = res;
  }

  function handleInput() {
    resizeTextarea();
    evaluate();
    updateAttributes({ code });
  }

  function resizeTextarea() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = textareaEl.scrollHeight + 'px';
  }

  function removeBlock() {
    const pos = getPos();
    if (pos !== null && pos !== undefined) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + $nodeStore.nodeSize }).run();
    }
  }

  onMount(() => {
    NumbatEngine.init().then(() => {
      evaluate();
      tick().then(resizeTextarea);
    });
  });
</script>

<div class="numbat-block" class:focused={isFocused}>
  <div class="numbat-header flex-row">
    <div class="numbat-title">Numbat Sheet</div>
    <button class="icon-btn delete-btn" onclick={removeBlock} title="Delete Block">
      <Trash2 size={14} />
    </button>
  </div>
  <div class="numbat-body flex-row">
    <textarea
      bind:this={textareaEl}
      bind:value={code}
      oninput={handleInput}
      onfocus={() => isFocused = true}
      onblur={() => isFocused = false}
      placeholder="e.g. 10 usd to inr"
      class="numbat-textarea"
    ></textarea>
    <div class="numbat-results flex-col">
      {#each results as res}
        <div class="result-line" class:error={res.isError}>
          {@html res.output || '&nbsp;'}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .numbat-block {
    margin: 16px 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-card);
    overflow: hidden;
    transition: border-color 0.2s;
  }
  .numbat-block.focused {
    border-color: var(--accent-primary);
  }
  .numbat-header {
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-card-hover);
    border-bottom: 1px solid var(--border-color);
  }
  .numbat-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    color: var(--text-primary);
    background: var(--bg-card);
  }
  .delete-btn:hover {
    color: var(--danger-color, #ff4444);
  }
  .numbat-body {
    position: relative;
    align-items: flex-start;
  }
  .numbat-textarea {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--text-primary);
    resize: none;
    overflow: hidden;
    outline: none;
  }
  .numbat-results {
    flex: 1;
    min-width: 0;
    padding: 12px;
    background: rgba(0, 0, 0, 0.1);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .result-line {
    min-height: 1.6em;
    word-break: break-all;
  }
  .result-line.error {
    color: var(--danger-color, #ff4444);
  }
  
  @media (max-width: 768px) {
    .numbat-body {
      flex-direction: column;
    }
    .numbat-results {
      width: 100%;
      border-top: 1px dashed var(--border-color);
    }
  }
</style>
