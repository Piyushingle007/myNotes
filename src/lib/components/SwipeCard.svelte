<script lang="ts">
  import { Flame, CheckCircle, SkipForward, Archive } from 'lucide-svelte';
  import type { CardPriority, CardEffort } from '../storage/FocusCardStore';

  interface Props {
    title: string;
    description: string;
    priority: CardPriority;
    effort: CardEffort;
    tags: string[];
    dueDate: string | null;
    stackIndex?: number;
    onSwipe?: (direction: 'right' | 'left' | 'up' | 'down') => void;
  }

  let {
    title, description, priority, effort, tags, dueDate,
    stackIndex = 0, onSwipe,
  }: Props = $props();

  // ── Drag state ──
  let dragX = $state(0);
  let dragY = $state(0);
  let dragging = $state(false);
  let exiting = $state(false);
  let cardEl = $state<HTMLDivElement | null>(null);

  let startX = 0;
  let startY = 0;
  let startTime = 0;

  const THRESHOLD = 80;
  const VELOCITY_THRESHOLD = 0.5;
  const MAX_ROTATION = 12;

  let rotation = $derived(dragging ? dragX / 20 : 0);
  let clampedRot = $derived(Math.min(MAX_ROTATION, Math.max(-MAX_ROTATION, rotation)));

  // Active zone detection
  function getActiveZone(): 'right' | 'left' | 'up' | 'down' | null {
    if (!dragging) return null;
    const absX = Math.abs(dragX);
    const absY = Math.abs(dragY);
    if (absX < THRESHOLD * 0.4 && absY < THRESHOLD * 0.4) return null;
    if (absX > absY) return dragX > 0 ? 'right' : 'left';
    return dragY < 0 ? 'up' : 'down';
  }

  let stackScale = $derived(1 - stackIndex * 0.04);
  let stackYOffset = $derived(stackIndex * 6);

  function priorityColor(p: CardPriority): string {
    switch (p) {
      case 'urgent': return 'var(--semantic-error, #ef4444)';
      case 'high': return 'var(--semantic-warning, #f59e0b)';
      case 'medium': return 'var(--accent)';
      case 'low': return 'var(--text-secondary)';
      default: return 'var(--text-tertiary, var(--text-secondary))';
    }
  }

  function effortLabel(e: CardEffort): string {
    switch (e) {
      case 'trivial': return '⚡ Trivial';
      case 'small': return '🟢 Small';
      case 'medium': return '🟡 Medium';
      case 'large': return '🟠 Large';
      case 'epic': return '🔴 Epic';
    }
  }

  function priorityLabel(p: CardPriority): string {
    switch (p) {
      case 'urgent': return '🔥 Urgent';
      case 'high': return '⚠️ High';
      case 'medium': return '● Medium';
      case 'low': return '○ Low';
      default: return '';
    }
  }

  // ── Pointer events ──
  function onPointerDown(e: PointerEvent) {
    if (stackIndex !== 0 || exiting) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startTime = Date.now();
    dragX = 0;
    dragY = 0;
    cardEl?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    dragX = e.clientX - startX;
    dragY = e.clientY - startY;
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    cardEl?.releasePointerCapture(e.pointerId);

    const elapsed = Math.max(1, Date.now() - startTime);
    const velocityX = Math.abs(dragX) / elapsed;
    const velocityY = Math.abs(dragY) / elapsed;
    const absX = Math.abs(dragX);
    const absY = Math.abs(dragY);

    let dir: 'right' | 'left' | 'up' | 'down' | null = null;

    if (absX > absY) {
      if (absX > THRESHOLD || velocityX > VELOCITY_THRESHOLD) {
        dir = dragX > 0 ? 'right' : 'left';
      }
    } else {
      if (absY > THRESHOLD || velocityY > VELOCITY_THRESHOLD) {
        dir = dragY < 0 ? 'up' : 'down';
      }
    }

    if (dir) {
      triggerExit(dir);
    } else {
      dragX = 0;
      dragY = 0;
    }
  }

  function triggerExit(dir: 'right' | 'left' | 'up' | 'down') {
    exiting = true;
    const dist = 600;
    switch (dir) {
      case 'right': dragX = dist; dragY = 0; break;
      case 'left':  dragX = -dist; dragY = 0; break;
      case 'up':    dragX = 0; dragY = -dist; break;
      case 'down':  dragX = 0; dragY = dist; break;
    }
    setTimeout(() => {
      onSwipe?.(dir);
      exiting = false;
      dragX = 0;
      dragY = 0;
    }, 280);
  }

  export function triggerSwipe(dir: 'right' | 'left' | 'up' | 'down') {
    if (stackIndex !== 0 || exiting) return;
    triggerExit(dir);
  }

  function zoneLabel(zone: 'right' | 'left' | 'up' | 'down' | null): string {
    switch (zone) {
      case 'right': return '✅ Do Today';
      case 'left': return '⏭️ Skip';
      case 'up': return '🔥 Prioritize';
      case 'down': return '📦 Archive';
      default: return '';
    }
  }

  function zoneColor(zone: 'right' | 'left' | 'up' | 'down' | null): string {
    switch (zone) {
      case 'right': return 'var(--semantic-success, #22c55e)';
      case 'left': return 'var(--semantic-warning, #f59e0b)';
      case 'up': return 'var(--semantic-error, #ef4444)';
      case 'down': return 'var(--text-secondary)';
      default: return 'transparent';
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={cardEl}
  class="swipe-card"
  class:dragging
  class:exiting
  class:behind={stackIndex > 0}
  style="
    --dx: {dragX}px;
    --dy: {dragY}px;
    --rot: {clampedRot}deg;
    --stack-scale: {stackScale};
    --stack-y: {stackYOffset}px;
    --zone-clr: {zoneColor(getActiveZone())};
    --priority-clr: {priorityColor(priority)};
    z-index: {10 - stackIndex};
  "
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  role="listitem"
  aria-label="{title}"
>
  <!-- Zone indicator -->
  {#if dragging && getActiveZone()}
    <div class="zone-indicator">
      <span class="zone-label">{zoneLabel(getActiveZone())}</span>
    </div>
  {/if}

  <!-- Priority stripe top -->
  <div class="priority-stripe"></div>

  <!-- Content -->
  <div class="card-content flex-col">
    <h2 class="sc-title">{title}</h2>
    {#if description}
      <p class="sc-desc">{description}</p>
    {/if}
    <div class="sc-meta flex-row">
      {#if priority !== 'none'}
        <span class="meta-pill" style="color: {priorityColor(priority)};">{priorityLabel(priority)}</span>
      {/if}
      <span class="meta-pill">{effortLabel(effort)}</span>
      {#if dueDate}
        <span class="meta-pill due">📅 {dueDate}</span>
      {/if}
    </div>
    {#if tags.length > 0}
      <div class="sc-tags flex-row">
        {#each tags as tag}
          <span class="sc-tag">{tag}</span>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Buttons -->
  {#if stackIndex === 0 && !exiting}
    <div class="sc-btns flex-row">
      <button class="sc-btn skip" onclick={() => triggerExit('left')} title="Skip (←)" aria-label="Skip today">
        <SkipForward size={18} />
      </button>
      <button class="sc-btn archive" onclick={() => triggerExit('down')} title="Archive (↓)" aria-label="Archive">
        <Archive size={18} />
      </button>
      <button class="sc-btn prioritize" onclick={() => triggerExit('up')} title="Prioritize (↑)" aria-label="High priority">
        <Flame size={18} />
      </button>
      <button class="sc-btn commit" onclick={() => triggerExit('right')} title="Do Today (→)" aria-label="Do today">
        <CheckCircle size={20} />
      </button>
    </div>
  {/if}
</div>

<style>
  .swipe-card {
    position: absolute;
    width: 100%;
    max-width: 100%;
    border-radius: 24px;
    background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid color-mix(in srgb, white 8%, transparent);
    box-shadow:
      0 12px 48px 0 rgba(0, 0, 0, 0.35),
      0 4px 16px 0 rgba(0, 0, 0, 0.2),
      0 1px 0 0 color-mix(in srgb, white 5%, transparent) inset;
    cursor: grab;
    user-select: none;
    touch-action: none;
    overflow: hidden;
    transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(var(--stack-scale)) translateY(var(--stack-y));
    transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease, box-shadow 0.25s ease;
    will-change: transform, opacity;
    animation: cardEntrance 0.45s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    animation-delay: calc(var(--stack-y) * 4ms);
  }

  @keyframes cardEntrance {
    from {
      opacity: 0;
      transform: translate(0, 24px) rotate(0deg) scale(calc(var(--stack-scale) * 0.9)) translateY(var(--stack-y));
    }
  }

  .swipe-card.dragging {
    cursor: grabbing;
    transition: none;
    box-shadow:
      0 24px 64px 0 color-mix(in srgb, var(--zone-clr) 22%, transparent),
      0 8px 32px 0 rgba(0, 0, 0, 0.3),
      0 1px 0 0 color-mix(in srgb, var(--zone-clr) 14%, transparent) inset;
    border-color: color-mix(in srgb, var(--zone-clr) 25%, transparent);
  }

  .swipe-card.exiting {
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
    opacity: 0;
    pointer-events: none;
  }

  .swipe-card.behind { pointer-events: none; }

  /* Priority gradient edge */
  .priority-stripe {
    height: 3px;
    background: linear-gradient(90deg, var(--priority-clr), color-mix(in srgb, var(--priority-clr) 30%, transparent));
    width: 100%;
  }

  /* Zone overlay */
  .zone-indicator {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--zone-clr) 8%, transparent);
    border: 2px solid color-mix(in srgb, var(--zone-clr) 35%, transparent);
    border-radius: 20px;
    pointer-events: none;
    z-index: 5;
    animation: zonePulse 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  @keyframes zonePulse {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
  }

  .zone-label {
    font-size: 20px;
    font-weight: 800;
    color: var(--zone-clr);
    text-shadow: 0 2px 8px color-mix(in srgb, var(--bg-base) 50%, transparent);
    letter-spacing: -0.3px;
    animation: zoneLabelBounce 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes zoneLabelBounce {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }

  /* Content */
  .card-content {
    padding: 28px 28px 16px;
    gap: 16px;
  }

  .sc-title {
    font-size: 22px;
    font-weight: 750;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.4px;
    line-height: 1.3;
    word-break: break-word;
  }

  .sc-desc {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.6;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    opacity: 0.85;
  }

  .sc-meta {
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .meta-pill {
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--bg-base) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--border-color) 30%, transparent);
    backdrop-filter: blur(4px);
    letter-spacing: 0.1px;
  }

  .meta-pill.due { color: var(--semantic-warning, #f59e0b); }

  .sc-tags {
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .sc-tag {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
  }

  /* Action buttons */
  .sc-btns {
    padding: 12px 28px 24px;
    gap: 16px;
    justify-content: center;
    align-items: center;
  }

  .sc-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1.5px solid var(--border-color);
    background: color-mix(in srgb, var(--bg-base) 70%, transparent);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    backdrop-filter: blur(4px);
  }

  .sc-btn:hover { transform: scale(1.12); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2); }
  .sc-btn:active { transform: scale(0.9); transition-duration: 0.08s; }

  .sc-btn.commit {
    border-color: transparent;
    color: white;
    width: 56px; height: 56px;
    background: linear-gradient(135deg, var(--semantic-success, #22c55e), color-mix(in srgb, var(--semantic-success, #22c55e) 70%, #059669));
    box-shadow: 0 6px 20px color-mix(in srgb, var(--semantic-success, #22c55e) 28%, transparent);
  }
  .sc-btn.commit:hover {
    transform: scale(1.12);
    box-shadow: 0 8px 28px color-mix(in srgb, var(--semantic-success, #22c55e) 38%, transparent);
  }

  .sc-btn.skip {
    border-color: color-mix(in srgb, var(--semantic-warning, #f59e0b) 40%, transparent);
    color: var(--semantic-warning, #f59e0b);
  }
  .sc-btn.skip:hover {
    background: color-mix(in srgb, var(--semantic-warning, #f59e0b) 12%, var(--bg-base));
    box-shadow: 0 4px 16px color-mix(in srgb, var(--semantic-warning, #f59e0b) 15%, transparent);
  }

  .sc-btn.prioritize {
    border-color: color-mix(in srgb, var(--semantic-error, #ef4444) 40%, transparent);
    color: var(--semantic-error, #ef4444);
  }
  .sc-btn.prioritize:hover {
    background: color-mix(in srgb, var(--semantic-error, #ef4444) 12%, var(--bg-base));
    box-shadow: 0 4px 16px color-mix(in srgb, var(--semantic-error, #ef4444) 15%, transparent);
  }

  .sc-btn.archive {
    border-color: color-mix(in srgb, var(--text-secondary) 30%, transparent);
  }
  .sc-btn.archive:hover {
    background: color-mix(in srgb, var(--text-secondary) 10%, var(--bg-base));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  @media (max-width: 767px) {
    .swipe-card { max-width: 100%; border-radius: 20px; }
    .card-content { padding: 24px 20px 12px; gap: 12px; }
    .sc-title { font-size: 20px; }
    .sc-btns { padding: 8px 20px 20px; gap: 12px; }
    .sc-btn { width: 44px; height: 44px; }
    .sc-btn.commit { width: 52px; height: 52px; }
    .zone-indicator { border-radius: 20px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .swipe-card { transition: none; animation: none; }
    .swipe-card.exiting { transition: opacity 0.15s ease; }
    .zone-indicator, .zone-label { animation: none; }
    .sc-btn { transition: none; }
  }
</style>
