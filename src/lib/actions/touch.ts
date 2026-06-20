/**
 * Touch Interaction Standards (UI-M-007)
 *
 * A single source of truth for touch behaviour across the app so that
 * long-press and tap interactions feel identical everywhere.
 *
 * - `LONG_PRESS_MS`        — how long a press must be held to count as a long-press
 * - `TOUCH_MOVE_TOLERANCE` — how far a finger may drift before the press is cancelled
 * - `longpress`            — a Svelte action that emits a `longpress` CustomEvent and
 *                            suppresses the synthetic click that follows, so it can be
 *                            combined safely with a normal `onclick` (tap) handler.
 *
 * Usage:
 *   <div use:longpress onlongpress={() => enterSelectMode()} onclick={open}>…</div>
 *   <div use:longpress={{ duration: 400 }} onlongpress={…}>…</div>
 */

export const LONG_PRESS_MS = 600;
export const TOUCH_MOVE_TOLERANCE = 10;

export interface LongpressOptions {
  /** Hold duration in ms before firing. Defaults to {@link LONG_PRESS_MS}. */
  duration?: number;
  /** Movement (px) that cancels the press. Defaults to {@link TOUCH_MOVE_TOLERANCE}. */
  moveTolerance?: number;
}

export function longpress(node: HTMLElement, options: LongpressOptions = {}) {
  let opts: Required<LongpressOptions> = {
    duration: options.duration ?? LONG_PRESS_MS,
    moveTolerance: options.moveTolerance ?? TOUCH_MOVE_TOLERANCE,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function suppressClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      // Swallow the click that the browser fires after this touch sequence so a
      // long-press never doubles as a tap.
      node.addEventListener('click', suppressClick, { capture: true, once: true });
      setTimeout(
        () => node.removeEventListener('click', suppressClick, { capture: true } as any),
        500
      );
      node.dispatchEvent(new CustomEvent('longpress', { detail: { x: startX, y: startY } }));
      if (navigator.vibrate) {
        try { navigator.vibrate(10); } catch { /* ignore */ }
      }
    }, opts.duration);
  }

  function onMove(e: TouchEvent) {
    if (!timer || e.touches.length === 0) return;
    const t = e.touches[0];
    if (
      Math.abs(t.clientX - startX) > opts.moveTolerance ||
      Math.abs(t.clientY - startY) > opts.moveTolerance
    ) {
      clearTimer();
    }
  }

  node.addEventListener('touchstart', onStart, { passive: true });
  node.addEventListener('touchmove', onMove, { passive: true });
  node.addEventListener('touchend', clearTimer);
  node.addEventListener('touchcancel', clearTimer);

  return {
    update(newOptions: LongpressOptions = {}) {
      opts = {
        duration: newOptions.duration ?? LONG_PRESS_MS,
        moveTolerance: newOptions.moveTolerance ?? TOUCH_MOVE_TOLERANCE,
      };
    },
    destroy() {
      clearTimer();
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', clearTimer);
      node.removeEventListener('touchcancel', clearTimer);
    },
  };
}

/* ───────────────────────── Swipe actions (UI-M-008) ───────────────────────── */

export interface SwipeActionsOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Distance (px) the row must travel to trigger an action. Default 80. */
  threshold?: number;
  /** Return false to disable swiping (e.g. while in selection mode). */
  enabled?: () => boolean;
}

/**
 * Makes a list row horizontally swipeable. The node follows the finger during a
 * horizontal drag and, when released past the threshold, fires the matching
 * action. Vertical drags are ignored so the list still scrolls normally.
 */
export function swipeActions(node: HTMLElement, options: SwipeActionsOptions) {
  let opts = options;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let tracking = false;
  let decided = false;
  let horizontal = false;

  function reset(animate: boolean) {
    if (animate) {
      node.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      node.style.transform = 'translateX(0)';
      window.setTimeout(() => {
        node.style.transition = '';
        node.style.transform = '';
      }, 220);
    } else {
      node.style.transition = '';
      node.style.transform = '';
    }
  }

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    if (opts.enabled && !opts.enabled()) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0; dy = 0;
    tracking = true;
    decided = false;
    horizontal = false;
  }

  function onMove(e: TouchEvent) {
    if (!tracking) return;
    dx = e.touches[0].clientX - startX;
    dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        decided = true;
        horizontal = Math.abs(dx) > Math.abs(dy);
      } else {
        return;
      }
    }
    if (horizontal) {
      node.style.transition = 'none';
      node.style.transform = `translateX(${dx}px)`;
    }
  }

  function onEnd() {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) {
      reset(false);
      return;
    }
    const threshold = opts.threshold ?? 80;
    if (dx <= -threshold) {
      opts.onSwipeLeft?.();
    } else if (dx >= threshold) {
      opts.onSwipeRight?.();
    }
    reset(true);
  }

  node.addEventListener('touchstart', onStart, { passive: true });
  node.addEventListener('touchmove', onMove, { passive: true });
  node.addEventListener('touchend', onEnd);
  node.addEventListener('touchcancel', onEnd);

  return {
    update(newOptions: SwipeActionsOptions) {
      opts = newOptions;
    },
    destroy() {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    },
  };
}

/* ─────────────────────── Edge swipe-back (UI-M-008) ─────────────────────── */

export interface EdgeSwipeOptions {
  onBack: () => void;
  /** How close to the left edge the gesture must start (px). Default 24. */
  edgeWidth?: number;
  /** Horizontal distance (px) needed to trigger back. Default 70. */
  threshold?: number;
}

/**
 * Recognises an iOS/Android-style "swipe in from the left edge to go back"
 * gesture and invokes `onBack` once per gesture.
 */
export function edgeSwipeBack(node: HTMLElement, options: EdgeSwipeOptions) {
  let opts = options;
  let startX = 0;
  let startY = 0;
  let active = false;

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1) { active = false; return; }
    const t = e.touches[0];
    const edge = opts.edgeWidth ?? 24;
    if (t.clientX <= edge) {
      startX = t.clientX;
      startY = t.clientY;
      active = true;
    } else {
      active = false;
    }
  }

  function onMove(e: TouchEvent) {
    if (!active) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dy) > 45) { active = false; return; }
    if (dx > (opts.threshold ?? 70)) {
      active = false;
      opts.onBack();
    }
  }

  function onEnd() {
    active = false;
  }

  node.addEventListener('touchstart', onStart, { passive: true });
  node.addEventListener('touchmove', onMove, { passive: true });
  node.addEventListener('touchend', onEnd);
  node.addEventListener('touchcancel', onEnd);

  return {
    update(newOptions: EdgeSwipeOptions) {
      opts = newOptions;
    },
    destroy() {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    },
  };
}

