// ── Task Data Types & Helpers ──────────────────────────────────────────────

export interface TaskData {
  /** Unique key: `notePath:linePos` */
  id: string;
  /** The task text content */
  text: string;
  /** Whether the checkbox is checked */
  completed: boolean;
  /** ISO date string YYYY-MM-DD or null */
  dueDate: string | null;
  /** Priority level */
  priority: 'low' | 'medium' | 'high' | null;
  /** Flagged / starred */
  flagged: boolean;
  /** Reminder ISO datetime string or null */
  reminder: string | null;
  /** Title of the note containing this task */
  noteTitle: string;
  /** Path of the note containing this task */
  notePath: string;
  /** Position index within the note (for navigation) */
  position: number;
}

// ── Date Helpers ───────────────────────────────────────────────────────────

/** Get today's date as YYYY-MM-DD in local timezone */
export function todayStr(): string {
  return new Date().toLocaleDateString('en-CA'); // en-CA gives ISO-style
}

/** Get tomorrow's date as YYYY-MM-DD */
export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

/** Format a YYYY-MM-DD date for display: "Today", "Tomorrow", "Jun 15", "Dec 3, 2025" */
export function formatDueDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const today = todayStr();
  const tomorrow = tomorrowStr();
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, opts);
}

/** Check if a due date is overdue (before today) */
export function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr < todayStr();
}

/** Check if a due date is today */
export function isDueToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr === todayStr();
}

/** Get relative reminder label */
export function formatReminder(isoStr: string | null): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return 'Past';
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `In ${diffMin}m`;
  const diffHrs = Math.round(diffMin / 60);
  if (diffHrs < 24) return `In ${diffHrs}h`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Priority Helpers ───────────────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function priorityRank(p: string | null): number {
  return p ? (PRIORITY_RANK[p] ?? 3) : 3;
}

export function priorityLabel(p: string | null): string {
  if (!p) return '';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function priorityColor(p: string | null): string {
  switch (p) {
    case 'high': return '#ef4444';
    case 'medium': return '#f59e0b';
    case 'low': return '#3b82f6';
    default: return 'transparent';
  }
}

export function dueDateColor(dateStr: string | null): string {
  if (!dateStr) return 'var(--text-muted, #888)';
  if (isOverdue(dateStr)) return '#ef4444';
  if (isDueToday(dateStr)) return '#f59e0b';
  return 'var(--text-muted, #888)';
}

// ── Task Extraction from HTML ──────────────────────────────────────────────

/**
 * Extract all tasks from an HTML note body.
 * Tasks are TipTap task-items rendered as:
 * <li data-type="taskItem" data-checked="true|false" data-due-date="..." ...>
 *   <label><input type="checkbox" ...></label>
 *   <div>Task text</div>
 * </li>
 */
export function extractTasksFromHtml(
  html: string,
  noteTitle: string,
  notePath: string
): TaskData[] {
  if (typeof DOMParser === 'undefined') return [];
  const tasks: TaskData[] = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('[data-type="taskItem"]');
    items.forEach((el, idx) => {
      const checked = el.getAttribute('data-checked') === 'true';
      const dueDate = el.getAttribute('data-due-date') || null;
      const priority = el.getAttribute('data-priority') as TaskData['priority'] || null;
      const flagged = el.getAttribute('data-flagged') === 'true';
      const reminder = el.getAttribute('data-reminder') || null;

      // Get task text — exclude nested task lists
      let text = '';
      const contentDiv = el.querySelector(':scope > div, :scope > p');
      if (contentDiv) {
        text = contentDiv.textContent?.trim() || '';
      } else {
        // Fallback: get direct text content (skip nested ul)
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('ul, label, input').forEach(n => n.remove());
        text = clone.textContent?.trim() || '';
      }

      tasks.push({
        id: `${notePath}:${idx}`,
        text: text || 'Untitled task',
        completed: checked,
        dueDate,
        priority,
        flagged,
        reminder,
        noteTitle,
        notePath,
        position: idx,
      });
    });
  } catch (e) {
    console.error('Failed to extract tasks:', e);
  }
  return tasks;
}

// ── Task Grouping ──────────────────────────────────────────────────────────

export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'nodate';

export function getTaskGroup(task: TaskData): TaskGroup {
  if (!task.dueDate) return 'nodate';
  if (isOverdue(task.dueDate)) return 'overdue';
  if (isDueToday(task.dueDate)) return 'today';
  return 'upcoming';
}

export const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: '🔴 Overdue',
  today: '🟡 Today',
  upcoming: '📅 Upcoming',
  nodate: '📋 No Date',
};

export const GROUP_ORDER: TaskGroup[] = ['overdue', 'today', 'upcoming', 'nodate'];
