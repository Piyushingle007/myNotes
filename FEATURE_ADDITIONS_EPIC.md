# Feature Additions Epic — AI Search, Charts, Dates, CSV, Floating UI

> **Self-contained implementation guide.** An engineer with NO context on this codebase
> can implement any section independently by following it top-to-bottom.

---

## Codebase Overview (Read First)

**Tech Stack:**
- Svelte 5 (runes: `$state`, `$derived`, `$effect`)
- Tiptap 3.x (ProseMirror-based rich text editor)
- Vite bundler
- Capacitor (Android)
- IndexedDB + Google Drive sync

**Key Files:**
| File | Purpose |
|------|---------|
| `src/lib/components/Editor.svelte` | ~7k line editor. Contains slash commands, all Tiptap extensions, save/load logic |
| `src/lib/stores/appState.svelte.ts` | Global state (notes list, search, sync, settings) |
| `src/lib/components/AppLayout.svelte` | Main app layout, sidebar, panels |
| `src/lib/components/SettingsModal.svelte` | User settings UI |
| `src/lib/components/MetricsBlock.svelte` | Calculation/budget blocks |
| `src/lib/components/BudgetView.svelte` | Budget dashboard |
| `src/lib/storage/StorageAdapter.ts` | IndexedDB/FileSystem storage interface |
| `package.json` | Dependencies |
| `vite.config.ts` | Build config |

**Patterns to Follow:**
- Slash commands are defined in `Editor.svelte` function `getSlashCommands()` (~line 1702). Each has: `label`, `description`, `aliases`, `icon` (SVG string), `action`, `category`, `badge?`
- Custom Tiptap nodes follow the `TiptapNode.create({...})` pattern (see `Metrics`, `TldrawBlockExt` etc in Editor.svelte)
- Components use Svelte 5 runes: `let x = $state(...)`, `let y = $derived(...)`, `$effect(() => {...})`
- AppState uses class-based reactive state: `appState.someField` (reactive via `$state`)
- Toast notifications: `appState.showToast(message, type, duration)`
- Prompt dialogs: `appState.showPrompt({ title, message, value, placeholder, onConfirm })`
- Icons use `lucide-svelte`: `import { IconName } from 'lucide-svelte'`

**Build/Check Commands:**
```bash
npm run build    # Production build (must pass)
npm run check    # TypeScript/Svelte check
npm run dev      # Dev server
```

---

## Table of Contents

