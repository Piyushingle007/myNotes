<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade, slide, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut, elasticOut, backOut } from 'svelte/easing';
  import { appState } from '../stores/appState.svelte';
  import {
    Target, Plus, Undo2, CheckCircle, SkipForward, Flame,
    Archive, ListChecks, Layers, Trash2, ChevronRight, Keyboard,
    PartyPopper, GripVertical, Edit3, X, Eye, SquareCheckBig, MoreVertical
  } from 'lucide-svelte';
  import SwipeCard from './SwipeCard.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import { longpress, swipeActions } from '../actions/touch';
  import type { FocusCard, CardPriority, CardEffort, CardStatus } from '../storage/FocusCardStore';

  // ── Mode: 'swipe' or 'plan' ──
  let mode = $state<'swipe' | 'plan'>('swipe');

  // ── Quick create ──
  let showCreate = $state(false);
  let newTitle = $state('');
  let newDesc = $state('');
  let newPriority = $state<CardPriority>('none');
  let newEffort = $state<CardEffort>('small');
  let createInputEl = $state<HTMLInputElement | null>(null);

  // ── Undo stack ──
  interface UndoEntry { card: FocusCard; previousStatus: CardStatus; }
  let undoStack = $state<UndoEntry[]>([]);
  const MAX_UNDO = 20;

  // ── Swipe card refs ──
  let cardRefs = $state<(SwipeCard | null)[]>([null, null, null]);
  let topCardRef = $derived(cardRefs[0]);

  // ── Keyboard hints visibility ──
  let showKeyHints = $state(false);

  // ── Celebration ──
  let showCelebration = $state(false);

  // ── Context menu ──
  let contextMenu = $state<{ x: number; y: number; cardId: string } | null>(null);

  // ── Inline editing ──
  let editingCardId = $state<string | null>(null);
  let editTitle = $state('');
  let editDesc = $state('');
  let editPriority = $state<CardPriority>('none');
  let editEffort = $state<CardEffort>('small');

  // ── Card preview (desktop) ──
  let previewCard = $state<FocusCard | null>(null);

  // ── Bulk select ──
  let bulkMode = $state(false);
  let bulkSelected = $state<Set<string>>(new Set());

  // ── Drag reorder ──
  let dragReorderIdx = $state<number | null>(null);
  let dragOverIdx = $state<number | null>(null);

  // ── Mobile: Bottom sheets ──
  let showMobileCreate = $state(false);
  let showMobileEdit = $state(false);
  let showMobilePreview = $state(false);
  let mobileActionSheet = $state<{ cardId: string } | null>(null);

  // ── Mobile: Pull-to-refresh ──
  let pullY = $state(0);
  let pulling = $state(false);
  let refreshing = $state(false);
  const PULL_THRESHOLD = 60;

  // ── Derived data ──
  let queue = $derived(appState.focusQueue.filter(c => c.status !== 'today'));
  let todayPlan = $derived(appState.focusTodayPlan);
  let doneToday = $derived(appState.focusCards.filter(c => c.status === 'done'));
  let totalCards = $derived(appState.focusCards.length);

  // Queue cards for stack display (show up to 3)
  let stackCards = $derived(queue.slice(0, 3));

  // Progress
  let processedCount = $derived(todayPlan.length + doneToday.length);
  let totalQueueable = $derived(queue.length + processedCount);
  let progressPct = $derived(totalQueueable > 0 ? Math.round((processedCount / totalQueueable) * 100) : 0);

  // ── Lifecycle ──
  onMount(() => {
    appState.refreshFocusCards();
  });

  // ── Keyboard shortcuts ──
  function handleKeydown(e: KeyboardEvent) {
    if (appState.activeTab !== 'focus') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

    if (mode === 'swipe' && queue.length > 0) {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          topCardRef?.triggerSwipe('right');
          return;
        case 'ArrowLeft':
          e.preventDefault();
          topCardRef?.triggerSwipe('left');
          return;
        case 'ArrowUp':
          e.preventDefault();
          topCardRef?.triggerSwipe('up');
          return;
        case 'ArrowDown':
          e.preventDefault();
          topCardRef?.triggerSwipe('down');
          return;
      }
    }

    // Global shortcuts
    switch (e.key) {
      case 'z':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleUndo(); }
        return;
      case 'a':
        if ((e.ctrlKey || e.metaKey) && mode === 'plan') {
          e.preventDefault();
          if (bulkMode) {
            // Select all queue cards
            const allIds = new Set(queue.map(c => c.id));
            bulkSelected = allIds;
          } else {
            bulkMode = true;
          }
        }
        return;
      case 'n':
        if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); openCreate(); }
        return;
      case 'Tab':
        e.preventDefault();
        mode = mode === 'swipe' ? 'plan' : 'swipe';
        return;
      case 'Escape':
        if (contextMenu) { contextMenu = null; return; }
        if (editingCardId) { editingCardId = null; return; }
        if (previewCard) { previewCard = null; return; }
        if (bulkMode) { bulkMode = false; bulkSelected = new Set(); return; }
        if (showCreate) { showCreate = false; return; }
        return;
      case ' ':
        // Space = preview top card in swipe mode
        if (mode === 'swipe' && queue.length > 0) {
          e.preventDefault();
          previewCard = previewCard ? null : queue[0];
        }
        return;
      case 'd':
        // D = mark first today card as done
        if (mode === 'plan' && todayPlan.length > 0 && !editingCardId) {
          e.preventDefault();
          handlePlanDone(todayPlan[0].id);
        }
        return;
      case '?':
        showKeyHints = !showKeyHints;
        return;
    }
  }

  // ── Card actions ──
  async function handleSwipe(cardId: string, direction: 'right' | 'left' | 'up' | 'down') {
    const card = appState.focusCards.find(c => c.id === cardId);
    if (!card) return;

    const previousStatus = card.status;
    let newStatus: CardStatus;

    switch (direction) {
      case 'right': newStatus = 'today'; break;
      case 'left':  newStatus = 'skipped'; break;
      case 'up':
        // Up = set high priority + add to today
        const updatedCard = { ...card, priority: 'high' as CardPriority };
        await appState.updateFocusCard(updatedCard);
        newStatus = 'today';
        break;
      case 'down':  newStatus = 'archived'; break;
    }

    // Push undo
    undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), { card: { ...card }, previousStatus }];

    const result = await appState.swipeFocusCard(cardId, newStatus!);
    if (result) {
      const labels: Record<string, string> = {
        right: '✅ Added to today',
        left: '⏭️ Skipped',
        up: '🔥 Prioritized for today',
        down: '📦 Archived',
      };
      appState.showToast(labels[direction], 'success', 2000);
    }

    // Check if queue is now empty → celebrate
    await appState.refreshFocusCards();
    if (appState.focusQueue.filter(c => c.status !== 'today').length === 0 && todayPlan.length > 0) {
      showCelebration = true;
      setTimeout(() => { showCelebration = false; }, 3000);
    }
  }

  async function handleUndo() {
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);

    // Restore the card to its previous state
    const restored = { ...entry.card, status: entry.previousStatus, updatedAt: Date.now() };
    if (entry.previousStatus !== 'done') restored.completedAt = null;
    await appState.updateFocusCard(restored);
    appState.showToast('↩️ Undone', 'info', 1500);
  }

  async function handleCreateCard() {
    const title = newTitle.trim();
    if (!title) return;
    await appState.addFocusCard(title, newDesc.trim(), {
      priority: newPriority,
      effort: newEffort,
    });
    newTitle = '';
    newDesc = '';
    newPriority = 'none';
    newEffort = 'small';
    showCreate = false;
    appState.showToast('📥 Card added to inbox', 'success', 2000);
  }

  function openCreate() {
    showCreate = true;
    setTimeout(() => createInputEl?.focus(), 50);
  }

  async function handlePlanDone(cardId: string) {
    await appState.swipeFocusCard(cardId, 'done');
    appState.showToast('✅ Done!', 'success', 1500);
  }

  async function handlePlanRemove(cardId: string) {
    await appState.swipeFocusCard(cardId, 'inbox');
    appState.showToast('Moved back to inbox', 'info', 1500);
  }

  async function handleDelete(cardId: string) {
    await appState.deleteFocusCard(cardId);
    appState.showToast('Card deleted', 'info', 1500);
  }

  // ── Context menu ──
  function openContextMenu(e: MouseEvent, cardId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, cardId };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  async function contextAction(action: string) {
    if (!contextMenu) return;
    const cardId = contextMenu.cardId;
    closeContextMenu();
    switch (action) {
      case 'today': await appState.swipeFocusCard(cardId, 'today'); break;
      case 'skip': await appState.swipeFocusCard(cardId, 'skipped'); break;
      case 'archive': await appState.swipeFocusCard(cardId, 'archived'); break;
      case 'done': await appState.swipeFocusCard(cardId, 'done'); break;
      case 'inbox': await appState.swipeFocusCard(cardId, 'inbox'); break;
      case 'edit': startEditing(cardId); break;
      case 'preview': previewCard = appState.focusCards.find(c => c.id === cardId) || null; break;
      case 'delete': await handleDelete(cardId); break;
    }
  }

  // ── Inline editing ──
  function startEditing(cardId: string) {
    const card = appState.focusCards.find(c => c.id === cardId);
    if (!card) return;
    editingCardId = cardId;
    editTitle = card.title;
    editDesc = card.description;
    editPriority = card.priority;
    editEffort = card.effort;
  }

  async function saveEditing() {
    if (!editingCardId) return;
    const card = appState.focusCards.find(c => c.id === editingCardId);
    if (!card) return;
    await appState.updateFocusCard({
      ...card,
      title: editTitle.trim() || card.title,
      description: editDesc.trim(),
      priority: editPriority,
      effort: editEffort,
    });
    editingCardId = null;
    appState.showToast('Card updated', 'success', 1500);
  }

  // ── Bulk operations ──
  function toggleBulkSelect(cardId: string) {
    const next = new Set(bulkSelected);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    bulkSelected = next;
  }

  async function bulkAction(action: 'today' | 'skipped' | 'archived' | 'delete') {
    const ids = Array.from(bulkSelected);
    if (ids.length === 0) return;
    for (const id of ids) {
      if (action === 'delete') await appState.deleteFocusCard(id);
      else await appState.swipeFocusCard(id, action);
    }
    appState.showToast(`${action === 'delete' ? 'Deleted' : action === 'today' ? 'Added to today' : action === 'skipped' ? 'Skipped' : 'Archived'} ${ids.length} card${ids.length > 1 ? 's' : ''}`, 'success', 2000);
    bulkSelected = new Set();
    bulkMode = false;
  }

  // ── Drag reorder ──
  function onDragStart(e: DragEvent, index: number) {
    dragReorderIdx = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function onDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    dragOverIdx = index;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  async function onDrop(e: DragEvent, targetIdx: number) {
    e.preventDefault();
    if (dragReorderIdx === null || dragReorderIdx === targetIdx) {
      dragReorderIdx = null;
      dragOverIdx = null;
      return;
    }
    // Reorder today's plan
    const cards = [...todayPlan];
    const [moved] = cards.splice(dragReorderIdx, 1);
    cards.splice(targetIdx, 0, moved);
    // Update sort orders
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].sortOrder !== i) {
        await appState.updateFocusCard({ ...cards[i], sortOrder: i });
      }
    }
    dragReorderIdx = null;
    dragOverIdx = null;
  }

  function onDragEnd() {
    dragReorderIdx = null;
    dragOverIdx = null;
  }

  // ── Mobile: Pull-to-refresh ──
  let pullStartY = 0;
  let pullDecided = false;

  function onPullStart(e: TouchEvent) {
    if (!appState.isMobile || refreshing) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop > 0) return; // only at top
    pullStartY = e.touches[0].clientY;
    pulling = true;
    pullDecided = false;
  }

  function onPullMove(e: TouchEvent) {
    if (!pulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (!pullDecided) {
      if (Math.abs(dy) > 8) { pullDecided = true; }
      else return;
    }
    if (dy > 0) {
      pullY = Math.min(dy * 0.5, 100);
    }
  }

  async function onPullEnd() {
    if (!pulling) return;
    pulling = false;
    if (pullY >= PULL_THRESHOLD) {
      refreshing = true;
      await appState.refreshFocusCards();
      appState.showToast('Refreshed', 'info', 1200);
      refreshing = false;
    }
    pullY = 0;
  }

  // ── Mobile: Action sheet (long press) ──
  function openMobileActionSheet(detail: { x: number; y: number }, cardId: string) {
    mobileActionSheet = { cardId };
  }

  function closeMobileActionSheet() {
    mobileActionSheet = null;
  }

  async function mobileAction(action: string) {
    if (!mobileActionSheet) return;
    const cardId = mobileActionSheet.cardId;
    closeMobileActionSheet();
    switch (action) {
      case 'today': await appState.swipeFocusCard(cardId, 'today'); appState.showToast('Added to today', 'success', 1500); break;
      case 'skip': await appState.swipeFocusCard(cardId, 'skipped'); appState.showToast('Skipped', 'info', 1500); break;
      case 'archive': await appState.swipeFocusCard(cardId, 'archived'); appState.showToast('Archived', 'info', 1500); break;
      case 'done': await appState.swipeFocusCard(cardId, 'done'); appState.showToast('Done!', 'success', 1500); break;
      case 'inbox': await appState.swipeFocusCard(cardId, 'inbox'); appState.showToast('Back to inbox', 'info', 1500); break;
      case 'edit': startEditing(cardId); showMobileEdit = true; break;
      case 'preview':
        previewCard = appState.focusCards.find(c => c.id === cardId) || null;
        showMobilePreview = true;
        break;
      case 'delete': await handleDelete(cardId); break;
    }
  }

  // ── Mobile: Create sheet open ──
  function openMobileCreate() {
    newTitle = '';
    newDesc = '';
    newPriority = 'none';
    newEffort = 'small';
    showMobileCreate = true;
  }

  // ── Mobile: Row swipe actions ──
  function makeSwipeOpts(card: FocusCard) {
    return {
      onSwipeRight: () => {
        if (card.status === 'today') {
          handlePlanDone(card.id);
        } else {
          appState.swipeFocusCard(card.id, 'today');
          appState.showToast('Added to today', 'success', 1500);
        }
      },
      onSwipeLeft: () => {
        if (card.status === 'today') {
          handlePlanRemove(card.id);
        } else {
          appState.swipeFocusCard(card.id, 'archived');
          appState.showToast('Archived', 'info', 1500);
        }
      },
      threshold: 80,
      enabled: () => appState.isMobile && !editingCardId,
    };
  }

  function priorityColor(p: CardPriority): string {
    switch (p) {
      case 'urgent': return 'var(--semantic-error, #ef4444)';
      case 'high': return 'var(--semantic-warning, #f59e0b)';
      case 'medium': return 'var(--accent)';
      case 'low': return 'var(--text-secondary)';
      default: return 'var(--text-tertiary, var(--text-secondary))';
    }
  }

  function effortEmoji(e: CardEffort): string {
    switch (e) {
      case 'trivial': return '⚡';
      case 'small': return '🟢';
      case 'medium': return '🟡';
      case 'large': return '🟠';
      case 'epic': return '🔴';
    }
  }
</script>


<svelte:window onkeydown={handleKeydown} />

<div class="focus-root">
  <div class="focus-container">

    <!-- ═══════ HEADER ═══════ -->
    <header class="focus-header">
      <div class="header-left">
        <div class="header-title-row">
          <div class="brand-icon"><Target size={18} /></div>
          <div class="header-text">
            <h1>Focus</h1>
            <p class="header-subtitle">Build today's plan by swiping your tasks</p>
          </div>
        </div>
      </div>
      <div class="header-right">
        <div class="header-chips">
          <span class="h-chip"><Layers size={12} /> {queue.length} queued</span>
          <span class="h-chip accent"><Flame size={12} /> {todayPlan.length} today</span>
          <span class="h-chip success"><CheckCircle size={12} /> {doneToday.length} done</span>
        </div>
        <div class="header-actions">
          {#if undoStack.length > 0}
            <button class="icon-btn" onclick={handleUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={16} /></button>
          {/if}
          {#if !appState.isMobile}
            <button class="icon-btn" onclick={() => (showKeyHints = !showKeyHints)} title="Keyboard shortcuts (?)" aria-label="Shortcuts"><Keyboard size={16} /></button>
          {/if}
          {#if mode === 'plan' && !appState.isMobile}
            <button class="icon-btn" class:active={bulkMode} onclick={() => { bulkMode = !bulkMode; bulkSelected = new Set(); }} title="Bulk select" aria-label="Bulk select"><SquareCheckBig size={16} /></button>
          {/if}
        </div>
      </div>
    </header>

    <!-- ═══════ KEYBOARD HINTS ═══════ -->
    {#if showKeyHints}
      <div class="key-hints" transition:slide={{ duration: 180, easing: cubicOut }}>
        <span><kbd>→</kbd> Today</span> <span><kbd>←</kbd> Skip</span> <span><kbd>↑</kbd> Prioritize</span> <span><kbd>↓</kbd> Archive</span>
        <span><kbd>Space</kbd> Preview</span> <span><kbd>Ctrl+Z</kbd> Undo</span> <span><kbd>N</kbd> New</span> <span><kbd>D</kbd> Done</span>
        <span><kbd>Tab</kbd> Toggle</span> <span><kbd>Ctrl+A</kbd> Select All</span> <span><kbd>Esc</kbd> Close</span>
      </div>
    {/if}

    <!-- ═══════ SEGMENT CONTROL + NEW BUTTON ═══════ -->
    <div class="controls-row">
      <div class="seg-toggle" role="radiogroup" aria-label="View mode">
        <div class="seg-track" style="transform: translateX({mode === 'plan' ? '100%' : '0'})"></div>
        <button class="seg-btn" class:active={mode === 'swipe'} onclick={() => (mode = 'swipe')} role="radio" aria-checked={mode === 'swipe'}>
          <Layers size={14} /> <span>Swipe</span>
        </button>
        <button class="seg-btn" class:active={mode === 'plan'} onclick={() => (mode = 'plan')} role="radio" aria-checked={mode === 'plan'}>
          <ListChecks size={14} /> <span>Plan</span>
        </button>
      </div>
      {#if !appState.isMobile}
        <button class="new-card-btn" onclick={openCreate} title="New card (N)">
          <Plus size={16} /> New Focus Card
        </button>
      {/if}
    </div>

    <!-- ═══════ BULK ACTION BAR ═══════ -->
    {#if bulkMode && bulkSelected.size > 0}
      <div class="bulk-bar" transition:fly={{ y: -8, duration: 180, easing: cubicOut }}>
        <span class="bulk-count">{bulkSelected.size} selected</span>
        <button class="bulk-action today" onclick={() => bulkAction('today')}><Flame size={14} /> Today</button>
        <button class="bulk-action" onclick={() => bulkAction('skipped')}><SkipForward size={14} /> Skip</button>
        <button class="bulk-action" onclick={() => bulkAction('archived')}><Archive size={14} /> Archive</button>
        <button class="bulk-action del" onclick={() => bulkAction('delete')}><Trash2 size={14} /> Delete</button>
        <button class="bulk-action" onclick={() => { bulkMode = false; bulkSelected = new Set(); }}><X size={14} /> Cancel</button>
      </div>
    {/if}

    <!-- ═══════ QUICK CREATE (desktop) ═══════ -->
    {#if showCreate}
      <div class="create-card" transition:slide={{ duration: 200, easing: cubicOut }}>
        <input bind:this={createInputEl} type="text" class="create-input" placeholder="What do you want to focus on?" bind:value={newTitle} onkeydown={(e) => { if (e.key === 'Enter') handleCreateCard(); if (e.key === 'Escape') showCreate = false; }} />
        <textarea class="create-textarea" placeholder="Details (optional)" bind:value={newDesc} rows="2"></textarea>
        <div class="create-actions">
          <select class="create-select" bind:value={newPriority}>
            <option value="none">Priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <select class="create-select" bind:value={newEffort}>
            <option value="trivial">⚡ Trivial</option><option value="small">🟢 Small</option><option value="medium">🟡 Medium</option><option value="large">🟠 Large</option><option value="epic">🔴 Epic</option>
          </select>
          <div class="create-btns">
            <button class="btn-pill btn-pill-outline" onclick={() => (showCreate = false)}>Cancel</button>
            <button class="btn-pill btn-pill-primary" onclick={handleCreateCard} disabled={!newTitle.trim()}>Add Card</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ═══════ DASHBOARD BODY ═══════ -->
    <div class="dashboard">

      <!-- ── LEFT PANEL ── -->
      <div class="panel-left">
        <!-- Progress Card -->
        <div class="glass-card progress-card">
          <div class="card-label">Daily Progress</div>
          <div class="progress-visual">
            <svg class="progress-ring" viewBox="0 0 96 96" width="96" height="96">
              <circle class="ring-bg" cx="48" cy="48" r="40" />
              <circle class="ring-fill" cx="48" cy="48" r="40" stroke-dasharray="{40 * 2 * Math.PI}" stroke-dashoffset="{40 * 2 * Math.PI * (1 - progressPct / 100)}" />
            </svg>
            <span class="progress-pct">{progressPct}<small>%</small></span>
          </div>
          <div class="progress-stats">
            <div class="p-stat"><span class="p-stat-n">{processedCount}</span><span class="p-stat-l">completed</span></div>
            <div class="p-stat-divider"></div>
            <div class="p-stat"><span class="p-stat-n">{queue.length}</span><span class="p-stat-l">remaining</span></div>
          </div>
        </div>

        <!-- Today's Plan Card -->
        <div class="glass-card plan-card">
          <div class="card-header">
            <div class="card-label"><CheckCircle size={14} /> Today's Plan</div>
            {#if todayPlan.length > 0}
              <span class="count-badge">{todayPlan.length}</span>
            {/if}
          </div>
          {#if todayPlan.length === 0}
            <div class="plan-empty">
              <div class="plan-empty-area">
                <Layers size={24} />
                <span>Swipe cards right to add them here</span>
              </div>
            </div>
          {:else}
            <div class="plan-items">
              {#each todayPlan as card, i (card.id)}
                <div class="plan-item" in:fly={{ x: 16, duration: 200, delay: i * 30, easing: cubicOut }} animate:flip={{ duration: 200 }}>
                  <span class="plan-num">{i + 1}</span>
                  <div class="plan-item-body">
                    <span class="plan-item-title">{card.title}</span>
                    <span class="plan-item-meta">{effortEmoji(card.effort)} {card.priority !== 'none' ? card.priority : ''}</span>
                  </div>
                  <button class="plan-item-done" onclick={() => handlePlanDone(card.id)} title="Done" aria-label="Done"><CheckCircle size={14} /></button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Quick Stats -->
        <div class="stats-grid">
          <div class="stat-card glass-card">
            <div class="stat-icon"><Target size={16} /></div>
            <div class="stat-info"><span class="stat-val">{totalCards}</span><span class="stat-label">Total Cards</span></div>
          </div>
          <div class="stat-card glass-card">
            <div class="stat-icon done-icon"><CheckCircle size={16} /></div>
            <div class="stat-info"><span class="stat-val">{doneToday.length}</span><span class="stat-label">Done Today</span></div>
          </div>
        </div>
      </div>

      <!-- ── RIGHT PANEL (main content) ── -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="panel-right" ontouchstart={onPullStart} ontouchmove={onPullMove} ontouchend={onPullEnd} ontouchcancel={onPullEnd} style={pullY > 0 ? `transform: translateY(${pullY}px)` : ''}>

        {#if pullY > 0 || refreshing}
          <div class="pull-indicator" class:ready={pullY >= PULL_THRESHOLD} class:refreshing>
            <div class="pull-spinner"></div>
            <span>{refreshing ? 'Refreshing…' : pullY >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
          </div>
        {/if}

        {#if appState.focusLoading}
          <div class="empty-state"><div class="spinner"></div><p>Loading…</p></div>

        {:else if mode === 'swipe'}
          {#if queue.length === 0}
            <div class="empty-state">
              {#if showCelebration || todayPlan.length > 0}
                <div class="empty-icon celebrate"><PartyPopper size={36} /></div>
                <h2>All Processed!</h2>
                <p>You've gone through your entire queue. {todayPlan.length} card{todayPlan.length !== 1 ? 's' : ''} in today's plan.</p>
                <button class="btn-pill btn-pill-primary" onclick={() => (mode = 'plan')}><ListChecks size={16} /> View Today's Plan</button>
              {:else}
                <div class="empty-icon"><Target size={36} /></div>
                <h2>Ready to Focus?</h2>
                <p>Create focus cards and swipe through them to build today's action plan.</p>
                <button class="btn-pill btn-pill-primary" onclick={() => appState.isMobile ? openMobileCreate() : openCreate()}><Plus size={16} /> Create First Card</button>
                <!-- Feature hints -->
                <div class="feature-hints">
                  <div class="feature-hint"><Layers size={14} /><span>Swipe to prioritize</span></div>
                  <div class="feature-hint"><CheckCircle size={14} /><span>Build today's plan</span></div>
                  <div class="feature-hint"><Target size={14} /><span>Track your progress</span></div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="swipe-stage">
              <div class="direction-hints">
                <span class="dir-hint right">Today →</span>
                <span class="dir-hint left">← Skip</span>
                <span class="dir-hint up">Priority ↑</span>
                <span class="dir-hint down">↓ Archive</span>
              </div>
              <div class="card-stack">
                {#each stackCards as card, i (card.id)}
                  <SwipeCard bind:this={cardRefs[i]} title={card.title} description={card.description} priority={card.priority} effort={card.effort} tags={card.tags} dueDate={card.dueDate} stackIndex={i} onSwipe={(dir) => handleSwipe(card.id, dir)} />
                {/each}
              </div>
              <div class="stack-counter">{queue.length} card{queue.length !== 1 ? 's' : ''} remaining</div>
            </div>
          {/if}

        {:else}
          <!-- PLAN MODE -->
          {#if todayPlan.length === 0 && queue.length === 0 && doneToday.length === 0}
            <div class="empty-state">
              <div class="empty-icon"><Target size={36} /></div>
              <h2>No Cards Yet</h2>
              <p>Create some focus cards and swipe through them to build your daily plan.</p>
              <button class="btn-pill btn-pill-primary" onclick={() => appState.isMobile ? openMobileCreate() : openCreate()}><Plus size={16} /> Create Card</button>
            </div>
          {:else}
            <div class="plan-list">
              {#if todayPlan.length > 0}
                <div class="plan-section">
                  <div class="section-header"><CheckCircle size={14} /><span>Today's Plan</span><span class="count-badge">{todayPlan.length}</span></div>
                  {#each todayPlan as card, i (card.id)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="list-row" class:drag-over={dragOverIdx === i && dragReorderIdx !== i} style="--row-accent: {priorityColor(card.priority)};" draggable={!appState.isMobile} ondragstart={(e) => onDragStart(e, i)} ondragover={(e) => onDragOver(e, i)} ondrop={(e) => onDrop(e, i)} ondragend={onDragEnd} oncontextmenu={(e) => { if (!appState.isMobile) openContextMenu(e, card.id); }} use:longpress onlongpress={(e: CustomEvent<{ x: number; y: number }>) => openMobileActionSheet(e.detail, card.id)} use:swipeActions={makeSwipeOpts(card)} in:fly={{ y: 12, duration: 250, delay: i * 40, easing: cubicOut }} out:fly={{ x: -30, duration: 200, easing: cubicOut }} animate:flip={{ duration: 250, easing: cubicOut }}>
                      {#if !appState.isMobile}<span class="drag-handle"><GripVertical size={14} /></span>{/if}
                      {#if editingCardId === card.id}
                        <div class="inline-edit">
                          <input class="create-input" bind:value={editTitle} onkeydown={(e) => { if (e.key === 'Enter') saveEditing(); if (e.key === 'Escape') editingCardId = null; }} autofocus />
                          <textarea class="create-textarea" bind:value={editDesc} rows="2"></textarea>
                          <div class="create-actions">
                            <select class="create-select" bind:value={editPriority}><option value="none">Priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select>
                            <select class="create-select" bind:value={editEffort}><option value="trivial">⚡ Trivial</option><option value="small">🟢 Small</option><option value="medium">🟡 Medium</option><option value="large">🟠 Large</option><option value="epic">🔴 Epic</option></select>
                            <div class="create-btns"><button class="btn-pill btn-pill-outline" onclick={() => (editingCardId = null)}>Cancel</button><button class="btn-pill btn-pill-primary" onclick={saveEditing}>Save</button></div>
                          </div>
                        </div>
                      {:else}
                        <div class="row-body" ondblclick={() => !appState.isMobile && startEditing(card.id)}>
                          <span class="row-title">{card.title}</span>
                          {#if card.description}<span class="row-desc">{card.description}</span>{/if}
                          <div class="row-meta">
                            {#if card.priority !== 'none'}<span class="meta-badge" style="color: {priorityColor(card.priority)};">{card.priority}</span>{/if}
                            <span class="meta-badge">{effortEmoji(card.effort)}</span>
                            {#if card.dueDate}<span class="meta-badge due">📅 {card.dueDate}</span>{/if}
                            {#each card.tags as tag}<span class="meta-badge tag">{tag}</span>{/each}
                          </div>
                        </div>
                        <div class="row-actions">
                          <button class="row-act done" onclick={() => handlePlanDone(card.id)} title="Done" aria-label="Done"><CheckCircle size={16} /></button>
                          {#if appState.isMobile}
                            <button class="row-act" onclick={() => (mobileActionSheet = { cardId: card.id })} aria-label="More"><MoreVertical size={14} /></button>
                          {:else}
                            <button class="row-act" onclick={() => handlePlanRemove(card.id)} title="Remove" aria-label="Remove"><Undo2 size={14} /></button>
                            <button class="row-act" onclick={() => startEditing(card.id)} title="Edit" aria-label="Edit"><Edit3 size={12} /></button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}

              {#if queue.length > 0}
                <div class="plan-section">
                  <div class="section-header"><Layers size={14} /><span>Queue</span><span class="count-badge muted">{queue.length}</span></div>
                  {#each queue as card (card.id)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="list-row" style="--row-accent: {priorityColor(card.priority)};" oncontextmenu={(e) => { if (!appState.isMobile) openContextMenu(e, card.id); }} use:longpress onlongpress={(e: CustomEvent<{ x: number; y: number }>) => openMobileActionSheet(e.detail, card.id)} use:swipeActions={makeSwipeOpts(card)} in:fly={{ y: 10, duration: 220, easing: cubicOut }} out:slide={{ duration: 180, easing: cubicOut }} animate:flip={{ duration: 250, easing: cubicOut }}>
                      {#if bulkMode}<input type="checkbox" class="bulk-checkbox" checked={bulkSelected.has(card.id)} onchange={() => toggleBulkSelect(card.id)} />{/if}
                      {#if editingCardId === card.id}
                        <div class="inline-edit">
                          <input class="create-input" bind:value={editTitle} onkeydown={(e) => { if (e.key === 'Enter') saveEditing(); if (e.key === 'Escape') editingCardId = null; }} autofocus />
                          <textarea class="create-textarea" bind:value={editDesc} rows="2"></textarea>
                          <div class="create-actions">
                            <select class="create-select" bind:value={editPriority}><option value="none">Priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select>
                            <select class="create-select" bind:value={editEffort}><option value="trivial">⚡ Trivial</option><option value="small">🟢 Small</option><option value="medium">🟡 Medium</option><option value="large">🟠 Large</option><option value="epic">🔴 Epic</option></select>
                            <div class="create-btns"><button class="btn-pill btn-pill-outline" onclick={() => (editingCardId = null)}>Cancel</button><button class="btn-pill btn-pill-primary" onclick={saveEditing}>Save</button></div>
                          </div>
                        </div>
                      {:else}
                        <div class="row-body" ondblclick={() => !appState.isMobile && startEditing(card.id)}>
                          <span class="row-title">{card.title}</span>
                          {#if card.description}<span class="row-desc">{card.description}</span>{/if}
                        </div>
                        <div class="row-actions">
                          {#if appState.isMobile}
                            <button class="row-act today" onclick={() => appState.swipeFocusCard(card.id, 'today')} aria-label="Today"><Flame size={14} /></button>
                            <button class="row-act" onclick={() => (mobileActionSheet = { cardId: card.id })} aria-label="More"><MoreVertical size={14} /></button>
                          {:else}
                            <button class="row-act today" onclick={() => appState.swipeFocusCard(card.id, 'today')} title="Today" aria-label="Today"><Flame size={14} /></button>
                            <button class="row-act" onclick={() => appState.swipeFocusCard(card.id, 'skipped')} title="Skip" aria-label="Skip"><SkipForward size={14} /></button>
                            <button class="row-act" onclick={() => appState.swipeFocusCard(card.id, 'archived')} title="Archive" aria-label="Archive"><Archive size={14} /></button>
                            <button class="row-act" onclick={() => startEditing(card.id)} title="Edit" aria-label="Edit"><Edit3 size={12} /></button>
                            <button class="row-act del" onclick={() => handleDelete(card.id)} title="Delete" aria-label="Delete"><Trash2 size={12} /></button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}

              {#if doneToday.length > 0}
                <div class="plan-section">
                  <div class="section-header done-header"><PartyPopper size={14} /><span>Completed</span><span class="count-badge success">{doneToday.length}</span></div>
                  {#each doneToday as card (card.id)}
                    <div class="list-row done-row" in:scale={{ start: 0.95, duration: 200, easing: backOut }} animate:flip={{ duration: 200 }}>
                      <span class="row-title done-title">{card.title}</span>
                      <button class="row-act del" onclick={() => handleDelete(card.id)} title="Delete" aria-label="Delete"><Trash2 size={12} /></button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>

  </div>

  <!-- ═══════ CONTEXT MENU ═══════ -->
  {#if contextMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ctx-backdrop" onclick={closeContextMenu} oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}></div>
    <div class="ctx-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
      <button class="ctx-item" onclick={() => contextAction('today')}><Flame size={14} /> Do Today</button>
      <button class="ctx-item" onclick={() => contextAction('done')}><CheckCircle size={14} /> Mark Done</button>
      <button class="ctx-item" onclick={() => contextAction('skip')}><SkipForward size={14} /> Skip</button>
      <button class="ctx-item" onclick={() => contextAction('archive')}><Archive size={14} /> Archive</button>
      <button class="ctx-item" onclick={() => contextAction('inbox')}><Layers size={14} /> Move to Inbox</button>
      <div class="ctx-divider"></div>
      <button class="ctx-item" onclick={() => contextAction('edit')}><Edit3 size={14} /> Edit</button>
      <button class="ctx-item" onclick={() => contextAction('preview')}><Eye size={14} /> Preview</button>
      <div class="ctx-divider"></div>
      <button class="ctx-item danger" onclick={() => contextAction('delete')}><Trash2 size={14} /> Delete</button>
    </div>
  {/if}

  <!-- ═══════ PREVIEW PANEL ═══════ -->
  {#if previewCard && !appState.isMobile}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="preview-backdrop" onclick={() => (previewCard = null)}></div>
    <div class="preview-panel">
      <div class="preview-header"><h2>{previewCard.title}</h2><button class="icon-btn" onclick={() => (previewCard = null)} aria-label="Close"><X size={16} /></button></div>
      {#if previewCard.description}<p class="preview-desc">{previewCard.description}</p>{/if}
      <div class="preview-fields">
        <div class="pf-row"><span class="pf-label">Status</span><span class="pf-value">{previewCard.status}</span></div>
        <div class="pf-row"><span class="pf-label">Priority</span><span class="pf-value" style="color: {priorityColor(previewCard.priority)};">{previewCard.priority}</span></div>
        <div class="pf-row"><span class="pf-label">Effort</span><span class="pf-value">{effortEmoji(previewCard.effort)} {previewCard.effort}</span></div>
        {#if previewCard.dueDate}<div class="pf-row"><span class="pf-label">Due</span><span class="pf-value">📅 {previewCard.dueDate}</span></div>{/if}
        {#if previewCard.tags.length > 0}<div class="pf-row"><span class="pf-label">Tags</span><span class="pf-value">{previewCard.tags.join(', ')}</span></div>{/if}
        <div class="pf-row"><span class="pf-label">Created</span><span class="pf-value">{new Date(previewCard.createdAt).toLocaleDateString()}</span></div>
      </div>
      <div class="preview-actions">
        <button class="btn-pill btn-pill-primary" onclick={() => { startEditing(previewCard!.id); previewCard = null; }}><Edit3 size={14} /> Edit</button>
        <button class="btn-pill btn-pill-outline" onclick={() => (previewCard = null)}>Close</button>
      </div>
    </div>
  {/if}

  <!-- ═══════ CELEBRATION ═══════ -->
  {#if showCelebration}
    <div class="celebration-overlay" transition:scale={{ start: 0.85, duration: 400, easing: elasticOut }}>
      <div class="confetti-burst"></div>
      <PartyPopper size={56} />
      <h2>🎉 Queue Clear!</h2>
      <p>You've processed all your cards. Time to execute!</p>
    </div>
  {/if}

  <!-- ═══════ MOBILE FAB ═══════ -->
  {#if appState.isMobile && mode === 'plan' && !showMobileCreate}
    <button class="mobile-fab" onclick={openMobileCreate} aria-label="Create new card"><Plus size={24} /></button>
  {/if}

  <!-- ═══════ MOBILE SHEETS ═══════ -->
  <BottomSheet show={!!mobileActionSheet} onClose={closeMobileActionSheet} title="Card Actions">
    {#if mobileActionSheet}
      {@const actionCard = appState.focusCards.find(c => c.id === mobileActionSheet!.cardId)}
      {#if actionCard}<div class="action-sheet-title">{actionCard.title}</div>{/if}
      <div class="action-sheet-list">
        <button class="action-sheet-item" onclick={() => mobileAction('today')}><Flame size={18} /><span>Do Today</span></button>
        <button class="action-sheet-item" onclick={() => mobileAction('done')}><CheckCircle size={18} /><span>Mark Done</span></button>
        <button class="action-sheet-item" onclick={() => mobileAction('skip')}><SkipForward size={18} /><span>Skip</span></button>
        <button class="action-sheet-item" onclick={() => mobileAction('inbox')}><Layers size={18} /><span>Move to Inbox</span></button>
        <button class="action-sheet-item" onclick={() => mobileAction('archive')}><Archive size={18} /><span>Archive</span></button>
        <div class="action-sheet-divider"></div>
        <button class="action-sheet-item" onclick={() => mobileAction('edit')}><Edit3 size={18} /><span>Edit</span></button>
        <button class="action-sheet-item" onclick={() => mobileAction('preview')}><Eye size={18} /><span>Preview</span></button>
        <div class="action-sheet-divider"></div>
        <button class="action-sheet-item danger" onclick={() => mobileAction('delete')}><Trash2 size={18} /><span>Delete</span></button>
      </div>
    {/if}
  </BottomSheet>

  <BottomSheet show={showMobileCreate} onClose={() => (showMobileCreate = false)} title="New Focus Card">
    <div class="sheet-form">
      <input type="text" class="create-input" placeholder="What do you want to focus on?" bind:value={newTitle} onkeydown={(e) => { if (e.key === 'Enter' && newTitle.trim()) { handleCreateCard(); showMobileCreate = false; } }} />
      <textarea class="create-textarea" placeholder="Details (optional)" bind:value={newDesc} rows="3"></textarea>
      <div class="sheet-field"><label class="sheet-label">Priority</label><select class="create-select" bind:value={newPriority}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
      <div class="sheet-field"><label class="sheet-label">Effort</label><select class="create-select" bind:value={newEffort}><option value="trivial">⚡ Trivial</option><option value="small">🟢 Small</option><option value="medium">🟡 Medium</option><option value="large">🟠 Large</option><option value="epic">🔴 Epic</option></select></div>
      <div class="sheet-actions"><button class="btn-pill btn-pill-outline" onclick={() => (showMobileCreate = false)}>Cancel</button><button class="btn-pill btn-pill-primary" onclick={() => { handleCreateCard(); showMobileCreate = false; }} disabled={!newTitle.trim()}><Plus size={14} /> Add Card</button></div>
    </div>
  </BottomSheet>

  <BottomSheet show={showMobileEdit && !!editingCardId} onClose={() => { showMobileEdit = false; editingCardId = null; }} title="Edit Card">
    <div class="sheet-form">
      <input type="text" class="create-input" placeholder="Title" bind:value={editTitle} onkeydown={(e) => { if (e.key === 'Enter') { saveEditing(); showMobileEdit = false; } }} />
      <textarea class="create-textarea" placeholder="Description (optional)" bind:value={editDesc} rows="3"></textarea>
      <div class="sheet-field"><label class="sheet-label">Priority</label><select class="create-select" bind:value={editPriority}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
      <div class="sheet-field"><label class="sheet-label">Effort</label><select class="create-select" bind:value={editEffort}><option value="trivial">⚡ Trivial</option><option value="small">🟢 Small</option><option value="medium">🟡 Medium</option><option value="large">🟠 Large</option><option value="epic">🔴 Epic</option></select></div>
      <div class="sheet-actions"><button class="btn-pill btn-pill-outline" onclick={() => { showMobileEdit = false; editingCardId = null; }}>Cancel</button><button class="btn-pill btn-pill-primary" onclick={() => { saveEditing(); showMobileEdit = false; }}><CheckCircle size={14} /> Save</button></div>
    </div>
  </BottomSheet>

  <BottomSheet show={showMobilePreview && !!previewCard} onClose={() => { showMobilePreview = false; previewCard = null; }} title="Card Details" maxHeight="85vh">
    {#if previewCard}
      <div class="sheet-form">
        <h3 class="mobile-preview-title">{previewCard.title}</h3>
        {#if previewCard.description}<p class="mobile-preview-desc">{previewCard.description}</p>{/if}
        <div class="preview-fields">
          <div class="pf-row"><span class="pf-label">Status</span><span class="pf-value">{previewCard.status}</span></div>
          <div class="pf-row"><span class="pf-label">Priority</span><span class="pf-value" style="color: {priorityColor(previewCard.priority)};">{previewCard.priority}</span></div>
          <div class="pf-row"><span class="pf-label">Effort</span><span class="pf-value">{effortEmoji(previewCard.effort)} {previewCard.effort}</span></div>
          {#if previewCard.dueDate}<div class="pf-row"><span class="pf-label">Due</span><span class="pf-value">📅 {previewCard.dueDate}</span></div>{/if}
          {#if previewCard.tags.length > 0}<div class="pf-row"><span class="pf-label">Tags</span><span class="pf-value">{previewCard.tags.join(', ')}</span></div>{/if}
          <div class="pf-row"><span class="pf-label">Created</span><span class="pf-value">{new Date(previewCard.createdAt).toLocaleDateString()}</span></div>
        </div>
        <div class="sheet-actions">
          <button class="btn-pill btn-pill-primary" onclick={() => { startEditing(previewCard!.id); showMobilePreview = false; previewCard = null; showMobileEdit = true; }}><Edit3 size={14} /> Edit</button>
          <button class="btn-pill btn-pill-outline" onclick={() => { showMobilePreview = false; previewCard = null; }}>Close</button>
        </div>
      </div>
    {/if}
  </BottomSheet>
</div>

<style>
  /* ═══════════════════════════════════════════
     PREMIUM DESIGN SYSTEM
     Linear · Arc · Things 3 · Apple Reminders
     Spacing: 8 / 16 / 24 / 32 / 48
     Radius: 8 / 12 / 16 / 20 / 24
  ═══════════════════════════════════════════ */

  /* ── Root ── */
  .focus-root {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: #0F1117;
    color: #e2e5ed;
    position: relative;
  }

  /* Subtle ambient background glow */
  .focus-root::before {
    content: '';
    position: fixed;
    top: -20%;
    left: 50%;
    width: 800px;
    height: 800px;
    border-radius: 50%;
    background: radial-gradient(ellipse, color-mix(in srgb, var(--accent, #00adb5) 4%, transparent) 0%, transparent 70%);
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 0;
  }

  .focus-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 32px 32px 48px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
    z-index: 1;
    animation: pageEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes pageEnter {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── GLASS CARD BASE ── */
  .glass-card {
    background: #161920;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 0 0 0.5px rgba(255, 255, 255, 0.03) inset;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }

  .glass-card:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(255, 255, 255, 0.04) inset;
    transform: translateY(-1px);
  }

  /* ═══════ HEADER ═══════ */
  .focus-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding-bottom: 8px;
  }

  .header-left { display: flex; flex-direction: column; gap: 4px; }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .brand-icon {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--accent, #00adb5) 0%, color-mix(in srgb, var(--accent, #00adb5) 55%, #6366f1) 100%);
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent, #00adb5) 20%, transparent);
  }

  .focus-header h1 {
    font-size: 26px;
    font-weight: 750;
    letter-spacing: -0.5px;
    color: #f4f5f7;
    margin: 0;
    line-height: 1;
  }

  .header-subtitle {
    font-size: 13px;
    color: #6b7280;
    margin: 0;
    margin-left: 56px;
    letter-spacing: 0.1px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .header-chips {
    display: flex;
    gap: 8px;
  }

  .h-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 550;
    padding: 6px 12px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.04);
    color: #9ca3af;
    white-space: nowrap;
    transition: background 0.15s, transform 0.15s;
  }
  .h-chip:hover { background: rgba(255, 255, 255, 0.06); transform: translateY(-0.5px); }

  .h-chip.accent {
    background: color-mix(in srgb, var(--accent, #00adb5) 8%, transparent);
    border-color: color-mix(in srgb, var(--accent, #00adb5) 12%, transparent);
    color: var(--accent, #00adb5);
  }
  .h-chip.success {
    background: rgba(52, 211, 153, 0.06);
    border-color: rgba(52, 211, 153, 0.1);
    color: #34d399;
  }

  .header-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  /* ── ICON BUTTONS ── */
  .icon-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
  }
  .icon-btn:hover { background: rgba(255, 255, 255, 0.06); color: #d1d5db; transform: scale(1.05); }
  .icon-btn:active { transform: scale(0.94); }
  .icon-btn.active { background: color-mix(in srgb, var(--accent, #00adb5) 12%, transparent); color: var(--accent, #00adb5); }

  /* ═══════ KEYBOARD HINTS ═══════ */
  .key-hints {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 12px 16px;
    background: #161920;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 12px;
    color: #6b7280;
  }
  .key-hints kbd {
    display: inline-block;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    font-family: inherit;
    font-size: 10px;
    font-weight: 600;
    color: #9ca3af;
    margin-right: 4px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* ═══════ CONTROLS ROW ═══════ */
  .controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  /* Segmented Toggle — premium glassmorphic */
  .seg-toggle {
    position: relative;
    display: flex;
    background: #13161d;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    padding: 4px;
    gap: 0;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2) inset;
  }

  .seg-track {
    position: absolute;
    inset: 4px;
    width: calc(50% - 4px);
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent, #00adb5) 14%, #1a1e28), color-mix(in srgb, var(--accent, #00adb5) 8%, #1e2230));
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent, #00adb5) 18%, transparent);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow:
      0 0 16px color-mix(in srgb, var(--accent, #00adb5) 10%, transparent),
      0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .seg-btn {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 24px;
    border: none;
    background: transparent;
    color: #6b7280;
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
    z-index: 1;
    border-radius: 10px;
    transition: color 0.2s, transform 0.12s;
    white-space: nowrap;
  }
  .seg-btn:hover { color: #a1a8b4; }
  .seg-btn:active { transform: scale(0.96); }
  .seg-btn.active { color: #f0f2f5; text-shadow: 0 0 16px color-mix(in srgb, var(--accent, #00adb5) 20%, transparent); }

  /* New Card Button */
  .new-card-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border: none;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--accent, #00adb5), color-mix(in srgb, var(--accent, #00adb5) 65%, #6366f1));
    color: #fff;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.2s;
    box-shadow: 0 2px 12px color-mix(in srgb, var(--accent, #00adb5) 22%, transparent);
    letter-spacing: 0.1px;
  }
  .new-card-btn:hover {
    transform: translateY(-1px) scale(1.01);
    box-shadow: 0 6px 24px color-mix(in srgb, var(--accent, #00adb5) 32%, transparent);
  }
  .new-card-btn:active { transform: scale(0.96); }

  /* ═══════ BULK BAR ═══════ */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: #161920;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .bulk-count { font-size: 13px; font-weight: 600; color: #e0e4ec; margin-right: 8px; }
  .bulk-action {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    color: #9ca3af;
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
  }
  .bulk-action:hover { background: rgba(255, 255, 255, 0.08); color: #e0e4ec; transform: translateY(-0.5px); }
  .bulk-action:active { transform: scale(0.95); }
  .bulk-action.today { color: var(--accent, #00adb5); }
  .bulk-action.del { color: #ef4444; }

  /* ═══════ CREATE CARD ═══════ */
  .create-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    background: #161920;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  }

  .create-input {
    width: 100%;
    padding: 12px 16px;
    background: #1B1F29;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    color: #f0f2f5;
    font-size: 15px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .create-input::placeholder { color: #4b5563; }
  .create-input:focus {
    border-color: color-mix(in srgb, var(--accent, #00adb5) 45%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #00adb5) 8%, transparent);
  }

  .create-textarea {
    width: 100%;
    padding: 12px 16px;
    background: #1B1F29;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    color: #f0f2f5;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    resize: vertical;
    min-height: 48px;
    transition: border-color 0.2s;
  }
  .create-textarea::placeholder { color: #4b5563; }
  .create-textarea:focus { border-color: color-mix(in srgb, var(--accent, #00adb5) 45%, transparent); }

  .create-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .create-select {
    padding: 8px 14px;
    background: #1B1F29;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    color: #e0e4ec;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    transition: border-color 0.2s;
  }
  .create-select:focus { border-color: color-mix(in srgb, var(--accent, #00adb5) 45%, transparent); }

  .create-btns {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  /* ── Pill Buttons ── */
  .btn-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border: none;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: transform 0.12s, box-shadow 0.2s, opacity 0.15s;
    white-space: nowrap;
  }
  .btn-pill:active { transform: scale(0.95); }
  .btn-pill:disabled { opacity: 0.35; cursor: not-allowed; }

  .btn-pill-primary {
    background: linear-gradient(135deg, var(--accent, #00adb5), color-mix(in srgb, var(--accent, #00adb5) 65%, #6366f1));
    color: #fff;
    box-shadow: 0 2px 10px color-mix(in srgb, var(--accent, #00adb5) 18%, transparent);
  }
  .btn-pill-primary:hover:not(:disabled) {
    box-shadow: 0 4px 20px color-mix(in srgb, var(--accent, #00adb5) 28%, transparent);
    transform: translateY(-0.5px);
  }

  .btn-pill-outline {
    background: rgba(255, 255, 255, 0.03);
    color: #9ca3af;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .btn-pill-outline:hover { background: rgba(255, 255, 255, 0.06); color: #e0e4ec; }

  /* ═══════ DASHBOARD LAYOUT ═══════ */
  .dashboard {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 24px;
    min-height: 0;
    flex: 1;
  }

  .panel-left {
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    position: sticky;
    top: 0;
    max-height: 100vh;
    padding-right: 4px;
    padding-bottom: 32px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
    align-self: flex-start;
  }

  .panel-right {
    display: flex;
    flex-direction: column;
    min-height: 420px;
    position: relative;
  }

  /* ═══════ PROGRESS CARD ═══════ */
  .progress-card {
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .card-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #6b7280;
    align-self: flex-start;
  }

  .progress-visual {
    position: relative;
    display: grid;
    place-items: center;
    padding: 8px 0;
  }

  .progress-ring { transform: rotate(-90deg); }

  .ring-bg {
    fill: none;
    stroke: rgba(255, 255, 255, 0.04);
    stroke-width: 5;
  }

  .ring-fill {
    fill: none;
    stroke: url(#progressGradient) var(--accent, #00adb5);
    stroke: var(--accent, #00adb5);
    stroke-width: 5;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    filter: drop-shadow(0 0 8px color-mix(in srgb, var(--accent, #00adb5) 35%, transparent));
  }

  .progress-pct {
    position: absolute;
    font-size: 24px;
    font-weight: 750;
    color: #f4f5f7;
    letter-spacing: -0.5px;
  }
  .progress-pct small {
    font-size: 12px;
    font-weight: 500;
    color: #6b7280;
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: 24px;
    width: 100%;
    justify-content: center;
    padding-top: 4px;
  }

  .p-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .p-stat-n { font-size: 18px; font-weight: 750; color: #f4f5f7; }
  .p-stat-l { font-size: 11px; color: #6b7280; letter-spacing: 0.2px; }
  .p-stat-divider {
    width: 1px;
    height: 24px;
    background: rgba(255, 255, 255, 0.06);
  }

  /* ═══════ TODAY'S PLAN CARD ═══════ */
  .plan-card {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .count-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--accent, #00adb5) 10%, transparent);
    color: var(--accent, #00adb5);
  }
  .count-badge.muted {
    background: rgba(255, 255, 255, 0.05);
    color: #6b7280;
  }
  .count-badge.success {
    background: rgba(52, 211, 153, 0.08);
    color: #34d399;
  }

  .plan-empty { padding: 8px 0; }

  .plan-empty-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    border: 1.5px dashed rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    color: #4b5563;
    font-size: 12px;
    text-align: center;
    transition: border-color 0.2s;
  }
  .plan-empty-area:hover { border-color: rgba(255, 255, 255, 0.12); }

  .plan-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .plan-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 10px;
    transition: background 0.15s, transform 0.12s;
  }
  .plan-item:hover { background: rgba(255, 255, 255, 0.04); transform: translateX(2px); }

  .plan-num {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent, #00adb5) 10%, transparent);
    color: var(--accent, #00adb5);
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .plan-item-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .plan-item-title {
    font-size: 13px;
    font-weight: 500;
    color: #e0e4ec;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plan-item-meta {
    font-size: 11px;
    color: #6b7280;
  }

  .plan-item-done {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #4b5563;
    cursor: pointer;
    transition: color 0.15s, background 0.15s, transform 0.12s;
    flex-shrink: 0;
  }
  .plan-item-done:hover { background: rgba(52, 211, 153, 0.08); color: #34d399; transform: scale(1.1); }

  /* ═══════ STATS GRID ═══════ */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .stat-card {
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .stat-icon {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    color: #6b7280;
    flex-shrink: 0;
  }
  .stat-icon.done-icon { background: rgba(52, 211, 153, 0.06); color: #34d399; }

  .stat-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .stat-val { font-size: 18px; font-weight: 750; color: #f4f5f7; }
  .stat-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 550; }

  /* ═══════ SWIPE STAGE — HERO ═══════ */
  .swipe-stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 16px;
    min-height: 480px;
  }

  /* Subtle glow behind the active card */
  .swipe-stage::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 70%;
    height: 60%;
    transform: translate(-50%, -50%);
    background: radial-gradient(ellipse, color-mix(in srgb, var(--accent, #00adb5) 5%, transparent) 0%, transparent 65%);
    pointer-events: none;
    border-radius: 50%;
  }

  .direction-hints {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }

  .dir-hint {
    position: absolute;
    font-size: 11px;
    font-weight: 550;
    color: rgba(255, 255, 255, 0.12);
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  .dir-hint.right { right: 24px; top: 50%; transform: translateY(-50%); }
  .dir-hint.left { left: 24px; top: 50%; transform: translateY(-50%); }
  .dir-hint.up { top: 16px; left: 50%; transform: translateX(-50%); }
  .dir-hint.down { bottom: 16px; left: 50%; transform: translateX(-50%); }

  .card-stack {
    position: relative;
    width: min(420px, 92%);
    height: 440px;
    z-index: 1;
  }

  .stack-counter {
    margin-top: 16px;
    font-size: 12px;
    color: #6b7280;
    font-weight: 550;
    letter-spacing: 0.2px;
  }

  /* ═══════ EMPTY STATE ═══════ */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 24px;
    gap: 16px;
    animation: pageEnter 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards;
  }

  .empty-icon {
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    color: #4b5563;
    margin-bottom: 4px;
  }
  .empty-icon.celebrate {
    background: color-mix(in srgb, var(--accent, #00adb5) 8%, transparent);
    color: var(--accent, #00adb5);
    animation: celebPulse 2s ease-in-out infinite;
  }

  @keyframes celebPulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent, #00adb5) 10%, transparent); }
    50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent, #00adb5) 0%, transparent); }
  }

  .empty-state h2 {
    font-size: 20px;
    font-weight: 700;
    color: #f4f5f7;
    margin: 0;
  }

  .empty-state p {
    font-size: 14px;
    color: #6b7280;
    max-width: 320px;
    line-height: 1.55;
    margin: 0;
  }

  .feature-hints {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .feature-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: #161920;
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    font-size: 12px;
    color: #9ca3af;
    font-weight: 500;
    transition: background 0.15s, transform 0.12s;
  }
  .feature-hint:hover { background: #1a1e28; transform: translateY(-1px); }

  /* ═══════ PLAN LIST ═══════ */
  .plan-list {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 4px 0;
    flex: 1;
  }

  .plan-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #6b7280;
    padding: 0 4px 8px;
  }
  .section-header.done-header { color: #34d399; }

  /* ── List Row ── */
  .list-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: #161920;
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    border-left: 3px solid var(--row-accent, transparent);
    transition: background 0.15s, transform 0.15s, box-shadow 0.2s;
    cursor: default;
  }
  .list-row:hover {
    background: #1a1e28;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  .list-row.drag-over {
    border-color: var(--accent, #00adb5);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #00adb5) 40%, transparent);
  }
  .list-row.done-row {
    opacity: 0.45;
    border-left-color: #34d399;
  }
  .list-row.done-row:hover { opacity: 0.65; }

  .drag-handle {
    color: #2d3748;
    cursor: grab;
    padding: 2px;
    transition: color 0.15s;
  }
  .drag-handle:hover { color: #6b7280; }

  .row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: default;
  }

  .row-title {
    font-size: 14px;
    font-weight: 520;
    color: #e2e5ed;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .done-title { text-decoration: line-through; color: #6b7280; }

  .row-desc {
    font-size: 12px;
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .meta-badge {
    font-size: 11px;
    font-weight: 550;
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    color: #9ca3af;
    text-transform: capitalize;
  }
  .meta-badge.due { color: #f59e0b; border-color: rgba(245, 158, 11, 0.12); }
  .meta-badge.tag { color: #818cf8; background: rgba(129, 140, 248, 0.06); border-color: rgba(129, 140, 248, 0.1); }

  .row-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .list-row:hover .row-actions { opacity: 1; }

  .row-act {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #4b5563;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
  }
  .row-act:hover { background: rgba(255, 255, 255, 0.05); color: #d1d5db; transform: scale(1.08); }
  .row-act:active { transform: scale(0.9); }
  .row-act.done:hover { background: rgba(52, 211, 153, 0.08); color: #34d399; }
  .row-act.today:hover { background: color-mix(in srgb, var(--accent, #00adb5) 10%, transparent); color: var(--accent, #00adb5); }
  .row-act.del:hover { background: rgba(239, 68, 68, 0.08); color: #ef4444; }

  .inline-edit {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .bulk-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent, #00adb5);
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ═══════ CONTEXT MENU ═══════ */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .ctx-menu {
    position: fixed;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    min-width: 192px;
    padding: 6px;
    background: #1a1e28;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), 0 0 0 0.5px rgba(255, 255, 255, 0.04) inset;
    backdrop-filter: blur(20px);
    animation: menuIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes menuIn {
    from { opacity: 0; transform: scale(0.95) translateY(-4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #d1d5db;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
  }
  .ctx-item:hover { background: rgba(255, 255, 255, 0.05); }
  .ctx-item:active { background: rgba(255, 255, 255, 0.08); }
  .ctx-item.danger { color: #ef4444; }
  .ctx-item.danger:hover { background: rgba(239, 68, 68, 0.08); }

  .ctx-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 4px 8px;
  }

  /* ═══════ PREVIEW PANEL ═══════ */
  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 900;
    backdrop-filter: blur(6px);
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .preview-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 901;
    width: 400px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 32px;
    background: #1a1e28;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 20px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: panelIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes panelIn {
    from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .preview-header h2 {
    font-size: 18px;
    font-weight: 700;
    color: #f4f5f7;
    margin: 0;
  }

  .preview-desc {
    font-size: 14px;
    color: #9ca3af;
    line-height: 1.55;
    margin: 0;
  }

  .preview-fields {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .pf-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .pf-row:last-child { border-bottom: none; }
  .pf-label {
    font-size: 13px;
    color: #6b7280;
    font-weight: 500;
  }
  .pf-value {
    font-size: 13px;
    color: #e0e4ec;
    font-weight: 550;
    text-transform: capitalize;
  }

  .preview-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  /* ═══════ CELEBRATION ═══════ */
  .celebration-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: rgba(15, 17, 23, 0.88);
    backdrop-filter: blur(12px);
    color: #f4f5f7;
    text-align: center;
    pointer-events: none;
  }
  .celebration-overlay h2 { font-size: 24px; font-weight: 750; margin: 0; }
  .celebration-overlay p { font-size: 15px; color: #9ca3af; margin: 0; }

  .confetti-burst {
    position: absolute;
    width: 240px;
    height: 240px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent, #00adb5) 12%, transparent) 0%, transparent 65%);
    animation: confettiPulse 1s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
  }
  @keyframes confettiPulse {
    0% { transform: scale(0.2); opacity: 1; }
    100% { transform: scale(3.5); opacity: 0; }
  }

  /* ═══════ MOBILE FAB ═══════ */
  .mobile-fab {
    position: fixed;
    right: 16px;
    bottom: calc(72px + env(safe-area-inset-bottom, 0px));
    width: 56px;
    height: 56px;
    border-radius: 16px;
    border: none;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, var(--accent, #00adb5), color-mix(in srgb, var(--accent, #00adb5) 65%, #6366f1));
    color: #fff;
    box-shadow: 0 8px 24px color-mix(in srgb, var(--accent, #00adb5) 25%, transparent);
    cursor: pointer;
    z-index: 100;
    transition: transform 0.15s, box-shadow 0.2s;
  }
  .mobile-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 32px color-mix(in srgb, var(--accent, #00adb5) 30%, transparent); }
  .mobile-fab:active { transform: scale(0.9); }

  /* ═══════ MOBILE BOTTOM SHEETS ═══════ */
  .action-sheet-title {
    padding: 4px 24px 16px;
    font-size: 15px;
    font-weight: 600;
    color: #f4f5f7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .action-sheet-list {
    display: flex;
    flex-direction: column;
    padding: 0 8px 8px;
  }

  .action-sheet-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 16px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: #d1d5db;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }
  .action-sheet-item:active { background: rgba(255, 255, 255, 0.05); }
  .action-sheet-item.danger { color: #ef4444; }

  .action-sheet-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 4px 16px;
  }

  /* ═══════ MOBILE SHEET FORMS ═══════ */
  .sheet-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px 24px 24px;
  }

  .sheet-field {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .sheet-label {
    font-size: 14px;
    font-weight: 550;
    color: #9ca3af;
    min-width: 72px;
  }

  .sheet-field .create-select {
    flex: 1;
  }

  .sheet-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .sheet-actions .btn-pill { flex: 1; justify-content: center; }

  .mobile-preview-title {
    font-size: 18px;
    font-weight: 700;
    color: #f4f5f7;
    margin: 0;
  }

  .mobile-preview-desc {
    font-size: 14px;
    color: #9ca3af;
    line-height: 1.55;
    margin: 0;
  }

  /* ═══════ PULL TO REFRESH ═══════ */
  .pull-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    font-size: 12px;
    color: #6b7280;
  }
  .pull-indicator.ready { color: var(--accent, #00adb5); }
  .pull-indicator.refreshing { color: var(--accent, #00adb5); }

  .pull-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.08);
    border-top-color: var(--accent, #00adb5);
    border-radius: 50%;
  }
  .refreshing .pull-spinner { animation: spin 0.6s linear infinite; }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2.5px solid rgba(255, 255, 255, 0.06);
    border-top-color: var(--accent, #00adb5);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ═══════ RESPONSIVE ═══════ */
  @media (max-width: 900px) {
    .focus-container {
      padding: 16px 16px 96px;
      gap: 16px;
    }

    .dashboard {
      grid-template-columns: 1fr;
      gap: 16px;
    }

    .panel-left {
      order: 2;
    }

    .panel-right {
      order: 1;
      min-height: 360px;
    }

    .focus-header {
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }

    .header-right {
      width: 100%;
      justify-content: space-between;
    }

    .header-subtitle { margin-left: 0; }

    .controls-row { flex-wrap: wrap; }

    .card-stack {
      width: min(360px, 95%);
      height: 420px;
    }

    .swipe-stage { min-height: 440px; padding: 8px; }

    .seg-btn { padding: 10px 20px; }

    .stats-grid { grid-template-columns: 1fr 1fr; }

    .row-actions { opacity: 1; }

    .list-row { padding: 10px 12px; }

    .feature-hints { flex-direction: column; align-items: stretch; }

    .focus-root::before { width: 400px; height: 400px; }
  }

  @media (max-width: 480px) {
    .focus-container { padding: 12px 12px 96px; gap: 12px; }

    .focus-header h1 { font-size: 22px; }

    .header-chips { flex-wrap: wrap; gap: 6px; }

    .card-stack { width: 95%; height: 400px; }

    .progress-card { padding: 16px; }

    .progress-ring { width: 72px !important; height: 72px !important; }

    .stats-grid { grid-template-columns: 1fr; gap: 8px; }

    .dir-hint { display: none; }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .focus-container { animation: none; }
    .empty-state { animation: none; }
    .glass-card { transition: none; }
    .list-row { transition: none; }
    .focus-root::before { display: none; }
    .swipe-stage::before { display: none; }
  }
</style>
