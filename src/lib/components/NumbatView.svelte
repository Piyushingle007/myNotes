<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Plus, Trash2, Edit3, HelpCircle, MoreVertical, Copy, Check, X, Calculator, FileCode, Cloud, CloudOff } from 'lucide-svelte';
  import { fade, slide } from 'svelte/transition';
  import { appState } from '../stores/appState.svelte';
  import SyncPopover from './SyncPopover.svelte';
  import { NumbatEngine, type NumDocument } from '../services/NumbatEngine';
  import { NumFileManager } from '../services/NumFileManager';

  // WASM Engine Loading State
  let isLoading = $state(true);
  let isWasmLoaded = $state(false);
  let loadError = $state<string | null>(null);

  // Files & Active Document State
  let numFiles = $state<{ path: string; name: string; created: number; modified: number }[]>([]);
  let activeFilePath = $state<string | null>(null);
  let activeTitle = $state('');
  
  // Document Content State
  let rawText = $state('');
  let results = $state<{ output: string; plain: string; isError: boolean, expr: string, lineNo: number, isEmpty: boolean }[]>([]);
  
  let lines = $derived(rawText.split('\n'));
  
  let inputRefs = $state<HTMLInputElement[]>([]);
  let activeLineIdx = $state(-1);
  
  // Copy to Clipboard Feedback
  let copiedLineIdx = $state<number | null>(null);

  // UI Panels State
  let showHelp = $state(false);
  let showMenu = $state(false);
  let showSyncPopover = $state(false);
  let isRenamingFile = $state(false);
  let newFileNameVal = $state('');

  // Autocomplete State
  let showCompletions = $state(false);
  let completions = $state<string[]>([]);
  let activeCompletionIdx = $state(0);
  let dropdownLeft = $state(0);

  // DOM Elements References
  let renameInputEl = $state<HTMLInputElement | null>(null);

  // Derived values
  let activeFile = $derived(numFiles.find(f => f.path === activeFilePath));

  // Initialize Numbat WASM on mount
  onMount(async () => {
    try {
      await NumbatEngine.init();
      isWasmLoaded = true;
      isLoading = false;
      await NumFileManager.ensureNumFolder();
      refreshFileList();

      if (numFiles.length === 0) {
        const path = await NumFileManager.createNumFile('Scratch');
        refreshFileList();
        selectFile(path);
      } else {
        selectFile(numFiles[0].path);
      }
    } catch (err: any) {
      console.error(err);
      loadError = err?.message || 'Failed to initialize calculator engine.';
      isLoading = false;
    }

    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        appState.showToast('Command Palette (Cmd+K) coming soon!', 'info', 2000);
      }
    };
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  function refreshFileList() {
    numFiles = NumFileManager.listNumFiles();
  }

  async function selectFile(path: string) {
    if (activeFilePath === path) return;

    // Fix: Cancel pending debounced evaluation to prevent race conditions
    if (evalTimeout) {
      clearTimeout(evalTimeout);
      evalTimeout = null;
    }

    // Fix: Save current tab before switching
    if (activeFilePath && activeFile) {
      await saveCurrentDocument();
    }

    activeFilePath = path;
    showMenu = false;
    isRenamingFile = false;

    try {
      const doc = NumFileManager.loadNumFile(path);
      activeTitle = doc.title;
      rawText = doc.text || '';
      evaluateDocument(rawText);
      await tick();
      inputRefs[0]?.focus();
    } catch (e) {
      console.error('Failed to load Num file:', e);
      appState.showToast('Failed to load calculation session.', 'error', 4000);
    }
  }

  async function handleCreateFile() {
    try {
      const path = await NumFileManager.createNumFile('Calc');
      refreshFileList();
      await selectFile(path);
      inputRefs[0]?.focus();
    } catch (e) {
      appState.showToast('Failed to create calculation session.', 'error', 4000);
    }
  }

  async function handleRenameActiveFile() {
    if (!activeFilePath || !newFileNameVal.trim()) return;
    const oldPath = activeFilePath;
    const cleanTitle = newFileNameVal.trim();
    
    try {
      const newPath = await NumFileManager.renameNumFile(oldPath, cleanTitle);
      refreshFileList();
      activeFilePath = newPath;
      activeTitle = cleanTitle;
      isRenamingFile = false;
      appState.showToast('Session renamed.', 'success', 2000);
    } catch (e) {}
  }

  async function handleDeleteFile(path: string) {
    const fileToDelete = numFiles.find(f => f.path === path);
    if (!fileToDelete) return;
    
    if (confirm(`Delete calculation session "${fileToDelete.name}"?`)) {
      try {
        await NumFileManager.deleteNumFile(path);
        refreshFileList();
        if (activeFilePath === path) {
          activeFilePath = null;
          if (numFiles.length > 0) {
            selectFile(numFiles[0].path);
          } else {
            const newPath = await NumFileManager.createNumFile('Scratch');
            refreshFileList();
            selectFile(newPath);
          }
        }
        showMenu = false;
        appState.showToast('Session deleted.', 'info', 2000);
      } catch (e) {
        appState.showToast('Failed to delete session file.', 'error', 4000);
      }
    }
  }

  function syncCode() {
    rawText = lines.join('\n');
    evaluateDocument(rawText);
  }

  let evalTimeout: any = null;
  function handleInput(e: Event, i: number) {
    const val = (e.target as HTMLInputElement).value;
    const newLines = [...lines];
    newLines[i] = val;
    rawText = newLines.join('\n');
    
    updateCompletions(i);

    if (evalTimeout) clearTimeout(evalTimeout);
    evalTimeout = setTimeout(() => {
      evaluateDocument(rawText);
    }, 150);
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
      const newLines = [...lines];
      
      newLines[i] = textBefore + pastedLines[0];
      
      const newLinesToInsert = pastedLines.slice(1);
      newLinesToInsert[newLinesToInsert.length - 1] += textAfter;
      
      newLines.splice(i + 1, 0, ...newLinesToInsert);
      rawText = newLines.join('\n');
      evaluateDocument(rawText);
      
      tick().then(() => {
        const lastPastedIdx = i + newLinesToInsert.length;
        inputRefs[lastPastedIdx]?.focus();
      });
    }
  }

  function updateCompletions(i: number) {
    const input = inputRefs[i];
    if (!input || !isWasmLoaded) return;
    const start = input.selectionStart || 0;
    const currentLineText = lines[i].substring(0, start);
    const currentCharIdx = currentLineText.length;

    // Check for trigger
    const isDotTrigger = currentLineText.endsWith('.');
    // Match the last word being typed
    const lastWordRegex = /[\w]+$/; 
    const match = currentLineText.match(lastWordRegex);
    
    // Close if it's a decimal number like .5 or 0.5
    if (currentLineText.match(/(?:\d+\.\d*|\.\d+)$/)) {
      showCompletions = false;
      return;
    }

    let query = '';
    if (isDotTrigger) {
      query = ''; // Show all options
    } else if (match) {
      query = match[0];
    } else {
      showCompletions = false;
      return;
    }

    // Preprocess 'to' in query just like interpret does
    const processedQuery = query.replace(/\bto\b/gi, '->');
    const results = NumbatEngine.getCompletions(processedQuery);

    if (results.length > 0) {
      completions = results.slice(0, 50); // limit to max 50 for performance
      activeCompletionIdx = 0;
      showCompletions = true;

      // Position calculation
      const assumedDropdownWidth = 320; 
      const containerWidth = input.clientWidth || 400;
      
      const maxLeft = Math.max(0, containerWidth - assumedDropdownWidth);
      const calculatedLeft = currentCharIdx * charWidth;
      
      dropdownLeft = Math.min(calculatedLeft, maxLeft);
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

    const newLines = [...lines];
    newLines[i] = textVal.substring(0, wordStart) + completion + textVal.substring(start);
    lines = newLines;
    rawText = newLines.join('\n');
    evaluateDocument(rawText);
    
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
      
      const newLines = [...lines];
      newLines[i] = newLines[i].substring(0, pos);
      newLines.splice(i + 1, 0, textAfter);
      
      lines = newLines;
      rawText = newLines.join('\n');
      evaluateDocument(rawText);
      
      tick().then(() => {
        inputRefs[i + 1]?.focus();
        inputRefs[i + 1]?.setSelectionRange(0, 0);
      });
    } else if (e.key === 'Backspace' && (input.selectionStart || 0) === 0 && (input.selectionEnd || 0) === 0 && i > 0) {
      e.preventDefault();
      const textToMove = lines[i];
      const newLines = [...lines];
      newLines.splice(i, 1);
      const prevLen = newLines[i - 1].length;
      newLines[i - 1] += textToMove;
      
      lines = newLines;
      rawText = newLines.join('\n');
      evaluateDocument(rawText);
      
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

  async function evaluateDocument(text: string) {
    if (!isWasmLoaded) return;
    NumbatEngine.reset();
    const textLines = text.split('\n');
    const newResults: { output: string; plain: string; isError: boolean, expr: string, lineNo: number, isEmpty: boolean }[] = [];
    
    for (let i = 0; i < textLines.length; i++) {
      const lineText = textLines[i].trim();
      if (!lineText || lineText.startsWith('#') || lineText.startsWith('//')) {
        newResults.push({ output: '', plain: '', isError: false, expr: '', lineNo: i + 1, isEmpty: true });
        continue;
      }
      
      const res = NumbatEngine.interpret(lineText);
      if (res.isCommand) {
        newResults.push({ output: `<span class="numbat-dimmed">// Command executed</span>`, plain: 'Command executed', isError: false, expr: lineText, lineNo: i + 1, isEmpty: false });
      } else {
        newResults.push({ output: res.output, plain: res.plainOutput, isError: res.isError, expr: lineText, lineNo: i + 1, isEmpty: res.isEmpty });
      }
    }
    results = newResults;
    saveCurrentDocument();
  }

  async function saveCurrentDocument() {
    if (!activeFilePath || !activeFile) return;
    const doc: NumDocument = {
      version: 2,
      title: activeTitle,
      text: rawText,
      createdAt: new Date(activeFile.created).toISOString(),
      modifiedAt: new Date().toISOString()
    };
    await NumFileManager.saveNumFile(activeFilePath, doc);
  }

  async function handleResetSession() {
    if (confirm('Reset calculation session? This clears all text variables and inputs.')) {
      rawText = '';
      lines = [''];
      results = [];
      NumbatEngine.reset();
      await saveCurrentDocument();
      showMenu = false;
      appState.showToast('Session reset.', 'info', 2000);
      inputRefs[0]?.focus();
    }
  }

  function handleCopyResult(plainText: string, index: number) {
    if (!plainText) return;
    navigator.clipboard.writeText(plainText).then(() => {
      copiedLineIdx = index;
      setTimeout(() => {
        if (copiedLineIdx === index) copiedLineIdx = null;
      }, 2000);
    });
  }

  function handleQuickInsert(expr: string) {
    const idx = activeLineIdx >= 0 ? activeLineIdx : lines.length - 1;
    const input = inputRefs[idx];
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const currentVal = lines[idx];
    
    const newLines = [...lines];
    newLines[idx] = currentVal.substring(0, start) + expr + currentVal.substring(end);
    lines = newLines;
    rawText = newLines.join('\n');
    evaluateDocument(rawText);
    
    tick().then(() => {
      inputRefs[idx]?.focus();
      const newPos = start + expr.length;
      inputRefs[idx]?.setSelectionRange(newPos, newPos);
    });
  }

  function clickOutside(node: HTMLElement, callback: () => void) {
    const handleClick = (e: MouseEvent) => {
      if (node && !node.contains(e.target as Node)) callback();
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy() { document.removeEventListener('click', handleClick, true); }
    };
  }

  function startRenaming() {
    newFileNameVal = activeTitle;
    isRenamingFile = true;
    showMenu = false;
    tick().then(() => renameInputEl?.focus());
  }

  function escapeHtml(str: string) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Basic single-pass tokenizer for the editor backdrop to avoid HTML injection bugs
  function highlightNumbatSyntax(text: string) {
    if (!text) return '';
    
    const regex = /(?:(\b(?:let|fn|if|then|else)\b)|(\b(?:km|m|cm|mm|kg|g|mg|s|min|h|d|usd|eur|inr|gbp|mph|celsius|fahrenheit)\b)|(\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b)|(\+|-|\*|\/|\^|->|=>|=|\bto\b)|(#.*|\/\/.*))/gi;
    
    let html = '';
    let lastIndex = 0;
    
    text.replace(regex, (match, kw, unit, num, op, comment, offset) => {
      html += escapeHtml(text.slice(lastIndex, offset));
      lastIndex = offset + match.length;
      
      if (kw) html += `<span class="tok-kw">${escapeHtml(kw)}</span>`;
      else if (unit) html += `<span class="tok-unit">${escapeHtml(unit)}</span>`;
      else if (num) html += `<span class="tok-num">${escapeHtml(num)}</span>`;
      else if (op) html += `<span class="tok-op">${escapeHtml(op)}</span>`;
      else if (comment) html += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
      
      return match;
    });
    
    html += escapeHtml(text.slice(lastIndex));
    
    // Preserve trailing newline for correct backdrop height matching
    if (html.endsWith('\n')) {
      html += ' ';
    }
    return html;
  }
</script>

<div class="workspace-root flex-col">
  <!-- 1. Minimal Top Header -->
  <header class="app-header flex-row">
    <div class="tabs-scroll flex-row">
      {#each numFiles as file}
        <div 
          class="file-tab flex-row" 
          class:active={activeFilePath === file.path}
          onclick={() => selectFile(file.path)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && selectFile(file.path)}
        >
          <FileCode size={14} class="tab-icon" />
          <span class="tab-name">{file.name}</span>
          {#if numFiles.length > 1}
            <button 
              class="tab-close-btn flex-row" 
              onclick={(e) => { e.stopPropagation(); handleDeleteFile(file.path); }}
              aria-label="Delete calculation session file"
            >
              <X size={12} />
            </button>
          {/if}
        </div>
      {/each}
      <button class="add-tab-btn flex-row" onclick={handleCreateFile} title="New Session">
        <Plus size={14} />
      </button>
    </div>

    <div class="header-actions flex-row">

      <button class="hdr-icon-btn" onclick={() => showHelp = !showHelp} class:active={showHelp} title="Syntax Guide">
        <HelpCircle size={15} />
      </button>
      <div class="menu-wrapper">
        <button class="hdr-icon-btn" onclick={(e) => { e.stopPropagation(); showMenu = !showMenu; }} title="More Options">
          <MoreVertical size={15} />
        </button>
        {#if showMenu}
          <div class="glass-menu flex-col" use:clickOutside={() => showMenu = false} transition:fade={{duration: 150}}>
            <button onclick={startRenaming}>
              <Edit3 size={14} /> Rename Session
            </button>
            <button onclick={handleResetSession}>
              <X size={14} /> Clear All Text
            </button>
            <div class="menu-divider"></div>
            {#if activeFilePath}
              <button onclick={() => handleDeleteFile(activeFilePath)} class="destructive-action">
                <Trash2 size={14} /> Delete Session
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </header>

  <!-- 2. Main Scrolling Area -->
  <main class="main-scroll flex-col">
    {#if isLoading}
      <div class="empty-state">Loading scientific engine...</div>
    {:else if loadError}
      <div class="empty-state error">Error: {loadError}</div>
    {:else}
      
      <div class="content-wrapper flex-col">
        <div class="session-title-area flex-row">
          {#if isRenamingFile}
            <input 
              type="text" 
              bind:value={newFileNameVal} 
              onkeydown={(e) => e.key === 'Enter' && handleRenameActiveFile()}
              onblur={handleRenameActiveFile}
              class="title-input"
              placeholder="Session name..."
              bind:this={renameInputEl}
            />
          {:else}
            <h1 class="title-display" ondblclick={startRenaming}>{activeTitle || 'Calculation Session'}</h1>
          {/if}

          <!-- Sync status badges moved next to title -->
          <div class="sync-popover-anchor note-status-group">
            <span class="status-badge save-status clean" title="All changes saved to local storage">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Saved Locally
            </span>

            <button 
              class="status-badge sync-status flex-row {appState.googleConnected && appState.syncEnabled ? (appState.syncStatus === 'syncing' ? 'syncing' : appState.syncStatus === 'error' ? 'error' : 'synced') : 'offline'}" 
              onclick={() => { showSyncPopover = !showSyncPopover; }}
              title="Sync & Account"
              aria-expanded={showSyncPopover}
            >
              {#if appState.googleConnected && appState.syncEnabled}
                {#if appState.syncStatus === 'syncing'}
                  <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                  </svg>
                  Syncing...
                {:else if appState.syncStatus === 'error'}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Sync Error
                {:else}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.47 0-.89.09-1.29.27A5 5 0 0 0 5 14c0 .34.05.67.15 1A4.5 4.5 0 0 0 8.5 19H17.5z"/>
                    <polyline points="9 15 11 17 15 13"/>
                  </svg>
                  Drive Synced
                {/if}
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 14c-.33 0-.66-.03-1-.1A4.5 4.5 0 0 0 8.5 19h7a4.5 4.5 0 0 0 4-2.5"/>
                  <path d="M16 11c1 .5 2.5.5 3.5-1.5M10.3 5.3A5 5 0 0 1 19 8c0 .33-.03.66-.1 1"/>
                  <line x1="2" y1="2" x2="22" y2="22"/>
                </svg>
                Sync Offline
              {/if}
            </button>
      
            {#if showSyncPopover}
              <SyncPopover onclose={() => { showSyncPopover = false; }} />
            {/if}
          </div>
        </div>

        <div class="numbat-body flex-col">
          {#each lines as line, i}
            <div class="cell flex-col" class:active={activeLineIdx === i}>
              <div class="cell-input-row flex-row">
                <div class="line-number">{i + 1}</div>
                <div style="position: relative; flex: 1;">
                  <input 
                    bind:this={inputRefs[i]}
                    value={line}
                    oninput={(e) => handleInput(e, i)}
                    onkeydown={(e) => handleKeydown(e, i)}
                    onpaste={(e) => handlePaste(e, i)}
                    onfocus={() => activeLineIdx = i}
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
                  <button 
                    class="copy-btn flex-row" 
                    onclick={() => handleCopyResult(results[i].plain, i)}
                    title="Copy result"
                  >
                    {#if copiedLineIdx === i}
                      <Check size={12} style="color: var(--semantic-success);" />
                    {:else}
                      <Copy size={12} />
                    {/if}
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </main>

  <!-- 3. Help Panel Overlay -->
  {#if showHelp}
    <div class="help-overlay" transition:fade={{duration: 150}}>
      <div class="help-panel flex-col" use:clickOutside={() => showHelp = false} transition:slide={{duration: 200}}>
        <div class="help-header flex-row">
          <h2>Numbat Syntax Guide</h2>
          <button class="hdr-icon-btn" onclick={() => showHelp = false}>
            <X size={16} />
          </button>
        </div>
        <div class="help-content flex-col">
          <section>
            <h3>Basic Arithmetic</h3>
            <pre><code>2 + 3 * 4
2^10
5.4e-3</code></pre>
          </section>
          <section>
            <h3>Conversions</h3>
            <pre><code>5 km -> miles
100 USD -> INR</code></pre>
          </section>
          <section>
            <h3>Variables & Functions</h3>
            <pre><code>let mass = 75 kg
fn f(x) = x^2</code></pre>
          </section>
        </div>
      </div>
    </div>
  {/if}

  <!-- 4. Bottom Quick Actions -->
  {#if isWasmLoaded && !isLoading && !loadError}
    <div class="quick-actions-bar flex-row">
      <div class="chips-scroll flex-row">
        <button class="chip" onclick={() => handleQuickInsert(' USD -> INR')}>USD ➔ INR</button>
        <button class="chip" onclick={() => handleQuickInsert(' EUR -> USD')}>EUR ➔ USD</button>
        <button class="chip" onclick={() => handleQuickInsert(' km/h -> mph')}>km/h ➔ mph</button>
        <button class="chip" onclick={() => handleQuickInsert(' kg -> lbs')}>kg ➔ lbs</button>
        <button class="chip" onclick={() => handleQuickInsert(' minutes -> hours')}>min ➔ hr</button>
        <button class="chip" onclick={() => handleQuickInsert('sqrt(')}>sqrt(x)</button>
        <button class="chip" onclick={() => handleQuickInsert('let ')}>let x =</button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Structural Layout ── */
  .workspace-root {
    width: 100%;
    height: 100%;
    background-color: var(--bg-base);
    color: var(--text-primary);
    font-family: 'Inter', system-ui, sans-serif;
  }

  .flex-col { display: flex; flex-direction: column; }
  .flex-row { display: flex; flex-direction: row; align-items: center; }

  /* ── 1. Top Header & Tabs ── */
  .app-header {
    height: 48px;
    padding: 0 var(--spacing-sm);
    background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    justify-content: space-between;
    z-index: 10;
  }

  .tabs-scroll {
    flex-grow: 1;
    overflow-x: auto;
    scrollbar-width: none;
    gap: var(--spacing-xs);
    height: 100%;
  }
  .tabs-scroll::-webkit-scrollbar { display: none; }

  .file-tab {
    height: 32px;
    padding: 0 var(--spacing-md);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
    gap: var(--spacing-sm);
    user-select: none;
  }

  .file-tab:hover {
    background-color: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }

  .file-tab.active {
    background-color: var(--bg-surface-elevated);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }

  .tab-icon { opacity: 0.7; }
  .file-tab.active .tab-icon { color: var(--accent); opacity: 1; }

  .tab-close-btn {
    opacity: 0;
    width: 0;
    overflow: hidden;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .file-tab:hover .tab-close-btn {
    opacity: 1;
    width: auto;
    margin-left: 4px;
  }

  .tab-close-btn:hover {
    color: var(--semantic-error);
    background-color: rgba(239, 68, 68, 0.15);
  }

  .add-tab-btn, .hdr-icon-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    height: 32px;
    width: 32px;
    border-radius: 8px;
    cursor: pointer;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .add-tab-btn:hover, .hdr-icon-btn:hover, .hdr-icon-btn.active {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  /* Sync Indicator */
  .sync-popover-anchor {
    position: relative;
  }

  .note-status-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: var(--spacing-sm);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
    letter-spacing: 0.01em;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid transparent;
    user-select: none;
    font-family: inherit;
    background: none;
    cursor: pointer;
    white-space: nowrap;
  }

  .status-badge:hover {
    filter: brightness(1.1);
    transform: translateY(-0.5px);
  }

  .status-badge svg {
    flex-shrink: 0;
    opacity: 0.95;
  }
  
  .status-badge .spin {
    animation: sync-spin 1s linear infinite;
  }

  /* Local Save status colors */
  .status-badge.save-status.clean {
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    cursor: default;
  }

  /* Google Drive Sync status colors */
  .status-badge.sync-status.offline {
    color: var(--text-tertiary);
    background: rgba(124, 124, 124, 0.08);
    border: 1px solid rgba(124, 124, 124, 0.15);
  }

  .status-badge.sync-status.syncing {
    color: var(--accent);
    background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
    border: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.2);
  }

  .status-badge.sync-status.synced {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .status-badge.sync-status.error {
    color: var(--semantic-error);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  @media (max-width: 768px) {
    .status-badge {
      font-size: 10px;
      padding: 2px 6px;
    }
  }

  .header-actions {
    gap: 4px;
    align-items: center;
  }
  .menu-wrapper { position: relative; }

  /* Glass Menu */
  .glass-menu {
    position: absolute;
    top: 40px;
    right: 0;
    width: 180px;
    background-color: rgba(30, 30, 30, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    padding: var(--spacing-xs);
    z-index: 100;
    gap: 2px;
  }

  .glass-menu button {
    background: none;
    border: none;
    color: var(--text-secondary);
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background 0.15s ease, color 0.15s ease;
    text-align: left;
    width: 100%;
  }

  .glass-menu button:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .glass-menu .menu-divider {
    height: 1px;
    background-color: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }

  .glass-menu .destructive-action:hover {
    background-color: rgba(239, 68, 68, 0.15);
    color: var(--semantic-error);
  }

  /* ── Main Content Area ── */
  .main-scroll {
    flex-grow: 1;
    overflow-y: auto;
    padding: var(--spacing-xl) 20px;
  }

  .content-wrapper {
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    gap: var(--spacing-lg);
  }

  .session-title-area {
    margin-bottom: var(--spacing-md);
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .title-display {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
    cursor: text;
  }

  .title-input {
    font-size: 1.5rem;
    font-weight: 600;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    width: 100%;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 4px;
  }

  .numbat-body {
    position: relative;
    background: var(--bg-surface-elevated, #1e2227);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1) inset;
    padding: 8px 0 80px 0;
    width: 100%;
  }

  .numbat-body::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 48px;
    background: rgba(0, 0, 0, 0.15);
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    z-index: 0;
    pointer-events: none;
    border-top-left-radius: 12px;
    border-bottom-left-radius: 12px;
  }
  
  .cell {
    position: relative;
    z-index: 1;
    width: 100%;
  }
  
  .cell.active {
    z-index: 10;
  }
  .cell-input-row {
    width: 100%;
    min-height: 28px;
    align-items: center;
  }
  .line-number {
    width: 48px;
    text-align: right;
    padding-right: 16px;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    user-select: none;
    flex-shrink: 0;
    font-family: 'JetBrains Mono', monospace;
  }
  .cell-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.95rem;
    padding: 4px 12px;
  }
  .cell-result-row {
    width: 100%;
    align-items: flex-start;
    padding: 4px 0 8px 0;
  }
  .result-spacer {
    width: 48px;
    flex-shrink: 0;
  }
  .cell-result {
    flex: 1;
    margin-left: 12px;
    margin-right: 12px;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.95rem;
    padding: 6px 16px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    word-break: break-all;
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .res-expr {
    color: var(--text-secondary);
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .res-val {
    color: var(--accent);
  }
  .res-val :global(.numbat-value) { color: #f59e0b; font-weight: 600; }
  .res-val :global(.numbat-unit) { color: #10b981; }
  
  .cell-result.error {
    color: var(--semantic-error);
  }

  .copy-btn {
    opacity: 0;
    background: rgba(255,255,255,0.05);
    border: none;
    color: var(--text-secondary);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .cell-result-row:hover .copy-btn { opacity: 1; }
  .copy-btn:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text-primary);
  }

  /* ── Autocomplete Dropdown ── */
  .autocomplete-dropdown {
    position: absolute;
    z-index: 1000;
    background: #25282e; /* Solid opaque color to prevent overlapping text bleeding through */
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    width: 320px;
    max-width: 100%;
    max-height: 200px;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-wrap: wrap;
    flex-direction: row;
    gap: 6px;
    align-content: flex-start;
  }

  .completion-item {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.05);
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
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }

  /* ── 4. Bottom Quick Actions ── */
  .quick-actions-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 48px;
    background: linear-gradient(to top, var(--bg-base) 60%, transparent);
    padding: 0 var(--spacing-lg);
    pointer-events: none; /* Let clicks pass through gradient */
  }

  .chips-scroll {
    pointer-events: auto; /* Re-enable clicks for chips */
    flex-grow: 1;
    overflow-x: auto;
    scrollbar-width: none;
    gap: var(--spacing-sm);
    padding-bottom: var(--spacing-md);
  }
  .chips-scroll::-webkit-scrollbar { display: none; }

  .chip {
    background-color: var(--bg-surface-elevated);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--text-secondary);
    padding: 6px 16px;
    border-radius: 20px; /* Pill shape */
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }

  .chip:hover {
    background-color: rgba(255,255,255,0.12);
    color: var(--text-primary);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }

  .empty-state {
    flex-grow: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-style: italic;
  }
  .empty-state.error { color: var(--semantic-error); font-style: normal; }

  /* ── 5. Help Panel ── */
  .help-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .help-panel {
    width: 360px;
    max-height: 80vh;
    background-color: var(--bg-surface-elevated);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .help-header {
    height: 56px;
    padding: 0 var(--spacing-lg);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    justify-content: space-between;
  }
  .help-header h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .help-content {
    overflow-y: auto;
    padding: var(--spacing-lg);
    gap: var(--spacing-md);
  }

  .help-content h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin: 0 0 var(--spacing-xs) 0;
  }

  .help-content pre {
    background-color: rgba(0, 0, 0, 0.2);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: 8px;
    margin: 0;
    overflow-x: auto;
  }

  .help-content code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    color: var(--accent);
  }
</style>