1. [Transformers.js — AI Features](#1-transformersjs--ai-features)
2. [Chart.js — Data Visualization](#2-chartjs--data-visualization)
3. [chrono-node — Date Intelligence](#3-chrono-node--date-intelligence)
4. [Papa Parse — CSV Integration](#4-papa-parse--csv-integration)
5. [Floating UI — Positioning & Popovers](#5-floating-ui--positioning--popovers)

---

# 1. Transformers.js — AI Features

## 1.0 Install

```bash
npm install @xenova/transformers
```

> **IMPORTANT:** Transformers.js runs ML models in the browser via WASM/WebGPU.
> Models download on first use (~20-80MB each, cached in IndexedDB).
> ALL inference runs in a Web Worker to avoid blocking the UI.

## 1.1 Architecture: AI Service Worker

**Create file: `src/lib/services/AiWorker.ts`**

This is a Web Worker script that loads and runs ML models. The main thread communicates via `postMessage`.

```typescript
// src/lib/services/AiWorker.ts
import { pipeline, env } from '@xenova/transformers';

// Disable local model checks (always use CDN/cache)
env.allowLocalModels = false;

// Cache for loaded pipelines
let embeddingPipeline: any = null;
let classifierPipeline: any = null;
let summarizerPipeline: any = null;

// Message handler
self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  
  try {
    let result: any;
    
    switch (type) {
      case 'embed': {
        // Generate embeddings for text(s)
        if (!embeddingPipeline) {
          self.postMessage({ id, type: 'progress', message: 'Loading embedding model...' });
          embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        }
        const texts: string[] = Array.isArray(payload.texts) ? payload.texts : [payload.texts];
        const output = await embeddingPipeline(texts, { pooling: 'mean', normalize: true });
        // Convert to plain arrays
        result = texts.map((_: any, i: number) => Array.from(output[i].data));
        break;
      }
      
      case 'classify': {
        // Zero-shot classification
        if (!classifierPipeline) {
          self.postMessage({ id, type: 'progress', message: 'Loading classifier model...' });
          classifierPipeline = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
        }
        const { text, labels } = payload;
        result = await classifierPipeline(text, labels);
        break;
      }
      
      case 'summarize': {
        // Text summarization
        if (!summarizerPipeline) {
          self.postMessage({ id, type: 'progress', message: 'Loading summarization model...' });
          summarizerPipeline = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
        }
        const { text: inputText, maxLength } = payload;
        const [summary] = await summarizerPipeline(inputText, {
          max_length: maxLength || 60,
          min_length: 15,
        });
        result = summary.summary_text;
        break;
      }
      
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
    
    self.postMessage({ id, type: 'result', result });
  } catch (error: any) {
    self.postMessage({ id, type: 'error', error: error.message || String(error) });
  }
};
```

**Create file: `src/lib/services/AiService.ts`**

This is the main-thread wrapper that communicates with the worker.

```typescript
// src/lib/services/AiService.ts

type TaskCallback = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onProgress?: (msg: string) => void;
};

class AiService {
  private worker: Worker | null = null;
  private pending = new Map<string, TaskCallback>();
  private idCounter = 0;
  private ready = false;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./AiWorker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.onmessage = (event) => {
        const { id, type, result, error, message } = event.data;
        const cb = this.pending.get(id);
        if (!cb) return;
        if (type === 'progress') {
          cb.onProgress?.(message);
        } else if (type === 'result') {
          this.pending.delete(id);
          cb.resolve(result);
        } else if (type === 'error') {
          this.pending.delete(id);
          cb.reject(new Error(error));
        }
      };
      this.ready = true;
    }
    return this.worker;
  }

  private send(type: string, payload: any, onProgress?: (msg: string) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = String(++this.idCounter);
      this.pending.set(id, { resolve, reject, onProgress });
      this.getWorker().postMessage({ id, type, payload });
    });
  }

  /** Generate embedding vectors for one or more texts. Returns number[][] */
  async embed(texts: string | string[], onProgress?: (msg: string) => void): Promise<number[][]> {
    return this.send('embed', { texts }, onProgress);
  }

  /** Zero-shot classification. Returns { labels: string[], scores: number[] } */
  async classify(text: string, labels: string[], onProgress?: (msg: string) => void): Promise<{ labels: string[]; scores: number[] }> {
    return this.send('classify', { text, labels }, onProgress);
  }

  /** Summarize text. Returns summary string. */
  async summarize(text: string, maxLength?: number, onProgress?: (msg: string) => void): Promise<string> {
    return this.send('summarize', { text, maxLength }, onProgress);
  }

  /** Clean up the worker */
  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export const aiService = new AiService();
```

**Vite config addition** (if needed for worker):

In `vite.config.ts`, ensure worker support is enabled (Vite supports it by default with `new URL(..., import.meta.url)` pattern). No changes needed unless build fails — then add:
```typescript
worker: {
  format: 'es'
}
```

---

## 1.2 Feature: Semantic Search (T1)

**What:** A "Smart Search" toggle next to the existing search. When enabled, finds notes by meaning.

**Files to modify:**
- `src/lib/stores/appState.svelte.ts` — add embedding index, smart search method
- `src/lib/components/AppLayout.svelte` or wherever the search input is rendered — add toggle

**Implementation Steps:**

### Step 1: Add Embedding Index to AppState

In `appState.svelte.ts`, add these fields to the `AppState` class (near other state fields ~line 200):

```typescript
// AI/Semantic search state
smartSearchEnabled = $state<boolean>(false);
smartSearchIndexing = $state<boolean>(false);
smartSearchProgress = $state<string>('');
private noteEmbeddings: Map<string, number[]> = new Map(); // notePath → vector
```

### Step 2: Add Index Building Method

Add this method to `AppState` class:

```typescript
async buildSmartSearchIndex() {
  const { aiService } = await import('../services/AiService');
  this.smartSearchIndexing = true;
  this.smartSearchProgress = 'Starting...';
  
  const notes = this.notes.filter(n => n.path.endsWith('.html'));
  const batchSize = 5;
  
  for (let i = 0; i < notes.length; i += batchSize) {
    const batch = notes.slice(i, i + batchSize);
    const texts = batch.map(n => {
      // Strip HTML, take first 500 chars for embedding
      const text = (n.content || '').replace(/<[^>]+>/g, '').slice(0, 500);
      return text || n.name;
    });
    
    this.smartSearchProgress = `Indexing ${i + batch.length}/${notes.length} notes...`;
    
    try {
      const embeddings = await aiService.embed(texts, (msg) => {
        this.smartSearchProgress = msg;
      });
      batch.forEach((note, j) => {
        this.noteEmbeddings.set(note.path, embeddings[j]);
      });
    } catch (e) {
      console.error('Embedding batch failed:', e);
    }
  }
  
  this.smartSearchIndexing = false;
  this.smartSearchProgress = '';
  this.smartSearchEnabled = true;
}

async smartSearch(query: string): Promise<Array<{ path: string; score: number }>> {
  if (!this.smartSearchEnabled || this.noteEmbeddings.size === 0) return [];
  
  const { aiService } = await import('../services/AiService');
  const [queryVec] = await aiService.embed(query);
  
  // Cosine similarity
  const cosineSim = (a: number[], b: number[]): number => {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-8);
  };
  
  const results: Array<{ path: string; score: number }> = [];
  for (const [path, vec] of this.noteEmbeddings) {
    results.push({ path, score: cosineSim(queryVec, vec) });
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}
```

### Step 3: Add UI Toggle

In the search area of AppLayout.svelte (find the search input), add a small toggle/button:

```svelte
<button 
  class="smart-search-btn"
  class:active={appState.smartSearchEnabled}
  title={appState.smartSearchEnabled ? 'Smart search active' : 'Enable AI-powered search'}
  onclick={() => {
    if (!appState.smartSearchEnabled && !appState.smartSearchIndexing) {
      appState.buildSmartSearchIndex();
    } else {
      appState.smartSearchEnabled = !appState.smartSearchEnabled;
    }
  }}
>
  {#if appState.smartSearchIndexing}
    <span class="spinner-sm"></span>
  {:else}
    <Brain size={14} />
  {/if}
</button>
```

Import `Brain` from `lucide-svelte`.

### Step 4: Integrate with Search Results

In the search handler (find where `searchQuery` is used to filter/search notes), add:

```typescript
// After regular MiniSearch results
if (appState.smartSearchEnabled && query.length > 2) {
  const smartResults = await appState.smartSearch(query);
  // Merge: regular results first, then semantic results not already in the list
  const existingPaths = new Set(regularResults.map(r => r.path));
  const newSmartResults = smartResults
    .filter(r => !existingPaths.has(r.path) && r.score > 0.3)
    .map(r => appState.notes.find(n => n.path === r.path))
    .filter(Boolean);
  finalResults = [...regularResults, ...newSmartResults];
}
```

---

## 1.3 Feature: Auto-Tag Suggestions (T2)

**What:** After saving a note, suggest relevant tags from your existing tag list.

**Files to modify:**
- `src/lib/components/Editor.svelte` — add suggestion UI after save
- Create `src/lib/components/TagSuggestions.svelte` — the suggestion chip bar

**Implementation Steps:**

### Step 1: Create TagSuggestions Component

**Create file: `src/lib/components/TagSuggestions.svelte`**

```svelte
<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { aiService } from '../services/AiService';
  import { X, Sparkles } from 'lucide-svelte';

  interface Props {
    noteContent: string;
    currentTags: string[];
    onAddTag: (tag: string) => void;
  }
  let { noteContent, currentTags, onAddTag }: Props = $props();

  let suggestions = $state<string[]>([]);
  let loading = $state(false);
  let dismissed = $state(false);

  async function generateSuggestions() {
    if (!noteContent || dismissed) return;
    
    // Get all available tags except ones already applied
    const allTags = appState.tagDb?.getAllTags?.()?.map((t: any) => t.name) || [];
    const candidateTags = allTags.filter((t: string) => !currentTags.includes(t));
    if (candidateTags.length === 0) return;
    
    loading = true;
    try {
      const plainText = noteContent.replace(/<[^>]+>/g, '').slice(0, 300);
      const result = await aiService.classify(plainText, candidateTags.slice(0, 10));
      // Take tags with confidence > 0.3
      suggestions = result.labels
        .filter((_: string, i: number) => result.scores[i] > 0.3)
        .slice(0, 3);
    } catch (e) {
      console.error('Tag suggestion failed:', e);
    }
    loading = false;
  }

  $effect(() => {
    if (noteContent && currentTags !== undefined) {
      generateSuggestions();
    }
  });
</script>

{#if suggestions.length > 0 && !dismissed}
  <div class="tag-suggestions">
    <Sparkles size={12} />
    <span class="label">Suggested:</span>
    {#each suggestions as tag}
      <button class="suggestion-chip" onclick={() => { onAddTag(tag); suggestions = suggestions.filter(t => t !== tag); }}>
        #{tag}
      </button>
    {/each}
    <button class="dismiss-btn" onclick={() => { dismissed = true; }}>
      <X size={12} />
    </button>
  </div>
{/if}

<style>
  .tag-suggestions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(99, 102, 241, 0.1);
    border-radius: 6px;
    font-size: 0.75rem;
    margin-top: 8px;
  }
  .label { color: var(--text-muted); }
  .suggestion-chip {
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(99, 102, 241, 0.2);
    border: 1px solid rgba(99, 102, 241, 0.3);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 0.7rem;
  }
  .suggestion-chip:hover { background: rgba(99, 102, 241, 0.3); }
  .dismiss-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
  }
</style>
```

### Step 2: Mount in Editor

In `Editor.svelte`, import and render `TagSuggestions` below the tag input area (find where note tags are displayed/edited in the note info panel). Pass `noteContent`, `currentTags`, and an `onAddTag` callback that updates the note's tags via `updateAttributes` or `appState`.

---

## 1.4 Feature: Summarize Note (T4 modified)

**What:** A slash command `/summarize` or toolbar button that generates a one-sentence summary of the current note and inserts it at cursor (or shows in a popover).

**Files to modify:**
- `src/lib/components/Editor.svelte` — add slash command

### Step 1: Add Slash Command

In `Editor.svelte`, in `getSlashCommands()` (~line 1702), add to the `utility` category:

```typescript
{
  label: 'Summarize Note',
  description: 'Generate an AI summary of this note',
  aliases: ['summarize', 'summary', 'tldr', 'ai summary'],
  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  action: async () => {
    if (!editor) return;
    const content = editor.getHTML().replace(/<[^>]+>/g, '').trim();
    if (content.length < 50) {
      appState.showToast('Note is too short to summarize.', 'info', 3000);
      return;
    }
    appState.showToast('Generating summary...', 'info', 0, undefined, true);
    try {
      const { aiService } = await import('../services/AiService');
      const summary = await aiService.summarize(content.slice(0, 1500), 80);
      editor.chain().focus().insertContent(`<blockquote><p><strong>Summary:</strong> ${summary}</p></blockquote>`).run();
      appState.dismissAllToasts?.();
      appState.showToast('Summary inserted!', 'success', 2000);
    } catch (e: any) {
      appState.dismissAllToasts?.();
      appState.showToast('Summarization failed: ' + (e.message || e), 'error', 4000);
    }
  },
  category: 'utility',
  badge: 'AI'
},
```

---

## 1.5 Feature: Find Action Items (T5)

**What:** A slash command `/extract-tasks` that scans the note and offers to convert action-item sentences into task list items.

**Files to modify:**
- `src/lib/components/Editor.svelte` — add slash command

### Step 1: Add Slash Command

In `getSlashCommands()`, utility category:

```typescript
{
  label: 'Extract Tasks',
  description: 'Find action items in this note and convert to tasks',
  aliases: ['extract tasks', 'find todos', 'action items', 'tasks'],
  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  action: async () => {
    if (!editor) return;
    const content = editor.getHTML().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (content.length < 30) {
      appState.showToast('Note is too short to extract tasks.', 'info', 3000);
      return;
    }
    
    appState.showToast('Scanning for action items...', 'info', 0, undefined, true);
    try {
      const { aiService } = await import('../services/AiService');
      // Split into sentences and classify each
      const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
      const candidates = sentences.filter(s => s.trim().length > 10).slice(0, 20);
      
      const actionItems: string[] = [];
      for (const sentence of candidates) {
        const result = await aiService.classify(sentence.trim(), ['action item or task', 'information or description']);
        if (result.scores[0] > 0.6) {
          actionItems.push(sentence.trim());
        }
      }
      
      appState.dismissAllToasts?.();
      
      if (actionItems.length === 0) {
        appState.showToast('No action items found in this note.', 'info', 3000);
        return;
      }
      
      // Insert as task list at cursor
      const taskListHtml = '<ul data-type="taskList">' + 
        actionItems.map(item => `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${item}</p></div></li>`).join('') +
        '</ul>';
      
      editor.chain().focus().insertContent(taskListHtml).run();
      appState.showToast(`Extracted ${actionItems.length} task(s)!`, 'success', 3000);
    } catch (e: any) {
      appState.dismissAllToasts?.();
      appState.showToast('Task extraction failed: ' + (e.message || e), 'error', 4000);
    }
  },
  category: 'utility',
  badge: 'AI'
},
```

---

# 2. Chart.js — Data Visualization

## 2.0 Install

```bash
npm install chart.js
```

## 2.1 Feature: `/chart` Slash Command Block (C1)

**What:** A new atom node in Tiptap that renders an interactive chart. User edits data inline, picks chart type.

**Files to create:**
- `src/lib/components/ChartBlock.svelte` — the chart renderer/editor component

**Files to modify:**
- `src/lib/components/Editor.svelte` — add `ChartBlockExt` node + slash command

### Step 1: Create ChartBlock Component

**Create file: `src/lib/components/ChartBlock.svelte`**

```svelte
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Writable } from 'svelte/store';
  import { Trash2, Settings, BarChart3, LineChart, PieChart } from 'lucide-svelte';

  interface Props {
    nodeStore: Writable<any>;
    getPos: () => number | null | undefined;
    editor: any;
    updateAttributes: (attrs: any) => void;
  }
  let { nodeStore, getPos, editor, updateAttributes }: Props = $props();

  let chartCanvas: HTMLCanvasElement;
  let chartInstance: any = null;
  let showEditor = $state(true);
  let chartType = $state<'bar' | 'line' | 'pie' | 'doughnut'>($nodeStore.attrs.chartConfig?.type || 'bar');
  let dataText = $state($nodeStore.attrs.chartConfig?.dataText || 'January: 65\nFebruary: 59\nMarch: 80\nApril: 81');
  let chartTitle = $state($nodeStore.attrs.chartConfig?.title || '');

  function parseData(text: string): { labels: string[]; values: number[] } {
    const labels: string[] = [];
    const values: number[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Supports "Label: 123" or "Label, 123" or "Label 123"
      const match = trimmed.match(/^(.+?)\s*[,:]\s*([\d.]+)\s*$/);
      if (match) {
        labels.push(match[1].trim());
        values.push(parseFloat(match[2]));
      }
    }
    return { labels, values };
  }

  function renderChart() {
    if (!chartCanvas) return;
    const { labels, values } = parseData(dataText);
    if (labels.length === 0) return;

    import('chart.js').then(({ Chart, registerables }) => {
      Chart.register(...registerables);
      
      if (chartInstance) {
        chartInstance.destroy();
      }

      const colors = [
        'rgba(99, 102, 241, 0.7)',
        'rgba(236, 72, 153, 0.7)',
        'rgba(34, 197, 94, 0.7)',
        'rgba(251, 146, 60, 0.7)',
        'rgba(14, 165, 233, 0.7)',
        'rgba(168, 85, 247, 0.7)',
        'rgba(245, 158, 11, 0.7)',
        'rgba(20, 184, 166, 0.7)',
      ];

      chartInstance = new Chart(chartCanvas, {
        type: chartType,
        data: {
          labels,
          datasets: [{
            label: chartTitle || 'Data',
            data: values,
            backgroundColor: chartType === 'pie' || chartType === 'doughnut' 
              ? colors.slice(0, labels.length) 
              : colors[0],
            borderColor: chartType === 'pie' || chartType === 'doughnut'
              ? colors.slice(0, labels.length).map(c => c.replace('0.7', '1'))
              : colors[0].replace('0.7', '1'),
            borderWidth: 1,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            title: chartTitle ? { display: true, text: chartTitle, color: '#e0e0e0' } : { display: false },
            legend: { labels: { color: '#a0a0a0' } }
          },
          scales: chartType === 'pie' || chartType === 'doughnut' ? {} : {
            x: { ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.1)' } }
          }
        }
      });
    });
  }

  function saveConfig() {
    const config = { type: chartType, dataText, title: chartTitle };
    updateAttributes({ chartConfig: config });
    showEditor = false;
    tick().then(renderChart);
  }

  function deleteBlock() {
    const pos = getPos();
    if (typeof pos === 'number') {
      editor.chain().focus().deleteRange({ from: pos, to: pos + $nodeStore.node.nodeSize }).run();
    }
  }

  onMount(() => {
    if (dataText && !showEditor) {
      renderChart();
    }
  });

  $effect(() => {
    // Re-render when chart type changes
    if (!showEditor && chartCanvas) {
      renderChart();
    }
  });
</script>

<div class="chart-block" contenteditable="false">
  <div class="chart-header">
    <span class="block-title">Chart</span>
    <div class="actions">
      <button onclick={() => { showEditor = !showEditor; }} title="Edit data">
        <Settings size={14} />
      </button>
      <button onclick={deleteBlock} title="Delete" class="delete">
        <Trash2 size={14} />
      </button>
    </div>
  </div>

  {#if showEditor}
    <div class="chart-editor">
      <div class="type-selector">
        <button class:active={chartType === 'bar'} onclick={() => chartType = 'bar'}><BarChart3 size={14} /> Bar</button>
        <button class:active={chartType === 'line'} onclick={() => chartType = 'line'}><LineChart size={14} /> Line</button>
        <button class:active={chartType === 'pie'} onclick={() => chartType = 'pie'}><PieChart size={14} /> Pie</button>
        <button class:active={chartType === 'doughnut'} onclick={() => chartType = 'doughnut'}><PieChart size={14} /> Donut</button>
      </div>
      <input class="chart-title-input" type="text" placeholder="Chart title (optional)" bind:value={chartTitle} />
      <textarea 
        class="data-input" 
        placeholder="Label: Value (one per line)&#10;e.g. January: 65&#10;February: 59"
        bind:value={dataText}
        rows="6"
      ></textarea>
      <button class="render-btn" onclick={saveConfig}>Render Chart</button>
    </div>
  {:else}
    <div class="chart-container">
      <canvas bind:this={chartCanvas}></canvas>
    </div>
  {/if}
</div>

<style>
  .chart-block {
    margin: 1.5rem 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-surface);
    overflow: hidden;
  }
  .chart-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px;
    background: var(--bg-surface-elevated, #1e2227);
    border-bottom: 1px solid var(--border-color);
  }
  .block-title { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .actions { display: flex; gap: 4px; }
  .actions button { width: 24px; height: 24px; border-radius: 4px; border: none; background: transparent; color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .actions button:hover { background: rgba(255,255,255,0.1); color: var(--text-normal); }
  .actions .delete:hover { background: rgba(255,50,50,0.2); color: #ff5555; }
  .chart-editor { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .type-selector { display: flex; gap: 4px; }
  .type-selector button { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; }
  .type-selector button.active { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.5); color: var(--text-normal); }
  .chart-title-input { padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-normal); font-size: 0.8rem; }
  .data-input { padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-normal); font-size: 0.8rem; font-family: monospace; resize: vertical; }
  .render-btn { padding: 6px 16px; border-radius: 4px; border: none; background: rgba(99,102,241,0.8); color: white; cursor: pointer; font-size: 0.8rem; align-self: flex-start; }
  .render-btn:hover { background: rgba(99,102,241,1); }
  .chart-container { padding: 16px; height: 300px; display: flex; align-items: center; justify-content: center; }
  .chart-container canvas { max-width: 100%; max-height: 100%; }
</style>
```

### Step 2: Add ChartBlockExt to Editor.svelte

In `Editor.svelte`:

1. **Import** at top (~line 48 area):
```typescript
import ChartBlock from './ChartBlock.svelte';
```

2. **Define the node** (near `TldrawBlockExt` definition, ~line 4050 area):

```typescript
const ChartBlockExt = TiptapNode.create({
  name: 'chartBlock',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,
  addAttributes() {
    return {
      chartConfig: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const data = el.getAttribute('data-chart-config');
          try { return data ? JSON.parse(decodeURIComponent(data)) : null; } catch { return null; }
        },
        renderHTML: (attrs) => {
          try { return { 'data-chart-config': encodeURIComponent(JSON.stringify(attrs.chartConfig)) }; } catch { return {}; }
        }
      }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'chart-block-view-container';
      dom.contentEditable = 'false';
      
      let currentNode = node;
      const nodeStore = writable(node);
      
      const component = mount(ChartBlock, {
        target: dom,
        props: {
          nodeStore,
          getPos,
          editor,
          updateAttributes: (attrs: any) => {
            const pos = typeof getPos === 'function' ? getPos() : null;
            if (pos !== null && pos !== undefined) {
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, ...attrs }));
            }
          }
        }
      });
      
      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'chartBlock') return false;
          currentNode = updatedNode;
          nodeStore.set(updatedNode);
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: () => true,
        destroy: () => { unmount(component); }
      };
    };
  }
});
```

3. **Register** in extensions array (~line 6748 area, near `TldrawBlockExt`):
```typescript
ChartBlockExt,
```

4. **Add slash command** in `getSlashCommands()`:
```typescript
{
  label: 'Chart',
  description: 'Insert an interactive chart (bar, line, pie)',
  aliases: ['chart', 'graph', 'visualization', 'bar chart', 'pie chart'],
  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  action: () => editor?.chain().focus().insertContent({ type: 'chartBlock' }).run(),
  category: 'insert',
  badge: 'New'
},
```

---

## 2.2 Feature: Metrics Block Visualization (C2)

**What:** Add a "Visualize" toggle button to existing MetricsBlock that renders a chart from its rows.

**Files to modify:**
- `src/lib/components/MetricsBlock.svelte` — add chart rendering

### Implementation

In `MetricsBlock.svelte`:

1. Add state variable:
```typescript
let showChart = $state(false);
let chartCanvas: HTMLCanvasElement;
```

2. Add a render function:
```typescript
async function renderMetricsChart() {
  if (!chartCanvas) return;
  const { Chart, registerables } = await import('chart.js');
  Chart.register(...registerables);
  
  // rows is already a reactive state: Array<{ id, checked, label, tagIds }>
  // Parse numeric values from labels (format is typically "Description: $amount" or just numbers)
  const labels: string[] = [];
  const values: number[] = [];
  
  for (const row of rows) {
    const nums = getRowNumbers(row.label);
    if (nums.length > 0) {
      labels.push(getCleanDescription(row.label) || row.label.slice(0, 20));
      values.push(nums[0]);
    }
  }
  
  if (labels.length === 0) return;
  
  new Chart(chartCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Values', data: values, backgroundColor: 'rgba(99, 102, 241, 0.7)' }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#a0a0a0' } },
        y: { ticks: { color: '#a0a0a0' } }
      }
    }
  });
}
```

3. Add toggle button in the header (next to existing buttons):
```svelte
<button onclick={() => { showChart = !showChart; if (showChart) tick().then(renderMetricsChart); }} title="Visualize">
  <BarChart3 size={14} />
</button>
```

4. Add chart container in the template (below the rows list):
```svelte
{#if showChart}
  <div class="metrics-chart" style="padding: 12px; height: 200px;">
    <canvas bind:this={chartCanvas}></canvas>
  </div>
{/if}
```

---

## 2.3 Feature: Budget Dashboard Charts (C3)

**What:** Show spending pie chart and trend line chart in BudgetView.

**Files to modify:**
- `src/lib/components/BudgetView.svelte`

### Implementation

Add two chart canvases at the top of the budget panel that render from the already-computed budget data. The `BudgetAggregator` already produces category totals — feed those into Chart.js pie/bar charts.

1. Import Chart.js lazily in BudgetView.svelte
2. After the existing data derivation, add a `$effect` that renders charts when data changes
3. Add canvas elements in the template above the category list

```typescript
let pieCanvas: HTMLCanvasElement;
let trendCanvas: HTMLCanvasElement;

$effect(() => {
  // Render charts when budget data changes
  if (pieCanvas && categoryData.length > 0) {
    renderBudgetCharts();
  }
});

async function renderBudgetCharts() {
  const { Chart, registerables } = await import('chart.js');
  Chart.register(...registerables);
  // ... render pie from categories, line from monthly trends
}
```

---

## 2.4 Feature: Inline Sparklines (C4)

**What:** Tiny inline SVG sparklines. Slash command `/sparkline`.

**Files to modify:**
- `src/lib/components/Editor.svelte` — add inline node + slash command

### Implementation

Create a simple inline Tiptap node that stores comma-separated numbers and renders as a tiny SVG:

```typescript
const SparklineNode = TiptapNode.create({
  name: 'sparkline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      data: { default: '10,20,15,30,25' }
    };
  },
  parseHTML() { return [{ tag: 'span[data-type="sparkline"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'sparkline' })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'sparkline-inline';
      dom.contentEditable = 'false';
      
      const values = node.attrs.data.split(',').map(Number).filter(n => !isNaN(n));
      if (values.length > 1) {
        const w = 60, h = 18;
        const max = Math.max(...values), min = Math.min(...values);
        const range = max - min || 1;
        const points = values.map((v, i) => 
          `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`
        ).join(' ');
        dom.innerHTML = `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${points}" fill="none" stroke="rgb(99,102,241)" stroke-width="1.5"/></svg>`;
      }
      
      return { dom };
    };
  }
});
```

Register in extensions array and add slash command:
```typescript
{
  label: 'Sparkline',
  description: 'Tiny inline chart from comma-separated numbers',
  aliases: ['sparkline', 'mini chart', 'inline chart'],
  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 18 8 12 12 16 16 8 20 14"/></svg>',
  action: () => {
    appState.showPrompt({
      title: 'Sparkline Data',
      message: 'Enter comma-separated numbers:',
      value: '10, 20, 15, 30, 25, 22, 35',
      placeholder: '10, 20, 30...',
      onConfirm: (data) => {
        editor?.chain().focus().insertContent({ type: 'sparkline', attrs: { data } }).run();
      }
    });
  },
  category: 'insert'
},
```

---

## 2.5 Feature: Chart from Table (C5)

**What:** Select a table → right-click or bubble menu button → "Visualize as chart" → inserts a chart block below.

**Files to modify:**
- `src/lib/components/Editor.svelte` — add to bubble menu or table context actions

### Implementation

Add a utility function that reads the selected table node, extracts columns, and inserts a chartBlock after it:

```typescript
function visualizeSelectedTable() {
  if (!editor) return;
  const { selection } = editor.state;
  // Find the table node
  let tableNode: any = null;
  let tablePos = 0;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name === 'table' && !tableNode) {
      tableNode = node;
      tablePos = pos;
    }
  });
  if (!tableNode) {
    appState.showToast('Select a table first.', 'info', 3000);
    return;
  }
  
  // Extract data: first column = labels, second column = values
  const rows: string[][] = [];
  tableNode.forEach((row: any) => {
    const cells: string[] = [];
    row.forEach((cell: any) => {
      cells.push(cell.textContent || '');
    });
    rows.push(cells);
  });
  
  if (rows.length < 2) return;
  
  // Skip header row, use col 0 as labels, col 1 as values
  const dataLines = rows.slice(1)
    .filter(r => r.length >= 2 && !isNaN(parseFloat(r[1])))
    .map(r => `${r[0]}: ${r[1]}`)
    .join('\n');
  
  // Insert chart block after the table
  const insertPos = tablePos + tableNode.nodeSize;
  editor.chain().focus()
    .insertContentAt(insertPos, { type: 'chartBlock', attrs: { chartConfig: { type: 'bar', dataText: dataLines, title: '' } } })
    .run();
}
```

Add as slash command or toolbar action.

---

# 3. chrono-node — Date Intelligence

## 3.0 Install

```bash
npm install chrono-node
```

## 3.1 Feature: Inline Date Detection (D1)

**What:** Automatically highlight natural dates in text with styled chips showing resolved dates.

**Files to modify:**
- `src/lib/components/Editor.svelte` — add ProseMirror decoration plugin

### Implementation

Create a ProseMirror plugin that runs `chrono.parse()` on text nodes and applies decorations:

```typescript
import * as chrono from 'chrono-node';

