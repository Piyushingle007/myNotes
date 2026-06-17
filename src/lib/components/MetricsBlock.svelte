<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { appState } from '../stores/appState.svelte';

	interface Props {
		blockState: {
			node: any;
			getPos: () => number | null | undefined;
			editor: any;
		};
		updateAttributes: (attrs: any) => void;
	}
	let { blockState, updateAttributes }: Props = $props();

	// Local reactive state for rows
	let rows: Array<{ id: string; checked: boolean; label: string }> = $state([]);
	let showSettings = $state(false);

	// Regular expression to match integers and decimals
	const NUMBER_REGEX = /(?<!\d)-?(?:\d+(?:\.\d+)?|\.\d+)/g;

	// Strip common date formats so they aren't parsed as numbers/negative signs
	function cleanText(text: string): string {
		let t = String(text || '');
		// Strip YYYY-MM-DD
		t = t.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '');
		// Strip MM/DD/YYYY, DD/MM/YYYY, MM-DD-YYYY, DD-MM-YYYY
		t = t.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '');
		return t;
	}

	function getRowNumbers(text: string): number[] {
		const cleaned = cleanText(text);
		const matches = cleaned.match(NUMBER_REGEX);
		if (!matches) return [];
		return matches.map(m => parseFloat(m)).filter(n => !isNaN(n));
	}

	function getRowTotal(text: string): number {
		const numbers = getRowNumbers(text);
		return numbers.reduce((sum, n) => sum + n, 0);
	}

	// Sync local rows from node attributes and perform legacy migrations
	$effect(() => {
		const dataStr = blockState.node.attrs.data || '[]';
		try {
			const parsed = JSON.parse(dataStr);
			const migrated = parsed.map((r: any) => {
				// Migrate legacy rows that have a separate value column
				if (r.value !== undefined && r.value !== null && String(r.value).trim() !== '') {
					return {
						id: r.id,
						checked: !!r.checked,
						label: (r.label || '').trim() + ' ' + String(r.value).trim(),
					};
				}
				return {
					id: r.id,
					checked: !!r.checked,
					label: r.label || ''
				};
			});

			untrack(() => {
				if (JSON.stringify(migrated) !== JSON.stringify(rows)) {
					rows = migrated;
				}
			});
		} catch (e) {
			console.error('Failed to parse metrics data', e);
		}
	});

	// Get settings from node attributes
	let excludeChecked = $derived(
		blockState.node.attrs.excludeChecked === 'true' || blockState.node.attrs.excludeChecked === true
	);
	let showIncome = $derived(
		blockState.node.attrs.showIncome === 'true' || blockState.node.attrs.showIncome === true
	);
	let showExpenses = $derived(
		blockState.node.attrs.showExpenses === 'true' || blockState.node.attrs.showExpenses === true
	);
	let showMin = $derived(
		blockState.node.attrs.showMin === 'true' || blockState.node.attrs.showMin === true
	);
	let showMax = $derived(
		blockState.node.attrs.showMax === 'true' || blockState.node.attrs.showMax === true
	);
	let showMedian = $derived(
		blockState.node.attrs.showMedian === 'true' || blockState.node.attrs.showMedian === true
	);

	let title = $derived(
		blockState.node.attrs.title || 'Metrics List'
	);

	let localTitle = $state('Metrics List');
	$effect(() => {
		localTitle = title;
	});

	// Derived calculations
	let activeRows = $derived.by(() => {
		return rows.filter((r: { id: string; checked: boolean; label: string }) => {
			if (excludeChecked && r.checked) return false;
			return true;
		});
	});

	let parsedValues = $derived.by(() => {
		const vals: number[] = [];
		activeRows.forEach((r: { id: string; checked: boolean; label: string }) => {
			const numbers = getRowNumbers(r.label);
			if (numbers.length === 0) return; // Ignore rows without any numeric entries
			vals.push(numbers.reduce((sum, n) => sum + n, 0));
		});
		return vals;
	});

	let stats = $derived.by(() => {
		const vals = parsedValues;
		const count = vals.length;
		if (count === 0) {
			return {
				count: 0,
				sum: 0,
				average: 0,
				min: 0,
				max: 0,
				median: 0,
				income: 0,
				expenses: 0,
				net: 0
			};
		}

		let sum = 0;
		let income = 0;
		let expenses = 0;
		let min = vals[0];
		let max = vals[0];

		vals.forEach(v => {
			sum += v;
			if (v > 0) {
				income += v;
			} else if (v < 0) {
				expenses += Math.abs(v);
			}
			if (v < min) min = v;
			if (v > max) max = v;
		});

		// Median calculation
		const sorted = [...vals].sort((a, b) => a - b);
		const mid = Math.floor(count / 2);
		const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

		const average = sum / count;
		const net = sum; // Net is the overall sum of positive and negative row totals

		return {
			count,
			sum,
			average,
			min,
			max,
			median,
			income,
			expenses,
			net
		};
	});

	function saveRows() {
		updateAttributes({ data: JSON.stringify(rows) });
	}

	function addRow() {
		const newRow = {
			id: 'row_' + Math.random().toString(36).substring(2, 9),
			checked: false,
			label: ''
		};
		rows.push(newRow);
		saveRows();

		tick().then(() => {
			const labelInputs = document.querySelectorAll(`.metrics-row-wrapper-${blockState.node.attrs.id || ''} .row-label-input`);
			const lastInput = labelInputs[labelInputs.length - 1] as HTMLInputElement | null;
			lastInput?.focus();
		});
	}

	function deleteRow(index: number) {
		rows.splice(index, 1);
		saveRows();
	}

	function handleKeyDown(event: KeyboardEvent, index: number) {
		if (event.key === 'Enter') {
			event.preventDefault();
			const newRow = {
				id: 'row_' + Math.random().toString(36).substring(2, 9),
				checked: false,
				label: ''
			};
			rows.splice(index + 1, 0, newRow);
			saveRows();

			tick().then(() => {
				const labelInputs = document.querySelectorAll(`.metrics-row-wrapper-${blockState.node.attrs.id || ''} .row-label-input`);
				const nextInput = labelInputs[index + 1] as HTMLInputElement | null;
				nextInput?.focus();
			});
		} else if (event.key === 'Backspace') {
			if (rows[index].label === '') {
				event.preventDefault();
				deleteRow(index);

				tick().then(() => {
					const labelInputs = document.querySelectorAll(`.metrics-row-wrapper-${blockState.node.attrs.id || ''} .row-label-input`);
					const targetIndex = index - 1 >= 0 ? index - 1 : 0;
					
					if (rows.length > 0) {
						const focusInput = labelInputs[targetIndex] as HTMLInputElement | null;
						focusInput?.focus();
					}
				});
			}
		}
	}

	function toggleSettingsMenu(e: MouseEvent) {
		e.stopPropagation();
		showSettings = !showSettings;
	}

	$effect(() => {
		if (showSettings) {
			const close = () => { showSettings = false; };
			window.addEventListener('click', close);
			return () => window.removeEventListener('click', close);
		}
	});

	// Drag & Drop reordering
	let draggingIndex: number | null = $state(null);
	let isRowDraggable: number | null = $state(null);
	let dragOverIndex: number | null = $state(null);
	let dragDropPosition: 'above' | 'below' | null = $state(null);

	function handleDragStart(event: DragEvent, index: number) {
		draggingIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragOver(event: DragEvent, index: number) {
		event.preventDefault();
		if (draggingIndex === null) return;

		dragOverIndex = index;

		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const relativeY = event.clientY - rect.top;
		if (relativeY < rect.height / 2) {
			dragDropPosition = 'above';
		} else {
			dragDropPosition = 'below';
		}
	}

	function handleDragLeave() {
		dragOverIndex = null;
		dragDropPosition = null;
	}

	function handleDrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (draggingIndex === null) return;

		let targetIndex = index;
		if (dragDropPosition === 'below') {
			targetIndex = index + 1;
		}

		const draggedRow = rows[draggingIndex];
		rows.splice(draggingIndex, 1);

		let insertIndex = targetIndex;
		if (draggingIndex < targetIndex) {
			insertIndex = targetIndex - 1;
		}

		rows.splice(insertIndex, 0, draggedRow);
		saveRows();

		draggingIndex = null;
		dragOverIndex = null;
		dragDropPosition = null;
		isRowDraggable = null;
	}

	function handleDragEnd() {
		draggingIndex = null;
		dragOverIndex = null;
		dragDropPosition = null;
		isRowDraggable = null;
	}

	function handleKeyboardAndClipboard(event: Event) {
		event.stopPropagation();
	}
