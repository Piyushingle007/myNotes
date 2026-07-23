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
  let showEditor = $state(!$nodeStore.attrs.chartConfig?.dataText);
  let chartType = $state<'bar' | 'line' | 'pie' | 'doughnut'>($nodeStore.attrs.chartConfig?.type || 'bar');
  let dataText = $state($nodeStore.attrs.chartConfig?.dataText || 'January: 65\nFebruary: 59\nMarch: 80\nApril: 81');
  let chartTitle = $state($nodeStore.attrs.chartConfig?.title || '');

  function parseData(text: string): { labels: string[]; values: number[] } {
    const labels: string[] = [];
    const values: number[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
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
          maintainAspectRatio: false,
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

  async function importCsvForChart() {
    try {
      const text = await navigator.clipboard.readText();
      const Papa = (await import('papaparse')).default;
      const result = Papa.parse(text.trim(), { header: false });
      const rows = result.data as string[][];
      
      if (rows.length < 1) return;
      
      // Convert to "Label: Value" format
      dataText = rows
        .filter(r => r.length >= 2 && !isNaN(parseFloat(r[1])))
        .map(r => `${r[0]}: ${r[1]}`)
        .join('\n');
    } catch (e) {
      console.error('Failed to import CSV from clipboard', e);
    }
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
      <div class="data-header">
        <span class="data-label">Data</span>
        <button class="csv-btn" onclick={importCsvForChart} title="Paste from clipboard">📋 Paste CSV</button>
      </div>
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
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    background: var(--bg-surface, #15181e);
    overflow: hidden;
  }
  .chart-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px;
    background: var(--bg-surface-elevated, #1e2227);
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  }
  .block-title { font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #a0a0a0); text-transform: uppercase; letter-spacing: 0.5px; }
  .actions { display: flex; gap: 4px; }
  .actions button { width: 24px; height: 24px; border-radius: 4px; border: none; background: transparent; color: var(--text-muted, #a0a0a0); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .actions button:hover { background: rgba(255,255,255,0.1); color: var(--text-normal, #e0e0e0); }
  .actions .delete:hover { background: rgba(255,50,50,0.2); color: #ff5555; }
  
  .chart-editor { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .type-selector { display: flex; gap: 4px; flex-wrap: wrap; }
  .type-selector button { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1)); background: transparent; color: var(--text-muted, #a0a0a0); cursor: pointer; font-size: 0.75rem; display: flex; align-items: center; gap: 6px; }
  .type-selector button.active { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.5); color: var(--text-normal, #e0e0e0); }
  
  .chart-title-input { padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1)); background: var(--bg-surface-elevated, #1e2227); color: var(--text-normal, #e0e0e0); font-size: 0.85rem; }
  .chart-title-input:focus { outline: none; border-color: #6366f1; }
  
  .data-header { display: flex; justify-content: space-between; align-items: center; }
  .data-label { font-size: 0.75rem; color: var(--text-muted, #a0a0a0); font-weight: 500; }
  .csv-btn { background: transparent; border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1)); color: var(--text-muted, #a0a0a0); font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
  .csv-btn:hover { background: rgba(255,255,255,0.1); color: var(--text-normal, #e0e0e0); }
  
  .data-input { padding: 10px; border-radius: 4px; border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1)); background: var(--bg-surface-elevated, #1e2227); color: var(--text-normal, #e0e0e0); font-size: 0.85rem; font-family: monospace; resize: vertical; }
  .data-input:focus { outline: none; border-color: #6366f1; }
  
  .render-btn { padding: 8px 16px; border-radius: 4px; border: none; background: #6366f1; color: white; cursor: pointer; font-size: 0.85rem; align-self: flex-start; font-weight: 500; }
  .render-btn:hover { background: #4f46e5; }
  
  .chart-container { padding: 16px; height: 350px; display: flex; align-items: center; justify-content: center; position: relative; }
</style>