const DateHighlightPlugin = Extension.create({
  name: 'dateHighlight',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('dateHighlight'),
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            const results = chrono.parse(node.text);
            for (const result of results) {
              const from = pos + result.index;
              const to = from + result.text.length;
              const resolved = result.start.date();
              const dateStr = resolved.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
              decorations.push(Decoration.inline(from, to, {
                class: 'date-highlight',
                'data-date': dateStr,
                title: dateStr
              }));
            }
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })];
  }
});
```

Register in extensions array. Add CSS:
```css
.date-highlight {
  background: rgba(251, 146, 60, 0.15);
  border-radius: 3px;
  padding: 0 2px;
  border-bottom: 1px dashed rgba(251, 146, 60, 0.5);
  cursor: help;
}
```

---

## 3.2 Feature: Task Due Dates (D2)

**What:** Parse dates in TaskItem text, show as badge, highlight overdue.

**Files to modify:**
- `src/lib/components/Editor.svelte` — extend TaskItem rendering or add a decoration

### Implementation

Add a decoration plugin that finds TaskItem nodes containing date text:

```typescript
const TaskDueDatePlugin = Extension.create({
  name: 'taskDueDate',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('taskDueDate'),
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return;
            const text = node.textContent;
            const results = chrono.parse(text);
            if (results.length > 0) {
              const dueDate = results[0].start.date();
              const isOverdue = dueDate < new Date() && node.attrs.checked !== true;
              // Add widget decoration at the end of the task item
              const endPos = pos + node.nodeSize - 1;
              decorations.push(Decoration.widget(endPos, () => {
                const badge = document.createElement('span');
                badge.className = `task-due-badge ${isOverdue ? 'overdue' : ''}`;
                badge.textContent = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return badge;
              }));
            }
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })];
  }
});
```

CSS:
```css
.task-due-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.15);
  color: rgba(99, 102, 241, 0.9);
  margin-left: 8px;
}
.task-due-badge.overdue {
  background: rgba(239, 68, 68, 0.15);
  color: rgba(239, 68, 68, 0.9);
}
```

---

## 3.3 Feature: Reminders (D3)

**What:** `/remind` slash command that schedules a local notification.

**Files to create:**
- `src/lib/services/ReminderService.ts`

**Files to modify:**
- `src/lib/components/Editor.svelte` — add slash command

### Step 1: ReminderService

**Create file: `src/lib/services/ReminderService.ts`**

```typescript
export interface Reminder {
  id: string;
  noteTitle: string;
  notePath: string;
  message: string;
  triggerAt: number; // timestamp
  fired: boolean;
}

