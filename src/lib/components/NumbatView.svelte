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
  
  // Syntax Highlighter
  let highlightedText = $derived(highlightNumbatSyntax(rawText));

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
  let dropdownTop = $state(0);
  let dropdownLeft = $state(0);

  // DOM Elements References
  let editorEl = $state<HTMLTextAreaElement | null>(null);
  let backdropEl = $state<HTMLElement | null>(null);
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
      resizeTextarea();
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
      editorEl?.focus();
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

  function resizeTextarea() {
    if (editorEl) {
      editorEl.style.height = 'auto';
      editorEl.style.height = editorEl.scrollHeight + 'px';
    }
  }

  function handleEditorScroll() {
    if (editorEl && backdropEl) {
      backdropEl.scrollTop = editorEl.scrollTop;
      backdropEl.scrollLeft = editorEl.scrollLeft;
    }
  }

  let evalTimeout: any = null;
  function handleEditorInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    rawText = target.value;
    resizeTextarea();
    handleEditorScroll();
    
    updateCompletions();

    if (evalTimeout) clearTimeout(evalTimeout);
    evalTimeout = setTimeout(() => {
      evaluateDocument(rawText);
    }, 150);
  }

  function updateCompletions() {
    if (!editorEl || !isWasmLoaded) return;
    const start = editorEl.selectionStart;
    const textBeforeCursor = rawText.substring(0, start);
    const linesBefore = textBeforeCursor.split('\n');
    const currentLineIdx = linesBefore.length - 1;
    const currentLineText = linesBefore[currentLineIdx];
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
      const lineHeight = 24.32; // 1.6 * 15.2px
      const charWidth = 9.12; // Approx for JetBrains Mono
      const gutterWidth = 44; 
      const paddingLeft = 16;
      const paddingTop = 16;

      const assumedDropdownWidth = 220; // Approximate max width of the dropdown
      const maxLeft = (editorEl?.clientWidth || 400) - assumedDropdownWidth;
      const calculatedLeft = gutterWidth + paddingLeft + (currentCharIdx * charWidth);

      dropdownTop = paddingTop + (currentLineIdx + 1) * lineHeight;
      dropdownLeft = Math.min(calculatedLeft, Math.max(0, maxLeft));
    } else {
      showCompletions = false;
    }
  }

  function insertCompletion(completion: string) {
    if (!editorEl) return;
    const start = editorEl.selectionStart;
    const textVal = rawText;
    const textBefore = textVal.substring(0, start);
    
    const isDotTrigger = textBefore.endsWith('.');
    const lastWordRegex = /[\w]+$/;
    const match = textBefore.match(lastWordRegex);
    
    let wordStart = start;
    if (isDotTrigger) {
      wordStart = start - 1; // replace the dot
    } else if (match) {
      wordStart = start - match[0].length;
    }

    rawText = textVal.substring(0, wordStart) + completion + textVal.substring(start);
    evaluateDocument(rawText);
    
    showCompletions = false;
    
    const newCursorPos = wordStart + completion.length;
    tick().then(() => {
      editorEl?.setSelectionRange(newCursorPos, newCursorPos);
      editorEl?.focus();
      resizeTextarea();
    });
  }

  function handleTextareaKeydown(e: KeyboardEvent) {
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
        newResults.push({ output: res.output, plain: res.plainOutput, isError: res.isError, expr: lineText, lineNo: i + 1, isEmpty: false });
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
      results = [];
      NumbatEngine.reset();
      await saveCurrentDocument();
      showMenu = false;
      appState.showToast('Session reset.', 'info', 2000);
      editorEl?.focus();
      resizeTextarea();
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
    if (!editorEl) return;
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const currentVal = editorEl.value;
    rawText = currentVal.substring(0, start) + expr + currentVal.substring(end);
    evaluateDocument(rawText);
    tick().then(() => {
      resizeTextarea();
      editorEl?.focus();
      const newPos = start + expr.length;
      editorEl?.setSelectionRange(newPos, newPos);
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
      <!-- Sync status badge + popover anchor (desktop only) -->
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

          <!-- Mobile-only sync status below title -->
          <div class="mobile-sync-status">
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
              onclick={() => { if (appState.googleConnected && appState.syncEnabled) showSyncPopover = !showSyncPopover; }}
              title={appState.googleConnected && appState.syncEnabled ? 'Sync & Account' : 'Sync is offline'}
              aria-expanded={showSyncPopover}
              style={!(appState.googleConnected && appState.syncEnabled) ? 'cursor: default;' : ''}
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

        <div class="workspace-grid">
          <!-- Enhanced Editor Area -->
          <div class="editor-container flex-row">
            <!-- Line Numbers Gutter -->
            <div class="line-gutter flex-col" aria-hidden="true">
              {#each lines as _, idx}
                <div class="line-no">{idx + 1}</div>
              {/each}
            </div>
            
            <div class="editor-wrapper">
              <!-- Syntax Backdrop -->
              <div class="editor-backdrop" aria-hidden="true" bind:this={backdropEl}>
                {@html highlightedText}
              </div>
            <!-- Transparent Textarea -->
            <textarea
              bind:this={editorEl}
              value={rawText}
              oninput={handleEditorInput}
              onscroll={handleEditorScroll}
              onkeydown={handleTextareaKeydown}
              placeholder="# Type calculations here...&#10;100 usd -> inr&#10;12 km / 2 h -> mph"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              class="editor-textarea"
            ></textarea>
            
            <!-- Autocomplete Dropdown -->
            {#if showCompletions}
              <div 
                class="autocomplete-dropdown flex-col"
                style="top: {dropdownTop}px; left: {dropdownLeft}px;"
              >
                {#each completions as completion, idx}
                  <button 
                    class="completion-item" 
                    class:active={idx === activeCompletionIdx}
                    onclick={() => insertCompletion(completion)}
                  >
                    {completion}
                  </button>
                {/each}
              </div>
            {/if}
            </div>
          </div>

          <!-- Results Stack -->
          <div class="results-stack flex-col" aria-hidden="true">
            {#each results as res, idx}
              <div class="result-row flex-row">
                {#if !res.isEmpty}
                  <div class="res-output flex-row">
                    <span class="res-line-badge">{res.lineNo}</span>
                    <div class="num-output" class:has-error={res.isError}>
                      {#if res.expr}
                        <span class="res-expr">{res.expr}</span>
                      {/if}
                      {@html res.output}
                    </div>
                  </div>
                  <button 
                    class="copy-btn flex-row" 
                    onclick={() => handleCopyResult(res.plain, idx)}
                    title="Copy result"
                  >
                    {#if copiedLineIdx === idx}
                      <Check size={12} style="color: var(--semantic-success);" />
                    {:else}
                      <Copy size={12} />
                    {/if}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
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
    border-bottom: 1px solid rgba(255, 255, 255, 0.05); /* Extremely subtle border */
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
    border-radius: 8px; /* Smooth corners */
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
    box-shadow: 0 2px 8px rgba(0,0,0,0.12); /* Hover elevation */
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

  @media (max-width: 768px) {
    .tab-close-btn {
      opacity: 1;
      width: auto;
      margin-left: 4px;
    }
  }

  .tab-close-btn:hover {
    color: var(--semantic-error);
    background-color: rgba(239, 68, 68, 0.15);
  }

  /* ── Mobile Header Revamp ── */
  @media (max-width: 768px) {
    .app-header {
      height: 44px;
      padding: 0 8px;
      gap: 4px;
    }

    .tabs-scroll {
      gap: 4px;
    }

    .file-tab {
      height: 28px;
      padding: 0 10px;
      border-radius: 14px; /* Full pill shape */
      font-size: 0.75rem;
      gap: 4px;
    }

    .file-tab .tab-icon {
      display: none; /* Remove file icons on mobile — tabs are obvious */
    }

    .tab-close-btn {
      opacity: 0.5;
      width: auto;
      margin-left: 2px;
      padding: 1px;
    }

    .file-tab.active .tab-close-btn {
      opacity: 0.7;
    }

    .add-tab-btn, .hdr-icon-btn {
      height: 28px;
      width: 28px;
      border-radius: 14px;
    }

    .header-actions {
      gap: 2px;
    }

    .quick-actions-bar {
      bottom: 56px;
    }
  }

  /* ── Autocomplete Dropdown ── */
  .autocomplete-dropdown {
    position: absolute;
    z-index: 1000;
    background: var(--bg-card-hover, #2d333b);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    min-width: 150px;
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
    /* Prevent default scrollbar styling to look clean */
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .completion-item {
    background: transparent;
    border: none;
    color: var(--text-primary);
    padding: 6px 12px;
    text-align: left;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
    width: 100%;
  }

  .completion-item:hover, .completion-item.active {
    background: rgba(255, 255, 255, 0.1);
    color: var(--accent);
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

  /* Header sync pills: hidden everywhere — desktop uses AppHeader, mobile uses .mobile-sync-status */
  .note-status-group { display: none; }

  @media (max-width: 768px) {
    .status-badge {
      font-size: 10px;
      padding: 2px 6px;
    }
  }

  /* Mobile sync bar below title */
  .mobile-sync-status {
    display: none; /* Hidden on desktop */
    position: relative;
  }

  @media (max-width: 768px) {
    .mobile-sync-status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
    }
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

  .add-tab-btn:hover, .hdr-icon-btn:hover {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .header-actions { gap: var(--spacing-xs); }
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

  /* ── 2. Main Content & Editor ── */
  .main-scroll {
    flex-grow: 1;
    overflow-y: auto;
    padding: var(--spacing-xl) 20px; /* Base padding */
    gap: var(--spacing-lg);
  }

  .content-wrapper {
    width: 100%;
    max-width: 1280px; /* Expand for side-by-side */
    margin: 0 auto;
    gap: var(--spacing-lg);
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-xl);
    align-items: start;
  }
  
  .workspace-grid > * {
    min-width: 0; /* Prevent grid blowout from pre-wrap text */
  }

  @media (max-width: 1024px) {
    .workspace-grid {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    .content-wrapper {
      max-width: 860px;
    }
  }

  @media (max-width: 768px) {
    .main-scroll { padding: var(--spacing-lg) var(--spacing-md); }
  }

  .session-title-area {
    margin-bottom: var(--spacing-md);
  }

  .title-display {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
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

  /* Enhanced Editor Container (Syntax Backdrop + Transparent Textarea) */
  .editor-container {
    position: relative;
    width: 100%;
    min-height: 120px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.95rem;
    line-height: 1.6;
    border-radius: 12px;
    background-color: var(--bg-surface);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1) inset;
    border: 1px solid rgba(255, 255, 255, 0.04);
    align-items: stretch;
  }

  .line-gutter {
    width: 44px;
    padding: var(--spacing-lg) 0;
    text-align: right;
    border-right: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.15);
    border-top-left-radius: 12px;
    border-bottom-left-radius: 12px;
    user-select: none;
    flex-shrink: 0;
  }

  .line-no {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--text-tertiary);
    padding-right: 12px;
    height: 1.6em; /* Match line height */
  }

  .editor-wrapper {
    position: relative;
    flex-grow: 1;
  }

  .editor-backdrop, .editor-textarea {
    width: 100%;
    min-height: 120px;
    padding: var(--spacing-lg);
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    box-sizing: border-box;
    white-space: pre-wrap;
    word-wrap: break-word;
    border-radius: 12px;
  }

  .editor-backdrop {
    position: absolute;
    top: 0;
    left: 0;
    color: var(--text-secondary); /* Default unhighlighted text color */
    pointer-events: none;
    overflow: hidden;
  }

  .editor-textarea {
    position: relative;
    background: transparent;
    color: transparent; /* Magic trick: hide text, show caret */
    caret-color: var(--text-primary); /* Keep caret visible */
    border: none;
    outline: none;
    resize: none;
    overflow: hidden; /* Hide scrollbar, let container expand */
  }

  /* Syntax Tokens */
  .editor-backdrop :global(.tok-num) { color: #f59e0b; }
  .editor-backdrop :global(.tok-unit) { color: #10b981; }
  .editor-backdrop :global(.tok-op) { color: var(--text-tertiary); }
  .editor-backdrop :global(.tok-kw) { color: #a855f7; font-weight: 600; }
  .editor-backdrop :global(.tok-comment) { color: var(--text-tertiary); font-style: italic; }

  /* ── 3. Results Stack ── */
  .results-stack {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.95rem; /* Force exact typography match to editor */
    line-height: 1.6;
    padding-top: calc(var(--spacing-lg) + 1px); /* Match editor's top padding + border exactly! */
    padding-bottom: 60px; /* Space for bottom chips */
    display: flex;
    flex-direction: column;
    /* No gap to ensure line-height sync */
    min-width: 0;
  }

  .result-row {
    height: 1.6em; /* Match editor line-height exactly on desktop */
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding-left: var(--spacing-md);
  }

  .res-output {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
    flex-grow: 1;
  }

  .res-line-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-tertiary);
    background: rgba(255,255,255,0.05);
    padding: 2px 4px;
    border-radius: 4px;
    min-width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .res-expr {
    color: var(--text-secondary);
  }

  .num-output {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.95rem;
    color: var(--text-primary);
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
    gap: 4px;
  }

  .num-output.has-error {
    color: var(--semantic-error);
    font-size: 0.85rem;
  }

  .num-output :global(.numbat-value) { color: #f59e0b; font-weight: 600; }
  .num-output :global(.numbat-unit) { color: #10b981; }

  .copy-btn {
    opacity: 0;
    background: rgba(255,255,255,0.05);
    border: none;
    color: var(--text-secondary);
    width: 24px;
    height: 24px;
    border-radius: 6px;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .result-row:hover .copy-btn { opacity: 1; }
  .copy-btn:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text-primary);
  }

  /* ── Mobile Result Improvements ── */
  @media (max-width: 1024px) {
    .results-stack {
      background: none;
      padding: var(--spacing-sm) 0;
      gap: var(--spacing-xs);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .result-row {
      height: auto;
      padding: 10px 12px;
      background: var(--bg-surface);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      align-items: flex-start;
    }

    /* Hide empty result rows on mobile */
    .result-row:not(:has(.res-output)) {
      display: none;
    }

    .res-output {
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }

    .res-line-badge {
      font-size: 0.6rem;
      opacity: 0.4;
      background: none;
      padding: 0;
      margin-right: 4px;
    }

    .num-output {
      white-space: normal;
      word-break: break-word;
      display: inline; /* Flow naturally as inline text, not flex */
    }

    .res-expr {
      font-size: 0.78rem;
      opacity: 0.55;
      letter-spacing: 0.01em;
      display: block; /* Force onto its own line */
    }

    .copy-btn {
      opacity: 1;
      margin-top: 2px;
    }
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
