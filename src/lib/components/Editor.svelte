<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { 
    Bold, Italic, Strikethrough, Code, Highlighter, Heading1, Heading2, Heading3,
    List, ListOrdered, ListTodo, Quote, Table, Link2, Image as ImageIcon, Underline,
    Indent, Outdent, Settings, Eye, HelpCircle, Columns, Sparkles, BookOpen, Pen, X
  } from 'lucide-svelte';
  import { marked } from 'marked';

  // State to track if graph view is toggled open on the right
  let { showGraph = $bindable(false) } = $props();

  let autosaveTimer: number | null = null;
  let focusMode = $state(false);
  let activeSidebarTab = $state<'outline' | 'comments'>('outline');
  let showRightSidebar = $state(true);

  // Pane layout states
  let viewMode = $state<'edit' | 'split' | 'preview'>('split');
  let editorWidthPercent = $state(50); // range: 20-80
  let rightSidebarWidth = $state(320); // range: 200-600

  let isResizingSplit = $state(false);
  let isResizingSidebar = $state(false);

  // Resize Split View
  function startSplitResize(e: PointerEvent) {
    e.preventDefault();
    isResizingSplit = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const container = document.querySelector('.editor-panels-container');
    if (!container) return;

    function handlePointerMove(moveEvent: PointerEvent) {
      const rect = container.getBoundingClientRect();
      const percentage = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      editorWidthPercent = Math.max(20, Math.min(80, percentage));
    }

    function handlePointerUp() {
      isResizingSplit = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  // Resize Right Sidebar
  function startSidebarResize(e: PointerEvent) {
    e.preventDefault();
    isResizingSidebar = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const container = document.querySelector('.editor-workspace');
    if (!container) return;

    function handlePointerMove(moveEvent: PointerEvent) {
      const rect = container.getBoundingClientRect();
      const width = rect.right - moveEvent.clientX;
      rightSidebarWidth = Math.max(200, Math.min(600, width));
    }

    function handlePointerUp() {
      isResizingSidebar = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  // Slash commands state
  let showSlashMenu = $state(false);
  let slashQuery = $state('');
  let slashIndex = $state(0);
  let slashPosition = $state({ top: 0, left: 0 });

  const slashCommands = [
    { cmd: '/h1', label: 'Heading 1', desc: 'Large section heading', prefix: '# ' },
    { cmd: '/h2', label: 'Heading 2', desc: 'Medium section heading', prefix: '## ' },
    { cmd: '/h3', label: 'Heading 3', desc: 'Small section heading', prefix: '### ' },
    { cmd: '/todo', label: 'Todo List', desc: 'Task list checkbox', prefix: '- [ ] ' },
    { cmd: '/bullet', label: 'Bullet List', desc: 'Unordered list', prefix: '- ' },
    { cmd: '/number', label: 'Numbered List', desc: 'Sequential list', prefix: '1. ' },
    { cmd: '/code', label: 'Code Block', desc: 'Preformatted code', prefix: '```\n', suffix: '\n```' },
    { cmd: '/table', label: 'Table', desc: 'Markdown data table', prefix: '\n| Col 1 | Col 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n' },
    { cmd: '/quote', label: 'Quote', desc: 'Blockquote text', prefix: '> ' }
  ];

  const filteredCommands = $derived(
    slashCommands.filter(c => c.cmd.toLowerCase().startsWith(slashQuery.toLowerCase()))
  );

  // Outline generation
  const outline = $derived.by(() => {
    const list: Array<{ level: number; text: string; lineIndex: number }> = [];
    const lines = appState.activeNoteContent.split('\n');
    lines.forEach((line, idx) => {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        list.push({ level, text, lineIndex: idx });
      }
    });
    return list;
  });

  // Comments feed mock
  let commentsList = $state<Array<{ author: string; text: string; date: string }>>([
    { author: 'Editor AI', text: 'Structure looks solid. Consider adding a summary section.', date: 'Just now' },
    { author: 'System', text: 'Document initialized successfully.', date: '5 mins ago' }
  ]);
  let newCommentText = $state('');

  function handleAddComment() {
    if (newCommentText.trim()) {
      commentsList = [...commentsList, {
        author: 'You',
        text: newCommentText.trim(),
        date: 'Just now'
      }];
      newCommentText = '';
    }
  }

  function handleContentInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    appState.activeNoteContent = target.value;
    appState.editorDirty = true;

    // Check slash command trigger
    const start = target.selectionStart;
    const text = target.value;
    const lastSlash = text.lastIndexOf('/', start - 1);
    
    if (lastSlash !== -1 && lastSlash >= text.lastIndexOf('\n', start - 1)) {
      showSlashMenu = true;
      slashQuery = text.slice(lastSlash, start);
      
      // Calculate cursor position for float menu
      const rect = target.getBoundingClientRect();
      // Simple rough absolute estimate
      slashPosition = {
        top: Math.min(rect.bottom - 180, rect.top + 80),
        left: Math.min(rect.right - 260, rect.left + 150)
      };
    } else {
      showSlashMenu = false;
    }

    // Reset autosave timer
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(async () => {
      if (appState.editorDirty) {
        await appState.saveActiveNote();
      }
    }, 2000); // 2s debounce autosave
  }

  // Clean up timer on destroy
  $effect(() => {
    return () => {
      if (autosaveTimer) clearTimeout(autosaveTimer);
    };
  });

  // Calculate statistics
  let wordCount = $derived.by(() => {
    const text = appState.activeNoteContent.trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  });

  let charCount = $derived.by(() => {
    return appState.activeNoteContent.length;
  });

  let readTime = $derived.by(() => {
    const wpm = 200; 
    const mins = Math.ceil(wordCount / wpm);
    return `${mins} min read`;
  });

  // Preprocess Markdown & parse with marked
  let previewHtml = $derived.by(() => {
    const md = appState.activeNoteContent;
    if (!md) return '';
    
    let processed = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, path, display) => {
      const displayText = display ? display.trim() : path.trim();
      let targetPath = path.trim();
      if (!targetPath.endsWith('.md')) {
        targetPath += '.md';
      }
      return `<a href="#" class="wikilink" data-path="${encodeURIComponent(targetPath)}">${displayText}</a>`;
    });

    try {
      return marked.parse(processed, { async: false }) as string;
    } catch (e) {
      console.error('Failed to parse Markdown:', e);
      return `<p style="color: var(--semantic-error);">Error rendering preview: ${e}</p>`;
    }
  });

  // Wikilink click navigation handler
  function handlePreviewClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const wikilink = target.closest('.wikilink') as HTMLElement;
    if (wikilink) {
      e.preventDefault();
      const path = decodeURIComponent(wikilink.getAttribute('data-path') || '');
      if (path) {
        let resolvedPath = path;
        if (appState.activeNotePath && appState.activeNotePath.includes('/')) {
          const folder = appState.activeNotePath.substring(0, appState.activeNotePath.lastIndexOf('/'));
          if (!path.startsWith('/')) {
            resolvedPath = `${folder}/${path}`;
          }
        }
        appState.selectNote(resolvedPath);
      }
    }
  }

  // Formatting helpers for Rich Editor toolbar
  function wrapSelection(prefix: string, suffix: string) {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    const selectedText = text.slice(start, end);
    const beforeText = text.slice(0, start);
    const afterText = text.slice(end);
    
    const replacement = prefix + selectedText + suffix;
    appState.activeNoteContent = beforeText + replacement + afterText;
    appState.editorDirty = true;
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length);
    }, 0);
  }

  function toggleLinePrefix(prefix: string) {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    const lastNewline = text.lastIndexOf('\n', start - 1);
    const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
    
    const nextNewline = text.indexOf('\n', end);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    
    const lineText = text.slice(lineStart, lineEnd);
    const beforeText = text.slice(0, lineStart);
    const afterText = text.slice(lineEnd);
    
    let newLineText = lineText;
    if (lineText.startsWith(prefix)) {
      newLineText = lineText.slice(prefix.length);
    } else {
      if (prefix.trim().startsWith('#')) {
        newLineText = lineText.replace(/^#+\s*/, '');
      }
      if (prefix.trim().startsWith('-') || prefix.trim().match(/^\d+\./)) {
        newLineText = lineText.replace(/^([-*+]|\d+\.)\s*/, '');
      }
      newLineText = prefix + newLineText;
    }
    
    appState.activeNoteContent = beforeText + newLineText + afterText;
    appState.editorDirty = true;
    
    setTimeout(() => {
      textarea.focus();
      const newPos = start + (newLineText.length - lineText.length);
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }

  function indentSelection(outdent: boolean) {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const lastNewline = text.lastIndexOf('\n', start - 1);
    const startOfSelectionLine = lastNewline === -1 ? 0 : lastNewline + 1;

    const nextNewline = text.indexOf('\n', end);
    const endOfSelectionLine = nextNewline === -1 ? text.length : nextNewline;

    const linesText = text.slice(startOfSelectionLine, endOfSelectionLine);
    const lines = linesText.split('\n');

    let newLinesText = '';
    if (!outdent) {
      newLinesText = lines.map(line => '  ' + line).join('\n');
    } else {
      newLinesText = lines.map(line => {
        if (line.startsWith('  ')) return line.slice(2);
        if (line.startsWith('\t')) return line.slice(1);
        if (line.startsWith(' ')) return line.slice(1);
        return line;
      }).join('\n');
    }

    const beforeText = text.slice(0, startOfSelectionLine);
    const afterText = text.slice(endOfSelectionLine);
    appState.activeNoteContent = beforeText + newLinesText + afterText;
    appState.editorDirty = true;

    setTimeout(() => {
      textarea.focus();
      const diff = newLinesText.length - linesText.length;
      if (start === end) {
        const newPos = Math.max(startOfSelectionLine, start + (outdent ? Math.max(-2, diff) : 2));
        textarea.setSelectionRange(newPos, newPos);
      } else {
        textarea.setSelectionRange(startOfSelectionLine, endOfSelectionLine + diff);
      }
    }, 0);
  }

  function executeSlashCommand(cmd: typeof slashCommands[0]) {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const text = textarea.value;
    const lastSlash = text.lastIndexOf('/', start - 1);
    
    if (lastSlash !== -1) {
      const beforeText = text.slice(0, lastSlash);
      const afterText = text.slice(start);
      
      const insertText = cmd.prefix + (cmd.suffix || '');
      appState.activeNoteContent = beforeText + insertText + afterText;
      appState.editorDirty = true;
      
      showSlashMenu = false;
      setTimeout(() => {
        textarea.focus();
        const cursorPosition = lastSlash + cmd.prefix.length;
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      }, 0);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const textarea = e.currentTarget as HTMLTextAreaElement;
    const start = textarea.selectionStart;
    const text = textarea.value;

    // Handle Slash Menu Navigation
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashIndex = (slashIndex + 1) % filteredCommands.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashIndex = (slashIndex - 1 + filteredCommands.length) % filteredCommands.length;
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSlashCommand(filteredCommands[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        showSlashMenu = false;
        return;
      }
    }

    // Tab / Shift+Tab for Indent / Outdent
    if (e.key === 'Tab') {
      e.preventDefault();
      indentSelection(e.shiftKey);
      return;
    }

    // List continuation helper on Enter keypress
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const lastNewline = text.lastIndexOf('\n', start - 1);
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      const nextNewline = text.indexOf('\n', start);
      const lineEnd = nextNewline === -1 ? text.length : nextNewline;
      const lineText = text.slice(lineStart, lineEnd);

      const checkboxMatch = lineText.match(/^(\s*)-\s\[[ xX]\]\s*(.*)$/);
      const bulletMatch = lineText.match(/^(\s*)([-*+])\s*(.*)$/);
      const numberMatch = lineText.match(/^(\s*)(\d+)\.\s*(.*)$/);

      // Check if previous line was a list to decide if we should exit on double Enter
      const prefixLines = text.slice(0, lineStart).split('\n');
      const prevLine = prefixLines[prefixLines.length - 2] || '';
      const isPrevLineList = prevLine.match(/^(\s*)(-\s\[[ xX]\]|[-*+]|\d+\.)/) !== null;

      if (checkboxMatch) {
        e.preventDefault();
        const [_, indent, content] = checkboxMatch;
        if (content.trim() === '' && isPrevLineList) {
          const before = text.slice(0, lineStart);
          const after = text.slice(lineEnd);
          appState.activeNoteContent = before + indent + after;
          appState.editorDirty = true;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
          }, 0);
        } else {
          wrapSelection(`\n${indent}- [ ] `, '');
        }
        return;
      }

      if (numberMatch) {
        e.preventDefault();
        const [_, indent, numStr, content] = numberMatch;
        if (content.trim() === '' && isPrevLineList) {
          const before = text.slice(0, lineStart);
          const after = text.slice(lineEnd);
          appState.activeNoteContent = before + indent + after;
          appState.editorDirty = true;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
          }, 0);
        } else {
          const nextNum = parseInt(numStr, 10) + 1;
          wrapSelection(`\n${indent}${nextNum}. `, '');
        }
        return;
      }

      if (bulletMatch) {
        e.preventDefault();
        const [_, indent, bullet, content] = bulletMatch;
        if (content.trim() === '' && isPrevLineList) {
          const before = text.slice(0, lineStart);
          const after = text.slice(lineEnd);
          appState.activeNoteContent = before + indent + after;
          appState.editorDirty = true;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
          }, 0);
        } else {
          wrapSelection(`\n${indent}${bullet} `, '');
        }
        return;
      }
    }
  }

  // Jump to heading line
  function jumpToHeading(lineIndex: number) {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const lines = appState.activeNoteContent.split('\n');
    let charIndex = 0;
    for (let i = 0; i < lineIndex; i++) {
      charIndex += lines[i].length + 1;
    }
    textarea.focus();
    textarea.setSelectionRange(charIndex, charIndex + lines[lineIndex].length);
  }