class ReminderService {
  private reminders: Reminder[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.load();
    this.scheduleAll();
  }

  private load() {
    try {
      this.reminders = JSON.parse(localStorage.getItem('mynotes_reminders') || '[]');
    } catch { this.reminders = []; }
  }

  private save() {
    localStorage.setItem('mynotes_reminders', JSON.stringify(this.reminders));
  }

  add(reminder: Omit<Reminder, 'id' | 'fired'>) {
    const r: Reminder = { ...reminder, id: crypto.randomUUID(), fired: false };
    this.reminders.push(r);
    this.save();
    this.schedule(r);
    return r;
  }

  private schedule(r: Reminder) {
    const delay = r.triggerAt - Date.now();
    if (delay <= 0) {
      this.fire(r);
      return;
    }
    const timer = setTimeout(() => this.fire(r), Math.min(delay, 2147483647));
    this.timers.set(r.id, timer);
  }

  private scheduleAll() {
    for (const r of this.reminders) {
      if (!r.fired) this.schedule(r);
    }
  }

  private fire(r: Reminder) {
    r.fired = true;
    this.save();
    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification(`Reminder: ${r.noteTitle}`, { body: r.message });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') {
          new Notification(`Reminder: ${r.noteTitle}`, { body: r.message });
        }
      });
    }
  }

  getActive(): Reminder[] {
    return this.reminders.filter(r => !r.fired);
  }

  remove(id: string) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.reminders = this.reminders.filter(r => r.id !== id);
    this.save();
  }
}

