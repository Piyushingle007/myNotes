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
  let dropdownLeft = $state(0);
  let evalTimeout: any = null;

  let lines = $state(code.split('\n'));
  let inputRefs = $state<HTMLInputElement[]>([]);
  let activeLineIdx = $state(-1);

  function syncCode() {
    code = lines.join('\n');
    updateAttributes({ code });
    evaluate();
  }

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

  function handleInput(e: Event, i: number) {
    lines[i] = (e.target as HTMLInputElement).value;
    syncCode();
    updateCompletions(i);
  }

  function handlePaste(e: ClipboardEvent, i: number) {
    const paste = e.clipboardData?.getData('text');
    if (paste && paste.includes('\n')) {
      e.preventDefault();
      const input = inputRefs[i];
      const pos = input?.selectionStart || 0;
      const textBefore = lines[i].substring(0, pos);
      const textAfter = lines[i].substring(input?.selectionEnd || 0);
      
      const pastedLines = paste.split('\n');
      lines[i] = textBefore + pastedLines[0];
      
      const newLinesToInsert = pastedLines.slice(1);
      newLinesToInsert[newLinesToInsert.length - 1] += textAfter;
      
      lines.splice(i + 1, 0, ...newLinesToInsert);
      syncCode();
      tick().then(() => {
        const lastPastedIdx = i + newLinesToInsert.length;
        inputRefs[lastPastedIdx]?.focus();
      });
    }
  }

  function updateCompletions(i: number) {
    const input = inputRefs[i];
    if (!input || !NumbatEngine.isReady()) return;
    const start = input.selectionStart || 0;
    const currentLineText = lines[i].substring(0, start);
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

      const charWidth = 9.12; 
      
      const assumedDropdownWidth = 330;
      const maxLeft = (input.clientWidth || 300) - assumedDropdownWidth;
      const calculatedLeft = currentCharIdx * charWidth;

      dropdownLeft = Math.min(calculatedLeft, Math.max(0, maxLeft));
    } else {
      showCompletions = false;
    }
  }

  function insertCompletion(completion: string, i: number) {
    const input = inputRefs[i];
    if (!input) return;
    const start = input.selectionStart || 0;
    const textVal = lines[i];
    const textBefore = textVal.substring(0, start);
    
    const isDotTrigger = textBefore.endsWith('.');
    const match = textBefore.match(/[\w]+$/);
    
    let wordStart = start;
    if (isDotTrigger) {
      wordStart = start - 1;
    } else if (match) {
      wordStart = start - match[0].length;
    }

    lines[i] = textVal.substring(0, wordStart) + completion + textVal.substring(start);
    syncCode();
    showCompletions = false;
    
    const newCursorPos = wordStart + completion.length;
    tick().then(() => {
      inputRefs[i]?.setSelectionRange(newCursorPos, newCursorPos);
      inputRefs[i]?.focus();
    });
  }

  function handleKeydown(e: KeyboardEvent, i: number) {
    if (showCompletions && activeLineIdx === i) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeCompletionIdx = (activeCompletionIdx + 1) % completions.length;
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeCompletionIdx = (activeCompletionIdx - 1 + completions.length) % completions.length;
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertCompletion(completions[activeCompletionIdx], i);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        showCompletions = false;
        return;
      }
    }

    const input = inputRefs[i];
    if (!input) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const pos = input.selectionStart || 0;
      const textAfter = lines[i].substring(pos);
      lines[i] = lines[i].substring(0, pos);
      lines.splice(i + 1, 0, textAfter);
      syncCode();
      tick().then(() => {
        inputRefs[i + 1]?.focus();
        inputRefs[i + 1]?.setSelectionRange(0, 0);
      });
    } else if (e.key === 'Backspace' && (input.selectionStart || 0) === 0 && (input.selectionEnd || 0) === 0 && i > 0) {
      e.preventDefault();
      const textToMove = lines[i];
      lines.splice(i, 1);
      const prevLen = lines[i - 1].length;
      lines[i - 1] += textToMove;
      syncCode();
      tick().then(() => {
        inputRefs[i - 1]?.focus();
        inputRefs[i - 1]?.setSelectionRange(prevLen, prevLen);
      });
    } else if (e.key === 'ArrowUp') {
      if (i > 0) {
        e.preventDefault();
        inputRefs[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowDown') {
      if (i < lines.length - 1) {
        e.preventDefault();
        inputRefs[i + 1]?.focus();
      }
    }
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
  <div class="numbat-body flex-col">
    {#each lines as line, i}
      <div class="cell flex-col">
        <div class="cell-input-row flex-row">
          <div class="line-number">{i + 1}</div>
          <div class="input-wrapper" style="position: relative; flex: 1;">
            <input 
              bind:this={inputRefs[i]}
              value={line}
              oninput={(e) => handleInput(e, i)}
              onkeydown={(e) => handleKeydown(e, i)}
              onpaste={(e) => handlePaste(e, i)}
              onfocus={() => activeLineIdx = i}
              onblur={() => setTimeout(() => { if (activeLineIdx === i) showCompletions = false; }, 150)}
              class="cell-input"
              autocomplete="off"
              spellcheck="false"
              placeholder={i === 0 ? "e.g. 10 usd to inr" : ""}
            />
            
            {#if showCompletions && activeLineIdx === i}
              <div 
                class="autocomplete-dropdown"
                style="top: 100%; left: {dropdownLeft}px; margin-top: 4px;"
              >
                {#each completions as completion, cIdx}
                  <button 
                    class="completion-item" 
                    class:active={cIdx === activeCompletionIdx}
                    onmousedown={(e) => { e.preventDefault(); insertCompletion(completion, i); }}
                  >
                    {completion}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        {#if results[i] && !results[i].isEmpty}
          <div class="cell-result-row flex-row">
            <div class="result-spacer"></div>
            <div class="cell-result" class:error={results[i].isError}>
              <span class="res-val">{@html results[i].output || '&nbsp;'}</span>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .numbat-block {
    margin: 16px 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-card);
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
    border-radius: 8px 8px 0 0;
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
    background: transparent;
    padding-bottom: 8px;
  }
  .cell {
    width: 100%;
    margin-top: 4px;
  }
  .cell-input-row {
    width: 100%;
    min-height: 28px;
    align-items: center;
  }
  .line-number {
    width: 36px;
    text-align: right;
    padding-right: 12px;
    color: var(--text-muted);
    font-size: 0.75rem;
    user-select: none;
    flex-shrink: 0;
  }
  .cell-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    padding: 4px 0;
  }
  .cell-result-row {
    width: 100%;
    align-items: center;
    margin-bottom: 4px;
  }
  .result-spacer {
    width: 36px;
    flex-shrink: 0;
  }
  .cell-result {
    flex: 1;
    color: var(--accent-primary, #007acc);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    padding: 4px 12px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    word-break: break-all;
  }
  .cell-result.error {
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
    max-width: calc(100vw - 48px);
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
  

</style>
