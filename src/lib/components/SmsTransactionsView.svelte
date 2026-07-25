<script lang="ts">
  import { smsService, type SmsTransaction } from '../services/smsService.svelte';
  import { appState, parseHtmlMetadata, generateHtmlNote } from '../stores/appState.svelte';
  import { BudgetAggregator } from '../services/BudgetAggregator';
  import {
    MessageSquare,
    RefreshCw,
    ShieldCheck,
    Check,
    X,
    Plus,
    ArrowUpRight,
    ArrowDownRight,
    Sparkles,
    Filter,
    AlertTriangle,
    Terminal,
    Smartphone,
    Globe,
    ArrowUpDown,
    Calendar,
    Edit3,
    RotateCcw,
    Tag as TagIcon
  } from 'lucide-svelte';

  let activeTab = $state<'pending' | 'inserted' | 'dismissed' | 'all'>('pending');
  let selectedBoxId = $state<string>('');
  let selectedTagIds = $state<Record<string, string[]>>({}); // txId -> array of selected tagIds mapping
  let sortOrder = $state<'latest' | 'oldest' | 'amount-high' | 'amount-low'>('latest');

  let currencySymbol = $derived(appState.defaultCurrency || '₹');
  let dashboardData = $derived(BudgetAggregator.aggregate(appState.notes, appState.calcTags));
  let availableBoxes = $derived(dashboardData.boxes);
  let sortedCalcTags = $derived(
    [...appState.calcTags].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
  );

  let showDiagnostics = $state(false);

  // Initialize selectedBoxId to first box if empty
  $effect(() => {
    if (!selectedBoxId && availableBoxes.length > 0) {
      selectedBoxId = availableBoxes[0].id;
    }
  });

  // Automatically deduplicate SMS transactions against pre-added manual calculation box entries
  $effect(() => {
    if (availableBoxes && availableBoxes.length > 0) {
      smsService.deduplicateAgainstBoxes(availableBoxes);
    }
  });

  // Filter transactions by tab
  let tabFilteredTransactions = $derived.by(() => {
    if (activeTab === 'pending') return smsService.pendingTransactions;
    if (activeTab === 'inserted') return smsService.allTransactions.filter(t => t.status === 'inserted');
    if (activeTab === 'dismissed') return smsService.allTransactions.filter(t => t.status === 'dismissed');
    return smsService.allTransactions;
  });

  // Sort transactions (Default: Latest First by date/timestamp)
  let filteredTransactions = $derived.by(() => {
    const list = [...tabFilteredTransactions];
    return list.sort((a, b) => {
      const timeA = a.timestamp || (a.date ? new Date(a.date).getTime() : 0);
      const timeB = b.timestamp || (b.date ? new Date(b.date).getTime() : 0);

      if (sortOrder === 'latest') {
        if (timeB !== timeA) return timeB - timeA;
        return (b.date || '').localeCompare(a.date || '');
      } else if (sortOrder === 'oldest') {
        if (timeA !== timeB) return timeA - timeB;
        return (a.date || '').localeCompare(b.date || '');
      } else if (sortOrder === 'amount-high') {
        return b.amount - a.amount;
      } else if (sortOrder === 'amount-low') {
        return a.amount - b.amount;
      }
      return 0;
    });
  });

  let showCustomInput = $state(false);
  let customSmsText = $state('');
  let scanFeedback = $state<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Auto-select text on INITIAL focus only (subsequent clicks allow normal cursor positioning)
  function handleInputFocus(e: FocusEvent) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setTimeout(() => {
      if (document.activeElement === target) {
        target.select();
      }
    }, 0);
  }

  // Auto-resize action for description textareas (guarantees NO SCROLLER EVER)
  function autoResizeTextarea(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = Math.max(38, node.scrollHeight) + 'px';
    };
    resize();
    node.addEventListener('input', resize);
    return {
      destroy() {
        node.removeEventListener('input', resize);
      }
    };
  }

  // Clean description label for Calculation Box insertion (eliminates phone numbers / contact numbers)
  function buildCleanCalBoxLabel(vendor: string, rawBody: string): string {
    let text = (vendor || '').trim();

    // If vendor is a phone number (5+ digits or digits/symbols), clean it up
    const isPhoneNumberOrCode = /\d{5,}/.test(text) || /^[0-9.+\-\s()]+$/.test(text) || text === 'Transaction';

    if (isPhoneNumberOrCode || !text) {
      text = (rawBody || '')
        .replace(/(?:call|contact|sms block|help|dispute|t&c|http|https|upi:\d+|block\s+\d+)\b.*/gi, '')
        .replace(/(?:debited|credited|spent|paid|transferred|deposited|sent|received|for|of|with|rs\.?|inr|₹|\d+(?:\.\d+)?)/gi, ' ')
        .replace(/\b(?:account|acct|a\/c|acc|card|upi|vpa|ref|no|val|bal|avl|avail)\b/gi, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\d+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      text = text.replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim();
    }

    text = text.replace(/[^\w\s\-&']/g, '').trim();
    return text.length >= 2 ? text : 'Transaction';
  }

  async function handleScan() {
    scanFeedback = null;
    const result = await smsService.scanInbox();
    if (availableBoxes.length > 0) {
      smsService.deduplicateAgainstBoxes(availableBoxes);
    }

    scanFeedback = {
      text: result.message,
      type: result.success ? (result.addedCount > 0 ? 'success' : 'info') : 'error',
    };

    setTimeout(() => { scanFeedback = null; }, 6000);
  }

  async function handleRequestPermission() {
    const granted = await smsService.requestPermissions();
    if (granted) {
      await handleScan();
    } else {
      scanFeedback = {
        text: 'SMS permission was denied. Please enable it in your phone Settings > Apps > myNotes > Permissions.',
        type: 'error',
      };
    }
  }

  function handleParseCustomText() {
    if (!customSmsText.trim()) return;
    const success = smsService.parseCustomText(customSmsText);
    if (success) {
      customSmsText = '';
      showCustomInput = false;
      scanFeedback = { text: 'Custom SMS text parsed successfully!', type: 'success' };
      setTimeout(() => { scanFeedback = null; }, 3000);
    } else {
      scanFeedback = {
        text: 'Could not detect a transaction. Make sure the text contains an amount and a debit/credit keyword. Example: "Rs. 450 debited at Swiggy"',
        type: 'error',
      };
      setTimeout(() => { scanFeedback = null; }, 5000);
    }
  }

  // Multi-Tag Toggle Function
  function handleToggleTag(txId: string, tagId: string) {
    const currentTx = smsService.allTransactions.find(t => t.id === txId);
    const defaultTag = currentTx?.suggestedTagId ? [currentTx.suggestedTagId] : [];
    const currentTags = selectedTagIds[txId] ?? defaultTag;

    let updated: string[];
    if (!tagId) {
      // Clicking "No Tag" clears all tags for this transaction
      updated = [];
    } else {
      if (currentTags.includes(tagId)) {
        // Toggle OFF if already selected
        updated = currentTags.filter(id => id !== tagId);
      } else {
        // Toggle ON if not selected (supports selecting multiple tags!)
        updated = [...currentTags, tagId];
      }
    }

    selectedTagIds = { ...selectedTagIds, [txId]: updated };
    smsService.updateTransaction(txId, { suggestedTagId: updated[0] || '' });
  }

  function handleToggleType(tx: SmsTransaction) {
    const newType = tx.type === 'expense' ? 'inflow' : 'expense';
    smsService.updateTransaction(tx.id, { type: newType });
  }

  function handleVendorChange(tx: SmsTransaction, newVendor: string) {
    smsService.updateTransaction(tx.id, { vendor: newVendor });
  }

  function handleRawBodyChange(tx: SmsTransaction, newRawBody: string) {
    smsService.updateTransaction(tx.id, { rawBody: newRawBody });
  }

  // Insert transaction into target Calculation Box matching standard CalBox label syntax
  async function handleInsertToBox(tx: SmsTransaction) {
    if (availableBoxes.length === 0) {
      appState.showToast('No Calculation Box found. Please create a Calculation Box or Note first.', 'warning', 3000);
      return;
    }

    const boxId = selectedBoxId || availableBoxes[0].id;
    const targetBox = availableBoxes.find(b => b.id === boxId);
    if (!targetBox) {
      appState.showToast('Selected calculation box not found.', 'error', 3000);
      return;
    }

    const note = appState.notes.find(n => n.path === targetBox.noteId);
    if (!note || !note.content) {
      appState.showToast('Target note not found.', 'error', 3000);
      return;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(note.content, 'text/html');
      const metricsBlocks = doc.querySelectorAll('div[data-type="metrics"]');

      let targetBlock: Element | null = null;
      metricsBlocks.forEach(block => {
        const dataAttr = block.getAttribute('data-metrics') || '[]';
        try {
          const rows = JSON.parse(dataAttr);
          if (Array.isArray(rows)) {
            const tempId = rows[0]?.id ? rows[0].id.split('_')[0] : '';
            if (boxId.includes(tempId) || metricsBlocks.length === 1) {
              targetBlock = block;
            }
          }
        } catch {}
      });

      if (!targetBlock && metricsBlocks.length > 0) {
        targetBlock = metricsBlocks[0];
      }

      if (!targetBlock) {
        appState.showToast('Could not find target calculation box in note.', 'error', 3000);
        return;
      }

      const dataAttr = targetBlock.getAttribute('data-metrics') || '[]';
      let rows: any[] = [];
      try {
        rows = JSON.parse(dataAttr);
      } catch {
        rows = [];
      }

      const cleanDesc = buildCleanCalBoxLabel(tx.vendor, tx.rawBody);
      const amountSign = tx.type === 'expense' ? ` -${tx.amount}` : ` ${tx.amount}`;
      const rowLabel = `${tx.date} ${cleanDesc}${amountSign}`;

      // Multiple tag selection support
      const activeTags = selectedTagIds[tx.id] ?? (tx.suggestedTagId ? [tx.suggestedTagId] : []);

      const newRow = {
        id: 'row_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        checked: false,
        label: rowLabel,
        tagIds: activeTags
      };

      rows.push(newRow);
      targetBlock.setAttribute('data-metrics', JSON.stringify(rows));

      const parsedNote = parseHtmlMetadata(note.content);
      parsedNote.meta.modified = new Date().toISOString();
      const updatedContent = generateHtmlNote(parsedNote.meta, doc.body.innerHTML);

      note.content = updatedContent;
      note.modified = Date.now();
      await appState.storage.writeNote(note.path, updatedContent);

      if (appState.activeNotePath === note.path) {
        appState.activeNoteContent = updatedContent;
      }

      await appState.refreshNotes();
      if ((appState as any).triggerDebouncedSync) {
        (appState as any).triggerDebouncedSync();
      }

      smsService.markInserted(tx.id);
      const displaySign = tx.type === 'expense' ? '-' : '+';
      appState.showToast(`Added "${displaySign}${currencySymbol}${tx.amount} ${cleanDesc}" to ${targetBox.boxTitle || 'Calculation Box'}!`, 'success', 3000);
    } catch (e) {
      console.error('Error inserting transaction to calculation box:', e);
      appState.showToast('Failed to add transaction to calculation box.', 'error', 3000);
    }
  }

  function handleDismiss(tx: SmsTransaction) {
    smsService.dismissTransaction(tx.id);
  }

  function handleRestore(tx: SmsTransaction) {
    smsService.updateTransaction(tx.id, { status: 'pending', autoMatched: false });
  }
</script>

<div class="sms-view-container">
  <!-- Top Header / Banner -->
  <header class="sms-header">
    <div class="header-title-group">
      <div class="header-icon-box">
        <MessageSquare size={22} class="header-icon" />
      </div>
      <div class="header-text">
        <h2>Inbox</h2>
        <div class="subtitle">
          {#if smsService.isNative}
            <span class="platform-badge native"><Smartphone size={11} /> Android Native</span>
          {:else}
            <span class="platform-badge web"><Globe size={11} /> Web Mode</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="action-bar">
      <button class="btn btn-secondary" onclick={() => showCustomInput = !showCustomInput}>
        <Plus size={15} /> Paste SMS
      </button>

      {#if smsService.isNative}
        <button class="btn btn-primary" onclick={handleScan} disabled={smsService.scanning}>
          <RefreshCw size={15} class={smsService.scanning ? 'spin' : ''} />
          {smsService.scanning ? 'Scanning...' : 'Scan Inbox'}
        </button>

        {#if smsService.permissionGranted === false}
          <button class="btn btn-warning" onclick={handleRequestPermission}>
            <ShieldCheck size={15} />
            Grant Access
          </button>
        {/if}
      {/if}

      <button class="btn btn-ghost btn-icon" onclick={() => showDiagnostics = !showDiagnostics} title="Diagnostics">
        <Terminal size={15} />
      </button>
    </div>
  </header>

  <!-- Scan Feedback Toast -->
  {#if scanFeedback}
    <div class="feedback-toast {scanFeedback.type}">
      {#if scanFeedback.type === 'success'}
        <Sparkles size={16} />
      {:else if scanFeedback.type === 'error'}
        <AlertTriangle size={16} />
      {:else}
        <Sparkles size={16} />
      {/if}
      <span>{scanFeedback.text}</span>
    </div>
  {/if}

  <!-- Diagnostic Log Panel -->
  {#if showDiagnostics}
    <div class="diagnostics-panel">
      <div class="diagnostics-header">
        <h4><Terminal size={14} /> Diagnostic Log</h4>
        <button class="btn btn-sm btn-ghost" onclick={() => showDiagnostics = false}>Close</button>
      </div>
      <div class="diagnostics-log">
        {#if smsService.logs.length === 0}
          <p class="log-empty">No log entries yet. Try scanning the inbox.</p>
        {:else}
          {#each smsService.logs as entry}
            <div class="log-entry">{entry}</div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Custom SMS Paste Input -->
  {#if showCustomInput}
    <div class="custom-input-box">
      <h4>Paste or Type Bank SMS Message</h4>
      <textarea 
        bind:value={customSmsText} 
        onfocus={handleInputFocus}
        placeholder='e.g., "Rs 450 debited from A/c XX4321 at SWIGGY on 25-07-2026"' 
        rows="3"
        class="custom-textarea"
      ></textarea>
      <div class="custom-actions">
        <button class="btn btn-sm btn-ghost" onclick={() => showCustomInput = false}>Cancel</button>
        <button class="btn btn-sm btn-primary" onclick={handleParseCustomText}>Parse & Add</button>
      </div>
    </div>
  {/if}

  <!-- Info Card -->
  <div class="info-card">
    <div class="info-badge">
      <Sparkles size={14} />
      <span>100% On-Device Privacy</span>
    </div>
    <p>
      {#if smsService.isNative}
        Bank & UPI transaction messages are parsed locally on your phone for <strong>current month</strong>. Pre-added manual entries with matching date & amount are automatically deduplicated.
      {:else}
        Running in web mode. Use <strong>Paste SMS</strong> to manually add transaction messages, or install the Android app for automatic SMS scanning.
      {/if}
    </p>
  </div>

  <!-- Filter, Sort & Target Toolbar -->
  <div class="toolbar-section">
    <!-- Status Tabs -->
    <div class="tabs-scroll-container">
      <div class="tabs">
        <button 
          class="tab-btn" 
          class:active={activeTab === 'pending'} 
          onclick={() => activeTab = 'pending'}
        >
          Pending ({smsService.pendingTransactions.length})
        </button>
        <button 
          class="tab-btn" 
          class:active={activeTab === 'inserted'} 
          onclick={() => activeTab = 'inserted'}
        >
          Added
        </button>
        <button 
          class="tab-btn" 
          class:active={activeTab === 'dismissed'} 
          onclick={() => activeTab = 'dismissed'}
        >
          Dismissed
        </button>
        <button 
          class="tab-btn" 
          class:active={activeTab === 'all'} 
          onclick={() => activeTab = 'all'}
        >
          All
        </button>
      </div>
    </div>

    <!-- Controls Row: Sort By & Target Box -->
    <div class="controls-row">
      <!-- Sort Selector -->
      <div class="control-group">
        <label for="sms-sort-order" class="control-label">
          <ArrowUpDown size={13} />
          <span>Sort:</span>
        </label>
        <select id="sms-sort-order" bind:value={sortOrder} class="select-input sort-select">
          <option value="latest">Latest First (Date ↓)</option>
          <option value="oldest">Oldest First (Date ↑)</option>
          <option value="amount-high">Amount (High to Low)</option>
          <option value="amount-low">Amount (Low to High)</option>
        </select>
      </div>

      <!-- Target Box Selector -->
      {#if availableBoxes.length > 0}
        <div class="control-group box-selector-group">
          <span class="control-label">Target Box:</span>
          <select bind:value={selectedBoxId} class="select-input box-select">
            {#each availableBoxes as box}
              <option value={box.id}>{box.boxTitle} ({box.noteName})</option>
            {/each}
          </select>
        </div>
      {/if}
    </div>
  </div>

  <!-- Transactions List -->
  <div class="tx-list-section">
    {#if filteredTransactions.length === 0}
      <div class="empty-state">
        <MessageSquare size={38} class="empty-icon" />
        <h3>No {activeTab} transactions found</h3>
        {#if smsService.isNative}
          <p>Tap <strong>Scan Inbox</strong> to check your inbox for recent banking alerts.</p>
        {:else}
          <p>Use <strong>Paste SMS</strong> to add bank transaction messages manually.</p>
        {/if}
        <button class="btn btn-secondary mt-2" onclick={() => smsService.addMockTransactions()}>
          Add Sample Messages (Demo)
        </button>
      </div>
    {:else}
      <div class="tx-grid">
        {#each filteredTransactions as tx (tx.id)}
          <div class="tx-card" class:expense={tx.type === 'expense'} class:inflow={tx.type === 'inflow'} class:dimmed={tx.status !== 'pending'}>
            
            <!-- Card Header: Type Icon, Editable Vendor Title, Date, Amount -->
            <div class="tx-card-header">
              <div class="vendor-group">
                <!-- Interactive Type Toggle Button (Expense vs Inflow) -->
                <button 
                  type="button"
                  class="tx-type-icon-btn" 
                  class:expense={tx.type === 'expense'} 
                  class:inflow={tx.type === 'inflow'}
                  onclick={() => handleToggleType(tx)}
                  title="Click to toggle Expense (-) or Inflow (+)"
                >
                  {#if tx.type === 'expense'}
                    <ArrowUpRight size={18} />
                  {:else}
                    <ArrowDownRight size={18} />
                  {/if}
                </button>
                <div class="vendor-meta">
                  <div class="editable-vendor-wrapper">
                    <input 
                      type="text" 
                      value={tx.vendor}
                      oninput={(e) => handleVendorChange(tx, (e.target as HTMLInputElement).value)}
                      onfocus={handleInputFocus}
                      class="vendor-input"
                      placeholder="Transaction description / vendor"
                      title="Edit vendor description"
                    />
                    <Edit3 size={13} class="vendor-edit-icon" />
                  </div>
                  <span class="tx-date">{tx.date} • {tx.sender} {#if tx.accountLast4}(A/c XX{tx.accountLast4}){/if}</span>
                </div>
              </div>

              <div class="amount-group">
                <span class="tx-amount" class:expense={tx.type === 'expense'} class:inflow={tx.type === 'inflow'}>
                  {tx.type === 'expense' ? '-' : '+'}{currencySymbol}{tx.amount.toLocaleString()}
                </span>
                
                <!-- Interactive Expense / Inflow Type Toggle Pill -->
                <button 
                  type="button"
                  class="type-pill" 
                  class:expense={tx.type === 'expense'} 
                  class:inflow={tx.type === 'inflow'}
                  onclick={() => handleToggleType(tx)}
                  title="Click to toggle Expense (-) vs Inflow (+)"
                >
                  {tx.type === 'expense' ? '- Expense' : '+ Inflow'}
                </button>

                {#if tx.autoMatched}
                  <span class="status-badge auto-matched">Pre-added (Matched)</span>
                {:else}
                  <span class="status-badge {tx.status}">{tx.status}</span>
                {/if}
              </div>
            </div>

            <!-- Editable Description Box / SMS Raw Body (Auto-Resizing, NO SCROLLER EVER) -->
            <div class="description-box-container">
              <textarea 
                use:autoResizeTextarea
                value={tx.rawBody} 
                oninput={(e) => handleRawBodyChange(tx, (e.target as HTMLTextAreaElement).value)}
                onfocus={handleInputFocus}
                class="editable-raw-sms" 
                rows="1"
                placeholder="Editable SMS description..."
                title="Edit SMS description"
              ></textarea>
            </div>

            <!-- Tag Selection Pill Structure (Supports Multiple Tags Selection) -->
            {#if tx.status === 'pending'}
              {@const activeTags = selectedTagIds[tx.id] ?? (tx.suggestedTagId ? [tx.suggestedTagId] : [])}
              <div class="tag-pills-section">
                <span class="tag-pills-label"><TagIcon size={12} /> Tags:</span>
                <div class="tag-pills-scroll">
                  <!-- No Tag Pill -->
                  <button 
                    type="button"
                    class="tag-pill" 
                    class:selected={activeTags.length === 0}
                    onclick={() => handleToggleTag(tx.id, '')}
                  >
                    {#if activeTags.length === 0}
                      <Check size={11} />
                    {/if}
                    No Tag
                  </button>

                  <!-- Existing Calc Tags Pills (Multiple Selectable, Alphabetical A-Z) -->
                  {#each sortedCalcTags as tag (tag.id)}
                    {@const isSelected = activeTags.includes(tag.id)}
                    <button 
                      type="button"
                      class="tag-pill custom-tag-pill" 
                      class:selected={isSelected}
                      style="--tag-color: {tag.color || '#3b82f6'};"
                      onclick={() => handleToggleTag(tx.id, tag.id)}
                    >
                      {#if isSelected}
                        <Check size={11} />
                      {/if}
                      {tag.name}
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Card Actions (Dismiss & Add) -->
              <div class="tx-card-actions">
                <button class="btn btn-sm btn-ghost" onclick={() => handleDismiss(tx)}>
                  <X size={14} /> Dismiss
                </button>
                <button class="btn btn-sm btn-primary" onclick={() => handleInsertToBox(tx)}>
                  <Plus size={14} /> Add to Calculation Box
                </button>
              </div>
            {:else if tx.status === 'dismissed' || tx.status === 'inserted'}
              <!-- Restore Action for dismissed/inserted cards -->
              <div class="tx-card-actions">
                <button class="btn btn-sm btn-secondary" onclick={() => handleRestore(tx)}>
                  <RotateCcw size={14} /> Restore to Pending
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .sms-view-container {
    padding: 1rem;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
    overflow-x: hidden;
    color: var(--text-primary, #ffffff);
  }

  @media (max-width: 600px) {
    .sms-view-container {
      padding: 0.75rem;
    }
  }

  /* Header Layout */
  .sms-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .header-title-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .header-icon-box {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
    flex-shrink: 0;
  }

  .header-text {
    min-width: 0;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
    line-height: 1.2;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle {
    margin: 0.25rem 0 0 0;
  }

  .platform-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.15rem 0.45rem;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .platform-badge.native {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .platform-badge.web {
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .action-bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    font-size: 0.825rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
  }
  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: var(--bg-mid-dark, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #ffffff);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
  }
  .btn-secondary:hover {
    background: var(--bg-card-hover, rgba(255, 255, 255, 0.16));
  }

  .btn-warning {
    background: #f59e0b;
    color: white;
  }
  .btn-warning:hover {
    background: #d97706;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #94a3b8);
  }
  .btn-ghost:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #ffffff);
  }

  .btn-icon {
    padding: 0.5rem;
  }

  .btn-sm {
    padding: 0.3rem 0.65rem;
    font-size: 0.775rem;
  }

  .mt-2 {
    margin-top: 0.75rem;
  }

  /* Diagnostics Panel */
  .diagnostics-panel {
    background: #090d16;
    border: 1px solid rgba(34, 211, 238, 0.3);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    max-height: 220px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .diagnostics-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .diagnostics-header h4 {
    margin: 0;
    color: #22d3ee;
    font-size: 0.825rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .diagnostics-log {
    overflow-y: auto;
    flex: 1;
  }

  .log-entry {
    font-family: var(--font-mono, monospace);
    font-size: 0.72rem;
    color: #94a3b8;
    padding: 0.15rem 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .log-empty {
    color: #475569;
    font-size: 0.8rem;
    margin: 0;
  }

  /* Feedback Toast */
  .feedback-toast {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1rem;
    border-radius: 8px;
    font-size: 0.825rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .feedback-toast.success {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.35);
    color: #4ade80;
  }

  .feedback-toast.error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #f87171;
  }

  .feedback-toast.info {
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: #60a5fa;
  }

  /* Info Card */
  .info-card {
    background: var(--bg-surface, rgba(59, 130, 246, 0.06));
    border: 1px solid var(--border-color, rgba(59, 130, 246, 0.2));
    border-radius: 12px;
    padding: 0.85rem 1.1rem;
    margin-bottom: 1.1rem;
  }

  .info-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--accent, #60a5fa);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.3rem;
  }

  .info-card p {
    margin: 0;
    font-size: 0.825rem;
    line-height: 1.4;
    color: var(--text-secondary, #94a3b8);
  }

  .info-card strong {
    color: var(--text-primary, #ffffff);
  }

  /* Toolbar Section (Tabs + Sort + Target) */
  .toolbar-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.1rem;
  }

  /* Tabs Horizontal Scroll Container */
  .tabs-scroll-container {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tabs-scroll-container::-webkit-scrollbar {
    display: none;
  }

  .tabs {
    display: inline-flex;
    gap: 0.3rem;
    background: var(--bg-mid-dark, rgba(255, 255, 255, 0.06));
    padding: 0.25rem;
    border-radius: 10px;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    white-space: nowrap;
  }

  .tab-btn {
    padding: 0.4rem 0.8rem;
    border-radius: 7px;
    border: none;
    background: transparent;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary, #94a3b8);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-btn.active {
    background: var(--accent, #3b82f6);
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
  }

  /* Controls Row: Sort & Target Box */
  .controls-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: space-between;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.8rem;
    min-width: 0;
  }

  .box-selector-group {
    flex: 1;
    min-width: 220px;
  }

  .control-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 600;
    color: var(--text-secondary, #94a3b8);
    white-space: nowrap;
  }

  .select-input {
    padding: 0.4rem 0.65rem;
    border-radius: 8px;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
    background: var(--bg-surface, #1e293b);
    font-size: 0.8rem;
    color: var(--text-primary, #ffffff);
    outline: none;
    max-width: 100%;
  }

  .sort-select {
    cursor: pointer;
    font-weight: 600;
  }

  .box-select {
    flex: 1;
    width: 100%;
    min-width: 0;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  /* Transactions List */
  .tx-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .tx-card {
    background: var(--bg-surface, #1e293b);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 12px;
    padding: 0.95rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: transform 0.15s ease, border-color 0.15s ease;
    box-sizing: border-box;
    width: 100%;
  }

  .tx-card.dimmed {
    opacity: 0.65;
  }

  .tx-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .vendor-group {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
    flex: 1;
  }

  .vendor-meta {
    min-width: 0;
    flex: 1;
  }

  /* Editable Vendor Input Wrapper */
  .editable-vendor-wrapper {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    position: relative;
    max-width: 100%;
  }

  .vendor-input {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-primary, #ffffff);
    background: transparent;
    border: 1px transparent dashed;
    border-radius: 4px;
    padding: 0.1rem 0.25rem;
    width: 100%;
    outline: none;
    transition: all 0.15s ease;
  }

  .vendor-input:hover, .vendor-input:focus {
    background: var(--bg-base, rgba(0, 0, 0, 0.25));
    border-color: var(--border-color, rgba(255, 255, 255, 0.2));
  }

  .vendor-edit-icon {
    color: var(--text-secondary, #64748b);
    opacity: 0.6;
    flex-shrink: 0;
    pointer-events: none;
  }

  .tx-type-icon-btn {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: none;
    cursor: pointer;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  .tx-type-icon-btn:hover {
    transform: scale(1.08);
  }
  .tx-type-icon-btn.expense {
    background: rgba(239, 68, 68, 0.18);
    color: #f87171;
  }
  .tx-type-icon-btn.inflow {
    background: rgba(34, 197, 94, 0.18);
    color: #4ade80;
  }

  .tx-date {
    font-size: 0.75rem;
    color: var(--text-secondary, #94a3b8);
    display: block;
    margin-top: 0.1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .amount-group {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    gap: 0.15rem;
  }

  .tx-amount {
    font-size: 1.05rem;
    font-weight: 800;
  }
  .tx-amount.expense {
    color: #f87171;
  }
  .tx-amount.inflow {
    color: #4ade80;
  }

  /* Interactive Type Toggle Pill */
  .type-pill {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.15rem 0.45rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }
  .type-pill.expense {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.35);
  }
  .type-pill.expense:hover {
    background: rgba(239, 68, 68, 0.35);
  }
  .type-pill.inflow {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.35);
  }
  .type-pill.inflow:hover {
    background: rgba(34, 197, 94, 0.35);
  }

  .status-badge {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0.12rem 0.4rem;
    border-radius: 4px;
  }
  .status-badge.pending {
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
  }
  .status-badge.inserted {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }
  .status-badge.auto-matched {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }
  .status-badge.dismissed {
    background: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
  }

  /* Editable Description Box Container - NO SCROLLER EVER */
  .description-box-container {
    margin: 0.4rem 0 0.65rem 0;
  }

  .editable-raw-sms {
    width: 100%;
    font-size: 0.775rem;
    line-height: 1.4;
    color: var(--text-secondary, #cbd5e1);
    background: var(--bg-base, rgba(0, 0, 0, 0.3));
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    font-family: var(--font-mono, monospace);
    resize: none !important;
    overflow: hidden !important;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s ease;
    min-height: 38px;
  }

  .editable-raw-sms:focus {
    border-color: var(--accent, #3b82f6);
    background: var(--bg-base, rgba(0, 0, 0, 0.4));
  }

  /* Tag Selection Pills Structure */
  .tag-pills-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.65rem;
    min-width: 0;
  }

  .tag-pills-label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary, #94a3b8);
    white-space: nowrap;
  }

  .tag-pills-scroll {
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0.15rem 0;
    flex: 1;
  }

  .tag-pills-scroll::-webkit-scrollbar {
    display: none;
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.725rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    background: rgba(148, 163, 184, 0.1);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: var(--text-secondary, #94a3b8);
    transition: all 0.15s ease;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .tag-pill:hover {
    background: rgba(148, 163, 184, 0.2);
  }

  .tag-pill.selected {
    background: rgba(148, 163, 184, 0.3);
    border-color: rgba(255, 255, 255, 0.4);
    color: #ffffff;
    font-weight: 700;
  }

  .tag-pill.custom-tag-pill {
    background: color-mix(in srgb, var(--tag-color) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--tag-color) 40%, transparent);
    color: color-mix(in srgb, var(--tag-color) 90%, #ffffff);
  }

  .tag-pill.custom-tag-pill:hover {
    background: color-mix(in srgb, var(--tag-color) 30%, transparent);
  }

  .tag-pill.custom-tag-pill.selected {
    background: var(--tag-color);
    border-color: var(--tag-color);
    color: #ffffff;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--tag-color) 40%, transparent);
    font-weight: 700;
  }

  /* Custom Paste SMS Box */
  .custom-input-box {
    background: var(--bg-surface, #1e293b);
    border: 1px solid var(--accent, #3b82f6);
    border-radius: 10px;
    padding: 0.85rem;
    margin-bottom: 1rem;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
  }

  .custom-input-box h4 {
    margin: 0 0 0.4rem 0;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-primary, #ffffff);
  }

  .custom-textarea {
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
    background: var(--bg-base, #0f172a);
    color: var(--text-primary, #ffffff);
    padding: 0.5rem 0.65rem;
    font-size: 0.825rem;
    box-sizing: border-box;
    font-family: inherit;
    outline: none;
  }

  .custom-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  .tx-card-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.45rem;
    border-top: 1px dashed var(--border-color, rgba(255, 255, 255, 0.1));
  }

  .empty-state {
    text-align: center;
    padding: 2.5rem 1rem;
    background: var(--bg-surface, rgba(255, 255, 255, 0.03));
    border: 1px dashed var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 12px;
    color: var(--text-secondary, #94a3b8);
  }

  .empty-state h3 {
    margin: 0.5rem 0 0.25rem 0;
    color: var(--text-primary, #ffffff);
    font-size: 1rem;
  }

  .empty-state p {
    font-size: 0.825rem;
    margin: 0 0 0.5rem 0;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