export const reminderService = new ReminderService();
```

### Step 2: Slash Command

In `getSlashCommands()`:

```typescript
{
  label: 'Remind',
  description: 'Set a reminder for this note',
  aliases: ['remind', 'reminder', 'notify', 'alarm'],
  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  action: () => {
    appState.showPrompt({
      title: 'Set Reminder',
      message: 'When should I remind you? (e.g. "tomorrow 9am", "in 2 hours", "next friday")',
      value: '',
      placeholder: 'tomorrow 9am',
      onConfirm: async (dateText) => {
        const chrono = await import('chrono-node');
        const parsed = chrono.parseDate(dateText);
        if (!parsed) {
          appState.showToast('Could not understand that date. Try "tomorrow 9am" or "in 3 hours".', 'error', 4000);
          return;
        }
        const { reminderService } = await import('../services/ReminderService');
        reminderService.add({
          noteTitle: $activeNote?.meta?.title || 'Untitled',
          notePath: $activeNotePath || '',
          message: `Check note: ${$activeNote?.meta?.title || 'Untitled'}`,
          triggerAt: parsed.getTime()
        });
        // Request notification permission
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        appState.showToast(`Reminder set for ${parsed.toLocaleString()}`, 'success', 4000);
      }
    });
  },
  category: 'utility'
},
```

---

## 3.4 Feature: Timeline View (D4)

**What:** A panel showing all notes/tasks on a timeline by their dates.

**Files to create:**
- `src/lib/components/TimelineView.svelte`

**Files to modify:**
- `src/lib/components/AppLayout.svelte` — add panel/tab

### Implementation

Create `TimelineView.svelte` that:
1. Scans all notes' content with `chrono.parse()` to find dates
2. Groups notes by date
3. Renders a vertical timeline with date markers and note cards
4. Click a card → navigates to the note

```svelte
<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { onMount } from 'svelte';
  import { Calendar, FileText } from 'lucide-svelte';

  interface TimelineEntry {
    date: Date;
    notePath: string;
    noteTitle: string;
    context: string; // the sentence containing the date
  }

  let entries = $state<TimelineEntry[]>([]);
  let loading = $state(true);

  onMount(async () => {
    const chrono = await import('chrono-node');
    const results: TimelineEntry[] = [];
    
    for (const note of appState.notes) {
      if (!note.content) continue;
      const plainText = note.content.replace(/<[^>]+>/g, ' ').slice(0, 2000);
      const parsed = chrono.parse(plainText);
      for (const result of parsed) {
        results.push({
          date: result.start.date(),
          notePath: note.path,
          noteTitle: note.name,
          context: result.text
        });
      }
    }
    
    entries = results.sort((a, b) => a.date.getTime() - b.date.getTime());
    loading = false;
  });
