<script lang="ts">
  import { appState, parseHtmlMetadata, generateHtmlNote } from '../stores/appState.svelte';
  import { BudgetAggregator, type CalcBoxRow } from '../services/BudgetAggregator';
  import { getRowNumbers, exportMultipleMetricsToXlsx, extractRowDate } from '../utils/exportMetricsXlsx';
  import { Wallet, Landmark, TrendingUp, TrendingDown, ArrowUpRight, FileText, ChevronRight, ChevronDown, Plus, X, Check, Pin, ArrowUpDown, Download, RefreshCw, Edit3, Trash2, Settings } from 'lucide-svelte';

  // Local state for the active selected calculation box
  let activeBoxId = $state<string>(localStorage.getItem('mynotes_active_budget_box_id') || '');

  // Search & Filter state
  let searchQuery = $state('');
  let activeTagFilters = $state<string[]>([]);

  // Pinned tags state
  let pinnedTags = $state<string[]>(JSON.parse(localStorage.getItem('mynotes_budget_pinned_tags') || '[]'));

  // Category sorting state
  let categorySortBy = $state<'spent' | 'alphabetical' | 'remaining' | 'budget'>(
    (localStorage.getItem('mynotes_budget_category_sort_by') as any) || 'spent'
  );

  // Local state for editing budgets inline
  let editingBudgetId = $state<string | null>(null);
  let editBudgetValue = $state<string>('');

  // Default currency symbol from appState or defaults
  let currencyCode = $derived(appState.defaultCurrency || '₹');

  // Quick-Add Modal State
  let showQuickAddModal = $state(false);
  let selectedBoxId = $state('');
  let selectedNotePath = $state('');
  let transactionDesc = $state('');
  let transactionAmount = $state('');
  let transactionType = $state<'expense' | 'inflow'>('expense');
  let transactionDate = $state(new Date().toISOString().split('T')[0]);
  let selectedTagIds = $state<string[]>([]);
  let showTagDropdown = $state(false);
  let showBoxDropdown = $state(false);
  let showSortDropdown = $state(false);
  let showTargetBoxDropdown = $state(false);
  let showAddCategoryInline = $state(false);
  let newCategoryName = $state('');

  // Transaction sorting (default: latest date first)
  const _storedSort = localStorage.getItem('mynotes_budget_tx_sort');
  const _storedDir = localStorage.getItem('mynotes_budget_tx_sort_dir');
  let txSortBy = $state<'default' | 'date' | 'amount'>(_storedSort === 'amount' ? 'amount' : 'date');
  let txSortDir = $state<'asc' | 'desc'>(_storedDir === 'asc' ? 'asc' : 'desc');

  const CALC_TAG_COLOR_PALETTE = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6',
    '#ec4899', '#f43f5e', '#78716c', '#64748b',
  ];

  // Edit Mode state tracking
  let editingRowId = $state<string | null>(null);
  let originalNotePath = $state('');
  let originalBoxId = $state('');

  // Block Settings Modal State
  let showBlockSettingsModal = $state(false);
  let editBlockTitle = $state('');
  let editBlockIncome = $state('');
  let editBlockCurrency = $state('');
  let editBlockExcludeChecked = $state(false);

  // Aggregate global budget data to list boxes
  let dashboardData = $derived(BudgetAggregator.aggregate(appState.notes, appState.calcTags));

  // Selected calculation box from the list
  let selectedBox = $derived.by(() => {
    if (dashboardData.boxes.length === 0) return null;
    const box = dashboardData.boxes.find(b => b.id === activeBoxId);
    return box || dashboardData.boxes[0];
  });

  // Sync activeBoxId with selectedBox
  $effect(() => {
    if (selectedBox && activeBoxId !== selectedBox.id) {
      activeBoxId = selectedBox.id;
      localStorage.setItem('mynotes_active_budget_box_id', activeBoxId);
    }
  });

  // Derived statistics for the selected calculation box
  let selectedStats = $derived.by(() => {
    if (!selectedBox) {
      return { income: 0, expenses: 0, inflows: 0, net: 0, savings: 0 };
    }
    const income = selectedBox.income;
    const net = selectedBox.stats.net;
    const expenses = selectedBox.stats.expenses;
    const inflows = selectedBox.stats.inflows;
    const savings = income + net;
    return { income, expenses, inflows, net, savings };
  });

  // Selected box category breakdown
  interface TagBreakdown {
    tagId: string;
    budget: number;
    spent: number;
    inflows: number;
    net: number;
    remaining: number;
    percentUsed: number;
    isOverBudget: boolean;
    hasBudget: boolean;
  }

  let selectedBoxBreakdown = $derived.by(() => {
    const tagMap = new Map<string, TagBreakdown>();
    let untaggedInflows = 0;
    let untaggedSpent = 0;
    let untaggedNet = 0;
    
    if (!selectedBox) {
      return { tagBreakdown: tagMap, untagged: { inflows: 0, spent: 0, net: 0 } };
    }

    // Initialize map with all calc tags
    appState.calcTags.forEach(tag => {
      if (tag.enabled) {
        tagMap.set(tag.id, {
          tagId: tag.id,
          budget: 0,
          spent: 0,
          inflows: 0,
          net: 0,
          remaining: 0,
          percentUsed: 0,
          isOverBudget: false,
          hasBudget: false
        });
      }
    });

    // Add budget from this selected box's metadata
    appState.calcTags.forEach(tag => {
      const budgetContribution = selectedBox.tagBudgets?.[tag.id] || 0;
      if (tag.enabled || budgetContribution > 0) {
        if (!tagMap.has(tag.id)) {
          tagMap.set(tag.id, {
            tagId: tag.id,
            budget: 0,
            spent: 0,
            inflows: 0,
            net: 0,
            remaining: 0,
            percentUsed: 0,
            isOverBudget: false,
            hasBudget: false
          });
        }
        const entry = tagMap.get(tag.id)!;
        entry.budget = budgetContribution;
        entry.hasBudget = entry.budget > 0;
      }
    });

    // Process rows of selectedBox
    selectedBox.rows.forEach(r => {
      if (r.tagIds && r.tagIds.length > 0) {
        r.tagIds.forEach(tagId => {
          if (!tagMap.has(tagId)) {
            const budget = selectedBox.tagBudgets?.[tagId] || 0;
            tagMap.set(tagId, {
              tagId,
              budget,
              spent: 0,
              inflows: 0,
              net: 0,
              remaining: budget,
              percentUsed: 0,
              isOverBudget: false,
              hasBudget: budget > 0
            });
          }
          const entry = tagMap.get(tagId)!;
          entry.net += r.total;
          if (r.total > 0) {
            entry.inflows += r.total;
          } else {
            entry.spent += Math.abs(r.total);
          }
        });
      } else {
        untaggedNet += r.total;
        if (r.total > 0) {
          untaggedInflows += r.total;
        } else {
          untaggedSpent += Math.abs(r.total);
        }
      }
    });

    // Finalize values
    tagMap.forEach(entry => {
      const netSpent = entry.net < 0 ? Math.abs(entry.net) : 0;
      const netInflow = entry.net > 0 ? entry.net : 0;
      entry.spent = netSpent;
      entry.inflows = netInflow;

      entry.remaining = entry.budget - entry.spent;
      entry.percentUsed = entry.budget > 0 ? (entry.spent / entry.budget) * 100 : 0;
      entry.isOverBudget = entry.budget > 0 && entry.remaining < 0;
    });

    const netUntaggedSpent = untaggedNet < 0 ? Math.abs(untaggedNet) : 0;
    const netUntaggedInflows = untaggedNet > 0 ? untaggedNet : 0;

    return {
      tagBreakdown: tagMap,
      untagged: {
        inflows: netUntaggedInflows,
        spent: netUntaggedSpent,
        net: untaggedNet
      }
    };
  });

  // Sort the selected box categories list
  let sortedCategories = $derived.by(() => {
    const list = Array.from(selectedBoxBreakdown.tagBreakdown.values());
    
    list.sort((a, b) => {
      const pinA = pinnedTags.includes(a.tagId);
      const pinB = pinnedTags.includes(b.tagId);
      if (pinA && !pinB) return -1;
      if (!pinA && pinB) return 1;

      const tagA = appState.calcTags.find(t => t.id === a.tagId);
      const tagB = appState.calcTags.find(t => t.id === b.tagId);
      if (!tagA || !tagB) return 0;

      if (categorySortBy === 'alphabetical') {
        return tagA.name.localeCompare(tagB.name);
      } else if (categorySortBy === 'spent') {
        return b.spent - a.spent;
      } else if (categorySortBy === 'remaining') {
        return a.remaining - b.remaining;
      } else if (categorySortBy === 'budget') {
        return b.budget - a.budget;
      }
      return 0;
    });
    
    return list;
  });

  // Filtered rows for the selected calculation box
  let filteredRows = $derived.by(() => {
    if (!selectedBox) return [];
    let rows = selectedBox.rows;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r => r.label.toLowerCase().includes(q));
    }
    if (activeTagFilters.length > 0) {
      rows = rows.filter(r => r.tagIds.some(tagId => activeTagFilters.includes(tagId)));
    }
    // Apply sorting
    if (txSortBy !== 'default') {
      rows = [...rows].sort((a, b) => {
        let cmp = 0;
        if (txSortBy === 'date') {
          const da = a.date || '9999-99-99';
          const db = b.date || '9999-99-99';
          cmp = da.localeCompare(db);
        } else if (txSortBy === 'amount') {
          cmp = Math.abs(a.total) - Math.abs(b.total);
        }
        return txSortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  });

  // Initialize selected box when modal opens
  $effect(() => {
    if (showQuickAddModal) {
      if (selectedBox) {
        selectedBoxId = selectedBox.id;
        selectedNotePath = selectedBox.noteId;
      } else if (dashboardData.boxes.length > 0) {
        selectedBoxId = dashboardData.boxes[0].id;
        selectedNotePath = dashboardData.boxes[0].noteId;
      }
    }
  });

  async function openNote(path: string) {
    await appState.selectNote(path);
    appState.activeTab = 'home';
  }

  function startEditingBudget(tagId: string, currentBudget: number) {
    editingBudgetId = tagId;
    editBudgetValue = currentBudget > 0 ? String(currentBudget) : '';
  }

  async function saveBudget(tagId: string) {
    if (!selectedBox) return;

    let clean = editBudgetValue.replace(/[^0-9.-]/g, '');
    let parsed = parseFloat(clean);
    if (isNaN(parsed) || parsed < 0) {
      parsed = null as any;
    }

    try {
      const note = appState.notes.find(n => n.path === selectedBox.noteId);
      if (!note) {
        appState.showToast('Note not found', 'error', 3000);
        return;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(note.content, 'text/html');

      const block = doc.querySelector(`div[data-type="metrics"][data-id="${selectedBox.id}"], div[data-type="metrics"]#${selectedBox.id}`);
      if (!block) {
        appState.showToast('Calculation box not found', 'error', 3000);
        return;
      }

      const currentBudgetsAttr = block.getAttribute('data-tag-budgets') || '{}';
      let budgets: Record<string, number> = {};
      try {
        budgets = JSON.parse(currentBudgetsAttr);
      } catch {
        budgets = {};
      }

      if (parsed === null) {
        delete budgets[tagId];
      } else {
        budgets[tagId] = parsed;
      }

      block.setAttribute('data-tag-budgets', JSON.stringify(budgets));

      const parsedNote = parseHtmlMetadata(note.content);
      parsedNote.meta.modified = new Date().toISOString();
      const updatedContent = generateHtmlNote(parsedNote.meta, doc.body.innerHTML);

      note.content = updatedContent;
      note.modified = Date.now();
      await appState.storage.writeNote(selectedBox.noteId, updatedContent);

      if (appState.activeNotePath === selectedBox.noteId) {
        appState.activeNoteContent = updatedContent;
      }

      appState.showToast('Budget updated successfully!', 'success', 2000);
      editingBudgetId = null;

      await appState.refreshNotes();
      appState.triggerDebouncedSync();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to update budget', 'error', 3000);
    }
  }

  function togglePinTag(tagId: string) {
    if (pinnedTags.includes(tagId)) {
      pinnedTags = pinnedTags.filter(id => id !== tagId);
    } else {
      pinnedTags = [...pinnedTags, tagId];
    }
    localStorage.setItem('mynotes_budget_pinned_tags', JSON.stringify(pinnedTags));
  }

  function updateSortBy(sort: 'spent' | 'alphabetical' | 'remaining' | 'budget') {
    categorySortBy = sort;
    localStorage.setItem('mynotes_budget_category_sort_by', sort);
  }



  // Handle Box selection changes in Quick Add form
  function handleBoxSelectChange(e: Event) {
    const target = e.currentTarget as HTMLSelectElement;
    const value = target.value;
    if (!value) return;
    
    const [notePath, boxId] = value.split('||');
    selectedNotePath = notePath;
    selectedBoxId = boxId;
  }

  function selectTargetBox(notePath: string, boxId: string) {
    selectedNotePath = notePath;
    selectedBoxId = boxId;
  }

  $effect(() => {
    if (showQuickAddModal) {
      if (dashboardData.boxes.length > 0 && (!selectedBoxId || !selectedNotePath)) {
        const activeBox = dashboardData.boxes.find(b => b.id === activeBoxId) || dashboardData.boxes[0];
        selectedBoxId = activeBox.id;
        selectedNotePath = activeBox.noteId;
      }
      showTargetBoxDropdown = false;
      showTagDropdown = false;
    }
  });

  // Parse a transaction's row label into components
  function parseRowLabel(label: string, total: number) {
    const extractedDate = extractRowDate(label);
    const dateVal = extractedDate !== '—' ? extractedDate : new Date().toISOString().split('T')[0];

    let desc = label;
    // Remove date matches
    desc = desc.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '');
    desc = desc.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '');

    const absTotal = Math.abs(total);
    const escapedTotalStr = String(absTotal).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    // 1. Try removing from the end (suffix format)
    const endRegex = new RegExp(`[-\\s\\+]?${escapedTotalStr}\\s*$`);
    if (endRegex.test(desc)) {
      desc = desc.replace(endRegex, '');
    } else {
      // 2. Try removing from the start (prefix format)
      const startRegex = new RegExp(`^\\s*[-\\s\\+]?${escapedTotalStr}[\\s-]*`);
      desc = desc.replace(startRegex, '');
    }

    desc = desc.replace(/\s+/g, ' ').trim();
    return {
      description: desc || 'Transaction',
      date: dateVal,
      amount: String(absTotal),
      type: total < 0 ? 'expense' : 'inflow' as 'expense' | 'inflow'
    };
  }

  // Pre-fill form fields and open the modal in Edit Mode
  function startEditingRow(row: CalcBoxRow) {
    if (!selectedBox) return;

    const parsed = parseRowLabel(row.label, row.total);
    transactionDesc = parsed.description;
    transactionDate = parsed.date;
    transactionAmount = parsed.amount;
    transactionType = parsed.type;
    selectedTagIds = [...row.tagIds];

    editingRowId = row.id;
    originalNotePath = selectedBox.noteId;
    originalBoxId = selectedBox.id;

    selectedBoxId = selectedBox.id;
    selectedNotePath = selectedBox.noteId;

    showQuickAddModal = true;
  }

  // Clear state and close the quick add modal
  function closeQuickAddModal() {
    showQuickAddModal = false;
    editingRowId = null;
    originalNotePath = '';
    originalBoxId = '';
    transactionDesc = '';
    transactionAmount = '';
    selectedTagIds = [];
    transactionDate = new Date().toISOString().split('T')[0];
  }

  // Open block settings modal with current values
  function openBlockSettings() {
    if (!selectedBox) {
      appState.showToast('No active calculation box to configure', 'error', 3000);
      return;
    }
    editBlockTitle = selectedBox.boxTitle;
    editBlockIncome = String(selectedBox.income);
    editBlockCurrency = selectedBox.currencyCode;
    editBlockExcludeChecked = selectedBox.excludeChecked;
    showBlockSettingsModal = true;
  }

  // Save changes back to calculation box block inside note
  async function saveBlockSettings() {
    if (!selectedBox) return;

    let cleanIncome = editBlockIncome.replace(/[^0-9.-]/g, '');
    let parsedIncome = parseFloat(cleanIncome);
    if (isNaN(parsedIncome) || parsedIncome < 0) {
      parsedIncome = 0;
    }

    try {
      const note = appState.notes.find(n => n.path === selectedBox.noteId);
      if (!note) {
        appState.showToast('Note not found', 'error', 3000);
        return;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(note.content, 'text/html');

      const block = doc.querySelector(`div[data-type="metrics"][data-id="${selectedBox.id}"], div[data-type="metrics"]#${selectedBox.id}`);
      if (!block) {
        appState.showToast('Calculation box not found', 'error', 3000);
        return;
      }

      block.setAttribute('data-title', editBlockTitle.trim() || 'Metrics List');
      block.setAttribute('data-income', String(parsedIncome));
      block.setAttribute('data-currency-code', editBlockCurrency.trim() || '₹');
      block.setAttribute('data-exclude-checked', String(editBlockExcludeChecked));

      const parsedNote = parseHtmlMetadata(note.content);
      parsedNote.meta.modified = new Date().toISOString();
      const updatedContent = generateHtmlNote(parsedNote.meta, doc.body.innerHTML);

      note.content = updatedContent;
      note.modified = Date.now();
      await appState.storage.writeNote(selectedBox.noteId, updatedContent);

      if (appState.activeNotePath === selectedBox.noteId) {
        appState.activeNoteContent = updatedContent;
      }

      appState.showToast('Block settings saved successfully!', 'success', 2000);
      showBlockSettingsModal = false;
      await appState.refreshNotes();
      appState.triggerDebouncedSync();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to save block settings', 'error', 3000);
    }
  }

  // Delete a transaction row from its note
  async function handleDeleteRow() {
    if (!editingRowId || !originalNotePath || !originalBoxId) return;

    try {
      const note = appState.notes.find(n => n.path === originalNotePath);
      if (!note) {
        appState.showToast('Note not found', 'error', 3000);
        return;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(note.content, 'text/html');

      const block = doc.querySelector(`div[data-type="metrics"][data-id="${originalBoxId}"], div[data-type="metrics"]#${originalBoxId}`);
      if (!block) {
        appState.showToast('Calculation box not found', 'error', 3000);
        return;
      }

      const metricsDataAttr = block.getAttribute('data-metrics');
      let rows: any[] = [];
      if (metricsDataAttr) {
        try {
          rows = JSON.parse(metricsDataAttr);
        } catch {
          rows = [];
        }
      }

      rows = rows.filter(r => r.id !== editingRowId);
      block.setAttribute('data-metrics', JSON.stringify(rows));

      const parsed = parseHtmlMetadata(note.content);
      parsed.meta.modified = new Date().toISOString();
      const updatedContent = generateHtmlNote(parsed.meta, doc.body.innerHTML);

      note.content = updatedContent;
      note.modified = Date.now();
      await appState.storage.writeNote(originalNotePath, updatedContent);

      if (appState.activeNotePath === originalNotePath) {
        appState.activeNoteContent = updatedContent;
      }

      appState.showToast('Transaction deleted successfully!', 'success', 2000);
      closeQuickAddModal();
      await appState.refreshCalcTags();
      appState.triggerDebouncedSync();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to delete transaction', 'error', 3000);
    }
  }

  // Save changes (creates a new row or updates an existing one)
  async function handleQuickAddSave() {
    if (!selectedBoxId || !selectedNotePath || !transactionDesc.trim() || !transactionAmount.trim()) {
      appState.showToast('Please fill all fields', 'error', 3000);
      return;
    }

    const amt = parseFloat(transactionAmount.replace(/[^0-9.-]/g, ''));
    if (isNaN(amt) || amt <= 0) {
      appState.showToast('Please enter a valid positive amount', 'error', 3000);
      return;
    }

    const finalAmount = transactionType === 'expense' ? -amt : amt;

    // Convert YYYY-MM-DD from the input value to DD-MM-YYYY
    let datePart = '';
    if (transactionDate) {
      const parts = transactionDate.split('-');
      if (parts.length === 3) {
        datePart = `${parts[2]}-${parts[1]}-${parts[0]} `;
      }
    }

    // Format description and amount
    const amountSign = finalAmount < 0 ? ` -${amt}` : ` ${amt}`;
    const fullLabel = `${datePart}${transactionDesc.trim()}${amountSign}`;

    try {
      if (editingRowId) {
        // --- EDIT MODE ---
        const isTargetChanged = (selectedNotePath !== originalNotePath || selectedBoxId !== originalBoxId);

        if (isTargetChanged) {
          // 1. Remove from original note/box
          const origNote = appState.notes.find(n => n.path === originalNotePath);
          if (!origNote) {
            appState.showToast('Original note not found', 'error', 3000);
            return;
          }

          const origParser = new DOMParser();
          const origDoc = origParser.parseFromString(origNote.content, 'text/html');
          const origBlock = origDoc.querySelector(`div[data-type="metrics"][data-id="${originalBoxId}"], div[data-type="metrics"]#${originalBoxId}`);
          if (origBlock) {
            const origAttr = origBlock.getAttribute('data-metrics');
            let origRows = origAttr ? JSON.parse(origAttr) : [];
            origRows = origRows.filter((r: any) => r.id !== editingRowId);
            origBlock.setAttribute('data-metrics', JSON.stringify(origRows));

            const parsedOrig = parseHtmlMetadata(origNote.content);
            parsedOrig.meta.modified = new Date().toISOString();
            const updatedOrigContent = generateHtmlNote(parsedOrig.meta, origDoc.body.innerHTML);

            origNote.content = updatedOrigContent;
            origNote.modified = Date.now();
            await appState.storage.writeNote(originalNotePath, updatedOrigContent);
            if (appState.activeNotePath === originalNotePath) {
              appState.activeNoteContent = updatedOrigContent;
            }
          }

          // 2. Add/Insert into target note/box
          const targetNote = appState.notes.find(n => n.path === selectedNotePath);
          if (!targetNote) {
            appState.showToast('Target note not found', 'error', 3000);
            return;
          }

          const targetParser = new DOMParser();
          const targetDoc = targetParser.parseFromString(targetNote.content, 'text/html');
          const targetBlock = targetDoc.querySelector(`div[data-type="metrics"][data-id="${selectedBoxId}"], div[data-type="metrics"]#${selectedBoxId}`);
          if (!targetBlock) {
            appState.showToast('Target box not found', 'error', 3000);
            return;
          }

          const targetAttr = targetBlock.getAttribute('data-metrics');
          let targetRows = targetAttr ? JSON.parse(targetAttr) : [];

          const updatedRow = {
            id: editingRowId,
            label: fullLabel,
            checked: false,
            tagIds: [...selectedTagIds]
          };
          targetRows.push(updatedRow);
          targetBlock.setAttribute('data-metrics', JSON.stringify(targetRows));

          const parsedTarget = parseHtmlMetadata(targetNote.content);
          parsedTarget.meta.modified = new Date().toISOString();
          const updatedTargetContent = generateHtmlNote(parsedTarget.meta, targetDoc.body.innerHTML);

          targetNote.content = updatedTargetContent;
          targetNote.modified = Date.now();
          await appState.storage.writeNote(selectedNotePath, updatedTargetContent);
          if (appState.activeNotePath === selectedNotePath) {
            appState.activeNoteContent = updatedTargetContent;
          }
        } else {
          // Same box, update in place
          const note = appState.notes.find(n => n.path === selectedNotePath);
          if (!note) {
            appState.showToast('Note not found', 'error', 3000);
            return;
          }

          const parser = new DOMParser();
          const doc = parser.parseFromString(note.content, 'text/html');
          const block = doc.querySelector(`div[data-type="metrics"][data-id="${selectedBoxId}"], div[data-type="metrics"]#${selectedBoxId}`);
          if (!block) {
            appState.showToast('Box not found', 'error', 3000);
            return;
          }

          const attr = block.getAttribute('data-metrics');
          let rows = attr ? JSON.parse(attr) : [];
          const idx = rows.findIndex((r: any) => r.id === editingRowId);
          if (idx !== -1) {
            rows[idx] = {
              ...rows[idx],
              label: fullLabel,
              tagIds: [...selectedTagIds]
            };
          } else {
            rows.push({
              id: editingRowId,
              label: fullLabel,
              checked: false,
              tagIds: [...selectedTagIds]
            });
          }
          block.setAttribute('data-metrics', JSON.stringify(rows));

          const parsed = parseHtmlMetadata(note.content);
          parsed.meta.modified = new Date().toISOString();
          const updatedContent = generateHtmlNote(parsed.meta, doc.body.innerHTML);

          note.content = updatedContent;
          note.modified = Date.now();
          await appState.storage.writeNote(selectedNotePath, updatedContent);
          if (appState.activeNotePath === selectedNotePath) {
            appState.activeNoteContent = updatedContent;
          }
        }

        appState.showToast('Transaction updated successfully!', 'success', 2000);
      } else {
        // --- ADD MODE ---
        const note = appState.notes.find(n => n.path === selectedNotePath);
        if (!note) {
          appState.showToast('Note not found', 'error', 3000);
          return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(note.content, 'text/html');
        const block = doc.querySelector(`div[data-type="metrics"][data-id="${selectedBoxId}"], div[data-type="metrics"]#${selectedBoxId}`);
        if (!block) {
          appState.showToast('Calculation box not found', 'error', 3000);
          return;
        }

        const attr = block.getAttribute('data-metrics');
        let rows = attr ? JSON.parse(attr) : [];

        const newRow = {
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
          label: fullLabel,
          checked: false,
          tagIds: [...selectedTagIds]
        };
        rows.push(newRow);
        block.setAttribute('data-metrics', JSON.stringify(rows));

        const parsed = parseHtmlMetadata(note.content);
        parsed.meta.modified = new Date().toISOString();
        const updatedContent = generateHtmlNote(parsed.meta, doc.body.innerHTML);

        note.content = updatedContent;
        note.modified = Date.now();
        await appState.storage.writeNote(selectedNotePath, updatedContent);
        if (appState.activeNotePath === selectedNotePath) {
          appState.activeNoteContent = updatedContent;
        }

        appState.showToast('Transaction added successfully!', 'success', 2000);
      }

      closeQuickAddModal();
      await appState.refreshCalcTags();
      appState.triggerDebouncedSync();
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to save transaction', 'error', 3000);
    }
  }

  function toggleQuickAddTag(tagId: string) {
    if (selectedTagIds.includes(tagId)) {
      selectedTagIds = selectedTagIds.filter(id => id !== tagId);
    } else {
      selectedTagIds = [...selectedTagIds, tagId];
    }
  }

  // Export selected calculation box sheet
  async function exportSelectedBoxBudget() {
    if (!selectedBox) return;
    try {
      const box = selectedBox;
      const boxRows = box.rows.map(r => {
        const numbers = getRowNumbers(r.label);
        const total = numbers.reduce((sum, n) => sum + n, 0);
        const rowTags = r.tagIds.map(tagId => {
          const tagObj = appState.calcTags.find(t => t.id === tagId);
          return { name: tagObj?.name || 'Unknown', color: tagObj?.color };
        });
        return {
          label: r.label,
          cleanedLabel: r.label.replace(/[-+]/g, '').trim(),
          date: r.date || '',
          value: total,
          tags: rowTags,
          counted: !(box.excludeChecked && r.checked)
        };
      });

      const boxCategoryTotals = Array.from(selectedBoxBreakdown.tagBreakdown.values()).map((details, i) => {
        const tagObj = appState.calcTags.find(t => t.id === details.tagId);
        return {
          rank: i + 1,
          name: tagObj?.name || 'Unknown',
          color: tagObj?.color,
          total: details.inflows - details.spent,
          pct: box.stats.expenses > 0 ? details.spent / box.stats.expenses : 0
        };
      }).filter(item => item.total !== 0);

      const sheet = {
        sheetTitle: box.boxTitle || 'Budget',
        data: {
          title: box.boxTitle,
          currency: box.currencyCode,
          incomeLabel: 'Initial Income',
          income: box.income,
          rows: boxRows,
          stats: {
            count: box.stats.count,
            sum: box.stats.net,
            average: box.stats.count > 0 ? box.stats.net / box.stats.count : 0,
            min: boxRows.length > 0 ? Math.min(...boxRows.map(r => r.value)) : 0,
            max: boxRows.length > 0 ? Math.max(...boxRows.map(r => r.value)) : 0,
            median: 0,
            inflows: box.stats.inflows,
            expenses: box.stats.expenses,
            net: box.stats.net
          },
          savings: box.income + box.stats.net,
          categoryTotals: boxCategoryTotals,
          untaggedTotal: -selectedBoxBreakdown.untagged.spent,
          largeIncomeThreshold: 10000,
          largeExpenseThreshold: 5000,
          insights: {
            largestExpense: boxRows.length > 0 ? Math.min(...boxRows.map(r => r.value)) : 0,
            smallestExpense: 0,
            averageExpense: box.stats.count > 0 ? -box.stats.expenses / box.stats.count : 0,
            mostUsedCategory: '',
            topCategory: ''
          },
          exportedAt: new Date().toISOString(),
          boxId: box.id
        }
      };

      const cleanTitle = (box.boxTitle || 'Budget').replace(/[\\/?*\[\]:]/g, '_').substring(0, 30);
      const filename = `mynotes_budget_${cleanTitle.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

      appState.showToast('Generating Excel export...', 'info', 2000);
      const success = await exportMultipleMetricsToXlsx(filename, [sheet]);
      if (success) {
        appState.showToast('Budget exported successfully!', 'success', 2000);
      }
    } catch (e) {
      console.error(e);
      appState.showToast('Failed to export budget data', 'error', 3000);
    }
  }

  // Add new Category tag logic
  async function handleAddCategorySubmit(e: Event) {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    
    // Case-insensitive duplicate check
    if (appState.calcTags.some(t => t.normalizedName === name.toLowerCase())) {
      appState.showToast('Category already exists!', 'error', 3000);
      return;
    }
    
    const color = CALC_TAG_COLOR_PALETTE[Math.floor(Math.random() * CALC_TAG_COLOR_PALETTE.length)];
    try {
      const newTag = await appState.createCalcTag(name, color);
      newCategoryName = '';
      showAddCategoryInline = false;
      
      // Auto-select the newly created tag in the Quick-Add modal if open
      if (showQuickAddModal && newTag && newTag.id) {
        if (!selectedTagIds.includes(newTag.id)) {
          selectedTagIds = [...selectedTagIds, newTag.id];
        }
      }
      
      appState.showToast(`Category "${name}" created.`, 'success', 2000);
    } catch (err) {
      console.error(err);
      appState.showToast('Failed to create category', 'error', 3000);
    }
  }

  // Dismiss custom dropdowns on click outside
  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    if (showTagDropdown && !target.closest('.tag-picker-wrapper')) {
      showTagDropdown = false;
    }
    if (showBoxDropdown && !target.closest('.box-selector-wrapper')) {
      showBoxDropdown = false;
    }
    if (showSortDropdown && !target.closest('.sort-selector-wrapper')) {
      showSortDropdown = false;
    }
    if (showTargetBoxDropdown && !target.closest('.target-box-picker-wrapper')) {
      showTargetBoxDropdown = false;
    }
    if (showAddCategoryInline && !target.closest('.add-category-wrapper')) {
      showAddCategoryInline = false;
      newCategoryName = '';
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="budget-view-container flex-col">
  <!-- Header -->
  <header class="budget-header">
    <div class="budget-header-left">
      <h1 class="budget-title flex-row">
        <Wallet size={24} />
        <span>Budget Dashboard</span>
      </h1>
      <div class="box-selector-wrapper flex-row" style="gap: var(--spacing-xs); align-items: center; margin-top: var(--spacing-2xs); position: relative;">
        <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">Active Block:</span>
        {#if dashboardData.boxes.length > 0}
          {@const currentBox = dashboardData.boxes.find(b => b.id === activeBoxId) || dashboardData.boxes[0]}
          <button 
            type="button" 
            class="custom-dropdown-trigger box-selector-trigger flex-row"
            onclick={(e) => {
              e.stopPropagation();
              showBoxDropdown = !showBoxDropdown;
              showSortDropdown = false;
            }}
          >
            <span class="dropdown-selected-text" style="max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              {currentBox.boxTitle} ({currentBox.noteName})
            </span>
            <ChevronDown size={14} style="color: var(--text-secondary);" />
          </button>
          <button
            type="button"
            class="block-settings-trigger-btn flex-row"
            title="Configure active block settings"
            onclick={openBlockSettings}
          >
            <Settings size={14} />
          </button>
          {#if showBoxDropdown}
            <div class="custom-dropdown-list box-dropdown-list flex-col">
              {#each dashboardData.boxes as box}
                <button
                   type="button"
                   class="dropdown-item flex-row"
                   class:selected={box.id === activeBoxId}
                   onclick={() => {
                     activeBoxId = box.id;
                     localStorage.setItem('mynotes_active_budget_box_id', activeBoxId);
                     showBoxDropdown = false;
                   }}
                >
                  <div class="flex-col" style="align-items: flex-start; text-align: left; gap: 2px;">
                    <span class="item-title" style="font-weight: 600; font-size: 13px; color: var(--text-primary);">{box.boxTitle}</span>
                    <span class="item-subtitle" style="font-size: 11px; color: var(--text-tertiary);">{box.noteName}</span>
                  </div>
                  {#if box.id === activeBoxId}
                    <Check size={14} class="check-icon" style="color: var(--accent);" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        {:else}
          <span style="font-size: 12px; color: var(--text-tertiary);">No calculation blocks found.</span>
        {/if}
      </div>
    </div>

    <!-- Actions -->
    <div class="budget-header-actions">
      {#if appState.googleConnected && appState.syncEnabled}
        <span class="bv-sync-status flex-row" class:syncing={appState.syncStatus === 'syncing'} class:error={appState.syncStatus === 'error'} class:synced={appState.syncStatus === 'idle'}>
          {#if appState.syncStatus === 'syncing'}
            <RefreshCw size={14} class="bv-sync-spin" />
            <span class="bv-sync-label">Syncing…</span>
          {:else if appState.syncStatus === 'error'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span class="bv-sync-label">Sync Error</span>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span class="bv-sync-label">Synced</span>
          {/if}
        </span>
      {/if}

      <button
        type="button"
        class="header-action-btn icon-only-btn flex-row"
        onclick={async () => {
          appState.showToast('Refreshing vault data...', 'info', 1500);
          await appState.refreshNotes();
        }}
        title="Refresh data"
      >
        <RefreshCw size={15} />
      </button>

      {#if dashboardData.boxes.length > 0}
        <button
          type="button"
          class="header-action-btn flex-row"
          onclick={exportSelectedBoxBudget}
          title="Export report to Excel"
        >
          <Download size={15} />
          <span class="btn-label-desktop">Export Excel</span>
        </button>

        <button 
          type="button" 
          class="header-quick-add-btn flex-row"
          onclick={() => showQuickAddModal = true}
        >
          <Plus size={16} />
          <span>Add Transaction</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Summary Cards Grid -->
  <section class="summary-cards-grid grid-layout">
    <!-- Total Inflow Card -->
    <div class="summary-card inflow-card flex-col">
      <div class="card-top flex-row">
        <span class="card-icon"><TrendingUp size={16} /></span>
        <span class="card-title">Total Inflows</span>
      </div>
      <div class="card-value">
        {currencyCode}{selectedStats.income.toLocaleString()}
      </div>
    </div>

    <!-- Total Expenses Card -->
    <div class="summary-card expenses-card flex-col">
      <div class="card-top flex-row">
        <span class="card-icon"><TrendingDown size={16} /></span>
        <span class="card-title">Total Expenses</span>
      </div>
      <div class="card-value">
        {currencyCode}{selectedStats.expenses.toLocaleString()}
      </div>
    </div>

    <!-- Net Total Card -->
    <div class="summary-card net-card flex-col">
      <div class="card-top flex-row">
        <span class="card-icon"><Landmark size={16} /></span>
        <span class="card-title">Net Total</span>
      </div>
      <div class="card-value" class:positive={selectedStats.net > 0} class:negative={selectedStats.net < 0}>
        {selectedStats.net < 0 ? '-' : ''}{currencyCode}{Math.abs(selectedStats.net).toLocaleString()}
      </div>
    </div>

    <!-- Savings Card -->
    <div class="summary-card savings-card flex-col">
      <div class="card-top flex-row">
        <span class="card-icon"><ArrowUpRight size={16} /></span>
        <span class="card-title">Savings</span>
      </div>
      <div class="card-value" class:positive={selectedStats.savings > 0} class:negative={selectedStats.savings < 0}>
        {selectedStats.savings < 0 ? '-' : ''}{currencyCode}{Math.abs(selectedStats.savings).toLocaleString()}
      </div>
    </div>
  </section>

  <!-- Double Column Layout -->
  <div class="budget-columns-layout flex-row">
    <!-- Left Column: Category Budgets -->
    <section class="budget-section categories-section flex-col">
      <div class="section-header-row flex-row" style="justify-content: space-between; align-items: center; width: 100%; margin-bottom: var(--spacing-sm); gap: var(--spacing-xs);">
        <h2 class="section-heading" style="margin: 0;">Category Budgets</h2>
        
        <div class="flex-row" style="align-items: center; gap: var(--spacing-xs);">
          <!-- Add Category Form/Trigger -->
          <div class="add-category-wrapper flex-row" style="align-items: center; position: relative;">
            {#if showAddCategoryInline}
              <form 
                onsubmit={handleAddCategorySubmit} 
                class="flex-row" 
                style="align-items: center; gap: 4px; background: var(--bg-mid-dark, #15171a); border: 1px solid var(--border-color, #2a2d35); border-radius: 6px; padding: 2px 6px; height: 26px; box-sizing: border-box;"
              >
                <input 
                  type="text" 
                  placeholder="New category..." 
                  bind:value={newCategoryName} 
                  autofocus
                  style="background: transparent; border: none; outline: none; color: var(--text-primary); font-size: 11px; width: 95px; padding: 0; font-family: inherit;"
                />
                <button 
                  type="submit" 
                  style="background: transparent; border: none; color: var(--accent); cursor: pointer; display: flex; align-items: center; padding: 2px; transition: opacity 0.2s;"
                  disabled={!newCategoryName.trim()}
                >
                  <Check size={12} />
                </button>
                <button 
                  type="button" 
                  onclick={() => { showAddCategoryInline = false; newCategoryName = ''; }} 
                  style="background: transparent; border: none; color: var(--text-tertiary); cursor: pointer; display: flex; align-items: center; padding: 2px; transition: opacity 0.2s;"
                >
                  <X size={12} />
                </button>
              </form>
            {:else}
              <button 
                type="button" 
                class="custom-dropdown-trigger flex-row" 
                style="padding: 4px var(--spacing-xs); font-size: 11px; height: 26px; line-height: 1; border-color: color-mix(in srgb, var(--accent) 40%, var(--border-color, #2a2d35)); color: var(--accent);" 
                onclick={(e) => { e.stopPropagation(); showAddCategoryInline = true; }}
              >
                <Plus size={11} style="color: var(--accent);" />
                <span style="font-weight: 600;">Add Tag</span>
              </button>
            {/if}
          </div>

          <!-- Sort dropdown selector -->
          <div class="custom-dropdown-container sort-selector-wrapper" style="position: relative;">
            <button 
              type="button" 
              class="custom-dropdown-trigger sort-selector-trigger flex-row"
              style="padding: 4px 8px; font-size: 11px; height: 26px; line-height: 1;"
              onclick={(e) => {
                e.stopPropagation();
                showSortDropdown = !showSortDropdown;
                showBoxDropdown = false;
                showAddCategoryInline = false;
              }}
            >
              <ArrowUpDown size={11} style="color: var(--text-secondary);" />
              <span class="dropdown-selected-text" style="font-weight: 600;">
                {#if categorySortBy === 'spent'}Sort by Spend
                {:else if categorySortBy === 'alphabetical'}Sort A-Z
                {:else if categorySortBy === 'remaining'}Sort by Remaining
                {:else if categorySortBy === 'budget'}Sort by Budget
                {/if}
              </span>
              <ChevronDown size={11} style="color: var(--text-tertiary);" />
            </button>
            {#if showSortDropdown}
            <div class="custom-dropdown-list sort-dropdown-list flex-col">
              {#each [
                { value: 'spent', label: 'Sort by Spend' },
                { value: 'alphabetical', label: 'Sort A-Z' },
                { value: 'remaining', label: 'Sort by Remaining' },
                { value: 'budget', label: 'Sort by Budget' }
              ] as option}
                <button
                  type="button"
                  class="dropdown-item flex-row"
                  class:selected={categorySortBy === option.value}
                  onclick={() => {
                    updateSortBy(option.value as any);
                    showSortDropdown = false;
                  }}
                >
                  <span style="font-size: 13px; font-weight: 500;">{option.label}</span>
                  {#if categorySortBy === option.value}
                    <Check size={12} class="check-icon" style="color: var(--accent);" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="categories-list flex-col">
        {#each sortedCategories as details (details.tagId)}
          {@const tag = appState.calcTags.find(t => t.id === details.tagId)}
          {#if tag}
            <div 
              class="budget-progress-card flex-col"
              class:over-budget={details.isOverBudget}
              style="--tag-color: {tag.color || 'var(--text-secondary)'}"
            >
              <!-- Card Top -->
              <div class="progress-card-top flex-row">
                <span class="category-info flex-row">
                  <span class="tag-dot" style="background: {tag.color || 'var(--text-secondary)'}"></span>
                  <span class="category-name">{tag.name}</span>
                </span>

                <div class="budget-amount flex-row" style="gap: var(--spacing-xs); align-items: center;">
                  <!-- Pin/Unpin tag toggle -->
                  <button
                    type="button"
                    class="pin-toggle-btn"
                    class:pinned={pinnedTags.includes(tag.id)}
                    onclick={() => togglePinTag(tag.id)}
                    title={pinnedTags.includes(tag.id) ? "Unpin Category" : "Pin Category"}
                  >
                    <Pin size={12} />
                  </button>

                  {#if editingBudgetId === tag.id}
                    <div class="budget-inline-editor flex-row">
                      <span class="editor-currency">{currencyCode}</span>
                      <input
                        type="text"
                        class="editor-input"
                        bind:value={editBudgetValue}
                        use:focusOnMount
                        onblur={() => saveBudget(tag.id)}
                        onkeydown={(e) => {
                          if (e.key === 'Enter') saveBudget(tag.id);
                          if (e.key === 'Escape') editingBudgetId = null;
                        }}
                      />
                    </div>
                  {:else}
                    <button 
                      type="button" 
                      class="budget-edit-trigger-btn"
                      onclick={() => startEditingBudget(tag.id, details.budget)}
                      title="Click to edit budget"
                    >
                      {#if details.hasBudget}
                        Budget: {currencyCode}{details.budget.toLocaleString()}
                      {:else}
                        Set Budget
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>

              <!-- Card Details -->
              <div class="progress-card-details flex-row">
                <span class="amount-spent">
                  {#if details.inflows > 0 && details.spent > 0}
                    <span class="inflows-text">+{currencyCode}{details.inflows.toLocaleString()}</span>
                    <span class="separator">/</span>
                    <span class="spent-text">-{currencyCode}{details.spent.toLocaleString()} spent</span>
                  {:else if details.inflows > 0}
                    <span class="inflows-text">+{currencyCode}{details.inflows.toLocaleString()} inflows</span>
                  {:else}
                    <span class="spent-text">-{currencyCode}{details.spent.toLocaleString()} spent</span>
                  {/if}
                </span>

                {#if details.hasBudget}
                  <span class="amount-remaining" class:warning-text={details.isOverBudget} class:success-text={!details.isOverBudget}>
                    {#if details.isOverBudget}
                      -{currencyCode}{Math.abs(details.remaining).toLocaleString()} remaining ⚠️
                    {:else}
                      +{currencyCode}{details.remaining.toLocaleString()} remaining
                    {/if}
                  </span>
                {/if}
              </div>

              <!-- Progress Bar -->
              {#if details.hasBudget}
                {@const percent = Math.min(120, details.percentUsed)}
                <div class="card-progress-container">
                  <div 
                    class="card-progress-bar" 
                    class:warning={details.isOverBudget}
                    style="width: {percent}%"
                  ></div>
                </div>
                <div class="progress-footer flex-row">
                  <span class="percent-label" class:warning-text={details.isOverBudget}>
                    {Math.round(details.percentUsed)}% spent
                  </span>
                  {#if details.isOverBudget}
                    <span class="warning-text">Over budget by {currencyCode}{Math.abs(details.remaining).toLocaleString()}!</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="empty-state-card flex-col">
            <p>No active categories configured.</p>
          </div>
        {/each}

        <!-- Untagged Bucket -->
        {#if selectedBoxBreakdown.untagged.spent > 0 || selectedBoxBreakdown.untagged.inflows > 0}
          <div class="budget-progress-card flex-col untagged-card" style="--tag-color: var(--text-tertiary)">
            <div class="progress-card-top flex-row">
              <span class="category-info flex-row">
                <span class="tag-dot" style="background: var(--text-tertiary)"></span>
                <span class="category-name">Untagged</span>
              </span>
              <span class="budget-amount no-budget">(no budget)</span>
            </div>
            <div class="progress-card-details flex-row">
              <span class="amount-spent">
                {#if selectedBoxBreakdown.untagged.inflows > 0 && selectedBoxBreakdown.untagged.spent > 0}
                  <span class="inflows-text">+{currencyCode}{selectedBoxBreakdown.untagged.inflows.toLocaleString()}</span>
                  <span class="separator">/</span>
                  <span class="spent-text">-{currencyCode}{selectedBoxBreakdown.untagged.spent.toLocaleString()} spent</span>
                {:else if selectedBoxBreakdown.untagged.inflows > 0}
                  <span class="inflows-text">+{currencyCode}{selectedBoxBreakdown.untagged.inflows.toLocaleString()} inflows</span>
                {:else}
                  <span class="spent-text">-{currencyCode}{selectedBoxBreakdown.untagged.spent.toLocaleString()} spent</span>
                {/if}
              </span>
            </div>
          </div>
        {/if}
      </div>
    </section>

    <!-- Right Column: Transactions & Items -->
    <section class="budget-section blocks-section flex-col">
      <div class="section-header-row flex-row" style="justify-content: space-between; align-items: center; width: 100%; margin-bottom: var(--spacing-sm);">
        <h2 class="section-heading">Transactions & Items</h2>
        {#if selectedBox}
          <span style="font-size: 11px; color: var(--text-tertiary); background: var(--bg-mid-dark); padding: 2px 8px; border-radius: 12px;">
            {filteredRows.length} items
          </span>
        {/if}
      </div>

      <!-- Search & Filters -->
      <div class="blocks-filter-controls flex-col">
        <input
          type="text"
          class="blocks-search-input"
          placeholder="Search transactions..."
          bind:value={searchQuery}
        />

        {#if appState.calcTags.length > 0}
          <div class="blocks-filter-chips flex-row">
            {#each appState.calcTags as tag}
              <button
                type="button"
                class="filter-chip"
                class:active={activeTagFilters.includes(tag.id)}
                style="--tag-color: {tag.color || 'var(--text-secondary)'}"
                onclick={() => {
                  if (activeTagFilters.includes(tag.id)) {
                    activeTagFilters = activeTagFilters.filter(id => id !== tag.id);
                  } else {
                    activeTagFilters = [...activeTagFilters, tag.id];
                  }
                }}
              >
                <span class="tag-dot" style="background: {tag.color || 'var(--text-secondary)'}"></span>
                <span>{tag.name}</span>
              </button>
            {/each}
            {#if activeTagFilters.length > 0}
              <button 
                type="button" 
                class="filter-chip clear-chip"
                onclick={() => { activeTagFilters = []; }}
              >
                Clear
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Sort Controls -->
      <div class="tx-sort-controls flex-row" style="gap: 6px; align-items: center; margin-bottom: var(--spacing-xs);">
        <ArrowUpDown size={13} style="color: var(--text-tertiary); flex-shrink: 0;" />
        <button
          type="button"
          class="tx-sort-btn"
          class:active={txSortBy === 'date'}
          onclick={() => {
            if (txSortBy === 'date') {
              txSortDir = txSortDir === 'desc' ? 'asc' : 'desc';
            } else {
              txSortBy = 'date';
              txSortDir = 'desc';
            }
            localStorage.setItem('mynotes_budget_tx_sort', txSortBy);
            localStorage.setItem('mynotes_budget_tx_sort_dir', txSortDir);
          }}
        >
          Date {#if txSortBy === 'date'}{txSortDir === 'desc' ? '↓' : '↑'}{/if}
        </button>
        <button
          type="button"
          class="tx-sort-btn"
          class:active={txSortBy === 'amount'}
          onclick={() => {
            if (txSortBy === 'amount') {
              txSortDir = txSortDir === 'desc' ? 'asc' : 'desc';
            } else {
              txSortBy = 'amount';
              txSortDir = 'desc';
            }
            localStorage.setItem('mynotes_budget_tx_sort', txSortBy);
            localStorage.setItem('mynotes_budget_tx_sort_dir', txSortDir);
          }}
        >
          Amount {#if txSortBy === 'amount'}{txSortDir === 'desc' ? '↓' : '↑'}{/if}
        </button>
        {#if txSortBy !== 'date' || txSortDir !== 'desc'}
          <button
            type="button"
            class="tx-sort-btn clear-sort"
            onclick={() => {
              txSortBy = 'date';
              txSortDir = 'desc';
              localStorage.setItem('mynotes_budget_tx_sort', 'date');
              localStorage.setItem('mynotes_budget_tx_sort_dir', 'desc');
            }}
          >
            <X size={12} /> Reset
          </button>
        {/if}
      </div>
      
      <div class="blocks-list flex-col" style="gap: 8px;">
        {#if selectedBox}
          {#each filteredRows as row (row.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div 
              class="matched-row flex-row clickable-row" 
              style="opacity: {row.checked ? 0.6 : 1};"
              onclick={() => startEditingRow(row)}
            >
              <div class="flex-col" style="gap: 4px; align-items: flex-start; min-width: 0; flex-grow: 1;">
                <div class="flex-row" style="align-items: center; gap: 8px; width: 100%;">
                  <span class="matched-row-bullet" style="color: {row.total > 0 ? 'var(--accent)' : 'var(--semantic-error)'}">•</span>
                  <span class="matched-row-label" style="font-weight: 600; color: var(--text-primary); text-decoration: {row.checked ? 'line-through' : 'none'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    {row.label}
                  </span>
                </div>
                <div class="flex-row" style="align-items: center; gap: 8px; font-size: 11px; color: var(--text-secondary); flex-wrap: wrap;">
                  {#if row.date && row.date !== '—'}
                    <span class="row-date-badge" style="background: var(--bg-mid-dark); padding: 1px 6px; border-radius: 4px; font-size: 10px; border: 1px solid var(--border-color);">{row.date}</span>
                  {/if}
                  {#if row.tagIds && row.tagIds.length > 0}
                    <div class="flex-row" style="gap: 4px; flex-wrap: wrap;">
                      {#each row.tagIds as tagId}
                        {@const tagObj = appState.calcTags.find(t => t.id === tagId)}
                        {#if tagObj}
                          <span style="font-size: 9px; padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, {tagObj.color || 'var(--text-secondary)'} 15%, transparent); color: {tagObj.color || 'var(--text-secondary)'}; border: 1px solid color-mix(in srgb, {tagObj.color || 'var(--text-secondary)'} 30%, transparent);">{tagObj.name}</span>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                  {#if row.checked}
                    <span style="font-size: 10px; color: var(--text-tertiary); font-style: italic;">(excluded)</span>
                  {/if}
                </div>
              </div>
              <div class="flex-row" style="align-items: center; gap: var(--spacing-xs); flex-shrink: 0;">
                <span class="snap-val" class:positive={row.total > 0} class:negative={row.total < 0} style="font-weight: 700; font-size: 14px;">
                  {row.total > 0 ? '+' : ''}{selectedBox.currencyCode}{row.total.toLocaleString()}
                </span>
                <Edit3 size={12} class="row-edit-icon" style="color: var(--text-tertiary); flex-shrink: 0;" />
              </div>
            </div>
          {:else}
            <div class="empty-state-card flex-col">
              <p>No matching transactions found.</p>
            </div>
          {/each}
        {:else}
          <div class="empty-state-card flex-col">
            <p>No calculation blocks found. Add a block in your notes to begin budgeting.</p>
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>

<!-- Mobile Floating Action Button (FAB) -->
{#if dashboardData.boxes.length > 0}
  <button 
    type="button" 
    class="mobile-budget-fab flex-row"
    onclick={() => showQuickAddModal = true}
    aria-label="Quick Add Expense"
  >
    <Plus size={24} />
  </button>
{/if}

<!-- Block Settings Modal Overlay -->
{#if showBlockSettingsModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={() => showBlockSettingsModal = false}></div>
  
  <div class="modal-card flex-col">
    <!-- Modal Header -->
    <div class="modal-header flex-row">
      <span class="modal-title flex-row">
        <Settings size={18} />
        <span>Block Settings</span>
      </span>
      <button type="button" class="modal-close-btn" onclick={() => showBlockSettingsModal = false}>
        <X size={16} />
      </button>
    </div>

    <!-- Modal Body -->
    <form onsubmit={(e) => { e.preventDefault(); saveBlockSettings(); }} class="modal-body flex-col" style="gap: var(--spacing-md);">
      
      <!-- Block Title -->
      <div class="form-group flex-col">
        <label for="block-title" class="form-label">Block Title</label>
        <input 
          id="block-title"
          type="text" 
          class="form-input" 
          placeholder="e.g. Monthly Budget"
          bind:value={editBlockTitle} 
          required
        />
      </div>

      <div class="flex-row" style="gap: var(--spacing-md); width: 100%;">
        <!-- Monthly Budget / Income -->
        <div class="form-group flex-col" style="flex: 1;">
          <label for="block-income" class="form-label">Monthly Income Limit</label>
          <input 
            id="block-income"
            type="number" 
            step="any"
            class="form-input" 
            placeholder="e.g. 50000"
            bind:value={editBlockIncome} 
            required
          />
        </div>

        <!-- Currency Code -->
        <div class="form-group flex-col" style="width: 100px;">
          <label for="block-currency" class="form-label">Currency</label>
          <input 
            id="block-currency"
            type="text" 
            class="form-input" 
            placeholder="e.g. ₹"
            bind:value={editBlockCurrency} 
            required
          />
        </div>
      </div>

      <!-- Exclude Checked Checkbox / Toggle -->
      <div class="flex-row" style="align-items: center; justify-content: space-between; padding: var(--spacing-xs) 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); margin-top: var(--spacing-xs);">
        <div class="flex-col" style="align-items: flex-start; gap: 2px; flex: 1; padding-right: var(--spacing-sm);">
          <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">Exclude Checked Items</span>
          <span style="font-size: 11px; color: var(--text-tertiary);">Do not count checked/crossed off notes in dashboard totals</span>
        </div>
        <!-- Toggle switch -->
        <label class="switch-container" style="position: relative; display: inline-block; width: 38px; height: 20px; margin: 0;">
          <input 
            type="checkbox" 
            bind:checked={editBlockExcludeChecked} 
            style="opacity: 0; width: 0; height: 0;"
          />
          <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .2s; border-radius: 20px;"></span>
        </label>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer flex-row" style="margin-top: var(--spacing-sm); justify-content: flex-end; gap: var(--spacing-xs); width: 100%;">
        <button type="button" class="btn btn-secondary" onclick={() => showBlockSettingsModal = false}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary">
          Save Settings
        </button>
      </div>
    </form>
  </div>
{/if}

<!-- Quick Add Modal Overlay -->
{#if showQuickAddModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={closeQuickAddModal}></div>
  
  <div class="modal-card flex-col">
    <!-- Modal Header -->
    <div class="modal-header flex-row">
      <span class="modal-title flex-row">
        {#if editingRowId}
          <Edit3 size={18} />
          <span>Edit Transaction</span>
        {:else}
          <Plus size={18} />
          <span>Add Transaction</span>
        {/if}
      </span>
      <button type="button" class="modal-close-btn" onclick={closeQuickAddModal}>
        <X size={18} />
      </button>
    </div>

    <!-- Modal Body / Form -->
    <div class="modal-body flex-col">
      <!-- Target Calculation Box Selection -->
      <div class="form-group flex-col target-box-picker-wrapper" style="position: relative;">
        <span class="form-label">Target Calculation Box</span>
        {#if dashboardData.boxes.length > 0}
          {@const selectedTargetBox = dashboardData.boxes.find(b => b.id === selectedBoxId && b.noteId === selectedNotePath) || dashboardData.boxes[0]}
          <button 
            type="button" 
            class="form-dropdown-trigger flex-row"
            onclick={(e) => {
              e.stopPropagation();
              showTargetBoxDropdown = !showTargetBoxDropdown;
              showTagDropdown = false;
            }}
          >
            <span class="trigger-label" style="text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              {selectedTargetBox.noteName} — {selectedTargetBox.boxTitle}
            </span>
            <ChevronRight size={14} style="transform: rotate({showTargetBoxDropdown ? '90deg' : '0deg'}); transition: transform 0.2s; flex-shrink: 0;" />
          </button>
          {#if showTargetBoxDropdown}
            <div class="tag-picker-popover flex-col" style="max-height: 240px; z-index: 120;">
              {#each dashboardData.boxes as box}
                <button
                  type="button"
                  class="tag-option flex-row"
                  class:selected={box.id === selectedBoxId && box.noteId === selectedNotePath}
                  style="justify-content: space-between; align-items: center;"
                  onclick={() => {
                    selectTargetBox(box.noteId, box.id);
                    showTargetBoxDropdown = false;
                  }}
                >
                  <div class="flex-col" style="align-items: flex-start; text-align: left; gap: 2px;">
                    <span class="tag-option-name" style="font-weight: 600;">{box.boxTitle}</span>
                    <span style="font-size: 11px; color: var(--text-tertiary);">{box.noteName}</span>
                  </div>
                  {#if box.id === selectedBoxId && box.noteId === selectedNotePath}
                    <Check size={14} class="check-icon" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Segmented Transaction Type Control -->
      <div class="form-group flex-col">
        <span class="form-label">Transaction Type</span>
        <div class="segmented-control flex-row">
          <button 
            type="button" 
            class="segment-btn expense" 
            class:active={transactionType === 'expense'}
            onclick={() => transactionType = 'expense'}
          >
            Expense (-)
          </button>
          <button 
            type="button" 
            class="segment-btn inflow" 
            class:active={transactionType === 'inflow'}
            onclick={() => transactionType = 'inflow'}
          >
            Inflow (+)
          </button>
        </div>
      </div>

      <!-- Description Input -->
      <div class="form-group flex-col">
        <label for="trans-desc" class="form-label">Description</label>
        <input 
          type="text" 
          id="trans-desc"
          class="form-input" 
          placeholder="e.g. Groceries, Freelance work" 
          bind:value={transactionDesc}
        />
      </div>

      <!-- Date Input -->
      <div class="form-group flex-col">
        <label for="trans-date" class="form-label">Date</label>
        <input 
          type="date" 
          id="trans-date"
          class="form-input" 
          bind:value={transactionDate}
        />
      </div>

      <!-- Amount Input -->
      <div class="form-group flex-col">
        <label for="trans-amount" class="form-label">Amount</label>
        <div class="amount-input-wrapper flex-row">
          <span class="amount-currency">{currencyCode}</span>
          <input 
            type="text" 
            id="trans-amount"
            class="form-input amount-field" 
            placeholder="0.00" 
            bind:value={transactionAmount}
          />
        </div>
      </div>

      <!-- Category Tag Picker (Horizontal Pills UI) -->
      <div class="form-group flex-col">
        <span class="form-label">Select Categories</span>
        <div class="category-pills-container flex-row" style="flex-wrap: wrap; gap: 8px; padding: 4px 0; align-items: center;">
          {#each appState.calcTags as tag}
            {@const isSelected = selectedTagIds.includes(tag.id)}
            <button 
              type="button" 
              class="category-pill-btn flex-row" 
              class:selected={isSelected}
              style="--tag-color: {tag.color || 'var(--text-secondary)'}"
              onclick={() => toggleQuickAddTag(tag.id)}
            >
              <span class="tag-dot" style="background: {tag.color || 'var(--text-secondary)'}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
              <span class="tag-name" style="font-size: 12px; font-weight: 500;">{tag.name}</span>
              {#if isSelected}
                <Check size={12} class="check-icon" style="color: var(--tag-color);" />
              {/if}
            </button>
          {/each}

          <!-- Inline Add Category inside Pills -->
          <div class="add-category-wrapper flex-row" style="align-items: center; position: relative;">
            {#if showAddCategoryInline}
              <form 
                onsubmit={handleAddCategorySubmit} 
                class="flex-row" 
                style="align-items: center; gap: 4px; background: var(--bg-mid-dark, #15171a); border: 1px solid var(--border-color, #2a2d35); border-radius: 12px; padding: 2px 6px; height: 24px; box-sizing: border-box;"
              >
                <input 
                  type="text" 
                  placeholder="New tag..." 
                  bind:value={newCategoryName} 
                  autofocus
                  style="background: transparent; border: none; outline: none; color: var(--text-primary); font-size: 11px; width: 80px; padding: 0; font-family: inherit;"
                />
                <button 
                  type="submit" 
                  style="background: transparent; border: none; color: var(--accent); cursor: pointer; display: flex; align-items: center; padding: 1px; transition: opacity 0.2s;"
                  disabled={!newCategoryName.trim()}
                >
                  <Check size={12} />
                </button>
                <button 
                  type="button" 
                  onclick={() => { showAddCategoryInline = false; newCategoryName = ''; }} 
                  style="background: transparent; border: none; color: var(--text-tertiary); cursor: pointer; display: flex; align-items: center; padding: 1px; transition: opacity 0.2s;"
                >
                  <X size={12} />
                </button>
              </form>
            {:else}
              <button 
                type="button" 
                class="category-pill-btn flex-row" 
                style="--tag-color: var(--accent); border-style: dashed; border-color: color-mix(in srgb, var(--accent) 50%, var(--border-color, #2a2d35)); color: var(--accent); height: 24px; border-radius: 12px; padding: 0 10px;" 
                onclick={(e) => { e.stopPropagation(); showAddCategoryInline = true; }}
              >
                <Plus size={11} style="color: var(--accent);" />
                <span style="font-size: 11px; font-weight: 600;">Add Tag</span>
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Footer Actions -->
    <div class="modal-footer flex-row" style="justify-content: space-between; align-items: center; width: 100%;">
      {#if editingRowId}
        <button 
          type="button" 
          class="btn btn-danger flex-row" 
          style="gap: var(--spacing-2xs); background: transparent; color: var(--semantic-error); border: 1px solid var(--semantic-error); padding: 8px 16px; border-radius: var(--radius-standard); cursor: pointer;" 
          onclick={handleDeleteRow}
        >
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      {:else}
        <div></div>
      {/if}
      <div class="flex-row" style="gap: var(--spacing-xs);">
        <button type="button" class="btn btn-secondary" onclick={closeQuickAddModal}>
          Cancel
        </button>
        <button 
          type="button" 
          class="btn btn-primary" 
          disabled={!transactionDesc.trim() || !transactionAmount.trim()}
          onclick={handleQuickAddSave}
        >
          {editingRowId ? 'Save Changes' : 'Add Row'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  .flex-col {
    display: flex;
    flex-direction: column;
  }
  .grid-layout {
    display: grid;
  }

  .budget-view-container {
    width: 100%;
    height: 100%;
    padding: var(--spacing-md);
    box-sizing: border-box;
    overflow-y: auto;
    background-color: var(--bg-base);
    gap: var(--spacing-md);
  }

  /* Header */
  .budget-header {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--spacing-sm);
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }
  .budget-header-left {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2xs);
  }
  .budget-header-actions {
    display: flex;
    flex-direction: row;
    gap: var(--spacing-xs);
    align-items: center;
  }

  .bv-sync-status {
    gap: 5px;
    align-items: center;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: var(--radius-full, 999px);
    background: var(--bg-secondary);
    white-space: nowrap;
  }
  .bv-sync-status.syncing {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .bv-sync-status.error {
    color: var(--semantic-error);
    background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
  }
  .bv-sync-status.synced {
    color: var(--semantic-success, #22c55e);
    background: color-mix(in srgb, var(--semantic-success, #22c55e) 10%, transparent);
  }
  .bv-sync-label {
    display: inline;
  }
  :global(.bv-sync-spin) {
    animation: bv-spin 1s linear infinite;
  }
  @keyframes bv-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .budget-title {
    font-size: 22px;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    gap: var(--spacing-sm);
    margin: 0;
  }
  .budget-subtitle {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .header-quick-add-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: var(--radius-pill);
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    gap: var(--spacing-xs);
    transition: background-color var(--motion-duration-fast);
  }
  .header-quick-add-btn:hover {
    background: var(--accent-hover);
  }

  /* Summary Cards */
  .summary-cards-grid {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--spacing-md);
    width: 100%;
  }

  .summary-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    padding: var(--spacing-md);
    gap: var(--spacing-xs);
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
  }
  .card-top {
    gap: var(--spacing-xs);
  }
  .card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-standard);
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-secondary);
  }
  .card-title {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: var(--font-weight-semibold);
  }
  .card-value {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
  }

  /* Card Color Variants */
  .inflow-card {
    border-left: 4px solid var(--accent);
  }
  .inflow-card .card-icon {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .expenses-card {
    border-left: 4px solid var(--semantic-error, #ef4444);
  }
  .expenses-card .card-icon {
    background: color-mix(in srgb, var(--semantic-error, #ef4444) 12%, transparent);
    color: var(--semantic-error, #ef4444);
  }
  .net-card {
    border-left: 4px solid #3b82f6;
  }
  .net-card .card-icon {
    background: color-mix(in srgb, #3b82f6 12%, transparent);
    color: #3b82f6;
  }
  .savings-card {
    border-left: 4px solid #eab308;
  }
  .savings-card .card-icon {
    background: color-mix(in srgb, #eab308 12%, transparent);
    color: #eab308;
  }

  .card-value.positive {
    color: var(--accent);
  }
  .card-value.negative {
    color: var(--semantic-error, #ef4444);
  }

  /* Columns Layout */
  .budget-columns-layout {
    gap: var(--spacing-lg);
    align-items: flex-start;
    width: 100%;
  }
  .budget-section {
    flex: 1;
    min-width: 0;
    gap: var(--spacing-sm);
  }
  .section-heading {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin: 0;
  }

  /* Filter Controls */
  .blocks-filter-controls {
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-xs);
  }
  .blocks-search-input {
    width: 100%;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .blocks-search-input:focus {
    border-color: var(--border-highlight);
  }
  .blocks-filter-chips {
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 9999px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    white-space: nowrap;
  }
  .filter-chip:hover {
    background: color-mix(in srgb, var(--text-primary) 3%, var(--bg-surface));
    color: var(--text-primary);
    border-color: var(--border-highlight);
  }
  .filter-chip.active {
    background: color-mix(in srgb, var(--tag-color) 12%, transparent);
    border-color: var(--tag-color);
    color: var(--tag-color);
    font-weight: 600;
  }
  .filter-chip.clear-chip {
    border-color: transparent;
    background: transparent;
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .filter-chip.clear-chip:hover {
    color: var(--text-primary);
  }

  /* Transaction Sort Controls */
  .tx-sort-controls {
    flex-wrap: wrap;
  }
  .tx-sort-btn {
    font-size: 11px;
    font-weight: 500;
    padding: 3px 10px;
    border-radius: var(--radius-full, 999px);
    border: 1px solid var(--border-color);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .tx-sort-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .tx-sort-btn.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .tx-sort-btn.clear-sort {
    border-color: transparent;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 10px;
  }
  .tx-sort-btn.clear-sort:hover {
    color: var(--semantic-error);
  }

  /* Progress Cards */
  .categories-list {
    gap: var(--spacing-sm);
  }
  .budget-progress-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    padding: var(--spacing-md);
    gap: var(--spacing-xs);
    position: relative;
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    box-sizing: border-box;
  }
  .budget-progress-card:hover {
    border-color: color-mix(in srgb, var(--tag-color) 25%, var(--border-color));
  }
  .budget-progress-card.over-budget {
    border-color: color-mix(in srgb, var(--semantic-error, #ef4444) 30%, var(--border-color));
    background: color-mix(in srgb, var(--semantic-error, #ef4444) 1.5%, var(--bg-surface));
  }

  .progress-card-top {
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }
  .category-info {
    align-items: center;
    gap: var(--spacing-xs);
  }
  .category-name {
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-base);
    color: var(--text-primary);
  }

  .budget-amount {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }
  .budget-edit-trigger-btn {
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-secondary);
    border: none;
    border-radius: 9999px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .budget-edit-trigger-btn:hover {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
    color: var(--text-primary);
  }
  .budget-amount.no-budget {
    font-size: 11px;
    color: var(--text-tertiary);
    font-style: italic;
  }

  .budget-inline-editor {
    align-items: center;
    gap: 2px;
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: 1px 6px;
    height: 22px;
    box-sizing: border-box;
  }
  .editor-currency {
    font-size: 10px;
    color: var(--text-secondary);
  }
  .editor-input {
    width: 50px;
    border: none;
    background: transparent;
    font-size: 11px;
    color: var(--text-primary);
    text-align: right;
    outline: none;
    padding: 0;
  }

  .progress-card-details {
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-size-sm);
  }
  .amount-spent {
    font-weight: 500;
    color: var(--text-secondary);
  }
  .inflows-text {
    color: var(--accent);
    font-weight: 600;
  }
  .spent-text {
    color: var(--text-primary);
  }
  .amount-spent .separator {
    margin: 0 4px;
    opacity: 0.4;
  }

  .amount-remaining {
    font-weight: var(--font-weight-bold);
  }
  .success-text {
    color: var(--semantic-success, #22c55e);
  }
  .warning-text {
    color: var(--semantic-error, #ef4444);
  }

  .card-progress-container {
    width: 100%;
    height: 6px;
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
    border-radius: 9999px;
    overflow: hidden;
    margin-top: 4px;
  }
  .card-progress-bar {
    height: 100%;
    background: var(--tag-color);
    border-radius: 9999px;
    transition: width 0.3s ease;
  }
  .card-progress-bar.warning {
    background: var(--semantic-error, #ef4444);
  }

  .progress-footer {
    justify-content: space-between;
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .empty-state-card {
    background: var(--bg-surface);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-large);
    padding: var(--spacing-xl);
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    text-align: center;
  }

  /* Scanned Blocks Row */
  .blocks-list {
    gap: var(--spacing-xs);
  }
  .block-snapshot-row {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    padding: var(--spacing-sm) var(--spacing-md);
    justify-content: space-between;
    cursor: pointer;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }
  .block-snapshot-row:hover {
    border-color: var(--border-highlight);
    background: color-mix(in srgb, var(--text-primary) 2%, var(--bg-surface));
  }
  .snapshot-info {
    gap: 2px;
  }
  .snapshot-title {
    align-items: center;
    gap: var(--spacing-xs);
  }
  .note-icon {
    color: var(--accent);
  }
  .box-title-text {
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    font-size: var(--font-size-base);
  }
  .note-name-text {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .snapshot-right {
    gap: var(--spacing-xs);
  }
  .snapshot-value {
    align-items: flex-end;
    gap: 1px;
  }
  .snap-val {
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-base);
  }
  .snap-val.positive {
    color: var(--accent);
  }
  .snap-val.negative {
    color: var(--semantic-error, #ef4444);
  }
  .snap-count {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .arrow-icon {
    color: var(--text-tertiary);
  }

  .tag-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  /* Mobile FAB styling */
  .mobile-budget-fab {
    display: none;
    position: fixed;
    bottom: calc(90px + env(safe-area-inset-bottom, 0px));
    right: 20px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    z-index: 9;
    transition: transform var(--motion-duration-fast) var(--motion-ease-out);
  }
  .mobile-budget-fab:active {
    transform: scale(0.9);
  }

  /* Modal Dialog & Backdrop */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-index-overlay);
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
  }

  .modal-card {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 440px;
    max-height: 90vh;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-large);
    z-index: calc(var(--z-index-overlay) + 1);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .modal-header {
    justify-content: space-between;
    padding: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
  }
  .modal-title {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    gap: var(--spacing-xs);
  }
  .modal-close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: inline-flex;
  }
  .modal-close-btn:hover {
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  .modal-body {
    padding: var(--spacing-md);
    gap: var(--spacing-md);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .form-group {
    gap: var(--spacing-2xs);
  }
  .form-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .form-input, .form-select, .form-dropdown-trigger {
    width: 100%;
    padding: var(--spacing-sm);
    background: color-mix(in srgb, var(--text-primary) 2%, var(--bg-surface));
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    box-sizing: border-box;
    outline: none;
    transition: border-color var(--motion-duration-fast);
  }
  .form-input:focus, .form-select:focus, .form-dropdown-trigger:focus {
    border-color: var(--border-highlight);
  }

  .form-dropdown-trigger {
    justify-content: space-between;
    cursor: pointer;
    background: color-mix(in srgb, var(--text-primary) 2%, var(--bg-surface));
    text-align: left;
  }
  .trigger-label {
    font-weight: 500;
  }

  /* Segmented Control styling */
  .segmented-control {
    width: 100%;
    height: 38px;
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    padding: 2px;
    box-sizing: border-box;
  }
  .segment-btn {
    flex: 1;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    border-radius: calc(var(--radius-standard) - 1px);
    transition: all var(--motion-duration-fast);
  }
  .segment-btn.active.expense {
    background: color-mix(in srgb, var(--semantic-error, #ef4444) 15%, transparent);
    color: var(--semantic-error, #ef4444);
  }
  .segment-btn.active.inflow {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  /* Amount Input */
  .amount-input-wrapper {
    position: relative;
    width: 100%;
  }
  .amount-currency {
    position: absolute;
    left: 12px;
    color: var(--text-secondary);
    font-weight: 600;
    font-size: var(--font-size-sm);
  }
  .form-input.amount-field {
    padding-left: 28px;
    font-weight: var(--font-weight-bold);
  }

  /* Tag checklist dropdown */
  .tag-dropdown-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: transparent;
  }
  .tag-picker-popover {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 11;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    margin-top: 4px;
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
  }
  .tag-option {
    width: 100%;
    padding: var(--spacing-sm);
    justify-content: space-between;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .tag-option:hover {
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }
  .tag-option-left {
    gap: var(--spacing-xs);
    align-items: center;
  }
  .tag-option-name {
    font-size: var(--font-size-sm);
    font-weight: 500;
  }
  .check-icon {
    color: var(--accent);
  }
  .empty-dropdown-text {
    padding: var(--spacing-sm);
    color: var(--text-tertiary);
    font-style: italic;
    font-size: var(--font-size-sm);
    text-align: center;
  }

  /* Category Pill Buttons inside Quick Add Modal */
  .category-pill-btn {
    background: color-mix(in srgb, var(--text-primary) 3%, transparent);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    padding: 6px 12px;
    color: var(--text-secondary);
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
  }
  .category-pill-btn:hover {
    border-color: color-mix(in srgb, var(--tag-color) 40%, var(--border-color));
    color: var(--text-primary);
    background: color-mix(in srgb, var(--tag-color) 6%, transparent);
  }
  .category-pill-btn.selected {
    border-color: var(--tag-color);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--tag-color) 12%, transparent);
    box-shadow: 0 0 0 1px var(--tag-color);
  }

  /* Modal Footer */
  .modal-footer {
    padding: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    justify-content: flex-end;
    gap: var(--spacing-sm);
  }

  .btn {
    padding: var(--spacing-xs) var(--spacing-lg);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    border-radius: var(--radius-standard);
    cursor: pointer;
    border: none;
    transition: all var(--motion-duration-fast);
  }
  .btn-secondary {
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-secondary);
  }
  .btn-secondary:hover {
    background: color-mix(in srgb, var(--text-primary) 12%, transparent);
    color: var(--text-primary);
  }
  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .custom-dropdown-container {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .custom-dropdown-trigger {
    background: var(--bg-mid-dark, #15171a);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 6px 12px;
    border-radius: var(--radius-standard);
    font-size: var(--font-size-sm);
    font-weight: 600;
    align-items: center;
    gap: var(--spacing-xs);
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    user-select: none;
  }
  .custom-dropdown-trigger:hover {
    border-color: var(--border-highlight);
    background: color-mix(in srgb, var(--text-primary) 3%, var(--bg-mid-dark, #15171a));
  }

  .custom-dropdown-list {
    position: absolute;
    top: 100%;
    z-index: 100;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-standard);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    margin-top: 4px;
    padding: 4px;
    min-width: 200px;
    max-height: 320px;
    overflow-y: auto;
  }

  .box-dropdown-list {
    left: auto;
    right: 0;
  }
  @media (min-width: 768px) {
    .box-dropdown-list {
      left: 0;
      right: auto;
      min-width: 320px;
    }
  }

  .sort-dropdown-list {
    right: 0;
    left: auto;
    min-width: 180px;
  }

  .dropdown-item {
    width: 100%;
    padding: 8px 12px;
    justify-content: space-between;
    align-items: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    gap: 12px;
  }
  .dropdown-item:hover {
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    color: var(--text-primary);
  }
  .dropdown-item.selected {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
  }

  /* Pinned tags and sort select and export controls */
  .header-action-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    gap: var(--spacing-xs);
    align-items: center;
    transition: all var(--motion-duration-fast) ease;
  }
  .header-action-btn:hover {
    border-color: var(--border-highlight);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--text-primary) 3%, transparent);
  }
  .header-action-btn.icon-only-btn {
    padding: var(--spacing-xs);
    width: 32px;
    height: 32px;
    justify-content: center;
  }

  .pin-toggle-btn {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: var(--spacing-3xs);
    border-radius: var(--radius-standard);
    display: inline-flex;
    align-items: center;
    transition: all 0.15s ease;
  }
  .pin-toggle-btn:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }
  .pin-toggle-btn.pinned {
    color: var(--accent);
    transform: rotate(45deg);
  }

  /* Sort select styles replaced by custom dropdown triggers */

  .btn-label-desktop {
    display: inline;
  }

  .snapshot-matched-rows {
    margin-top: var(--spacing-xs);
    padding-top: var(--spacing-xs);
    border-top: 1px dashed var(--border-color);
    gap: var(--spacing-2xs);
    align-self: stretch;
  }
  .matched-row {
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-primary) 3%, transparent);
    padding: var(--spacing-2xs) var(--spacing-sm);
    border-radius: var(--radius-standard);
  }
  .matched-row-bullet {
    font-weight: bold;
  }

  .clickable-row {
    transition: background-color 0.2s, border-color 0.2s, transform 0.15s;
  }
  .clickable-row:hover {
    background-color: var(--bg-mid-dark, #15171a) !important;
    border-color: var(--accent) !important;
  }
  .clickable-row:active {
    transform: scale(0.995);
  }
  .clickable-row .row-edit-icon {
    opacity: 0;
    transition: opacity 0.2s, color 0.2s;
  }
  .clickable-row:hover .row-edit-icon {
    opacity: 1;
    color: var(--accent) !important;
  }

  .matched-row.clickable-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface);
    gap: 12px;
    cursor: pointer;
  }

  /* Responsive styling */
  @media (max-width: 768px) {
    .budget-columns-layout {
      flex-direction: column !important;
      align-items: stretch !important;
    }
    .budget-section {
      width: 100%;
    }
    .header-quick-add-btn, .btn-label-desktop {
      display: none;
    }
    .mobile-budget-fab {
      display: flex;
    }

    /* Compact summary cards on mobile */
    .summary-cards-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }
    .summary-card {
      padding: 6px 8px;
      gap: 2px;
      border-radius: var(--radius-standard);
    }
    .card-top {
      gap: 4px;
    }
    .card-icon {
      width: 18px;
      height: 18px;
      border-radius: 3px;
    }
    .card-icon :global(svg) {
      width: 10px;
      height: 10px;
    }
    .card-title {
      font-size: 10px;
    }
    .card-value {
      font-size: 13px;
      font-weight: 700;
    }

    /* Compact category cards on mobile */
    .categories-list {
      gap: 6px;
    }
    .budget-progress-card {
      padding: 6px 8px;
      gap: 3px;
      border-radius: var(--radius-standard);
    }
    .category-name {
      font-size: 12px;
    }
    .progress-card-details {
      font-size: 10px;
    }
    .card-progress-container {
      height: 3px;
      margin-top: 1px;
    }
    .progress-footer {
      font-size: 8.5px;
    }
    .budget-edit-trigger-btn {
      padding: 2px 6px;
      font-size: 9.5px;
    }

    /* Compact transaction rows on mobile */
    .blocks-list {
      gap: 5px !important;
    }
    .matched-row.clickable-row {
      padding: 6px 8px;
      gap: 6px;
    }
    .matched-row-label {
      font-size: 11.5px;
    }
    .snap-val {
      font-size: 12px !important;
    }
    .row-date-badge {
      font-size: 9px !important;
      padding: 0px 4px !important;
    }
    .clickable-row .row-edit-icon {
      opacity: 0.7;
    }
    .section-heading {
      font-size: 14px;
    }
    .section-header-row {
      margin-bottom: 8px !important;
    }

    /* Header mobile layout to prevent actions overflow */
    .budget-header {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      gap: var(--spacing-xs);
      align-items: center;
    }
    .budget-header-left {
      display: contents;
    }
    .budget-title {
      grid-column: 1;
      grid-row: 1;
      font-size: 20px;
    }
    .budget-header-actions {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
    }
    .bv-sync-label {
      display: none;
    }
    .bv-sync-status {
      padding: 4px 6px;
    }
    .box-selector-wrapper {
      grid-column: 1 / span 2;
      grid-row: 2;
      margin-top: 0 !important;
      width: 100%;
    }
    .dropdown-selected-text {
      max-width: 160px !important;
    }
    .budget-view-container {
      overflow-y: visible;
      height: auto;
      padding: var(--spacing-sm);
    }
  }

  /* Block Settings trigger button */
  .block-settings-trigger-btn {
    background: var(--bg-mid-dark, #15171a);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 6px 8px;
    border-radius: var(--radius-standard);
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s, color 0.2s;
    align-items: center;
    justify-content: center;
    height: 32px;
    display: inline-flex;
  }
  .block-settings-trigger-btn:hover {
    border-color: var(--border-highlight);
    background: color-mix(in srgb, var(--text-primary) 3%, var(--bg-mid-dark, #15171a));
    color: var(--text-primary);
  }

  /* Toggle Switch / Slider styling */
  .switch-container {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 20px;
    flex-shrink: 0;
  }
  .switch-container input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color);
    transition: .2s;
    border-radius: 20px;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .2s;
    border-radius: 50%;
  }
  input:checked + .slider {
    background-color: var(--accent);
  }
  input:checked + .slider:before {
    transform: translateX(18px);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>

<script lang="ts" context="module">
  // Custom focus on mount action
  export function focusOnMount(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>