</script>

<div 
  class="editor-workspace flex-row" 
  class:focus-mode={focusMode}
  class:resizing={isResizingSplit || isResizingSidebar}
>
  <!-- Main Editor Sheet Column -->
  <div class="editor-main-sheet flex-col flex-grow">
    <!-- Format Tool Panel (Google Docs / M3 Style) -->
    <div class="editor-toolbar flex-row">
      <!-- Group 1: Typography -->
      <div class="toolbar-group flex-row">
        <button onclick={() => toggleLinePrefix('# ')} title="Heading 1" class="btn-tool"><Heading1 size={16} /></button>
        <button onclick={() => toggleLinePrefix('## ')} title="Heading 2" class="btn-tool"><Heading2 size={16} /></button>
        <button onclick={() => toggleLinePrefix('### ')} title="Heading 3" class="btn-tool"><Heading3 size={16} /></button>
      </div>
      <span class="toolbar-divider"></span>

      <!-- Group 2: Inline Formatting -->
      <div class="toolbar-group flex-row">
        <button onclick={() => wrapSelection('**', '**')} title="Bold" class="btn-tool"><Bold size={16} /></button>
        <button onclick={() => wrapSelection('*', '*')} title="Italic" class="btn-tool"><Italic size={16} /></button>
        <button onclick={() => wrapSelection('~~', '~~')} title="Strikethrough" class="btn-tool"><Strikethrough size={16} /></button>
        <button onclick={() => wrapSelection('`', '`')} title="Inline Code" class="btn-tool"><Code size={16} /></button>
        <button onclick={() => wrapSelection('<mark>', '</mark>')} title="Highlight" class="btn-tool"><Highlighter size={16} /></button>
      </div>
      <span class="toolbar-divider"></span>

      <!-- Group 3: Lists & Indents -->
      <div class="toolbar-group flex-row">
        <button onclick={() => toggleLinePrefix('- ')} title="Bullet List" class="btn-tool"><List size={16} /></button>
        <button onclick={() => toggleLinePrefix('1. ')} title="Numbered List" class="btn-tool"><ListOrdered size={16} /></button>
        <button onclick={() => toggleLinePrefix('- [ ] ')} title="Task List" class="btn-tool"><ListTodo size={16} /></button>
        <button onclick={() => indentSelection(false)} title="Increase Indent (Tab)" class="btn-tool"><Indent size={16} /></button>
        <button onclick={() => indentSelection(true)} title="Decrease Indent (Shift+Tab)" class="btn-tool"><Outdent size={16} /></button>
      </div>
      <span class="toolbar-divider"></span>

      <!-- Group 4: Insert elements -->
      <div class="toolbar-group flex-row">
        <button onclick={() => wrapSelection('\n> ', '')} title="Quote" class="btn-tool"><Quote size={16} /></button>
        <button onclick={() => wrapSelection('\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n', '')} title="Table" class="btn-tool"><Table size={16} /></button>
        <button onclick={() => wrapSelection('[', '](https://)')} title="Insert Link" class="btn-tool"><Link2 size={16} /></button>
        <button onclick={() => wrapSelection('![alt](', ')')} title="Insert Image" class="btn-tool"><ImageIcon size={16} /></button>
      </div>
      
      <span class="toolbar-spacer flex-grow"></span>

      <!-- Group 5: Segmented viewMode control (Edit / Split / Preview) -->
      <div class="toolbar-group segmented-control flex-row">
        <button 
          class="btn-tool mode-btn" 
          class:active={viewMode === 'edit'} 
          onclick={() => viewMode = 'edit'} 
          title="Edit Source"
        >
          <Pen size={14} />
          <span class="btn-label">Edit</span>
        </button>
        <button 
          class="btn-tool mode-btn" 
          class:active={viewMode === 'split'} 
          onclick={() => viewMode = 'split'} 
          title="Split View"
        >
          <Columns size={14} />
          <span class="btn-label">Split</span>
        </button>
        <button 
          class="btn-tool mode-btn" 
          class:active={viewMode === 'preview'} 
          onclick={() => viewMode = 'preview'} 
          title="Full Preview"
        >
          <Eye size={14} />
          <span class="btn-label">Preview</span>
        </button>
      </div>

      <span class="toolbar-divider"></span>

      <!-- Group 6: Sidebar & Graph toggles -->
      <div class="toolbar-group flex-row">
        <button onclick={() => focusMode = !focusMode} class="btn-tool" class:active={focusMode} title="Toggle Focus Mode">
          👓
        </button>
        <button onclick={() => showGraph = !showGraph} class="btn-tool" class:active={showGraph} title="Toggle Graph View">
          🌐
        </button>
        <button onclick={() => showRightSidebar = !showRightSidebar} class="btn-tool" class:active={showRightSidebar} title="Toggle Outline Sidebar">
          📋
        </button>
      </div>
    </div>

    <!-- Draggable resizable panels workspace -->
    <div class="editor-panels-container view-{viewMode}">
      <!-- Editor Column (visible in 'edit' or 'split') -->
      {#if viewMode === 'edit' || viewMode === 'split'}
        <div class="editor-panel-wrapper" style="width: {viewMode === 'split' ? `${editorWidthPercent}%` : '100%'};">
          <div class="panel-scroller">
            <div class="paper-canvas">
              <textarea 
                class="editor-textarea" 
                value={appState.activeNoteContent} 
                oninput={handleContentInput}
                onkeydown={handleKeyDown}
                placeholder="Start writing... Type / for commands."
              ></textarea>

              <!-- Floating Slash command autocomplete menu -->
              {#if showSlashMenu && filteredCommands.length > 0}
                <div class="slash-commands-dropdown md3-card-filled" style={`top: ${slashPosition.top}px; left: ${slashPosition.left}px;`}>
                  {#each filteredCommands as cmd, idx}
                    <button 
                      class="slash-item" 
                      class:active={idx === slashIndex}
                      onclick={() => executeSlashCommand(cmd)}
                    >
                      <span class="slash-cmd">{cmd.cmd}</span>
                      <div class="slash-meta">
                        <span class="slash-label">{cmd.label}</span>
                        <span class="slash-desc">{cmd.desc}</span>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Resize handle between Editor and Preview (visible in 'split') -->
      {#if viewMode === 'split'}
        <div 
          class="resize-handle split-handle" 
          class:active={isResizingSplit}
          onpointerdown={startSplitResize}
          title="Drag to resize pane"
        ></div>
      {/if}

      <!-- Preview Column (visible in 'preview' or 'split') -->
      {#if viewMode === 'preview' || viewMode === 'split'}
        <div class="preview-panel-wrapper" style="width: {viewMode === 'split' ? `${100 - editorWidthPercent}%` : '100%'};">
          <div class="panel-header flex-row">
            <span class="panel-title">{viewMode === 'split' ? 'Live Preview' : 'Document Preview'}</span>
            {#if viewMode === 'split'}
              <button class="btn-close-panel" onclick={() => viewMode = 'edit'} title="Close Preview Pane">
                <X size={16} />
              </button>
            {:else}
              <button class="btn-close-panel" onclick={() => viewMode = 'edit'} title="Edit Document">
                <Pen size={16} />
              </button>
            {/if}
          </div>
          <div class="panel-scroller">
            <div class="paper-canvas markdown-body" onclick={handlePreviewClick}>
              {@html previewHtml || '<p class="empty-text">Nothing to preview yet...</p>'}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer Stats Bar -->
    <div class="editor-footer-stats flex-row">
      <span>{wordCount} words</span>
      <span>{charCount} characters</span>
      <span>{readTime}</span>
      {#if appState.editorDirty}
        <span class="save-indicator dirty">● Unsaved Changes</span>
      {:else}
        <span class="save-indicator saved">✓ Saved</span>
      {/if}
    </div>
  </div>

  <!-- Resize handle between Main Editor/Preview sheet and Right Sidebar -->
  {#if showRightSidebar}
    <div 
      class="resize-handle sidebar-handle" 
      class:active={isResizingSidebar}
      onpointerdown={startSidebarResize}
      title="Drag to resize sidebar"
    ></div>
  {/if}

  <!-- Right Collapsible Panel Drawer (Outline, Mock Comments) -->
  {#if showRightSidebar}
    <div class="editor-right-sidebar flex-col" style="width: {rightSidebarWidth}px;">
      <div class="sidebar-header-bar flex-row">
        <div class="sidebar-tabs flex-row">
          <button 
            class="sidebar-tab" 
            class:active={activeSidebarTab === 'outline'} 
            onclick={() => activeSidebarTab = 'outline'}
          >
            Outline
          </button>
          <button 
            class="sidebar-tab" 
            class:active={activeSidebarTab === 'comments'} 
            onclick={() => activeSidebarTab = 'comments'}
          >
            Activity
          </button>
        </div>
        <button class="btn-close-panel" onclick={() => showRightSidebar = false} title="Close Side Panel">
          <X size={16} />
        </button>
      </div>

      <div class="sidebar-content flex-grow">
        {#if activeSidebarTab === 'outline'}
          <!-- Document outline -->
          <div class="outline-pane flex-col">
            <h4 class="sidebar-header">Document Map</h4>
            {#if outline.length === 0}
              <p class="empty-text">No headings found. Add `#` titles to populate the outline navigation.</p>
            {:else}
              <div class="outline-list flex-col">
                {#each outline as head}
                  <button 
                    class="outline-item" 
                    style={`padding-left: ${(head.level - 1) * 12 + 8}px;`}
                    onclick={() => jumpToHeading(head.lineIndex)}
                  >
                    {head.text}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else if activeSidebarTab === 'comments'}
          <!-- Activity & comment mocks -->
          <div class="comments-pane flex-col">
            <h4 class="sidebar-header">Review Comments</h4>
            <div class="comments-list flex-col">
              {#each commentsList as comm}
                <div class="comment-card md3-card-filled">
                  <div class="comm-header flex-row">
                    <strong class="comm-author">{comm.author}</strong>
                    <span class="comm-date">{comm.date}</span>
                  </div>
                  <p class="comm-text">{comm.text}</p>
                </div>
              {/each}
            </div>

            <!-- Comment input -->
            <div class="comment-input-row flex-row">
              <input 
                type="text" 
                placeholder="Add audit note..." 
                bind:value={newCommentText}
                onkeydown={(e) => e.key === 'Enter' && handleAddComment()}
                class="comment-input"
              />
              <button class="md3-btn" onclick={handleAddComment}>Post</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .editor-workspace {
    display: flex;
    flex-direction: row;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background-color: var(--bg-base);
    transition: var(--transition-standard);
  }

  /* When resizing, disable transitions for smooth real-time response */
  .editor-workspace.resizing * {
    transition: none !important;
    user-select: none !important;
  }

  .editor-main-sheet {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Formatting Toolbar styling */
  .editor-toolbar {
    height: 48px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-surface);
    padding: 0 16px;
    gap: 4px;
    flex-shrink: 0;
    transition: var(--transition-standard);
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* Segmented View Mode Control (Google M3 Tonal Style) */
  .segmented-control {
    background-color: var(--bg-surface-container-high);
    border-radius: 20px;
    padding: 2px;
    border: 1px solid var(--border-color);
  }

  .segmented-control .mode-btn {
    height: 28px;
    border-radius: 16px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    gap: 6px;
    display: flex;
    align-items: center;
    border: none;
    color: var(--text-secondary);
    background: transparent;
    transition: var(--transition-fast);
  }

  .segmented-control .mode-btn:hover {
    color: var(--text-primary);
    background-color: rgba(120, 120, 120, 0.08);
  }

  .segmented-control .mode-btn.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
    box-shadow: var(--shadow-lvl1);
  }

  .btn-tool {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-s);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .btn-tool:hover {
    background-color: rgba(120, 120, 120, 0.08);
    color: var(--text-primary);
  }

  .btn-tool.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background-color: var(--border-color);
    margin: 0 8px;
    flex-shrink: 0;
  }

  /* Resizable Panels Container */
  .editor-panels-container {
    display: flex;
    flex-direction: row;
    flex-grow: 1;
    overflow: hidden;
    height: 100%;
    position: relative;
    background-color: var(--bg-base);
  }

  .editor-panel-wrapper,
  .preview-panel-wrapper {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    transition: width var(--transition-standard);
  }

  .panel-scroller {
    flex-grow: 1;
    overflow-y: auto;
    padding: 30px 20px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .panel-header {
    height: 40px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-surface-container);
    padding: 0 16px;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .btn-close-panel {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-xs);
    width: 24px;
    height: 24px;
    transition: var(--transition-fast);
  }

  .btn-close-panel:hover {
    background-color: rgba(120, 120, 120, 0.1);
    color: var(--text-primary);
  }

  /* Draggable Resize Handles */
  .resize-handle {
    width: 4px;
    background-color: var(--border-color);
    cursor: col-resize;
    position: relative;
    z-index: 10;
    flex-shrink: 0;
    transition: background-color var(--transition-fast);
  }

  .resize-handle:hover,
  .resize-handle.active {
    background-color: var(--primary);
  }

  /* Grab handles hit area */
  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -6px;
    right: -6px;
    cursor: col-resize;
  }

  /* Paper Canvas Metaphor */
  .paper-canvas {
    width: 100%;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-lvl2);
    display: flex;
    position: relative;
    box-sizing: border-box;
    transition: var(--transition-standard);
  }

  /* View-specific configurations */
  .view-edit .paper-canvas,
  .view-preview .paper-canvas {
    max-width: 800px;
    min-height: 800px;
    padding: 60px 50px;
  }

  .view-split .paper-canvas {
    max-width: 100%;
    min-height: 100%;
    padding: 30px 24px;
    border-radius: var(--radius-s);
  }

  .editor-textarea {
    width: 100%;
    height: 100%;
    resize: none;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 16px;
    line-height: 1.8;
    outline: none;
    box-sizing: border-box;
  }

  /* Floating slash dropdown */
  .slash-commands-dropdown {
    position: fixed;
    width: 250px;
    max-height: 280px;
    overflow-y: auto;
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-lvl4);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    z-index: 1000;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .slash-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: var(--radius-s);
    text-align: left;
    gap: 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .slash-item:hover, .slash-item.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .slash-cmd {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 13px;
    color: var(--primary);
  }

  .slash-item:hover .slash-cmd, .slash-item.active .slash-cmd {
    color: var(--on-primary-container);
  }

  .slash-meta {
    display: flex;
    flex-direction: column;
  }

  .slash-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .slash-item:hover .slash-label, .slash-item.active .slash-label {
    color: var(--on-primary-container);
  }

  .slash-desc {
    font-size: 10px;
    color: var(--text-tertiary);
  }

  /* Footer Stats */
  .editor-footer-stats {
    height: 32px;
    border-top: 1px solid var(--border-color);
    background-color: var(--bg-surface);
    padding: 0 24px;
    gap: 20px;
    font-size: 11px;
    color: var(--text-tertiary);
    font-weight: 600;
    flex-shrink: 0;
  }

  .save-indicator {
    margin-left: auto;
    font-weight: 700;
  }

  .save-indicator.dirty {
    color: var(--semantic-warning);
  }

  .save-indicator.saved {
    color: var(--semantic-success);
  }

  /* Right Sidebar Drawer styling */
  .editor-right-sidebar {
    background-color: var(--bg-surface);
    border-left: 1px solid var(--border-color);
    height: 100%;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    transition: width var(--transition-standard);
  }

  .sidebar-header-bar {
    height: 48px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-surface-container);
    padding: 0 8px 0 16px;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .sidebar-tabs {
    height: 100%;
    display: flex;
    flex-direction: row;
    gap: 16px;
  }

  .sidebar-tab {
    height: 100%;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    background: transparent;
    padding: 0 4px;
    transition: var(--transition-fast);
  }

  .sidebar-tab.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }

  .sidebar-content {
    padding: 20px;
    overflow-y: auto;
  }

  .sidebar-header {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    margin-bottom: 16px;
    font-weight: 700;
  }

  .empty-text {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
  }

  /* Outline list mapping */
  .outline-list {
    gap: 6px;
  }

  .outline-item {
    text-align: left;
    font-size: 13px;
    color: var(--text-secondary);
    padding: 6px 8px;
    border-radius: var(--radius-xs);
    cursor: pointer;
    background: transparent;
    border: none;
    transition: var(--transition-fast);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .outline-item:hover {
    background-color: var(--bg-surface-container);
    color: var(--primary);
  }

  /* Comments Tab styling */
  .comments-pane {
    height: 100%;
    justify-content: space-between;
  }

  .comments-list {
    gap: 12px;
    overflow-y: auto;
    flex-grow: 1;
    margin-bottom: 16px;
  }

  .comment-card {
    padding: 12px;
    border-radius: var(--radius-m);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .comm-header {
    justify-content: space-between;
    font-size: 11px;
  }

  .comm-author {
    color: var(--text-primary);
  }

  .comm-date {
    color: var(--text-tertiary);
  }

  .comm-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .comment-input-row {
    gap: 8px;
    flex-shrink: 0;
  }

  .comment-input {
    flex-grow: 1;
    background-color: var(--bg-surface-container);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text-primary);
  }

  /* HTML Preview Pane */
  .html-preview-pane {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-primary);
    width: 100%;
  }

  /* Focus Mode animations / fades */
  .editor-workspace.focus-mode .editor-toolbar,
  .editor-workspace.focus-mode .editor-footer-stats,
  .editor-workspace.focus-mode .resize-handle,
  .editor-workspace.focus-mode .editor-right-sidebar {
    opacity: 0.05;
  }

  .editor-workspace.focus-mode .editor-toolbar:hover,
  .editor-workspace.focus-mode .editor-footer-stats:hover,
  .editor-workspace.focus-mode .resize-handle:hover,
  .editor-workspace.focus-mode .editor-right-sidebar:hover {
    opacity: 1;
  }

  .editor-workspace.focus-mode .editor-scroller,
  .editor-workspace.focus-mode .panel-scroller {
    background-color: var(--bg-surface);
  }

  .editor-workspace.focus-mode .paper-canvas {
    border-color: transparent;
    box-shadow: none;
  }

  /* Responsive / Mobile Breakpoints */
  @media (max-width: 1000px) {
    .editor-right-sidebar,
    .sidebar-handle {
      display: none !important;
    }
  }

  @media (max-width: 900px) {
    .resize-handle {
      display: none !important;
    }
    .preview-panel-wrapper {
      display: none !important;
    }
    .editor-panel-wrapper {
      width: 100% !important;
    }
    .segmented-control {
      display: none !important;
    }
  }

  @media (max-width: 768px) {
    .view-edit .paper-canvas,
    .view-preview .paper-canvas,
    .view-split .paper-canvas {
      padding: 30px 20px;
      border-radius: 0;
      border: none;
      min-height: 100%;
      box-shadow: none;
    }
    .panel-scroller {
      padding: 0;
    }
    .editor-toolbar {
      overflow-x: auto;
      white-space: nowrap;
      display: flex;
    }
  }
</style>