</script>

<!-- Render vertical timeline UI -->
```

Register in AppLayout as a panel option (similar to GraphView).

---

## 3.5 Feature: "On This Day" (D5)

**What:** Show notes created on this date in previous years on the home screen.

**Files to modify:**
- `src/lib/components/AppLayout.svelte` — add card to home/empty state

### Implementation

Simple derived state that filters notes by creation date matching today's month+day:

```typescript
let onThisDayNotes = $derived(() => {
  const today = new Date();
  const month = today.getMonth();
  const day = today.getDate();
  return appState.notes.filter(n => {
    const created = new Date(n.created || 0);
    return created.getMonth() === month && created.getDate() === day && created.getFullYear() < today.getFullYear();
  });
});
```

Render as a small card if results exist.

---

# 4. Papa Parse — CSV Integration

## 4.0 Install

```bash
npm install papaparse
npm install -D @types/papaparse
```

## 4.1 Feature: Paste CSV → Auto Table (P1)

**What:** Detect CSV/TSV paste → offer to convert to table.

**Files to modify:**
- `src/lib/components/Editor.svelte` — modify `handlePaste` / `transformPastedHTML`

### Implementation

In Editor.svelte, find the `handlePaste` prop in editorProps (or the `handleFilePaste` function). Add CSV detection:

```typescript
// In editorProps.handleDOMEvents or a custom paste handler:
// After checking for files, check for CSV text:

const text = event.clipboardData?.getData('text/plain') || '';
if (text && looksLikeCsv(text)) {
  event.preventDefault();
  import('papaparse').then(({ default: Papa }) => {
    const result = Papa.parse(text.trim(), { header: false });
    if (result.data && result.data.length >= 2) {
      // Ask user
      appState.showPrompt({
        title: 'Tabular Data Detected',
        message: `Paste as table (${result.data.length} rows)?`,
        value: 'yes',
        placeholder: '',
        onConfirm: () => {
          const rows = result.data as string[][];
          const headerRow = rows[0];
          const tableHtml = `<table><thead><tr>${headerRow.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
          editor?.chain().focus().insertContent(tableHtml).run();
        }
      });
    }
  });
  return true;
}

function looksLikeCsv(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;
  // Check if most lines have consistent comma/tab separators
  const commaCount = lines[0].split(',').length;
  const tabCount = lines[0].split('\t').length;
  if (commaCount < 2 && tabCount < 2) return false;
  const separator = tabCount > commaCount ? '\t' : ',';
  const firstCount = lines[0].split(separator).length;
  return lines.slice(1, 5).every(l => Math.abs(l.split(separator).length - firstCount) <= 1);
}
```

---

## 4.2 Feature: Import CSV File (P2)

**What:** File picker or drag-drop `.csv` → creates new note with table.

**Files to modify:**
- `src/lib/components/AppLayout.svelte` or Sidebar — add import option

### Implementation

Add to the "New Note" area or import menu:

```typescript
async function importCsvFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.tsv';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const Papa = (await import('papaparse')).default;
    const result = Papa.parse(text, { header: false });
    const rows = result.data as string[][];
    
    if (rows.length < 1) {
      appState.showToast('CSV file is empty.', 'error', 3000);
      return;
    }
    
    const title = file.name.replace(/\.(csv|tsv)$/i, '');
    const headerRow = rows[0];
    const tableHtml = `<table><thead><tr>${headerRow.map(h => `<th>${h || ''}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map(c => `<td>${c || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const bodyHtml = `<h1>${title}</h1>${tableHtml}`;
    
    await appState.createNote(title);
    // After note is created and selected, set its content
    // (createNote already selects it, then loadNote will fire)
  };
  input.click();
}
```

---

## 4.3 Feature: Export Table as CSV (P3)

**What:** Right-click table → "Export as CSV" downloads a file.

**Files to modify:**
- `src/lib/components/Editor.svelte` — add to table context/bubble menu

### Implementation

Add a utility function:

```typescript
async function exportTableAsCsv() {
  if (!editor) return;
  const { selection } = editor.state;
  let tableNode: any = null;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.type.name === 'table') tableNode = node;
  });
  if (!tableNode) {
    appState.showToast('Select a table first.', 'info', 3000);
    return;
  }
  
  const rows: string[][] = [];
  tableNode.forEach((row: any) => {
    const cells: string[] = [];
    row.forEach((cell: any) => { cells.push(cell.textContent || ''); });
    rows.push(cells);
  });
  
  const Papa = (await import('papaparse')).default;
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `table-export-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  appState.showToast('Table exported as CSV!', 'success', 2000);
}
```

Add as slash command or table bubble menu action.

---

## 4.4 Feature: CSV Data for Charts (P4)

**What:** In the ChartBlock editor, add a "Paste CSV" button that auto-fills the data textarea.

**Files to modify:**
- `src/lib/components/ChartBlock.svelte`

### Implementation

Add button in the chart editor panel:

```svelte
<button class="csv-import-btn" onclick={importCsvForChart}>📋 Paste CSV</button>
```

```typescript
async function importCsvForChart() {
  const text = await navigator.clipboard.readText();
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse(text.trim(), { header: false });
  const rows = result.data as string[][];
  
  if (rows.length < 1) {
    // fallback: prompt
    return;
  }
  
  // Convert to "Label: Value" format
  dataText = rows
    .filter(r => r.length >= 2 && !isNaN(parseFloat(r[1])))
    .map(r => `${r[0]}: ${r[1]}`)
    .join('\n');
}
```

---

# 5. Floating UI — Positioning & Popovers

## 5.0 Install

```bash
npm install @floating-ui/dom
```

## 5.1 Feature: Link Preview Popover (F1)

**What:** Hover over wiki-links or URLs → rich preview popover.

**Files to create:**
- `src/lib/components/LinkPreview.svelte`

**Files to modify:**
- `src/lib/components/Editor.svelte` — add hover handler

### Step 1: Create LinkPreview Component

**Create file: `src/lib/components/LinkPreview.svelte`**

```svelte
<script lang="ts">
  import { computePosition, offset, flip, shift } from '@floating-ui/dom';
  import { appState, parseHtmlMetadata } from '../stores/appState.svelte';
  import { onMount } from 'svelte';

  interface Props {
    targetElement: HTMLElement;
    href: string;
    onDismiss: () => void;
  }
  let { targetElement, href, onDismiss }: Props = $props();

  let popover: HTMLDivElement;
  let previewTitle = $state('');
  let previewContent = $state('');
  let visible = $state(false);

  onMount(() => {
    // Resolve the link
    if (href.startsWith('[[') || !href.startsWith('http')) {
      // Wiki-link or internal link — find the note
      const linkText = href.replace(/^\[\[|\]\]$/g, '');
      const note = appState.notes.find(n => 
        n.name.toLowerCase() === linkText.toLowerCase() ||
        n.path.toLowerCase().includes(linkText.toLowerCase())
      );
      if (note) {
        const parsed = parseHtmlMetadata(note.content || '');
        previewTitle = note.name;
        previewContent = (parsed.content || '').replace(/<[^>]+>/g, '').slice(0, 200) + '...';
      }
    } else {
      previewTitle = href;
      previewContent = 'External link';
    }

    // Position with Floating UI
    computePosition(targetElement, popover, {
      placement: 'top',
      middleware: [offset(8), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      popover.style.left = `${x}px`;
      popover.style.top = `${y}px`;
      visible = true;
    });
  });
</script>

<div 
  bind:this={popover} 
  class="link-preview-popover"
  class:visible
  onmouseleave={onDismiss}
>
  {#if previewTitle}
    <div class="preview-title">{previewTitle}</div>
    <div class="preview-content">{previewContent}</div>
  {/if}
</div>

<style>
  .link-preview-popover {
    position: absolute;
    z-index: 9999;
    max-width: 300px;
    padding: 10px 14px;
    background: var(--bg-surface-elevated, #1e2227);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: auto;
  }
  .link-preview-popover.visible { opacity: 1; }
  .preview-title { font-weight: 600; font-size: 0.85rem; color: var(--text-normal); margin-bottom: 4px; }
  .preview-content { font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; }
</style>
```

### Step 2: Add Hover Handler in Editor

In Editor.svelte, add a mouseover handler (either in `editorProps.handleDOMEvents` or as a separate event listener on the editor container):

```typescript
// In editorProps.handleDOMEvents:
mouseover: (view, event) => {
  const target = event.target as HTMLElement;
  const link = target.closest('a, [data-type="wikiLink"]');
  if (!link) return false;
  
  // Debounce to avoid flicker
  clearTimeout(linkPreviewTimer);
  linkPreviewTimer = setTimeout(() => {
    const href = link.getAttribute('href') || link.textContent || '';
    showLinkPreview(link as HTMLElement, href);
  }, 400);
  return false;
},
mouseout: (view, event) => {
  const target = event.target as HTMLElement;
  if (target.closest('a, [data-type="wikiLink"]')) {
    clearTimeout(linkPreviewTimer);
    hideLinkPreview();
  }
  return false;
},
```

---

## 5.2 Feature: Better Slash Command Positioning (F2)

**What:** Replace manual positioning of slash command menu with Floating UI.

**Files to modify:**
- `src/lib/components/Editor.svelte` — find slash menu positioning logic

### Implementation

Find where `slashMenuCoords` or similar is calculated (search for how the slash command popup is positioned). Replace with:

```typescript
import { computePosition, offset, flip, shift, size } from '@floating-ui/dom';

// When showing slash menu:
async function positionSlashMenu() {
  const { from } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);
  
  // Create a virtual reference element at cursor position
  const virtualRef = {
    getBoundingClientRect: () => ({
      x: coords.left,
      y: coords.top,
      top: coords.top,
      left: coords.left,
      bottom: coords.bottom,
      right: coords.left,
      width: 0,
      height: coords.bottom - coords.top,
      toJSON: () => {}
    })
  };
  
  const { x, y } = await computePosition(virtualRef, slashMenuElement, {
    placement: 'bottom-start',
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ['top-start'] }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight }) {
          Object.assign(slashMenuElement.style, {
            maxHeight: `${Math.min(availableHeight - 16, 320)}px`
          });
        }
      })
    ]
  });
  
  slashMenuElement.style.left = `${x}px`;
  slashMenuElement.style.top = `${y}px`;
}
```

---

## 5.3 Feature: Tooltip System (F3)

**What:** A reusable Tooltip component using Floating UI.

**Files to create:**
- `src/lib/components/Tooltip.svelte`

### Implementation

**Create file: `src/lib/components/Tooltip.svelte`**

```svelte
<script lang="ts">
  import { computePosition, offset, flip, shift, arrow as arrowMiddleware } from '@floating-ui/dom';

  interface Props {
    text: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    children: any;
  }
  let { text, placement = 'top', children }: Props = $props();

  let triggerEl: HTMLElement;
  let tooltipEl: HTMLDivElement;
  let arrowEl: HTMLDivElement;
  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  function show() {
    timer = setTimeout(async () => {
      visible = true;
      await computePosition(triggerEl, tooltipEl, {
        placement,
        middleware: [offset(8), flip(), shift({ padding: 4 }), arrowMiddleware({ element: arrowEl })]
      }).then(({ x, y, middlewareData }) => {
        tooltipEl.style.left = `${x}px`;
        tooltipEl.style.top = `${y}px`;
        if (middlewareData.arrow) {
          const { x: ax, y: ay } = middlewareData.arrow;
          arrowEl.style.left = ax != null ? `${ax}px` : '';
          arrowEl.style.top = ay != null ? `${ay}px` : '';
        }
      });
    }, 500);
  }

  function hide() {
    clearTimeout(timer);
    visible = false;
  }
</script>

<span bind:this={triggerEl} onmouseenter={show} onmouseleave={hide} onfocusin={show} onfocusout={hide}>
  {@render children()}
</span>

{#if visible}
  <div bind:this={tooltipEl} class="tooltip-floating" role="tooltip">
    {text}
    <div bind:this={arrowEl} class="tooltip-arrow"></div>
  </div>
{/if}

<style>
  .tooltip-floating {
    position: absolute;
    z-index: 99999;
    padding: 4px 8px;
    background: #1a1a2e;
    color: #e0e0e0;
    border-radius: 4px;
    font-size: 0.7rem;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .tooltip-arrow {
    position: absolute;
    width: 6px;
    height: 6px;
    background: #1a1a2e;
    transform: rotate(45deg);
  }
</style>
```

Usage: `<Tooltip text="Bold (Cmd+B)"><button>B</button></Tooltip>`

---

## 5.4 Feature: Context-Specific Toolbar (F4)

**What:** A floating toolbar that appears near specific nodes (images, tables, code blocks) with relevant actions.

### Implementation

Use Floating UI to position a contextual action bar near the currently selected node. Detect node type from ProseMirror selection, show appropriate buttons:

- **Image selected:** Resize, align left/center/right, alt text, delete
- **Table selected:** Add row, add column, delete table, export CSV
- **Code block selected:** Copy code, change language

This builds on the existing bubble menu concept but makes it node-type-aware.

---

## 5.5 Feature: Multi-Level Dropdowns (F5)

**What:** Proper sub-menu support for complex action menus.

**Files to create:**
- `src/lib/components/DropdownMenu.svelte`

### Implementation

A generic dropdown menu component with sub-menu support using Floating UI for positioning:

```svelte
<!-- Usage -->
<DropdownMenu items={[
  { label: 'Export', children: [
    { label: 'PDF', action: exportPdf },
    { label: 'Word', action: exportDocx },
    { label: 'CSV', action: exportCsv },
  ]},
  { label: 'Share', action: shareNote },
  { label: 'Delete', action: deleteNote, variant: 'danger' },
]} />
```

Each sub-menu uses `computePosition` with `placement: 'right-start'` and `flip`/`shift` middleware.

---

# Dependency Summary

```bash
npm install @xenova/transformers chart.js chrono-node papaparse @floating-ui/dom
npm install -D @types/papaparse
```

# Implementation Priority Order

1. **Floating UI** (F2, F3) — Foundation for better UX, used by other features
2. **Chart.js** (C1, C4) — Most visible, high wow-factor
3. **Papa Parse** (P1, P3) — Quick wins, pairs with charts
4. **chrono-node** (D1, D2, D3) — Practical productivity value
5. **Transformers.js** (T1, T2, T5) — Highest impact but heaviest; do last

# Testing Checklist

For each feature:
- [ ] `npm run build` passes
- [ ] Feature works in dev mode (`npm run dev`)
- [ ] No console errors
- [ ] Slash commands appear in the menu and execute correctly
- [ ] Data persists through save/reload cycle
- [ ] Mobile (Capacitor) doesn't crash on the feature
- [ ] Feature degrades gracefully if a library fails to load
