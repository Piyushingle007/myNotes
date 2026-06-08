<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { 
    Save, HelpCircle, ArrowLeft, BookOpen, AlertTriangle, Eye, Edit3, Columns,
    Bold, Italic, Strikethrough, Code, Highlighter, Heading1, Heading2, Heading3, Heading4,
    List, ListOrdered, ListTodo, Quote, Terminal, Minus, Table, Link2, Image as ImageIcon, Underline,
    Indent, Outdent, X, Menu, FileText
  } from 'lucide-svelte';
  import { marked } from 'marked';

  let autosaveTimer: number | null = null;

  function handleContentInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    appState.activeNoteContent = target.value;
    appState.editorDirty = true;

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
    const wpm = 200; // average reading speed
    const mins = Math.ceil(wordCount / wpm);
    return `${mins} min read`;
  });

  function handleSaveClick() {
    appState.saveActiveNote(true);
  }

  function handleInsertWikiLink() {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.slice(start, end) || 'NoteTitle';
    
    appState.activeNoteContent = text.slice(0, start) + `[[${selected}]]` + text.slice(end);
    appState.editorDirty = true;
    
    // Set focus back and select text
    textarea.focus();
    setTimeout(() => {
      textarea.setSelectionRange(start + 2, start + 2 + selected.length);
    }, 0);
  }

  // View mode state (Edit, Split, Preview)
  let viewMode = $state<'edit' | 'split' | 'preview'>((localStorage.getItem('mynotes_editor_view_mode') as any) || 'edit');

  function setViewMode(mode: 'edit' | 'split' | 'preview') {
    viewMode = mode;
    localStorage.setItem('mynotes_editor_view_mode', mode);
  }

  // Preprocess Markdown & parse with marked
  let previewHtml = $derived.by(() => {
    const md = appState.activeNoteContent;
    if (!md) return '';
    
    // Preprocess wikilinks: [[Note Title]] or [[Note Title|Display Name]]
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

        const noteExists = appState.notes.some(n => n.path.toLowerCase() === resolvedPath.toLowerCase());
        if (noteExists) {
          appState.selectNote(resolvedPath);
        } else {
          const directMatch = appState.notes.some(n => n.path.toLowerCase() === path.toLowerCase());
          if (directMatch) {
            appState.selectNote(path);
          } else {
            const filenameMatch = appState.notes.find(n => n.name.toLowerCase() === path.replace(/\.md$/, '').toLowerCase());
            if (filenameMatch) {
              appState.selectNote(filenameMatch.path);
            } else {
              // Create new note in the active directory folder
              const folder = appState.activeNotePath && appState.activeNotePath.includes('/')
                ? appState.activeNotePath.substring(0, appState.activeNotePath.lastIndexOf('/'))
                : null;
              appState.createNote(path.replace(/\.md$/, ''), folder);
            }
          }
        }
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
    
    // Refocus and place selection
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
      // Remove other heading prefixes if we are adding a heading
      if (prefix.trim().startsWith('#')) {
        newLineText = lineText.replace(/^#+\s*/, '');
      }
      // Remove other list prefixes if we are adding a list
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
      // Indent: Add 2 spaces to the start of each line
      newLinesText = lines.map(line => '  ' + line).join('\n');
    } else {
      // Outdent: Remove 2 spaces (or 1 tab/space) from the start of each line
      newLinesText = lines.map(line => {
        if (line.startsWith('  ')) {
          return line.slice(2);
        } else if (line.startsWith('\t')) {
          return line.slice(1);
        } else if (line.startsWith(' ')) {
          return line.slice(1);
        }
        return line;
      }).join('\n');
    }

    const beforeText = text.slice(0, startOfSelectionLine);
    const afterText = text.slice(endOfSelectionLine);
    appState.activeNoteContent = beforeText + newLinesText + afterText;
    appState.editorDirty = true;

    // Restore selection/caret position
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

  function insertTable() {
    const tableTemplate = `\n| Column 1 | Column 2 | Column 3 |\n| :--- | :--- | :--- |\n| Row 1 Col 1 | Row 1 Col 2 | Row 1 Col 3 |\n| Row 2 Col 1 | Row 2 Col 2 | Row 2 Col 3 |\n`;
    wrapSelection('', tableTemplate);
  }

  function insertLink() {
    const url = prompt('Enter link URL (e.g., https://example.com):');
    if (url === null) return;
    const text = prompt('Enter link text (optional):') || 'link';
    wrapSelection(`[${text}](${url})`, '');
  }

  function insertImage() {
    const url = prompt('Enter image URL (e.g., https://example.com/image.png):');
    if (url === null) return;
    const alt = prompt('Enter image description (alt text):') || 'image';
    wrapSelection(`![${alt}](${url})`, '');
  }

  // Keyboard Shortcuts Handler bound directly to textarea
  function handleKeyDown(e: KeyboardEvent) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isModifier = isMac ? e.metaKey : e.ctrlKey;

    // Tab / Shift+Tab for Indent / Outdent
    if (e.key === 'Tab') {
      e.preventDefault();
      indentSelection(e.shiftKey);
      return;
    }

    // List continuation helper on Enter keypress
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const textarea = e.currentTarget as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const text = textarea.value;

      // Find current line start and end
      const lastNewline = text.lastIndexOf('\n', start - 1);
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      const nextNewline = text.indexOf('\n', start);
      const lineEnd = nextNewline === -1 ? text.length : nextNewline;
      const lineText = text.slice(lineStart, lineEnd);

      // Match markdown checklist, bullet list, and numbered list prefixes
      const checkboxMatch = lineText.match(/^(\s*)-\s\[[ xX]\]\s*(.*)$/);
      const bulletMatch = lineText.match(/^(\s*)([-*+])\s*(.*)$/);
      const numberMatch = lineText.match(/^(\s*)(\d+)\.\s*(.*)$/);

      if (checkboxMatch) {
        e.preventDefault();
        const [_, indent, content] = checkboxMatch;
        if (content.trim() === '') {
          // Erase checklist prefix if item is empty (exiting list)
          const before = text.slice(0, lineStart);
          const after = text.slice(lineEnd);
          appState.activeNoteContent = before + indent + after;
          appState.editorDirty = true;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
          }, 0);
        } else {
          // Continue checkbox list
          wrapSelection(`\n${indent}- [ ] `, '');
        }
        return;
      }

      if (numberMatch) {
        e.preventDefault();
        const [_, indent, numStr, content] = numberMatch;
        if (content.trim() === '') {
          // Erase numbered prefix if item is empty (exiting list)
          const before = text.slice(0, lineStart);
          const after = text.slice(lineEnd);
          appState.activeNoteContent = before + indent + after;
          appState.editorDirty = true;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
          }, 0);
        } else {
          // Continue numbered list with incremented counter
          const nextNum = parseInt(numStr, 10) + 1;
          wrapSelection(`\n${indent}${nextNum}. `, '');
        }
        return;
      }

      if (bulletMatch) {
        e.preventDefault();
        const [_, indent, bullet, content] = bulletMatch;
        if (content.trim() === '') {
          // Erase bullet prefix if item is empty (exiting list)
          const before = text.slice(0, lineStart);
          const after = text.slice(lineEnd);
          appState.activeNoteContent = before + indent + after;
          appState.editorDirty = true;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
          }, 0);
        } else {
          // Continue bullet list
          wrapSelection(`\n${indent}${bullet} `, '');
        }
        return;
      }
    }

    if (isModifier) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        wrapSelection('**', '**');
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        wrapSelection('*', '*');
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        insertLink();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        wrapSelection('`', '`');
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        wrapSelection('<mark>', '</mark>');
      } else if (e.shiftKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        wrapSelection('~~', '~~');
      } else if (e.altKey && e.key === '1') {
        e.preventDefault();
        toggleLinePrefix('# ');
      } else if (e.altKey && e.key === '2') {
        e.preventDefault();
        toggleLinePrefix('## ');
      } else if (e.altKey && e.key === '3') {
        e.preventDefault();
        toggleLinePrefix('### ');
      } else if (e.altKey && e.key === '4') {
        e.preventDefault();
        toggleLinePrefix('#### ');
      }
    }
  }

  // Floating Selection Toolbar Logic
  let floatingToolbarX = $state(0);
  let floatingToolbarY = $state(0);
  let showFloatingToolbar = $state(false);

  function handleMouseUp(e: MouseEvent | KeyboardEvent) {
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    if (start !== end) {
      if (e instanceof MouseEvent) {
        floatingToolbarX = e.clientX;
        floatingToolbarY = e.clientY - 45;
      } else {
        const rect = textarea.getBoundingClientRect();
        floatingToolbarX = rect.left + rect.width / 2;
        floatingToolbarY = rect.top + 40;
      }
      showFloatingToolbar = true;
    } else {
      showFloatingToolbar = false;
    }
  }

  function handleTextareaBlur() {
    setTimeout(() => {
      showFloatingToolbar = false;
    }, 200);
  }
