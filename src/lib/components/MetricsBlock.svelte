<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { appState } from '../stores/appState.svelte';
	import { Trash2, GripVertical, X, ChevronDown, BarChart3, Plus, Settings, Search, Tag } from 'lucide-svelte';

	interface Props {
		nodeStore: Writable<any>;
		getPos: () => number | null | undefined;
		editor: any;
		updateAttributes: (attrs: any) => void;
	}
	let { nodeStore, getPos, editor, updateAttributes }: Props = $props();

	// Local reactive state for rows
	let rows: Array<{ id: string; checked: boolean; label: string; tagIds?: string[] }> = $state([]);
	let showSettings = $state(false);
	let editingRowIndex = $state<number | null>(null);
	let isInsertingDate = false;
	let activeTagPickerRowId = $state<string | null>(null);
	// MB-005: fixed-position coordinates for the tag picker so it escapes the scroll container
	let tagPickerCoords = $state<{ left: number; top: number; flip: boolean; width: number } | null>(null);
	// MB-010: search/filter term for the tag picker dropdown
	let tagPickerSearch = $state('');
	// MT-005: maximum tag pills shown inline before collapsing into a "+N" overflow pill
	const MAX_VISIBLE_ROW_TAGS = 2;
	// Redesign: row ids whose tag list is expanded (clicking "+N" reveals all tags)
	let expandedTagRows = $state<string[]>([]);

	function toggleExpandTags(event: MouseEvent, rowId: string) {
		event.preventDefault();
		event.stopPropagation();
		if (expandedTagRows.includes(rowId)) {
			expandedTagRows = expandedTagRows.filter((id) => id !== rowId);
		} else {
			expandedTagRows = [...expandedTagRows, rowId];
		}
	}

	// Redesign: Tabbed settings dropdown menu state
	let activeSettingsTab = $state<'options' | 'categories'>('options');

	// Redesign: Budget Tag Catalog Editor state inside block dropdown
	let newCalcTagName = $state('');
	let calcTagColorPickerOpen = $state<string | null>(null);
	let calcTagCustomHex = $state('');
	
	const CALC_TAG_COLOR_PALETTE = [
		'#ef4444', '#f97316', '#eab308', '#22c55e',
		'#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6',
		'#ec4899', '#f43f5e', '#78716c', '#64748b',
	];

	let isCalcTagHexValid = $derived(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(calcTagCustomHex.trim()));
	let normalizedCalcTagHex = $derived(isCalcTagHexValid ? (calcTagCustomHex.trim().startsWith('#') ? calcTagCustomHex.trim() : '#' + calcTagCustomHex.trim()) : '');

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
		const regex = /-?(?:\d+(?:\.\d+)?|\.\d+)/g;
		const numbers: number[] = [];
		let match;
		
		while ((match = regex.exec(cleaned)) !== null) {
			const valStr = match[0];
			const start = match.index;
			const end = regex.lastIndex;
			
			let isTouching = false;
			
			if (start > 0) {
				const prevChar = cleaned[start - 1];
				if (/[a-zA-Z0-9]/.test(prevChar)) {
					isTouching = true;
				}
				if (/[-+/]/.test(prevChar)) {
					let idx = start - 1;
					while (idx > 0 && /\s/.test(cleaned[idx - 1])) {
						idx--;
					}
					if (idx > 0 && /[a-zA-Z0-9]/.test(cleaned[idx - 1])) {
						isTouching = true;
					}
				}
			}
			
			if (end < cleaned.length) {
				const nextChar = cleaned[end];
				if (/[a-zA-Z0-9]/.test(nextChar)) {
					isTouching = true;
				}
				if (/[-+/]/.test(nextChar)) {
					let idx = end;
					while (idx < cleaned.length - 1 && /\s/.test(cleaned[idx + 1])) {
						idx++;
					}
					if (idx < cleaned.length - 1 && /[a-zA-Z0-9]/.test(cleaned[idx + 1])) {
						isTouching = true;
					}
				}
			}
			
			if (!isTouching) {
				const num = parseFloat(valStr);
				if (!isNaN(num)) {
					numbers.push(num);
				}
			}
		}
		
		return numbers;
	}

	function getRowTotal(text: string): number {
		const numbers = getRowNumbers(text);
		return numbers.reduce((sum, n) => sum + n, 0);
	}

	function escapeHtml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function renderFormattedLabel(text: string): string {
		if (!text) return '';
		
		const regex = /-?(?:\d+(?:\.\d+)?|\.\d+)/g;
		let match;
		let result = '';
		let lastIndex = 0;
		
		while ((match = regex.exec(text)) !== null) {
			const valStr = match[0];
			const start = match.index;
			const end = regex.lastIndex;
			
			let isTouching = false;
			if (start > 0) {
				const prevChar = text[start - 1];
				if (/[a-zA-Z0-9]/.test(prevChar)) {
					isTouching = true;
				}
				if (/[-+/]/.test(prevChar)) {
					let idx = start - 1;
					while (idx > 0 && /\s/.test(text[idx - 1])) {
						idx--;
					}
					if (idx > 0 && /[a-zA-Z0-9]/.test(text[idx - 1])) {
						isTouching = true;
					}
				}
			}
			if (end < text.length) {
				const nextChar = text[end];
				if (/[a-zA-Z0-9]/.test(nextChar)) {
					isTouching = true;
				}
				if (/[-+/]/.test(nextChar)) {
					let idx = end;
					while (idx < text.length - 1 && /\s/.test(text[idx + 1])) {
						idx++;
					}
					if (idx < text.length - 1 && /[a-zA-Z0-9]/.test(text[idx + 1])) {
						isTouching = true;
					}
				}
			}
			
			result += escapeHtml(text.substring(lastIndex, start));
			
			if (!isTouching) {
				const num = parseFloat(valStr);
				if (!isNaN(num)) {
					const className = num > 0 ? 'metrics-num-pos' : (num < 0 ? 'metrics-num-neg' : 'metrics-num-zero');
					result += `<span class="${className}">${escapeHtml(valStr)}</span>`;
				} else {
					result += escapeHtml(valStr);
				}
			} else {
				result += escapeHtml(valStr);
			}
			
			lastIndex = end;
		}
		
		result += escapeHtml(text.substring(lastIndex));
		return result;
	}

	function focusOnMount(node: HTMLElement) {
		node.focus();
		const range = document.createRange();
		range.selectNodeContents(node);
		range.collapse(false);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function handleInsertDate(event: MouseEvent, rowId: string) {
		event.preventDefault();
		const el = document.querySelector(`.metrics-row-wrapper-${$nodeStore.attrs.id || ''} [data-row-id="${rowId}"]`) as HTMLElement | null;
		if (el) {
			el.focus();
			const todayStr = new Date().toISOString().split('T')[0];
			document.execCommand('insertText', false, todayStr);
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	function handleRowInput(event: Event, row: any) {
		const target = event.target as HTMLElement;
		const text = target.textContent || '';
		
		const todayStr = new Date().toISOString().split('T')[0];
		if (text.includes('@today') || text.includes('@date')) {
			const sel = window.getSelection();
			let offset = 0;
			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				offset = range.startOffset;
			}
			
			const newText = text.replace(/@today/g, todayStr).replace(/@date/g, todayStr);
			row.label = newText;
			target.textContent = newText;
			saveRows();
			
			tick().then(() => {
				target.focus();
				const range = document.createRange();
				const textNode = target.firstChild || target;
				const newOffset = Math.min(textNode.textContent?.length || 0, offset + (todayStr.length - 6));
				try {
					range.setStart(textNode, newOffset);
					range.collapse(true);
					sel?.removeAllRanges();
					sel?.addRange(range);
				} catch (e) {
					focusOnMount(target);
				}
			});
		} else {
			row.label = text;
			saveRows();
		}
	}

	// Sync local rows from node attributes and perform legacy migrations
	$effect(() => {
		const dataStr = $nodeStore.attrs.data || '[]';
		try {
			const parsed = JSON.parse(dataStr);
			const migrated = parsed.map((r: any) => {
				// MT-001: normalize tags to an array (legacy rows carry a single `tagId`)
				const tagIds: string[] = Array.isArray(r.tagIds)
					? r.tagIds.filter((id: any) => typeof id === 'string')
					: (r.tagId ? [r.tagId] : []);
				// Migrate legacy rows that have a separate value column
				if (r.value !== undefined && r.value !== null && String(r.value).trim() !== '') {
					return {
						id: r.id,
						checked: !!r.checked,
						label: (r.label || '').trim() + ' ' + String(r.value).trim(),
						tagIds
					};
				}
				return {
					id: r.id,
					checked: !!r.checked,
					label: r.label || '',
					tagIds
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

	let visibleTagTotals: string[] = $derived.by(() => {
		try {
			const val = $nodeStore.attrs.visibleTagTotals || '[]';
			const parsed = JSON.parse(val);
			return Array.isArray(parsed) ? parsed : [];
		} catch (e) {
			return [];
		}
	});

	// Get settings from node attributes via reactive synchronization
	let excludeChecked = $derived($nodeStore.attrs.excludeChecked === 'true' || $nodeStore.attrs.excludeChecked === true);
	let showInflows = $derived($nodeStore.attrs.showInflows === 'true' || $nodeStore.attrs.showInflows === true);
	let showExpenses = $derived($nodeStore.attrs.showExpenses === 'true' || $nodeStore.attrs.showExpenses === true);
	let showMin = $derived($nodeStore.attrs.showMin === 'true' || $nodeStore.attrs.showMin === true);
	let showMax = $derived($nodeStore.attrs.showMax === 'true' || $nodeStore.attrs.showMax === true);
	let showMedian = $derived($nodeStore.attrs.showMedian === 'true' || $nodeStore.attrs.showMedian === true);
	
	let incomeLabel = $derived($nodeStore.attrs.incomeLabel || appState.defaultIncomeLabel || 'Income');
	let currencyCode = $derived($nodeStore.attrs.currencyCode || appState.defaultCurrency || '₹');
	let incomePlaceholder = $derived($nodeStore.attrs.incomePlaceholder || '');
	let incomeSources = $derived.by(() => {
		try {
			const val = $nodeStore.attrs.incomeSources || '[]';
			const parsed = JSON.parse(val);
			return Array.isArray(parsed) ? parsed : [];
		} catch (e) {
			return [];
		}
	});

	let incomeVal = $derived(parseFloat($nodeStore.attrs.income || '0') || 0);

	let showSavings = $derived.by(() => {
		const rawSavings = $nodeStore.attrs.showSavings;
		if (rawSavings === 'true' || rawSavings === true) {
			return true;
		} else if (rawSavings === 'false' || rawSavings === false) {
			return false;
		} else {
			return incomeVal > 0;
		}
	});

	let showIncome = $derived(showSavings && ($nodeStore.attrs.showIncome === 'true' || $nodeStore.attrs.showIncome === true));

	let isIncomeFocused = $state(false);
	let localIncomeStr = $state('0');

	$effect(() => {
		if (!isIncomeFocused) {
			localIncomeStr = incomeVal.toLocaleString();
		}
	});

	$effect(() => {
		const currentCalcTags = appState.calcTags || [];
		const serializedTags = JSON.stringify(currentCalcTags.map(tag => ({
			id: tag.id,
			name: tag.name,
			color: tag.color,
			enabled: tag.enabled,
			createdAt: tag.createdAt
		})));
		if ($nodeStore.attrs.tagsMetadata !== serializedTags) {
			updateAttributes({ tagsMetadata: serializedTags });
		}
	});

	function handleIncomeFocus() {
		isIncomeFocused = true;
		localIncomeStr = incomeVal === 0 ? '' : String(incomeVal);
	}

	function handleIncomeBlur() {
		isIncomeFocused = false;
		let clean = localIncomeStr.replace(/[^0-9.-]/g, '');
		let parsed = parseFloat(clean);
		if (isNaN(parsed)) {
			parsed = 0;
		}
		updateAttributes({ income: parsed });
		localIncomeStr = parsed.toLocaleString();
	}

	function handleIncomeKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			(event.target as HTMLInputElement).blur();
		}
	}

	let title = $derived(
		$nodeStore.attrs.title || 'Metrics List'
	);

	let localTitle = $state('Metrics List');
	$effect(() => {
		localTitle = title;
	});

	// Derived calculations
	let tagTotals = $derived.by(() => {
		const totalsMap = new Map<string, number>();
		let untaggedTotal = 0;

		activeRows.forEach((r: { id: string; checked: boolean; label: string; tagIds?: string[] }) => {
			const numbers = getRowNumbers(r.label);
			if (numbers.length === 0) return;
			const total = numbers.reduce((sum, n) => sum + n, 0);

			const ids = getRowTagIds(r);
			if (ids.length > 0) {
				// MT-002: a row contributes its total to every category it belongs to
				ids.forEach((tagId) => {
					totalsMap.set(tagId, (totalsMap.get(tagId) || 0) + total);
				});
			} else {
				untaggedTotal += total;
			}
		});

		return {
			totalsMap,
			untaggedTotal
		};
	});

	// MB-004: sum of all visible category totals (for the "Total" row in the breakdown)
	let visibleTagTotalSum = $derived.by(() => {
		let sum = 0;
		for (const id of visibleTagTotals) {
			sum += tagTotals.totalsMap.get(id) || 0;
		}
		return sum;
	});

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
				income: incomeVal,
				inflows: 0,
				expenses: 0,
				net: 0
			};
		}

		let sum = 0;
		let inflows = 0;
		let expenses = 0;
		let min = vals[0];
		let max = vals[0];

		vals.forEach(v => {
			sum += v;
			if (v > 0) {
				inflows += v;
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
			income: incomeVal,
			inflows,
			expenses,
			net
		};
	});

	let savingsVal = $derived(
		incomeVal + stats.net
	);

	function saveRows() {
		updateAttributes({ data: JSON.stringify(rows) });
	}

	// MT-001/MT-003: multi-tag helpers
	function getRowTagIds(row: any): string[] {
		return Array.isArray(row?.tagIds) ? row.tagIds : (row?.tagId ? [row.tagId] : []);
	}

	function getRowTags(row: any) {
		return getRowTagIds(row)
			.map((id) => appState.calcTags.find((t) => t.id === id))
			.filter((t): t is NonNullable<typeof t> => !!t);
	}

	function rowHasTag(row: any, tagId: string): boolean {
		return getRowTagIds(row).includes(tagId);
	}

	function toggleRowTag(row: any, tagId: string) {
		const ids = getRowTagIds(row);
		if (ids.includes(tagId)) {
			row.tagIds = ids.filter((id) => id !== tagId);
		} else {
			row.tagIds = [...ids, tagId];
		}
		saveRows();
	}

	function clearRowTags(row: any) {
		row.tagIds = [];
		saveRows();
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
			const labelInputs = document.querySelectorAll(`.metrics-row-wrapper-${$nodeStore.attrs.id || ''} .row-label-input`);
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
				const labelInputs = document.querySelectorAll(`.metrics-row-wrapper-${$nodeStore.attrs.id || ''} .row-label-input`);
				const nextInput = labelInputs[index + 1] as HTMLInputElement | null;
				nextInput?.focus();
			});
		} else if (event.key === 'Backspace') {
			if (rows[index].label === '') {
				event.preventDefault();
				deleteRow(index);

				tick().then(() => {
					const labelInputs = document.querySelectorAll(`.metrics-row-wrapper-${$nodeStore.attrs.id || ''} .row-label-input`);
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
		e.preventDefault();
		e.stopPropagation();
		showSettings = !showSettings;
	}

	// MB-012: detect mobile viewport so dropdowns/popovers can render as bottom sheets
	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 600px)');
		const update = () => { isMobile = mq.matches; };
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});

	// MB-005: open the row tag picker, computing fixed coordinates that escape the
	// scrollable card body and auto-flip above the button when near the viewport bottom.
	function toggleTagPicker(event: MouseEvent, rowId: string) {
		event.preventDefault();
		event.stopPropagation();
		if (activeTagPickerRowId === rowId) {
			activeTagPickerRowId = null;
			tagPickerCoords = null;
			return;
		}
		// On mobile, drop any lingering text-field focus so the virtual keyboard closes
		// before the picker (rendered as a bottom sheet) appears.
		if (typeof document !== 'undefined') {
			(document.activeElement as HTMLElement)?.blur?.();
		}
		tagPickerSearch = '';
		const btn = event.currentTarget as HTMLElement;
		const rect = btn.getBoundingClientRect();
		const MENU_HEIGHT = 260;
		const spaceBelow = window.innerHeight - rect.bottom;
		const flip = spaceBelow < MENU_HEIGHT && rect.top > spaceBelow;
		tagPickerCoords = {
			left: rect.left,
			top: flip ? rect.top : rect.bottom,
			flip,
			width: rect.width
		};
		activeTagPickerRowId = rowId;
	}

	// MB-005: dismiss the tag picker when the parent scroll container or window scrolls
	$effect(() => {
		if (!activeTagPickerRowId || isMobile) return;
		const close = () => {
			activeTagPickerRowId = null;
			tagPickerCoords = null;
		};
		window.addEventListener('scroll', close, true);
		window.addEventListener('resize', close);
		return () => {
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('resize', close);
		};
	});

	$effect(() => {
		if (showSettings) {
			const close = (event: MouseEvent) => {
				const target = event.target as HTMLElement | null;
				if (target && !target.closest('.settings-dropdown-menu') && !target.closest('.settings-trigger-btn')) {
					showSettings = false;
				}
			};
			const onKey = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					showSettings = false;
				}
			};
			const timer = setTimeout(() => {
				window.addEventListener('click', close);
				window.addEventListener('keydown', onKey);
			}, 0);
			return () => {
				clearTimeout(timer);
				window.removeEventListener('click', close);
				window.removeEventListener('keydown', onKey);
			};
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
	class="metrics-card-wrapper metrics-row-wrapper-{$nodeStore.attrs.id || ''}"
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
		<span class="metrics-card-icon"><BarChart3 size={16} strokeWidth={2.2} /></span>
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
				<button 
					class="settings-trigger-btn" 
					onmousedown={(e) => { e.preventDefault(); e.stopPropagation(); }} 
					onclick={toggleSettingsMenu} 
					title="Metrics settings"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</button>
				{#if showSettings}
					{#if isMobile}
						<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
						<div class="mb-sheet-backdrop" onclick={() => showSettings = false}></div>
					{/if}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="settings-dropdown-menu" class:mb-bottom-sheet={isMobile} onclick={(e) => e.stopPropagation()}>
						<!-- MB-006: Popover header with title + close button -->
						<div class="settings-popover-header flex-row">
							<span class="settings-popover-title flex-row">
								<Settings size={13} />
								<span>Block Settings</span>
							</span>
							<button type="button" class="settings-popover-close" onclick={() => showSettings = false} title="Close settings">
								<X size={14} />
							</button>
						</div>
						<!-- Tab Header -->
						<div class="settings-tabs-header flex-row">
							<button
								type="button"
								onclick={() => activeSettingsTab = 'options'}
								class="settings-tab-btn"
								class:active={activeSettingsTab === 'options'}
							>
								Options
							</button>
							<button
								type="button"
								onclick={() => activeSettingsTab = 'categories'}
								class="settings-tab-btn"
								class:active={activeSettingsTab === 'categories'}
							>
								Categories
							</button>
						</div>

						{#if activeSettingsTab === 'options'}
							<div class="settings-tab-content flex-col">
								<label class="settings-option flex-row">
									<input
										type="checkbox"
										class="mb-check"
										checked={excludeChecked}
										onchange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											updateAttributes({ excludeChecked: checked });
										}}
									/>
									<span>Exclude checked rows</span>
								</label>

								<div class="settings-menu-divider"></div>
								<div class="settings-menu-subtitle">Block Overrides</div>

								<!-- MB-003/MB-006: grouped override inputs in a card -->
								<!-- svelte-ignore a11y_label_has_associated_control -->
								<div class="settings-overrides-card flex-col">
									<div class="settings-override-field flex-col">
										<label class="settings-override-label">Income Label Override</label>
										<input
											type="text"
											class="settings-override-input"
											value={$nodeStore.attrs.incomeLabel || ''}
											placeholder={appState.defaultIncomeLabel || 'Income'}
											oninput={(e) => {
												updateAttributes({ incomeLabel: e.currentTarget.value });
											}}
										/>
									</div>

									<div class="settings-override-field flex-col">
										<label class="settings-override-label">Currency Symbol Override</label>
										<input
											type="text"
											class="settings-override-input"
											value={$nodeStore.attrs.currencyCode || ''}
											placeholder={appState.defaultCurrency || '₹'}
											oninput={(e) => {
												updateAttributes({ currencyCode: e.currentTarget.value });
											}}
										/>
									</div>

									<div class="settings-override-field flex-col">
										<label class="settings-override-label">Income Placeholder Override</label>
										<input
											type="text"
											class="settings-override-input"
											value={incomePlaceholder}
											placeholder="0"
											oninput={(e) => {
												updateAttributes({ incomePlaceholder: e.currentTarget.value });
											}}
										/>
									</div>
								</div>

								<div class="settings-menu-divider"></div>
								<div class="settings-menu-subtitle">Show Statistics</div>

								<label class="settings-option flex-row" class:is-disabled={!showSavings}>
									<input
										type="checkbox"
										class="mb-check"
										checked={showSavings && ($nodeStore.attrs.showIncome === 'true' || $nodeStore.attrs.showIncome === true)}
										disabled={!showSavings}
										onchange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											updateAttributes({ showIncome: checked });
										}}
									/>
									<span>{incomeLabel}</span>
								</label>

								<label class="settings-option flex-row">
									<input
										type="checkbox"
										class="mb-check"
										checked={showInflows}
										onchange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											updateAttributes({ showInflows: checked });
										}}
									/>
									<span>Inflows</span>
								</label>

								<label class="settings-option flex-row">
									<input
										type="checkbox"
										class="mb-check"
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
										class="mb-check"
										checked={showSavings}
										onchange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											updateAttributes({ showSavings: checked });
										}}
									/>
									<span>Savings</span>
								</label>

								<label class="settings-option flex-row">
									<input
										type="checkbox"
										class="mb-check"
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
										class="mb-check"
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
										class="mb-check"
										checked={showMedian}
										onchange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											updateAttributes({ showMedian: checked });
										}}
									/>
									<span>Median</span>
								</label>

								<div class="settings-menu-divider"></div>
								<div class="settings-menu-subtitle">Show Category Summaries</div>

								{#each appState.calcTags as tag}
									{@const isChecked = visibleTagTotals.includes(tag.id)}
									<label class="settings-option flex-row" class:is-dim={!tag.enabled}>
										<input
											type="checkbox"
											class="mb-check"
											checked={isChecked}
											onchange={(e) => {
												const checked = (e.target as HTMLInputElement).checked;
												let updated: string[];
												if (checked) {
													updated = [...visibleTagTotals, tag.id];
												} else {
													updated = visibleTagTotals.filter((id: string) => id !== tag.id);
												}
												updateAttributes({ visibleTagTotals: JSON.stringify(updated) });
											}}
										/>
										<span class="settings-option-tag flex-row">
											<span class="settings-tag-dot" style="background: {tag.color || 'var(--text-secondary)'};"></span>
											<span>{tag.name}</span>
										</span>
									</label>
								{:else}
									<span class="settings-empty-note">
										No categories created.
									</span>
								{/each}
							</div>
						{:else if activeSettingsTab === 'categories'}
							<!-- TAB 2: GLOBAL CATEGORIES MANAGER -->
							<div class="settings-tab-content settings-categories-tab flex-col">
								<div class="settings-categories-title">Manage Budget Categories</div>

								<!-- Add Category Form -->
								<form
									onsubmit={async (e) => {
										e.preventDefault();
										const name = newCalcTagName.trim();
										if (!name) return;
										if (appState.calcTags.some(t => t.normalizedName === name.toLowerCase())) {
											appState.showToast('Category already exists!', 'error', 3000);
											return;
										}
										const color = CALC_TAG_COLOR_PALETTE[Math.floor(Math.random() * CALC_TAG_COLOR_PALETTE.length)];
										await appState.createCalcTag(name, color);
										newCalcTagName = '';
										appState.showToast(`Category "${name}" created.`, 'success', 2000);
									}}
									class="settings-add-category-form flex-row"
								>
									<input
										type="text"
										class="settings-category-add-input"
										placeholder="New category..."
										bind:value={newCalcTagName}
									/>
									<button
										type="submit"
										class="settings-category-add-btn"
										disabled={!newCalcTagName.trim()}
									>
										Add
									</button>
								</form>

								<!-- Scrollable Categories list -->
								<div class="settings-category-list flex-col">
									{#each appState.calcTags as tag (tag.id)}
										<div class="settings-category-item flex-row">
											<!-- Color Dot Selector -->
											<div class="settings-color-dot-wrapper">
												<button
													type="button"
													class="settings-color-dot-btn"
													onclick={() => {
														if (calcTagColorPickerOpen === tag.id) {
															calcTagColorPickerOpen = null;
														} else {
															calcTagColorPickerOpen = tag.id;
															calcTagCustomHex = tag.color || '';
														}
													}}
													style="background-color: {tag.color || 'var(--text-secondary)'};"
													title="Change color"
												></button>

												<!-- Color Picker Dropdown Popover -->
												{#if calcTagColorPickerOpen === tag.id}
													<!-- svelte-ignore a11y_no_static_element_interactions -->
													<div
														class="settings-color-picker-backdrop"
														onclick={() => calcTagColorPickerOpen = null}
													></div>
													<div class="settings-color-picker-popover flex-col">
														<div class="settings-color-picker-title">Select Color</div>
														<div class="settings-color-grid">
															{#each CALC_TAG_COLOR_PALETTE as color}
																<button
																	type="button"
																	class="settings-color-swatch"
																	class:selected={tag.color === color}
																	onclick={async () => {
																		await appState.setCalcTagColor(tag.id, color);
																		calcTagColorPickerOpen = null;
																	}}
																	style="background-color: {color};"
																	aria-label={`Set color ${color}`}
																></button>
															{/each}
														</div>

														<!-- Custom Hex Input -->
														<div class="settings-color-hex-row flex-row">
															<input
																type="text"
																class="settings-color-hex-input"
																placeholder="#HEX"
																bind:value={calcTagCustomHex}
															/>
															<button
																type="button"
																class="settings-color-hex-btn"
																disabled={!isCalcTagHexValid}
																onclick={async () => {
																	await appState.setCalcTagColor(tag.id, normalizedCalcTagHex);
																	calcTagColorPickerOpen = null;
																}}
															>
																Set
															</button>
														</div>
													</div>
												{/if}
											</div>

											<!-- Rename input -->
											<input
												type="text"
												class="settings-category-rename-input"
												value={tag.name}
												onblur={async (e) => {
													const newName = e.currentTarget.value.trim();
													if (newName === tag.name) return;
													if (!newName) {
														e.currentTarget.value = tag.name;
														return;
													}
													if (appState.calcTags.some(t => t.id !== tag.id && t.normalizedName === newName.toLowerCase())) {
														appState.showToast('Category name already exists!', 'error', 3000);
														e.currentTarget.value = tag.name;
														return;
													}
													await appState.renameCalcTag(tag.id, newName);
													appState.showToast(`Category renamed to "${newName}".`, 'success', 2000);
												}}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.currentTarget.blur();
													}
												}}
											/>

											<!-- Enabled Toggle -->
											<label class="settings-category-active-label flex-row">
												<input
													type="checkbox"
													class="mb-check mb-check-sm"
													checked={tag.enabled}
													onchange={async (e) => {
														const checked = e.currentTarget.checked;
														await appState.setCalcTagEnabled(tag.id, checked);
														appState.showToast(`Category ${tag.name} ${checked ? 'enabled' : 'disabled'}.`, 'info', 2000);
													}}
												/>
												<span>Active</span>
											</label>

											<!-- Delete Button -->
											<button
												type="button"
												class="settings-category-delete-btn"
												onclick={() => {
													appState.showConfirmation({
														title: 'Delete Category',
														message: `Are you sure you want to delete category "${tag.name}"? Existing row assignments in calculation boxes will revert to "Untagged".`,
														confirmText: 'Delete',
														onConfirm: async () => {
															await appState.deleteCalcTag(tag.id);
															appState.showToast(`Category "${tag.name}" deleted.`, 'success', 2000);
														}
													});
												}}
												title="Delete category"
											>
												<Trash2 size={12} />
											</button>
										</div>
									{:else}
										<span class="settings-empty-note settings-empty-note-center">
											No categories. Add one above!
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
	
	<!-- MT-005: reusable multi-tag pill renderer; "+N" expands to reveal every tag -->
	{#snippet tagPills(tags: any[], rowId: string, inline: boolean)}
		{@const isExpanded = expandedTagRows.includes(rowId)}
		{@const visible = isExpanded ? tags : tags.slice(0, MAX_VISIBLE_ROW_TAGS)}
		{@const hiddenCount = tags.length - visible.length}
		<span 
			class="metrics-row-tags" 
			class:is-inline={inline}
			onmousedown={(e) => e.stopPropagation()}
			onclick={(e) => e.stopPropagation()}
			ontouchstart={(e) => e.stopPropagation()}
			ontouchend={(e) => e.stopPropagation()}
		>
			{#each visible as t}
				<span
					class="metrics-row-tag-pill"
					style="background: color-mix(in srgb, {t.color || 'var(--text-tertiary)'} 14%, transparent); border-color: color-mix(in srgb, {t.color || 'var(--text-tertiary)'} 32%, transparent); color: {t.color || 'var(--text-secondary)'};"
					title={t.enabled ? t.name : `${t.name} (Disabled)`}
				>
					<span class="metrics-row-tag-dot" style="background: {t.color || 'var(--text-secondary)'};"></span>
					{t.name}
				</span>
			{/each}
			{#if hiddenCount > 0}
				<button
					type="button"
					class="metrics-row-tag-pill metrics-row-tag-overflow"
					title={tags.slice(MAX_VISIBLE_ROW_TAGS).map((t) => t.name).join(', ')}
					onmousedown={(e) => e.preventDefault()}
					onclick={(e) => toggleExpandTags(e, rowId)}
				>
					+{hiddenCount}
				</button>
			{:else if isExpanded && tags.length > MAX_VISIBLE_ROW_TAGS}
				<button
					type="button"
					class="metrics-row-tag-pill metrics-row-tag-overflow"
					title="Show fewer tags"
					onmousedown={(e) => e.preventDefault()}
					onclick={(e) => toggleExpandTags(e, rowId)}
				>
					Less
				</button>
			{/if}
		</span>
	{/snippet}

	<!-- Mobile fix: tag picker lives on an always-visible line (not tied to edit mode / contenteditable focus) -->
	{#snippet rowTagPicker(row: any, rowTags: any[])}
		<div class="metrics-row-tag-dropdown-container">
			<button
				type="button"
				class="row-tag-trigger flex-row"
				class:has-tags={rowTags.length > 0}
				onmousedown={(e) => e.preventDefault()}
				onclick={(e) => toggleTagPicker(e, row.id)}
				title="Categorize row"
			>
				<Tag size={11} />
				{#if rowTags.length === 0}
					<span class="row-tag-trigger-text">Tag</span>
				{/if}
			</button>

			{#if activeTagPickerRowId === row.id}
				{@const pickerTags = appState.calcTags.filter(t => (t.enabled || rowHasTag(row, t.id)) && (!tagPickerSearch.trim() || t.name.toLowerCase().includes(tagPickerSearch.trim().toLowerCase())))}
				{@const showSearch = appState.calcTags.filter(t => t.enabled || rowHasTag(row, t.id)).length > 5}
				<!-- Click-away backdrop overlay -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="tag-picker-backdrop"
					class:is-dim={isMobile}
					onclick={(e) => {
						e.stopPropagation();
						activeTagPickerRowId = null;
						tagPickerCoords = null;
					}}
				></div>
				<!-- Dropdown / bottom sheet (fixed-positioned so it escapes the scroll container) -->
				<div
					class="metrics-row-tag-dropdown-menu flex-col"
					class:mb-bottom-sheet={isMobile}
					class:flip-up={!isMobile && tagPickerCoords?.flip}
					style={isMobile || !tagPickerCoords ? '' : `left: ${tagPickerCoords.left}px; ${tagPickerCoords.flip ? `bottom: ${window.innerHeight - tagPickerCoords.top}px;` : `top: ${tagPickerCoords.top + 4}px;`}`}
					onmousedown={(e) => e.stopPropagation()}
					onclick={(e) => e.stopPropagation()}
				>
					<div class="tag-picker-header flex-row">
						<span class="tag-picker-header-title">Categorize</span>
						<span class="tag-picker-header-count">{getRowTagIds(row).length} selected</span>
					</div>
					{#if showSearch}
						<div class="tag-picker-search flex-row">
							<Search size={12} />
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								class="tag-picker-search-input"
								placeholder="Search categories..."
								bind:value={tagPickerSearch}
								autofocus={!isMobile}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										const first = pickerTags[0];
										if (first) {
											toggleRowTag(row, first.id);
										}
									} else if (e.key === 'Escape') {
										activeTagPickerRowId = null;
										tagPickerCoords = null;
									}
								}}
							/>
						</div>
					{/if}
					<div class="tag-picker-list flex-col">
						<button
							type="button"
							class="tag-dropdown-item tag-dropdown-clear flex-row"
							disabled={getRowTagIds(row).length === 0}
							onmousedown={(e) => e.preventDefault()}
							onclick={() => clearRowTags(row)}
						>
							<X size={12} />
							<span>Clear tags</span>
						</button>
						{#each pickerTags as tag}
							{@const isSel = rowHasTag(row, tag.id)}
							<button
								type="button"
								class="tag-dropdown-item tag-dropdown-toggle flex-row"
								class:selected={isSel}
								onmousedown={(e) => e.preventDefault()}
								onclick={() => toggleRowTag(row, tag.id)}
							>
								<span class="tag-dropdown-check" class:checked={isSel}></span>
								<span class="tag-dot" style="background: {tag.color || 'var(--text-secondary)'};"></span>
								<span class="tag-dropdown-name">{tag.name}</span>
								{#if !tag.enabled}
									<span class="tag-dropdown-disabled">disabled</span>
								{/if}
							</button>
						{:else}
							<span class="tag-picker-empty">No matches</span>
						{/each}
					</div>
					<button
						type="button"
						class="tag-picker-done"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => { activeTagPickerRowId = null; tagPickerCoords = null; }}
					>
						Done
					</button>
				</div>
			{/if}
		</div>
	{/snippet}

	<!-- Income Row -->
	{#if showIncome}
		<div class="metrics-income-row flex-row">
			<span class="income-label">{incomeLabel}</span>
			<span class="income-currency">{currencyCode}</span>
			{#if !appState.isReadOnly}
				<input
					type="text"
					class="income-input-field"
					class:negative={incomeVal < 0}
					bind:value={localIncomeStr}
					onfocus={handleIncomeFocus}
					onblur={handleIncomeBlur}
					onkeydown={handleIncomeKeyDown}
					placeholder={incomePlaceholder || '0'}
				/>
			{:else}
				<span class="income-value-readonly" class:negative={incomeVal < 0}>
					{incomeVal.toLocaleString()}
				</span>
			{/if}
			{#if incomeVal < 0}
				<span class="income-warning-icon" title="Negative income is unusual">⚠️</span>
			{/if}
		</div>
	{/if}

	<!-- Rows Body -->
	<div class="metrics-card-body">
		{#if rows.length === 0 && appState.isReadOnly}
			<div class="metrics-empty-state">No metrics recorded</div>
		{/if}

		{#each rows as row, index (row.id)}
			{@const numbers = getRowNumbers(row.label)}
			{@const total = numbers.reduce((sum, n) => sum + n, 0)}
			{@const rowTags = getRowTags(row)}
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
				onfocusout={(e) => {
					if (isInsertingDate) {
						isInsertingDate = false;
						return;
					}
					const related = e.relatedTarget as HTMLElement | null;
					if (related && e.currentTarget.contains(related)) {
						return;
					}
					saveRows();
					editingRowIndex = null;
				}}
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
					><GripVertical size={14} /></div>
					<input
						type="checkbox"
						class="row-item-checkbox mb-check"
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
					<div class="row-content-stack">
						{#if editingRowIndex === index}
							<div class="row-edit-line flex-row">
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									contenteditable="plaintext-only"
									class="row-label-input editing"
									data-row-id={row.id}
									bind:textContent={row.label}
									placeholder="List item (e.g. groceries 2000)..."
									oninput={(e) => handleRowInput(e, row)}
									onkeydown={(e) => handleKeyDown(e, index)}
									use:focusOnMount
								></div>
								<button
									type="button"
									class="row-date-insert-btn"
									onmousedown={(e) => {
										e.preventDefault();
										isInsertingDate = true;
									}}
									onclick={(e) => handleInsertDate(e, row.id)}
									title="Insert today's date"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
								</button>
							</div>
						{:else}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="row-label-input preview-mode"
								onclick={() => { editingRowIndex = index; }}
								title="Click to edit"
							>
								{#if row.label.trim() === ''}
									<span class="row-label-placeholder">List item (e.g. groceries 2000)...</span>
								{:else}
									{@html renderFormattedLabel(row.label)}
								{/if}
							</div>
						{/if}

						<!-- Tags line: ALWAYS visible so tagging works in preview mode without
						     focusing the contenteditable (which is what summoned the keyboard). -->
						<div class="row-tags-line">
							{#if rowTags.length > 0}
								{@render tagPills(rowTags, row.id, false)}
							{/if}
							{@render rowTagPicker(row, rowTags)}
						</div>
					</div>
				{:else}
					<div class="row-content-stack readonly">
						<div class="row-label-input readonly-label-text">
							{#if row.label.trim() === ''}
								<span class="row-label-placeholder">Empty item</span>
							{:else}
								{@html renderFormattedLabel(row.label)}
							{/if}
						</div>

						{#if rowTags.length > 0}
							<div class="row-tags-line">
								{@render tagPills(rowTags, row.id, true)}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Trailing group: sum badge + delete, kept together and right-aligned -->
				<div class="row-trailing-group flex-row">
					<!-- Sum Badge Display -->
					{#if numbers.length > 0}
						<span
							class="row-sum-badge"
							class:positive={total > 0}
							class:negative={total < 0}
						>
							{total > 0 ? '+' : ''}{currencyCode}{Math.abs(total).toLocaleString()}
						</span>
					{/if}

					{#if !appState.isReadOnly}
						<button class="row-delete-action" onclick={() => deleteRow(index)} title="Delete row">
							<X size={13} />
						</button>
					{/if}
				</div>
			</div>
		{/each}

		{#if !appState.isReadOnly}
			<button class="add-row-action flex-row" onclick={addRow}>
				<Plus size={14} strokeWidth={2.5} />
				<span>Add Row</span>
			</button>
		{/if}
	</div>

	<!-- Category summaries display -->
	{#if visibleTagTotals && visibleTagTotals.length > 0}
		<div class="metrics-tag-totals-section">
			<div class="metrics-tag-totals-header">
				<span class="metrics-tag-totals-title">Category Breakdown</span>
			</div>
			<div class="metrics-tag-totals-chips flex-row">
				{#each visibleTagTotals as tagId}
					{@const tag = appState.calcTags.find(t => t.id === tagId)}
					{@const totalVal = tagTotals.totalsMap.get(tagId) || 0}
					{#if tag}
						<div
							class="tag-total-chip flex-row"
							class:is-zero={totalVal === 0}
							style="background: color-mix(in srgb, {tag.color || 'var(--text-tertiary)'} 10%, transparent); border-color: color-mix(in srgb, {tag.color || 'var(--text-tertiary)'} 24%, transparent);"
						>
							<span
								class="tag-total-dot"
								style="background: {tag.color || 'var(--text-secondary)'}; box-shadow: 0 0 6px color-mix(in srgb, {tag.color || 'var(--text-tertiary)'} 70%, transparent);"
							></span>
							<span class="tag-total-name">{tag.name}</span>
							<span
								class="tag-total-value"
								class:positive={totalVal > 0}
								class:negative={totalVal < 0}
							>
								{totalVal > 0 ? '+' : ''}{currencyCode}{Math.abs(totalVal).toLocaleString()}
							</span>
						</div>
					{/if}
				{/each}
			</div>
			{#if visibleTagTotals.length > 1}
				<div class="tag-total-summary flex-row">
					<span class="tag-total-summary-label">Total</span>
					<span
						class="tag-total-value"
						class:positive={visibleTagTotalSum > 0}
						class:negative={visibleTagTotalSum < 0}
					>
						{visibleTagTotalSum > 0 ? '+' : ''}{currencyCode}{Math.abs(visibleTagTotalSum).toLocaleString()}
					</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Savings Hero Panel -->
	{#if showSavings}
		<div class="metrics-savings-panel" class:positive={savingsVal > 0} class:negative={savingsVal < 0} class:neutral={savingsVal === 0}>
			<div class="savings-inner flex-row">
				<div class="savings-info">
					<span class="savings-label">Remaining Budget</span>
					<span class="savings-title">{savingsVal > 0 ? 'Safe to Spend' : (savingsVal < 0 ? 'Overspent' : 'Balanced')}</span>
				</div>
				<div class="savings-value flex-row">
					<span class="savings-currency">{currencyCode}</span>
					<span class="savings-amount">{savingsVal.toLocaleString()}</span>
				</div>
			</div>
		</div>
	{/if}

	<!-- Statistics Footer -->
	<div class="metrics-card-footer">
		<div class="stats-grid grid-layout">
			<div class="stat-badge flex-col">
				<span class="badge-label">Count</span>
				<span class="badge-value">{stats.count}</span>
			</div>
			{#if showIncome}
				<div class="stat-badge flex-col">
					<span class="badge-label">{incomeLabel}</span>
					<span class="badge-value positive">{stats.income.toLocaleString()}</span>
				</div>
			{/if}
			{#if showInflows}
				<div class="stat-badge flex-col">
					<span class="badge-label">Inflows</span>
					<span class="badge-value positive">{stats.inflows.toLocaleString()}</span>
				</div>
			{/if}
			{#if showExpenses}
				<div class="stat-badge flex-col">
					<span class="badge-label">Expenses</span>
					<span class="badge-value negative">{stats.expenses.toLocaleString()}</span>
				</div>
			{/if}
			<div class="stat-badge flex-col">
				<span class="badge-label">Net Total</span>
				<span class="badge-value" class:positive={stats.net > 0} class:negative={stats.net < 0}>
					{stats.net < 0 ? '-' : ''}{currencyCode}{Math.abs(stats.net).toLocaleString()}
				</span>
			</div>
			<div class="stat-badge flex-col">
				<span class="badge-label">Average</span>
				<span class="badge-value">{stats.average.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
			</div>
			{#if showMin}
				<div class="stat-badge flex-col">
					<span class="badge-label">Min</span>
					<span class="badge-value" class:positive={stats.min > 0} class:negative={stats.min < 0}>
						{stats.min.toLocaleString()}
					</span>
				</div>
			{/if}
			{#if showMax}
				<div class="stat-badge flex-col">
					<span class="badge-label">Max</span>
					<span class="badge-value" class:positive={stats.max > 0} class:negative={stats.max < 0}>
						{stats.max.toLocaleString()}
					</span>
				</div>
			{/if}
			{#if showMedian}
				<div class="stat-badge flex-col">
					<span class="badge-label">Median</span>
					<span class="badge-value" class:positive={stats.median > 0} class:negative={stats.median < 0}>
						{stats.median.toLocaleString()}
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
		border-top-left-radius: 11px;
		border-top-right-radius: 11px;
	}

	.metrics-card-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	/* MB-001: Custom styled checkbox (cross-platform, SVG checkmark via mask) */
	.mb-check {
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-subtle);
		border: 1.5px solid var(--border-highlight);
		background: color-mix(in srgb, var(--bg-base) 40%, transparent);
		cursor: pointer;
		position: relative;
		transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
			border-color var(--motion-duration-fast) var(--motion-ease-standard);
	}

	.mb-check.mb-check-sm {
		width: 14px;
		height: 14px;
	}

	.mb-check:hover {
		border-color: var(--accent);
	}

	.mb-check:checked {
		background-color: var(--accent);
		border-color: var(--accent);
	}

	.mb-check:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		background-color: var(--bg-primary);
		-webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>") center / 70% 70% no-repeat;
		mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>") center / 70% 70% no-repeat;
	}

	.mb-check:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.mb-check:disabled {
		cursor: not-allowed;
		opacity: 0.5;
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
		top: calc(100% + var(--spacing-2xs));
		right: 0;
		z-index: var(--z-index-popover);
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-comfortable);
		box-shadow: var(--shadow-heavy);
		padding: var(--spacing-sm);
		min-width: 240px;
		max-width: 300px;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		transform-origin: top right;
		animation: mb-popover-in var(--motion-duration-standard) var(--motion-ease-out);
	}

	@keyframes mb-popover-in {
		from { opacity: 0; transform: scale(0.94) translateY(-4px); }
		to { opacity: 1; transform: scale(1) translateY(0); }
	}

	/* MB-006: settings popover header */
	.settings-popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-xs);
		padding-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--border-color);
	}

	.settings-popover-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-2xs);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		color: var(--text-primary);
	}

	.settings-popover-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: var(--spacing-3xs);
		border-radius: var(--radius-subtle);
		transition: background-color var(--motion-duration-fast), color var(--motion-duration-fast);
	}

	.settings-popover-close:hover {
		background: color-mix(in srgb, var(--text-primary) 8%, transparent);
		color: var(--text-primary);
	}

	.settings-tabs-header {
		display: flex;
		gap: var(--spacing-xs);
		justify-content: space-between;
		width: 100%;
		padding-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--border-color);
	}

	/* MB-006: scrollable tab content */
	.settings-tab-content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		width: 100%;
		max-height: 320px;
		overflow-y: auto;
		padding-right: var(--spacing-2xs);
	}

	.settings-categories-tab {
		gap: var(--spacing-sm);
		min-width: 250px;
	}

	.settings-menu-divider {
		height: 1px;
		background: var(--border-color);
		margin: var(--spacing-2xs) 0;
	}

	.settings-menu-subtitle {
		font-size: 10px;
		font-weight: var(--font-weight-bold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: var(--spacing-3xs);
	}

	.settings-option {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--text-primary);
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
	}

	.settings-option.is-disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.settings-option.is-dim {
		opacity: 0.6;
	}

	.settings-option-tag {
		display: flex;
		align-items: center;
		gap: var(--spacing-2xs);
	}

	.settings-tag-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-circle);
		display: inline-block;
		flex-shrink: 0;
	}

	.settings-empty-note {
		font-size: 11px;
		font-style: italic;
		color: var(--text-tertiary);
		padding: var(--spacing-3xs) var(--spacing-2xs);
	}

	.settings-empty-note-center {
		text-align: center;
		padding: var(--spacing-xs) 0;
		width: 100%;
	}

	/* MB-003/MB-006: grouped override inputs card */
	.settings-overrides-card {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		background: color-mix(in srgb, var(--bg-base) 35%, transparent);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-comfortable);
		padding: var(--spacing-sm);
	}

	.settings-override-field {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3xs);
	}

	.settings-override-label {
		font-size: 11px;
		color: var(--text-secondary);
		font-weight: var(--font-weight-semibold);
	}

	.settings-override-input,
	.settings-category-add-input,
	.settings-color-hex-input {
		background: color-mix(in srgb, var(--bg-base) 40%, transparent);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-subtle);
		padding: var(--spacing-2xs) var(--spacing-xs);
		font-size: 11px;
		color: var(--text-primary);
		outline: none;
		width: 100%;
		box-sizing: border-box;
		transition: border-color var(--motion-duration-fast), box-shadow var(--motion-duration-fast);
	}

	.settings-override-input:focus,
	.settings-category-add-input:focus,
	.settings-color-hex-input:focus,
	.settings-category-rename-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent-light);
	}

	/* MB-003: category manager */
	.settings-categories-title {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		color: var(--text-secondary);
		margin-bottom: var(--spacing-3xs);
	}

	.settings-add-category-form {
		display: flex;
		gap: var(--spacing-2xs);
		margin-bottom: var(--spacing-2xs);
	}

	.settings-category-add-input {
		flex: 1;
	}

	.settings-category-add-btn {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		padding: var(--spacing-2xs) var(--spacing-sm);
		border-radius: var(--radius-subtle);
		font-weight: var(--font-weight-bold);
		font-size: 11px;
		cursor: pointer;
		transition: opacity var(--motion-duration-standard);
	}

	.settings-category-add-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.settings-category-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xs);
		max-height: 220px;
		overflow-y: auto;
		padding-right: var(--spacing-2xs);
		width: 100%;
	}

	.settings-category-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		background: color-mix(in srgb, var(--text-primary) 2%, transparent);
		border: 1px solid var(--border-color);
		padding: var(--spacing-2xs) var(--spacing-xs);
		border-radius: var(--radius-subtle);
		position: relative;
		width: 100%;
		box-sizing: border-box;
	}

	.settings-color-dot-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.settings-color-dot-btn {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-circle);
		border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
		cursor: pointer;
		padding: 0;
	}

	.settings-color-picker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 998;
	}

	.settings-color-picker-popover {
		position: absolute;
		top: calc(100% + var(--spacing-2xs));
		left: 0;
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-standard);
		box-shadow: var(--shadow-heavy);
		padding: var(--spacing-xs);
		min-width: 140px;
		z-index: 999;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xs);
	}

	.settings-color-picker-title {
		font-size: 10px;
		font-weight: var(--font-weight-bold);
		color: var(--text-secondary);
	}

	.settings-color-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--spacing-2xs);
	}

	.settings-color-swatch {
		width: 18px;
		height: 18px;
		border-radius: var(--radius-circle);
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
	}

	.settings-color-swatch.selected {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.settings-color-hex-row {
		display: flex;
		gap: var(--spacing-2xs);
		align-items: center;
		border-top: 1px dashed var(--border-color);
		padding-top: var(--spacing-2xs);
		margin-top: var(--spacing-3xs);
	}

	.settings-color-hex-input {
		width: 55px;
		padding: 1px var(--spacing-3xs);
		font-size: 9px;
	}

	.settings-color-hex-btn {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-subtle);
		padding: 1px var(--spacing-2xs);
		font-size: 9px;
		font-weight: var(--font-weight-bold);
		cursor: pointer;
	}

	.settings-color-hex-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.settings-category-rename-input {
		flex: 1;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-subtle);
		font-size: 11px;
		font-weight: var(--font-weight-semibold);
		color: var(--text-primary);
		outline: none;
		padding: var(--spacing-3xs) var(--spacing-2xs);
		min-width: 0;
		transition: border-color var(--motion-duration-fast), box-shadow var(--motion-duration-fast);
	}

	.settings-category-active-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-2xs);
		cursor: pointer;
		font-size: 10px;
		color: var(--text-secondary);
		user-select: none;
		margin-left: auto;
	}

	.settings-category-delete-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: var(--spacing-3xs);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-subtle);
		transition: color var(--motion-duration-fast), background-color var(--motion-duration-fast);
	}

	.settings-category-delete-btn:hover {
		color: var(--semantic-error);
		background: color-mix(in srgb, var(--semantic-error) 12%, transparent);
	}

	.metrics-card-body {
		padding: var(--spacing-sm) var(--spacing-xs);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
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
		align-items: flex-start;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-xs);
		border-radius: var(--radius-standard);
		transition: background-color 0.15s;
		box-sizing: border-box;
		min-height: 40px;
	}

	.metrics-card-row:hover {
		background: color-mix(in srgb, var(--text-primary) 4%, transparent);
	}

	.metrics-card-row.dragging {
		opacity: 0.4;
		border: 1px dashed var(--accent);
	}

	.metrics-card-row.drag-over-above {
		border-top: 2px solid var(--accent) !important;
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.metrics-card-row.drag-over-below {
		border-bottom: 2px solid var(--accent) !important;
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.row-drag-handle-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		cursor: grab;
		user-select: none;
		padding: var(--spacing-2xs);
		margin-top: 2px;
		flex-shrink: 0;
		touch-action: none;
	}

	.row-drag-handle-btn:hover {
		color: var(--text-secondary);
	}

	.row-drag-handle-btn:active {
		cursor: grabbing;
	}

	.row-item-checkbox {
		margin-top: 4px;
	}

	.row-item-checkbox-readonly {
		font-size: 14px;
		color: var(--text-secondary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		user-select: none;
		margin-top: 2px;
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

	.row-label-input.editing {
		border-bottom-color: var(--accent);
	}

	/* Redesign: label gets its own full-width line, tags drop beneath it */
	.row-content-stack {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
		width: 100%;
	}

	.row-tags-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding-top: 2px;
	}

	.row-label-input.preview-mode {
		cursor: text;
		border-bottom-color: transparent;
		white-space: normal;
		overflow: visible;
		text-overflow: clip;
		word-break: break-word;
		width: 100%;
	}

	.row-label-input.preview-mode:hover {
		background: color-mix(in srgb, var(--text-primary) 2%, transparent);
		border-radius: var(--radius-subtle);
	}

	/* MB-003: tag pill (preview + readonly) */
	.metrics-row-tag-pill {
		font-size: 10px;
		padding: 1px var(--spacing-2xs);
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		font-weight: var(--font-weight-semibold);
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* MT-005: multi-tag pill container + overflow */
	.metrics-row-tags {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-3xs);
		min-width: 0;
		max-width: 100%;
	}

	.metrics-row-tags.is-inline {
		vertical-align: middle;
	}

	.metrics-row-tag-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.metrics-row-tag-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-circle);
		flex-shrink: 0;
	}

	.metrics-row-tag-overflow {
		background: color-mix(in srgb, var(--text-primary) 9%, transparent);
		border-color: var(--border-highlight);
		color: var(--text-secondary);
		cursor: pointer;
		font-family: inherit;
		line-height: 1.4;
		transition: background-color var(--motion-duration-fast), color var(--motion-duration-fast);
	}

	.metrics-row-tag-overflow:hover {
		background: var(--accent-light);
		border-color: var(--accent);
		color: var(--text-primary);
	}

	/* MB-007: trailing group keeps badge + delete together, right aligned */
	.row-trailing-group {
		display: flex;
		align-items: center;
		gap: var(--spacing-2xs);
		flex-shrink: 0;
		margin-top: 2px;
		margin-left: auto;
	}

	.row-label-input[contenteditable="true"]:empty::before {
		content: attr(placeholder);
		color: var(--text-tertiary, #888);
		pointer-events: none;
		display: inline-block;
	}

	.row-label-placeholder {
		color: var(--text-tertiary, #888);
		font-style: italic;
	}

	.row-date-insert-btn {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.15s, color 0.15s;
		flex-shrink: 0;
	}

	.row-date-insert-btn:hover {
		background: var(--bg-hover);
		color: var(--accent);
	}

	:global(.metrics-num-pos) {
		color: var(--semantic-success, #22c55e) !important;
		font-weight: 600;
	}

	:global(.metrics-num-neg) {
		color: var(--semantic-error, #ff4d4d) !important;
		font-weight: 600;
	}

	:global(.metrics-num-zero) {
		color: var(--text-secondary) !important;
		font-weight: 600;
	}

	.row-sum-badge {
		font-size: 11px;
		font-weight: var(--font-weight-bold);
		color: var(--text-secondary);
		background: color-mix(in srgb, var(--text-primary) 5%, transparent);
		border: 1px solid var(--border-color);
		padding: var(--spacing-3xs) var(--spacing-xs);
		border-radius: var(--radius-standard);
		font-family: var(--font-mono);
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.row-sum-badge.positive {
		color: var(--semantic-success);
		background: color-mix(in srgb, var(--semantic-success) 8%, transparent);
		border-color: color-mix(in srgb, var(--semantic-success) 15%, transparent);
	}

	.row-sum-badge.negative {
		color: var(--semantic-error);
		background: color-mix(in srgb, var(--semantic-error) 8%, transparent);
		border-color: color-mix(in srgb, var(--semantic-error) 15%, transparent);
	}

	.row-delete-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: var(--spacing-3xs);
		border-radius: var(--radius-subtle);
		opacity: 0;
		transition: opacity 0.15s, background-color 0.15s, color 0.15s;
	}

	.metrics-card-row:hover .row-delete-action {
		opacity: 1;
	}

	.row-delete-action:hover {
		background: color-mix(in srgb, var(--semantic-error) 15%, var(--bg-surface));
		color: var(--semantic-error);
	}

	/* MB-008: prominent Add Row CTA */
	.add-row-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2xs);
		background: color-mix(in srgb, var(--text-primary) 2%, transparent);
		border: 1px dashed var(--border-highlight);
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-standard);
		width: 100%;
		box-sizing: border-box;
		margin-top: var(--spacing-2xs);
		transition: background-color 0.15s, color 0.15s, border-color 0.15s;
	}

	.add-row-action:hover {
		background: var(--accent-light);
		border-style: solid;
		border-color: var(--accent);
		color: var(--text-primary);
	}

	/* MB-004: Category Breakdown section */
	.metrics-tag-totals-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-md);
		border-top: 1px dashed var(--border-color);
		margin-top: var(--spacing-2xs);
		margin-bottom: var(--spacing-xs);
	}

	.metrics-tag-totals-header {
		display: flex;
		align-items: center;
	}

	.metrics-tag-totals-title {
		font-size: 10px;
		font-weight: var(--font-weight-bold);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.metrics-tag-totals-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
	}

	.tag-total-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-2xs);
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		padding: var(--spacing-3xs) var(--spacing-xs);
		font-size: 11px;
		user-select: none;
		transition: opacity var(--motion-duration-fast);
	}

	.tag-total-chip.is-zero {
		opacity: 0.5;
	}

	.tag-total-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-circle);
		display: inline-block;
		flex-shrink: 0;
	}

	.tag-total-chip.is-zero .tag-total-dot {
		box-shadow: none !important;
	}

	.tag-total-name {
		font-weight: var(--font-weight-semibold);
		color: var(--text-secondary);
	}

	.tag-total-value {
		font-family: var(--font-mono);
		font-weight: var(--font-weight-bold);
		color: var(--text-primary);
	}

	.tag-total-value.positive {
		color: var(--semantic-success);
	}

	.tag-total-value.negative {
		color: var(--semantic-error);
	}

	.tag-total-chip.is-zero .tag-total-name,
	.tag-total-chip.is-zero .tag-total-value {
		color: var(--text-tertiary);
	}

	.tag-total-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-xs);
		padding-top: var(--spacing-xs);
		border-top: 1px solid var(--border-color);
	}

	.tag-total-summary-label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		color: var(--text-secondary);
	}

	.metrics-card-footer {
		padding: 12px 16px;
		background: color-mix(in srgb, var(--border-color) 15%, var(--bg-surface));
		border-top: 1px solid var(--border-color, #2a2d35);
		border-bottom-left-radius: 11px;
		border-bottom-right-radius: 11px;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 8px;
	}

	.stat-badge {
		display: flex;
		flex-direction: column;
		background: linear-gradient(160deg,
			color-mix(in srgb, var(--text-primary) 4%, var(--bg-secondary)) 0%,
			var(--bg-secondary) 100%);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-comfortable);
		padding: var(--spacing-2xs) var(--spacing-sm);
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		gap: var(--spacing-3xs);
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
		font-family: var(--font-mono);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: center;
	}

	.badge-value.positive {
		color: var(--semantic-success);
	}

	.badge-value.negative {
		color: var(--semantic-error);
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
	.metrics-income-row {
		display: flex;
		align-items: center;
		padding: 12px 16px;
		background: color-mix(in srgb, var(--border-color) 10%, var(--bg-surface));
		gap: 6px;
		font-size: 13px;
		border-bottom: 1px dashed var(--border-color, #2a2d35);
	}

	.income-label {
		font-weight: 600;
		color: var(--text-secondary, #a1a1aa);
		margin-right: auto;
	}

	.income-currency {
		color: var(--text-tertiary, #71717a);
		font-weight: 500;
	}

	.income-input-field {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary, #fff);
		outline: none;
		padding: 2px 6px;
		width: 100px;
		text-align: right;
		font-family: var(--font-mono, monospace);
		transition: border-color 0.15s, background-color 0.15s;
	}

	.income-input-field:focus {
		background: var(--bg-hover, rgba(255,255,255,0.05));
		border-color: var(--border-color, #2a2d35);
	}

	.income-input-field.negative,
	.income-value-readonly.negative {
		color: var(--semantic-error, #ff4d4d);
	}

	.income-value-readonly {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary, #fff);
		padding: 2px 6px;
		font-family: var(--font-mono, monospace);
		text-align: right;
		display: inline-block;
		min-width: 100px;
	}

	.income-warning-icon {
		color: var(--semantic-warning, #eab308);
		cursor: help;
		font-size: 12px;
	}

	.metrics-card-divider {
		height: 1px;
		background: transparent;
		margin-bottom: 8px;
	}

	@media (max-width: 600px) {
		.metrics-card-header {
			padding: var(--spacing-xs) var(--spacing-sm);
		}
		.metrics-card-body {
			padding: var(--spacing-xs) var(--spacing-2xs);
		}
		.metrics-card-row {
			gap: var(--spacing-2xs);
			padding: var(--spacing-xs) var(--spacing-2xs);
			min-height: 40px;
		}
		.row-label-input {
			font-size: 12px;
			padding: 2px;
		}
		.row-sum-badge {
			font-size: 10px;
			padding: 2px var(--spacing-2xs);
		}
		/* MB-012: delete always visible on touch (no !important needed) */
		.row-delete-action {
			opacity: 1;
			padding: var(--spacing-2xs);
		}
		/* MB-012: larger drag touch target */
		.row-drag-handle-btn {
			min-width: 32px;
			min-height: 32px;
		}
		.metrics-card-footer {
			padding: var(--spacing-xs) var(--spacing-sm);
		}
		/* MB-012: fixed 3-column stats grid avoids orphan columns */
		.stats-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: var(--spacing-2xs);
		}
		.stat-badge {
			padding: var(--spacing-2xs) var(--spacing-2xs);
		}
		.badge-label {
			font-size: 9px;
		}
		.badge-value {
			font-size: 11px;
		}
		/* MB-012: category chips two per row */
		.metrics-tag-totals-chips {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}
		.tag-total-chip {
			min-width: 0;
		}
		.tag-total-name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			min-width: 0;
		}
		/* MB-012: scale savings panel down proportionally */
		.metrics-savings-panel {
			padding: var(--spacing-sm);
			margin: var(--spacing-xs) var(--spacing-sm) var(--spacing-sm);
		}
		.savings-amount {
			font-size: 20px;
		}
		.savings-currency {
			font-size: 14px;
		}
		.savings-title {
			font-size: 13px;
		}
	}

	.metrics-savings-panel {
		padding: 16px;
		margin: 8px 16px 16px 16px;
		border-radius: 8px;
		border: 1px solid var(--border-color, #2a2d35);
		transition: all 0.2s ease-in-out;
		background: color-mix(in srgb, var(--border-color) 5%, var(--bg-surface));
	}

	.metrics-savings-panel.positive {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0.02) 100%);
		border-color: rgba(34, 197, 94, 0.2);
	}

	.metrics-savings-panel.negative {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(239, 68, 68, 0.02) 100%);
		border-color: rgba(239, 68, 68, 0.2);
	}

	.metrics-savings-panel.neutral {
		background: linear-gradient(135deg, rgba(161, 161, 170, 0.08) 0%, rgba(161, 161, 170, 0.02) 100%);
		border-color: rgba(161, 161, 170, 0.2);
	}

	.savings-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.savings-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.savings-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #71717a);
		text-transform: uppercase;
	}

	.savings-title {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary, #fff);
	}

	.metrics-savings-panel.positive .savings-title {
		color: #4ade80;
	}

	.metrics-savings-panel.negative .savings-title {
		color: #f87171;
	}

	.metrics-savings-panel.neutral .savings-title {
		color: var(--text-secondary, #a1a1aa);
	}

	.savings-value {
		display: flex;
		align-items: baseline;
		gap: 4px;
		font-family: var(--font-mono, monospace);
	}

	.savings-currency {
		font-size: 16px;
		font-weight: 500;
		color: var(--text-secondary, #a1a1aa);
	}

	.savings-amount {
		font-size: 24px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}

	.metrics-savings-panel.positive .savings-amount {
		color: #4ade80;
	}

	.metrics-savings-panel.negative .savings-amount {
		color: #f87171;
	}

	.metrics-savings-panel.neutral .savings-amount {
		color: var(--text-primary, #fff);
	}

	.metrics-row-tag-dropdown-container {
		position: relative;
		display: inline-block;
	}

	/* Mobile fix: editing line keeps the label + date button on one row */
	.row-edit-line {
		display: flex;
		align-items: center;
		gap: var(--spacing-2xs);
		width: 100%;
	}

	.row-edit-line .row-label-input.editing {
		flex: 1;
		min-width: 0;
	}

	/* Compact tag trigger that lives on the always-visible tags line */
	.row-tag-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-3xs);
		background: color-mix(in srgb, var(--text-primary) 4%, transparent);
		border: 1px dashed var(--border-highlight);
		border-radius: var(--radius-pill);
		color: var(--text-secondary);
		padding: 2px var(--spacing-2xs);
		min-height: 24px;
		font-size: 10px;
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
		outline: none;
		flex-shrink: 0;
		transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	}

	.row-tag-trigger:hover {
		border-color: var(--accent);
		color: var(--text-primary);
		background: var(--accent-light);
	}

	.row-tag-trigger.has-tags {
		border-style: solid;
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
		color: var(--text-secondary);
		padding: 2px var(--spacing-2xs);
		min-width: 28px;
		justify-content: center;
	}

	.row-tag-trigger-text {
		line-height: 1;
	}

	.metrics-row-tag-dropdown-menu {
		position: fixed;
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-standard);
		box-shadow: var(--shadow-heavy);
		padding: var(--spacing-2xs);
		min-width: 160px;
		max-width: 240px;
		z-index: var(--z-index-toast);
		max-height: 260px;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3xs);
		animation: mb-popover-in var(--motion-duration-fast) var(--motion-ease-out);
	}

	/* MB-010: tag picker search */
	.tag-picker-search {
		display: flex;
		align-items: center;
		gap: var(--spacing-2xs);
		padding: var(--spacing-2xs) var(--spacing-xs);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-subtle);
		background: color-mix(in srgb, var(--bg-base) 40%, transparent);
		color: var(--text-tertiary);
		margin-bottom: var(--spacing-3xs);
	}

	.tag-picker-search-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-size: 11px;
	}

	.tag-picker-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3xs);
		overflow-y: auto;
		min-height: 0;
	}

	.tag-picker-empty {
		font-size: 11px;
		font-style: italic;
		color: var(--text-tertiary);
		padding: var(--spacing-xs);
		text-align: center;
	}

	.tag-dropdown-item {
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 500;
		padding: 6px 8px;
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: all 0.12s ease;
		display: flex;
		align-items: center;
		gap: 6px;
		box-sizing: border-box;
	}
	.tag-dropdown-item:hover {
		background: color-mix(in srgb, var(--text-primary) 6%, transparent);
		color: var(--text-primary);
	}
	.tag-dropdown-item.selected {
		background: color-mix(in srgb, var(--text-primary) 8%, transparent);
		color: var(--text-primary);
		font-weight: var(--font-weight-semibold);
	}

	.tag-dropdown-item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* MT-003: multi-select picker header / check indicator / clear / done */
	.tag-picker-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-xs);
		padding: var(--spacing-3xs) var(--spacing-2xs) var(--spacing-2xs);
		border-bottom: 1px solid var(--border-color);
		margin-bottom: var(--spacing-3xs);
	}

	.tag-picker-header-title {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		color: var(--text-primary);
	}

	.tag-picker-header-count {
		font-size: 10px;
		font-weight: var(--font-weight-semibold);
		color: var(--text-tertiary);
	}

	.tag-dropdown-check {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		border-radius: var(--radius-subtle);
		border: 1.5px solid var(--border-highlight);
		background: color-mix(in srgb, var(--bg-base) 40%, transparent);
		position: relative;
		transition: background-color var(--motion-duration-fast), border-color var(--motion-duration-fast);
	}

	.tag-dropdown-check.checked {
		background-color: var(--accent);
		border-color: var(--accent);
	}

	.tag-dropdown-check.checked::after {
		content: '';
		position: absolute;
		inset: 0;
		background-color: var(--bg-primary);
		-webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>") center / 70% 70% no-repeat;
		mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>") center / 70% 70% no-repeat;
	}

	.tag-dropdown-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tag-dropdown-disabled {
		font-size: 9px;
		font-style: italic;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.tag-dropdown-clear {
		color: var(--semantic-error);
	}

	.tag-dropdown-clear:not(:disabled):hover {
		background: color-mix(in srgb, var(--semantic-error) 12%, transparent);
		color: var(--semantic-error);
	}

	.tag-picker-done {
		margin-top: var(--spacing-2xs);
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-subtle);
		padding: var(--spacing-2xs) var(--spacing-sm);
		font-size: 11px;
		font-weight: var(--font-weight-bold);
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color var(--motion-duration-fast);
	}

	.tag-picker-done:hover {
		background: var(--accent-hover);
	}

	.tag-picker-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		z-index: calc(var(--z-index-toast) - 1);
		background: transparent;
	}

	/* Mobile: dim behind the bottom-sheet picker for clarity */
	.tag-picker-backdrop.is-dim {
		z-index: var(--z-index-overlay);
		background: rgba(0, 0, 0, 0.5);
	}

	/* MB-012: shared bottom-sheet presentation for mobile */
	.mb-sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-index-overlay);
		background: rgba(0, 0, 0, 0.5);
		animation: mb-fade-in var(--motion-duration-standard) var(--motion-ease-out);
	}

	@keyframes mb-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes mb-sheet-up {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	:global(.metrics-card-wrapper) .mb-bottom-sheet {
		position: fixed !important;
		left: 0 !important;
		right: 0 !important;
		bottom: 0 !important;
		top: auto !important;
		width: 100% !important;
		max-width: 100% !important;
		min-width: 0 !important;
		box-sizing: border-box;
		border-radius: var(--radius-large) var(--radius-large) 0 0;
		max-height: 70vh;
		z-index: calc(var(--z-index-overlay) + 1);
		padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom, 0px));
		animation: mb-sheet-up var(--motion-duration-standard) var(--motion-ease-out);
	}

	.tag-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		display: inline-block;
		flex-shrink: 0;
	}

	/* Redesign: Tabbed settings dropdown */
	.settings-tab-btn {
		flex: 1;
		background: color-mix(in srgb, var(--text-primary) 3%, transparent);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-standard);
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: var(--font-weight-semibold);
		padding: var(--spacing-2xs) var(--spacing-sm);
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: center;
	}
	.settings-tab-btn:hover {
		border-color: var(--border-highlight);
		color: var(--text-primary);
	}
	.settings-tab-btn.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg-primary);
	}
</style>
