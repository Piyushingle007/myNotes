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

  // Autocomplete state
  let completions = $state<string[]>([]);
  let showCompletions = $state(false);
  let activeCompletionIdx = $state(0);
  let dropdownTop = $state(0);
  let dropdownLeft = $state(0);
  let evalTimeout: any = null;

  function evaluate() {
    if (!NumbatEngine.isReady()) return;
    const lines = code.split('\n');
    let res = [];
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('//')) {
        res.push({ output: '', isError: false });
        continue;
      }
      const evalRes = NumbatEngine.interpret(line);
      res.push(evalRes);
    }
    results = res;
  }

  function handleInput(e: Event) {
    code = (e.target as HTMLTextAreaElement).value;
    resizeTextarea();
    updateCompletions();
    
    if (evalTimeout) clearTimeout(evalTimeout);
    evalTimeout = setTimeout(() => {
      evaluate();
      updateAttributes({ code });
    }, 150);
  }

  function updateCompletions() {
    if (!textareaEl || !NumbatEngine.isReady()) return;
    const start = textareaEl.selectionStart;
    const textBeforeCursor = code.substring(0, start);
    const linesBefore = textBeforeCursor.split('\n');
    const currentLineIdx = linesBefore.length - 1;
    const currentLineText = linesBefore[currentLineIdx];
    const currentCharIdx = currentLineText.length;

    const isDotTrigger = currentLineText.endsWith('.');
    const lastWordRegex = /[\w]+$/; 
    const match = currentLineText.match(lastWordRegex);
    
    if (currentLineText.match(/(?:\d+\.\d*|\.\d+)$/)) {
      showCompletions = false;
      return;
    }

    let query = '';
    if (isDotTrigger) {
      query = '';
    } else if (match) {
      query = match[0];
    } else {
      showCompletions = false;
      return;
    }

    const processedQuery = query.replace(/\bto\b/gi, '->');
    const compResults = NumbatEngine.getCompletions(processedQuery);

    if (compResults.length > 0) {
      completions = compResults.slice(0, 50);
      activeCompletionIdx = 0;
      showCompletions = true;

      const lineHeight = 24.32; // 1.6 * 15.2px
      const charWidth = 9.12; 
      const paddingLeft = 12;
      const paddingTop = 12;

      const assumedDropdownWidth = 200;
      const maxLeft = (textareaEl.clientWidth || 300) - assumedDropdownWidth;
      const calculatedLeft = paddingLeft + (currentCharIdx * charWidth);

      dropdownTop = paddingTop + (currentLineIdx + 1) * lineHeight;
      dropdownLeft = Math.min(calculatedLeft, Math.max(0, maxLeft));
    } else {
      showCompletions = false;
    }
  }

  function insertCompletion(completion: string) {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const textVal = code;
    const textBefore = textVal.substring(0, start);
    
    const isDotTrigger = textBefore.endsWith('.');
    const match = textBefore.match(/[\w]+$/);
    
    let wordStart = start;
    if (isDotTrigger) {
      wordStart = start - 1;
    } else if (match) {
      wordStart = start - match[0].length;
    }

    code = textVal.substring(0, wordStart) + completion + textVal.substring(start);
    evaluate();
    updateAttributes({ code });
    showCompletions = false;
    
    const newCursorPos = wordStart + completion.length;
    tick().then(() => {
      textareaEl?.setSelectionRange(newCursorPos, newCursorPos);
      textareaEl?.focus();
      resizeTextarea();
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!showCompletions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeCompletionIdx = (activeCompletionIdx + 1) % completions.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeCompletionIdx = (activeCompletionIdx - 1 + completions.length) % completions.length;
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertCompletion(completions[activeCompletionIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      showCompletions = false;
    }
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
    <div class="input-pane flex-row">
      <div class="line-numbers">
        {#each code.split('\n') as _, i}
          <div class="line-number">{i + 1}</div>
        {/each}
      </div>
      <div style="position: relative; flex: 1; min-width: 0;">
        <textarea
          bind:this={textareaEl}
          bind:value={code}
          oninput={handleInput}
          onkeydown={handleKeydown}
          onfocus={() => isFocused = true}
          onblur={() => setTimeout(() => showCompletions = false, 150)}
          placeholder="e.g. 10 usd to inr"
          class="numbat-textarea"
        ></textarea>
        
        {#if showCompletions}
          <div 
            class="autocomplete-dropdown"
            style="top: {dropdownTop}px; left: {dropdownLeft}px;"
          >
            {#each completions as completion, i}
              <button 
                class="completion-item" 
                class:active={i === activeCompletionIdx}
                onmousedown={(e) => { e.preventDefault(); insertCompletion(completion); }}
              >
                {completion}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="output-pane flex-row">
      <div class="line-numbers output-numbers">
        {#each results as _, i}
          <div class="line-number">{i + 1}</div>
        {/each}
      </div>
      <div class="results-content flex-col">
        {#each results as res}
          <div class="result-line" class:error={res.isError}>
            {@html res.output || '&nbsp;'}
          </div>
        {/each}
      </div>
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
  .input-pane, .output-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: row;
    align-items: stretch;
  }
  .output-pane {
    background: rgba(0, 0, 0, 0.1);
  }
  .line-numbers {
    width: 36px;
    padding: 12px 8px 12px 4px;
    text-align: right;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--text-muted, #6e7681);
    user-select: none;
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(0, 0, 0, 0.05);
  }
  .output-numbers {
    border-right: none;
    background: transparent;
    padding-left: 12px;
  }
  .numbat-textarea {
    width: 100%;
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
  .results-content {
    flex: 1;
    min-width: 0;
    padding: 12px;
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
  
  /* Autocomplete Dropdown */
  .autocomplete-dropdown {
    position: absolute;
    z-index: 1000;
    background: var(--bg-card-hover, #2d333b);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    width: 320px;
    max-height: 200px;
    overflow-y: auto;
    padding: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    display: flex;
    flex-wrap: wrap;
    flex-direction: row;
    gap: 6px;
    align-content: flex-start;
  }

  .completion-item {
    background: transparent;
    border: none;
    color: var(--text-primary);
    padding: 6px 12px;
    text-align: center;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .completion-item:hover, .completion-item.active {
    background: var(--accent-primary, #007acc);
    color: #ffffff;
  }
  
  @media (max-width: 768px) {
    .numbat-body {
      flex-direction: column;
    }
    .input-pane {
      width: 100%;
    }
    .output-pane {
      width: 100%;
      border-top: 1px dashed var(--border-color);
    }
  }
</style>