</script>

<div 
  class="editor-container flex-col" 
  style="display: {appState.editorCollapsed ? 'none' : 'flex'}; min-width: 0;"
>
  {#if appState.activeNote}
    <!-- Editor Header Player Controls -->
    <div class="editor-header flex-row">
      <div class="track-meta flex-col">
        <div class="flex-row" style="gap: 8px; align-items: center;">
          {#if appState.sidebarCollapsed}
            <button 
              onclick={() => appState.setSidebarCollapsed(false)} 
              title="Expand Sidebar"
              aria-label="Expand sidebar"
              style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
              onmouseover={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              <Menu size={16} />
            </button>
          {/if}
          {#if appState.notelistCollapsed}
            <button 
              onclick={() => appState.setNotelistCollapsed(false)} 
              title="Expand Note List"
              aria-label="Expand note list"
              style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
              onmouseover={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onmouseout={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              <FileText size={16} />
            </button>
          {/if}
          <span class="now-editing-lbl">
            NOW EDITING {#if appState.vaultName}• {appState.vaultName.toUpperCase()}{/if}
          </span>
        </div>
        <input 
          type="text" 
          value={appState.activeNoteTitle} 
          class="note-title-input" 
          readonly
        />
      </div>

      <!-- Controls Toolbar -->
      <div class="controls-toolbar flex-row">
        <!-- WikiLink Button -->
        <button 
          class="btn-control flex-row" 
          onclick={handleInsertWikiLink} 
          title="Insert Wiki Link (Ctrl+K)"
        >
          <BookOpen size={18} />
          <span class="btn-label">Link</span>
        </button>



        <!-- Segmented View Toggle -->
        <div class="segmented-control flex-row">
          <button 
            class="btn-segment" 
            class:active={viewMode === 'edit'} 
            onclick={() => setViewMode('edit')}
            title="Edit Mode"
          >
            <Edit3 size={15} />
          </button>
          <button 
            class="btn-segment" 
            class:active={viewMode === 'split'} 
            onclick={() => setViewMode('split')}
            title="Split View"
          >
            <Columns size={15} />
          </button>
          <button 
            class="btn-segment" 
            class:active={viewMode === 'preview'} 
            onclick={() => setViewMode('preview')}
            title="Preview Mode"
          >
            <Eye size={15} />
          </button>
        </div>

        <!-- Circular Play/Save Button -->
        <button 
          class="btn-circle btn-circle-primary save-btn" 
          class:dirty={appState.editorDirty} 
          onclick={handleSaveClick}
          title="Save Note (Ctrl+S)"
          aria-label="Save note"
        >
          <Save size={18} />
        </button>

        <!-- Collapse Editor Button -->
        <button 
          class="btn-circle btn-circle-outline close-editor-btn" 
          onclick={() => appState.setEditorCollapsed(true)}
          title="Close Editor"
          aria-label="Close editor"
          style="background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; transition: all 0.2s; margin-left: 8px; flex-shrink: 0;"
          onmouseover={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
          onmouseout={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          <X size={18} />
        </button>
      </div>
    </div>

    <!-- Formatting Toolbar (Phase 1) -->
    <div class="formatting-toolbar flex-row">
      <!-- Text formats -->
      <button onclick={() => wrapSelection('**', '**')} title="Bold (Ctrl+B)" class="btn-tool">
        <Bold size={15} />
      </button>
      <button onclick={() => wrapSelection('*', '*')} title="Italic (Ctrl+I)" class="btn-tool">
        <Italic size={15} />
      </button>
      <button onclick={() => wrapSelection('~~', '~~')} title="Strikethrough (Ctrl+Shift+X)" class="btn-tool">
        <Strikethrough size={15} />
      </button>
      <button onclick={() => wrapSelection('<u>', '</u>')} title="Underline" class="btn-tool">
        <Underline size={15} />
      </button>
      <button onclick={() => wrapSelection('`', '`')} title="Inline Code (Ctrl+E)" class="btn-tool">
        <Code size={15} />
      </button>
      <button onclick={() => wrapSelection('<mark>', '</mark>')} title="Highlight (Ctrl+H)" class="btn-tool">
        <Highlighter size={15} />
      </button>

      <span class="tool-divider"></span>

      <!-- Headings -->
      <button onclick={() => toggleLinePrefix('# ')} title="Heading 1 (Ctrl+Alt+1)" class="btn-tool">
        <Heading1 size={15} />
      </button>
      <button onclick={() => toggleLinePrefix('## ')} title="Heading 2 (Ctrl+Alt+2)" class="btn-tool">
        <Heading2 size={15} />
      </button>
      <button onclick={() => toggleLinePrefix('### ')} title="Heading 3 (Ctrl+Alt+3)" class="btn-tool">
        <Heading3 size={15} />
      </button>

      <span class="tool-divider"></span>

      <!-- Lists -->
      <button onclick={() => toggleLinePrefix('- ')} title="Bullet List" class="btn-tool">
        <List size={15} />
      </button>
      <button onclick={() => toggleLinePrefix('1. ')} title="Numbered List" class="btn-tool">
        <ListOrdered size={15} />
      </button>
      <button onclick={() => toggleLinePrefix('- [ ] ')} title="Task List" class="btn-tool">
        <ListTodo size={15} />
      </button>
      <button onclick={() => indentSelection(false)} title="Increase Indent (Tab)" class="btn-tool">
        <Indent size={15} />
      </button>
      <button onclick={() => indentSelection(true)} title="Decrease Indent (Shift+Tab)" class="btn-tool">
        <Outdent size={15} />
      </button>

      <span class="tool-divider"></span>

      <!-- Blocks & Elements -->
      <button onclick={() => toggleLinePrefix('> ')} title="Blockquote" class="btn-tool">
        <Quote size={15} />
      </button>
      <button onclick={() => wrapSelection('```\n', '\n```')} title="Code Block" class="btn-tool">
        <Terminal size={15} />
      </button>
      <button onclick={() => wrapSelection('\n---\n', '')} title="Horizontal Rule" class="btn-tool">
        <Minus size={15} />
      </button>
      <button onclick={insertTable} title="Insert Table" class="btn-tool">
        <Table size={15} />
      </button>

      <span class="tool-divider"></span>

      <!-- Media Links -->
      <button onclick={insertLink} title="Insert Link (Ctrl+K)" class="btn-tool">
        <Link2 size={15} />
      </button>
      <button onclick={insertImage} title="Insert Image" class="btn-tool">
        <ImageIcon size={15} />
      </button>
    </div>

    <!-- Textarea Editing Panel / Preview Panel Workspace -->
    <div class="editor-body flex-row">
      {#if viewMode !== 'preview'}
        <div class="editor-pane">
          <textarea 
            class="editor-textarea font-mono" 
            value={appState.activeNoteContent} 
            oninput={handleContentInput}
            onkeydown={handleKeyDown}
            onmouseup={handleMouseUp}
            onkeyup={handleMouseUp}
            onblur={handleTextareaBlur}
            placeholder="Start writing in markdown..."
          ></textarea>
        </div>
      {/if}

      {#if viewMode === 'split'}
        <div class="editor-separator"></div>
      {/if}

      {#if viewMode !== 'edit'}
        <div 
          class="preview-pane markdown-body" 
          onclick={handlePreviewClick}
        >
          {@html previewHtml}
        </div>
      {/if}
    </div>

    <!-- Bottom Player / Status Bar -->
    <div class="editor-footer flex-row">
      <div class="stats-panel flex-row">
        <span class="stat-item">{wordCount} words</span>
        <span class="stat-divider">|</span>
        <span class="stat-item">{charCount} characters</span>
        <span class="stat-divider">|</span>
        <span class="stat-item">{readTime}</span>
      </div>

      <div class="save-status flex-row">
        {#if appState.editorDirty}
          <span class="status-unsaved flex-row">
            <span class="status-dot"></span> Unsaved changes
          </span>
        {:else}
          <span class="status-saved flex-row" style="gap: 8px;">
            <span>Saved locally</span>
            {#if appState.syncEnabled && appState.googleConnected}
              <span class="status-divider">|</span>
              {#if appState.syncStatus === 'syncing'}
                <span class="status-syncing flex-row" style="color: var(--semantic-info); gap: 4px;">
                  <span class="status-dot-syncing"></span> Syncing to Drive ({appState.customDriveFolderName || 'MyNotes'})
                </span>
              {:else if appState.syncStatus === 'error'}
                <span style="color: var(--semantic-error);">Sync Error</span>
              {:else}
                <span style="color: var(--accent);">Synced to Drive ({appState.customDriveFolderName || 'MyNotes'})</span>
              {/if}
            {/if}
          </span>
        {/if}
      </div>
    </div>
  {:else}
    <div class="no-note-selected flex-col" style="position: relative; width: 100%; height: 100%;">
      <div class="flex-row" style="position: absolute; top: 20px; left: 24px; gap: 8px; align-items: center;">
        {#if appState.sidebarCollapsed}
          <button 
            onclick={() => appState.setSidebarCollapsed(false)} 
            title="Expand Sidebar"
            aria-label="Expand sidebar"
            style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 6px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Menu size={18} />
          </button>
        {/if}
        {#if appState.notelistCollapsed}
          <button 
            onclick={() => appState.setNotelistCollapsed(false)} 
            title="Expand Note List"
            aria-label="Expand note list"
            style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 6px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;"
            onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
            onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <FileText size={18} />
          </button>
        {/if}
      </div>
      <button 
        class="close-panel-btn flex-row" 
        onclick={() => appState.setEditorCollapsed(true)} 
        aria-label="Collapse editor"
        style="position: absolute; top: 20px; right: 24px; background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 6px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;"
        onmouseover={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
        onmouseout={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <X size={18} />
      </button>
      <div class="disc-art">📓</div>
      <h2 class="no-note-title">No Note Loaded</h2>
      <p class="no-note-text">Select a note from the list or click "Add Note" to create one.</p>
      <button class="btn-pill btn-pill-primary select-vault-btn" onclick={appState.initSandbox.bind(appState)}>
        Load Local Sandbox
      </button>
    </div>
  {/if}
</div>

{#if showFloatingToolbar}
  <div 
    class="floating-selection-toolbar flex-row" 
    style="left: {floatingToolbarX}px; top: {floatingToolbarY}px;"
  >
    <button onclick={() => wrapSelection('**', '**')} title="Bold" class="btn-float-tool">
      <Bold size={13} />
    </button>
    <button onclick={() => wrapSelection('*', '*')} title="Italic" class="btn-float-tool">
      <Italic size={13} />
    </button>
    <button onclick={() => wrapSelection('~~', '~~')} title="Strikethrough" class="btn-float-tool">
      <Strikethrough size={13} />
    </button>
    <button onclick={() => wrapSelection('`', '`')} title="Inline Code" class="btn-float-tool">
      <Code size={13} />
    </button>
    <button onclick={() => wrapSelection('<mark>', '</mark>')} title="Highlight" class="btn-float-tool">
      <Highlighter size={13} />
    </button>
    <button onclick={insertLink} title="Link" class="btn-float-tool">
      <Link2 size={13} />
    </button>
  </div>
{/if}

<style>
  .editor-container {
    flex-grow: 1;
    height: 100%;
    background-color: var(--bg-base);
    overflow: hidden;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .editor-header {
    height: 80px;
    background-color: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
    padding: 0 24px;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .track-meta {
    gap: 2px;
    overflow: hidden;
    max-width: 50%;
  }

  .now-editing-lbl {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1px;
  }

  .note-title-input {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: transparent;
    border: none;
    outline: none;
    pointer-events: none; /* read-only */
  }

  .controls-toolbar {
    gap: 16px;
  }

  .btn-control {
    color: var(--text-secondary);
    font-weight: 700;
    gap: 6px;
    padding: 8px 12px;
    border-radius: var(--radius-pill);
    transition: color 0.2s, background-color 0.2s;
  }

  .btn-control:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .btn-control.active {
    color: var(--accent);
    background-color: rgba(30, 215, 96, 0.08);
  }

  .btn-label {
    font-size: 12px;
  }

  .save-btn {
    box-shadow: var(--shadow-medium);
  }

  .save-btn.dirty {
    animation: save-glow 2s infinite ease-in-out;
  }

  @keyframes save-glow {
    0%, 100% {
      box-shadow: 0 0 0 0px rgba(30, 215, 96, 0.4);
    }
    50% {
      box-shadow: 0 0 12px 4px rgba(30, 215, 96, 0.6);
    }
  }

  .editor-body {
    flex-grow: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    padding: 16px 24px;
    background-color: var(--bg-base);
  }

  .editor-textarea {
    width: 100%;
    height: 100%;
    resize: none;
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-primary);
    background: transparent;
    border: none;
    outline: none;
  }

  .editor-footer {
    height: 48px;
    background-color: var(--bg-surface);
    border-top: 1px solid var(--border-color);
    padding: 0 24px;
    justify-content: space-between;
    flex-shrink: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .stats-panel {
    gap: 8px;
  }

  .stat-divider {
    color: var(--text-tertiary);
  }

  .save-status {
    gap: 8px;
    font-weight: 500;
  }

  .status-unsaved {
    color: var(--semantic-warning);
    gap: 6px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--semantic-warning);
    display: inline-block;
  }

  .status-saved {
    color: var(--text-tertiary);
  }

  .status-dot-syncing {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--semantic-info);
    display: inline-block;
    animation: sync-pulse 1s infinite alternate;
  }

  @keyframes sync-pulse {
    from { opacity: 0.4; }
    to { opacity: 1; }
  }

  .no-note-selected {
    align-items: center;
    justify-content: center;
    flex-grow: 1;
    gap: 16px;
    text-align: center;
    padding: 32px;
  }

  .disc-art {
    font-size: 64px;
    margin-bottom: 8px;
    animation: float 4s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  .no-note-title {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
  }

  .no-note-text {
    font-size: 13px;
    color: var(--text-secondary);
    max-width: 280px;
    line-height: 1.5;
  }

  .select-vault-btn {
    margin-top: 8px;
  }

  /* Segmented view controls */
  .segmented-control {
    background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    padding: 2px;
    gap: 2px;
    flex-shrink: 0;
  }

  .btn-segment {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    width: 30px;
    height: 30px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.2s, background-color 0.2s;
  }

  .btn-segment:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.03);
  }

  .btn-segment.active {
    color: var(--accent);
    background-color: rgba(255, 255, 255, 0.08);
  }

  /* Split and preview panes */
  .editor-pane {
    flex: 1;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .editor-separator {
    width: 1px;
    height: 100%;
    background-color: var(--border-color);
    margin: 0 16px;
    flex-shrink: 0;
  }

  .preview-pane {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    color: var(--text-primary);
    line-height: 1.6;
    font-size: 14px;
    padding-right: 8px;
  }

  /* Custom markdown renderer elements styling */
  .preview-pane :global(h1), .preview-pane :global(h2), .preview-pane :global(h3), .preview-pane :global(h4), .preview-pane :global(h5), .preview-pane :global(h6) {
    color: var(--text-primary);
    font-weight: 800;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    line-height: 1.35;
  }

  .preview-pane :global(h1) {
    font-size: 24px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 8px;
    margin-top: 0;
  }

  .preview-pane :global(h2) {
    font-size: 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 6px;
  }

  .preview-pane :global(h3) {
    font-size: 15px;
  }

  .preview-pane :global(p) {
    margin-top: 0;
    margin-bottom: 1em;
    font-size: 13.5px;
    color: var(--text-secondary);
  }

  .preview-pane :global(a) {
    color: var(--accent);
    text-decoration: none;
    transition: opacity 0.2s;
  }

  .preview-pane :global(a:hover) {
    opacity: 0.8;
  }

  .preview-pane :global(.wikilink) {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px dashed var(--accent);
    font-weight: 600;
  }

  .preview-pane :global(ul), .preview-pane :global(ol) {
    margin-top: 0;
    margin-bottom: 1em;
    padding-left: 20px;
    color: var(--text-secondary);
    font-size: 13.5px;
  }

  .preview-pane :global(li) {
    margin-bottom: 0.25em;
  }

  .preview-pane :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background-color: rgba(255, 255, 255, 0.05);
    padding: 2px 5px;
    border-radius: 4px;
    color: #e2e8f0;
  }

  .preview-pane :global(pre) {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-medium);
    padding: 14px;
    overflow-x: auto;
    margin-top: 0;
    margin-bottom: 1em;
  }

  .preview-pane :global(pre code) {
    background-color: transparent;
    padding: 0;
    border-radius: 0;
    color: inherit;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .preview-pane :global(blockquote) {
    margin: 0 0 1em 0;
    padding: 4px 0 4px 16px;
    border-left: 3px solid var(--accent);
    color: var(--text-secondary);
    font-style: italic;
    background-color: rgba(255, 255, 255, 0.01);
  }

  .preview-pane :global(hr) {
    height: 1px;
    background-color: var(--border-color);
    border: none;
    margin: 24px 0;
  }

  .preview-pane :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1em;
    font-size: 13px;
  }

  .preview-pane :global(th), .preview-pane :global(td) {
    border: 1px solid var(--border-color);
    padding: 8px 12px;
  }

  .preview-pane :global(th) {
    background-color: rgba(255, 255, 255, 0.03);
    font-weight: 700;
    color: var(--text-primary);
  }

  .preview-pane :global(td) {
    color: var(--text-secondary);
  }

  /* Formatting Toolbar styles */
  .formatting-toolbar {
    height: 40px;
    background-color: var(--bg-surface);
    border-bottom: 1px solid var(--border-color);
    padding: 0 16px;
    gap: 4px;
    flex-shrink: 0;
    overflow-x: auto;
    display: flex;
    align-items: center;
  }

  /* Hide scrollbar for Chrome, Safari and Opera */
  .formatting-toolbar::-webkit-scrollbar {
    display: none;
  }

  /* Hide scrollbar for IE, Edge and Firefox */
  .formatting-toolbar {
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */
  }

  .btn-tool {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-small);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.2s, background-color 0.2s;
    flex-shrink: 0;
  }

  .btn-tool:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .tool-divider {
    width: 1px;
    height: 16px;
    background-color: var(--border-color);
    margin: 0 6px;
    flex-shrink: 0;
  }

  /* Floating Selection Toolbar styles */
  .floating-selection-toolbar {
    position: fixed;
    z-index: 1000;
    background-color: rgba(18, 18, 18, 0.9);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    padding: 3px;
    gap: 2px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -100%);
    animation: fade-in 0.15s ease-out;
  }

  @keyframes fade-in {
    from { opacity: 0; transform: translate(-50%, -90%); }
    to { opacity: 1; transform: translate(-50%, -100%); }
  }

  .btn-float-tool {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    width: 26px;
    height: 26px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
  }

  .btn-float-tool:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.08);
  }
</style>