</script>

<div
	class="metrics-card-wrapper metrics-row-wrapper-{blockState.node.attrs.id || ''}"
	class:readonly={appState.isReadOnly}
	onkeydown={handleKeyboardAndClipboard}
	onkeyup={handleKeyboardAndClipboard}
	onkeypress={handleKeyboardAndClipboard}
	oncopy={handleKeyboardAndClipboard}
	onpaste={handleKeyboardAndClipboard}
	oncut={handleKeyboardAndClipboard}
	oninput={handleKeyboardAndClipboard}
	onbeforeinput={handleKeyboardAndClipboard}
	oncompositionstart={handleKeyboardAndClipboard}
	oncompositionupdate={handleKeyboardAndClipboard}
	oncompositionend={handleKeyboardAndClipboard}
>
	<!-- Header -->
	<div class="metrics-card-header flex-row">
		<span class="metrics-card-icon">📊</span>
		<input
			type="text"
			class="metrics-card-title-input"
			bind:value={localTitle}
			placeholder="Metrics List"
			disabled={appState.isReadOnly}
			onblur={() => {
				updateAttributes({ title: localTitle });
			}}
		/>
		{#if !appState.isReadOnly}
			<div class="settings-trigger-wrapper">
				<button class="settings-trigger-btn" onclick={toggleSettingsMenu} title="Metrics settings">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</button>
				{#if showSettings}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="settings-dropdown-menu" onclick={(e) => e.stopPropagation()}>
						<label class="settings-option flex-row">
							<input
								type="checkbox"
								checked={excludeChecked}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									updateAttributes({ excludeChecked: checked });
								}}
							/>
							<span>Exclude checked rows</span>
						</label>

						<div class="settings-menu-divider"></div>
						<div class="settings-menu-subtitle">Show Statistics:</div>

						<label class="settings-option flex-row">
							<input
								type="checkbox"
								checked={showIncome}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									updateAttributes({ showIncome: checked });
								}}
							/>
							<span>Income</span>
						</label>

						<label class="settings-option flex-row">
							<input
								type="checkbox"
								checked={showExpenses}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									updateAttributes({ showExpenses: checked });
								}}
							/>
							<span>Expenses</span>
						</label>

						<label class="settings-option flex-row">
							<input
								type="checkbox"
								checked={showMin}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									updateAttributes({ showMin: checked });
								}}
							/>
							<span>Min</span>
						</label>

						<label class="settings-option flex-row">
							<input
								type="checkbox"
								checked={showMax}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									updateAttributes({ showMax: checked });
								}}
							/>
							<span>Max</span>
						</label>

						<label class="settings-option flex-row">
							<input
								type="checkbox"
								checked={showMedian}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									updateAttributes({ showMedian: checked });
								}}
							/>
							<span>Median</span>
						</label>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Rows Body -->
	<div class="metrics-card-body">
		{#if rows.length === 0 && appState.isReadOnly}
			<div class="metrics-empty-state">No metrics recorded</div>
		{/if}

		{#each rows as row, index (row.id)}
			{@const numbers = getRowNumbers(row.label)}
			{@const total = numbers.reduce((sum, n) => sum + n, 0)}
			<div
				class="metrics-card-row flex-row"
				class:dragging={draggingIndex === index}
				class:drag-over-above={dragOverIndex === index && dragDropPosition === 'above'}
				class:drag-over-below={dragOverIndex === index && dragDropPosition === 'below'}
				draggable={isRowDraggable === index && !appState.isReadOnly}
				ondragstart={(e) => handleDragStart(e, index)}
				ondragover={(e) => handleDragOver(e, index)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, index)}
				ondragend={handleDragEnd}
			>
				{#if !appState.isReadOnly}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						class="row-drag-handle-btn" 
						title="Drag to reorder"
						onmousedown={() => { isRowDraggable = index; }}
						onmouseup={() => { isRowDraggable = null; }}
						ontouchstart={() => { isRowDraggable = index; }}
						ontouchend={() => { isRowDraggable = null; }}
					>⋮⋮</div>
					<input
						type="checkbox"
						class="row-item-checkbox"
						checked={row.checked}
						onchange={(e) => {
							row.checked = (e.target as HTMLInputElement).checked;
							saveRows();
						}}
					/>
				{:else}
					<div class="row-item-checkbox-readonly">
						{row.checked ? '☑' : '☐'}
					</div>
				{/if}

				{#if !appState.isReadOnly}
					<div
						contenteditable="plaintext-only"
						class="row-label-input"
						bind:textContent={row.label}
						placeholder="List item (e.g. groceries 2000)..."
						onblur={saveRows}
						onkeydown={(e) => handleKeyDown(e, index)}
					></div>
				{:else}
					<div class="row-label-input readonly-label-text">
						{row.label}
					</div>
				{/if}

				<!-- Sum Badge Display -->
				{#if numbers.length > 0}
					<span 
						class="row-sum-badge"
						class:positive={total > 0}
						class:negative={total < 0}
					>
						{total > 0 ? '+' : ''}{total.toLocaleString()}
					</span>
				{/if}

				{#if !appState.isReadOnly}
					<button class="row-delete-action" onclick={() => deleteRow(index)} title="Delete row">
						✕
					</button>
				{/if}
			</div>
		{/each}

		{#if !appState.isReadOnly}
			<button class="add-row-action flex-row" onclick={addRow}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				<span>Add Row</span>
			</button>
		{/if}
	</div>

	<!-- Statistics Footer -->
	<div class="metrics-card-footer">
		<div class="stats-grid grid-layout">
			<div class="stat-badge flex-col">
				<span class="badge-label">Count</span>
				<span class="badge-value">{stats.count}</span>
			</div>
			{#if showIncome}
				<div class="stat-badge flex-col">
					<span class="badge-label">Income</span>
					<span class="badge-value positive">{stats.income}</span>
				</div>
			{/if}
			{#if showExpenses}
				<div class="stat-badge flex-col">
					<span class="badge-label">Expenses</span>
					<span class="badge-value negative">{stats.expenses}</span>
				</div>
			{/if}
			<div class="stat-badge flex-col">
				<span class="badge-label">Net Total</span>
				<span class="badge-value" class:positive={stats.net > 0} class:negative={stats.net < 0}>
					{stats.net}
				</span>
			</div>
			<div class="stat-badge flex-col">
				<span class="badge-label">Average</span>
				<span class="badge-value">{stats.average.toFixed(2).replace(/\.00$/, '')}</span>
			</div>
			{#if showMin}
				<div class="stat-badge flex-col">
					<span class="badge-label">Min</span>
					<span class="badge-value" class:positive={stats.min > 0} class:negative={stats.min < 0}>
						{stats.min}
					</span>
				</div>
			{/if}
			{#if showMax}
				<div class="stat-badge flex-col">
					<span class="badge-label">Max</span>
					<span class="badge-value" class:positive={stats.max > 0} class:negative={stats.max < 0}>
						{stats.max}
					</span>
				</div>
			{/if}
			{#if showMedian}
				<div class="stat-badge flex-col">
					<span class="badge-label">Median</span>
					<span class="badge-value" class:positive={stats.median > 0} class:negative={stats.median < 0}>
						{stats.median}
					</span>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.metrics-card-wrapper {
		display: flex;
		flex-direction: column;
		background: var(--bg-surface, #1e2025);
		border: 1px solid var(--border-color, #2a2d35);
		border-radius: 12px;
		margin: 20px 0;
		overflow: hidden;
		box-shadow: var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.1));
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
	}

	.metrics-card-header {
		display: flex;
		align-items: center;
		padding: 12px 16px;
		background: color-mix(in srgb, var(--border-color) 30%, var(--bg-surface));
		border-bottom: 1px solid var(--border-color, #2a2d35);
		gap: 8px;
	}

	.metrics-card-icon {
		font-size: 16px;
	}

	.metrics-card-title-input {
		flex: 1;
		background: transparent;
		border: none;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary);
		outline: none;
		padding: 4px 0;
	}

	.settings-trigger-wrapper {
		position: relative;
	}

	.settings-trigger-btn {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 6px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		transition: background-color 0.15s, color 0.15s;
	}

	.settings-trigger-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.settings-dropdown-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 200;
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		box-shadow: var(--shadow-xl);
		padding: 8px 12px;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.settings-menu-divider {
		height: 1px;
		background: var(--border-color);
		margin: 4px 0;
	}

	.settings-menu-subtitle {
		font-size: 10px;
		font-weight: 700;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 2px;
	}

	.settings-option {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-primary);
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
	}

	.settings-option input {
		margin: 0;
		cursor: pointer;
	}

	.metrics-card-body {
		padding: 12px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 400px;
		overflow-y: auto;
	}

	.metrics-empty-state {
		font-size: 13px;
		color: var(--text-tertiary);
		text-align: center;
		padding: 24px;
		font-style: italic;
	}

	.metrics-card-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: 6px;
		transition: background-color 0.15s;
		box-sizing: border-box;
	}

	.metrics-card-row:hover {
		background: var(--bg-hover);
	}

	.metrics-card-row.dragging {
		opacity: 0.4;
		border: 1px dashed var(--accent);
	}

	.metrics-card-row.drag-over-above {
		border-top: 2px solid var(--accent, #00adb5) !important;
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.metrics-card-row.drag-over-below {
		border-bottom: 2px solid var(--accent, #00adb5) !important;
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.row-drag-handle-btn {
		color: var(--text-tertiary);
		cursor: grab;
		font-size: 12px;
		user-select: none;
		padding: 4px;
	}

	.row-drag-handle-btn:active {
		cursor: grabbing;
	}

	.row-item-checkbox {
		cursor: pointer;
		margin: 0;
	}

	.row-item-checkbox-readonly {
		font-size: 14px;
		color: var(--text-secondary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		user-select: none;
	}

	.row-label-input {
		flex: 1;
		background: transparent;
		border: none;
		border-bottom: 1px solid transparent;
		font-size: 13px;
		color: var(--text-primary);
		outline: none;
		padding: 4px;
		transition: border-bottom-color 0.15s;
		min-height: 20px;
		word-break: break-word;
		white-space: pre-wrap;
	}

	.row-label-input:focus {
		border-bottom-color: var(--accent);
	}

	.row-label-input[contenteditable="true"]:empty::before {
		content: attr(placeholder);
		color: var(--text-tertiary, #888);
		pointer-events: none;
		display: inline-block;
	}

	.row-sum-badge {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border-color);
		padding: 3px 8px;
		border-radius: 6px;
		font-family: monospace;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.row-sum-badge.positive {
		color: var(--semantic-success, #22c55e);
		background: rgba(34, 197, 94, 0.08);
		border-color: rgba(34, 197, 94, 0.15);
	}

	.row-sum-badge.negative {
		color: var(--semantic-error, #ff4d4d);
		background: rgba(255, 77, 77, 0.08);
		border-color: rgba(255, 77, 77, 0.15);
	}

	.row-delete-action {
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 4px 6px;
		border-radius: 4px;
		font-size: 11px;
		opacity: 0;
		transition: opacity 0.15s, background-color 0.15s;
	}

	.metrics-card-row:hover .row-delete-action {
		opacity: 1;
	}

	.row-delete-action:hover {
		background: color-mix(in srgb, var(--semantic-error, #ff4d4d) 15%, var(--bg-surface));
		color: var(--semantic-error, #ff4d4d);
	}

	.add-row-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		padding: 8px 12px;
		border-radius: 6px;
		width: fit-content;
		margin-top: 4px;
		margin-left: 8px;
		transition: background-color 0.15s, color 0.15s;
	}

	.add-row-action:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.metrics-card-footer {
		padding: 12px 16px;
		background: color-mix(in srgb, var(--border-color) 15%, var(--bg-surface));
		border-top: 1px solid var(--border-color, #2a2d35);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 8px;
	}

	.stat-badge {
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary, #141517);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 6px 10px;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		gap: 2px;
		min-width: 0;
		overflow: hidden;
	}

	.badge-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-tertiary);
		margin-bottom: 2px;
		font-weight: 700;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: center;
	}

	.badge-value {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-primary);
		font-family: monospace;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: center;
	}

	.badge-value.positive {
		color: var(--semantic-success, #22c55e);
	}

	.badge-value.negative {
		color: var(--semantic-error, #ff4d4d);
	}

	/* Prevent selection from making text black when parent card is selected */
	.metrics-card-wrapper *::selection {
		background: rgba(0, 173, 181, 0.3) !important;
		color: var(--text-primary) !important;
	}
	.metrics-card-wrapper input::selection {
		background: var(--accent) !important;
		color: #000000 !important;
	}

	@media (max-width: 600px) {
		.metrics-card-header {
			padding: 8px 12px;
		}
		.metrics-card-body {
			padding: 8px 4px;
		}
		.metrics-card-row {
			gap: 4px;
			padding: 4px;
		}
		.row-label-input {
			font-size: 12px;
			padding: 2px;
		}
		.row-sum-badge {
			font-size: 10px;
			padding: 2px 6px;
		}
		.row-delete-action {
			opacity: 1 !important; /* Always show delete action on touch devices */
			padding: 4px;
		}
		.metrics-card-footer {
			padding: 8px 12px;
		}
		.stats-grid {
			grid-template-columns: repeat(auto-fit, minmax(75px, 1fr));
			gap: 4px;
		}
		.stat-badge {
			padding: 4px 6px;
		}
		.badge-label {
			font-size: 9px;
		}
		.badge-value {
			font-size: 11px;
		}
	}
</style>
