import type { NoteFile } from '../storage/StorageAdapter';
import type { CalcTag } from '../storage/CalcTagSchema';
import { getRowNumbers, extractRowDate } from '../utils/exportMetricsXlsx';

export interface CalcBoxRow {
  id: string;
  label: string;
  total: number;
  tagIds: string[];
  checked: boolean;
  date?: string; // YYYY-MM-DD
}

export interface CalcBoxSnapshot {
  id: string;
  noteId: string; // note path
  noteName: string;
  boxTitle: string;
  income: number;
  incomeLabel?: string;
  currencyCode: string;
  rows: CalcBoxRow[];
  excludeChecked: boolean;
  tagBudgets?: Record<string, number>;
  stats: {
    net: number;
    expenses: number;
    inflows: number;
    savings: number;
    count: number;
  };
}

export interface TagBreakdown {
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

export interface BudgetDashboardData {
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  totalNet: number;
  tagBreakdown: Map<string, TagBreakdown>;
  untaggedBreakdown: {
    inflows: number;
    spent: number;
    net: number;
  };
  boxes: CalcBoxSnapshot[];
}

export class BudgetAggregator {
  static aggregate(notes: NoteFile[], calcTags: CalcTag[], defaultCurrency: string = '₹'): BudgetDashboardData {
    const snapshots: CalcBoxSnapshot[] = [];
    
    // Parse note content to extract calc boxes
    notes.forEach(note => {
      if (!note.content) return;
      if (typeof DOMParser === 'undefined') return;

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(note.content, 'text/html');
        const metricsBlocks = doc.querySelectorAll('div[data-type="metrics"]');

        metricsBlocks.forEach(block => {
          const title = block.getAttribute('data-title') || 'Metrics List';
          const income = parseFloat(block.getAttribute('data-income') || '0') || 0;
          const incomeLabel = block.getAttribute('data-income-label') || 'Income';
          const currencyCode = block.getAttribute('data-currency-code') || defaultCurrency || '₹';
          const excludeChecked = block.getAttribute('data-exclude-checked') === 'true';
          const metricsDataAttr = block.getAttribute('data-metrics');
          
          if (!metricsDataAttr) return;

          let rawRows: any[] = [];
          try {
            rawRows = JSON.parse(metricsDataAttr);
          } catch {
            return;
          }

          if (!Array.isArray(rawRows)) return;

          const rows: CalcBoxRow[] = [];
          let net = 0;
          let expenses = 0;
          let inflows = 0;
          let count = 0;

          rawRows.forEach(r => {
            const rowChecked = r.checked === true || r.checked === 'true';
            
            // Apply exclude checked rules
            const isCounted = !(excludeChecked && rowChecked);

            // Parse numbers from row label
            const numbers = getRowNumbers(r.label || '');
            const total = numbers.reduce((sum, n) => sum + n, 0);

            // Retrieve tag ids (supporting old single tagId format and new multi tagIds format)
            let tagIds: string[] = [];
            if (Array.isArray(r.tagIds)) {
              tagIds = r.tagIds;
            } else if (r.tagId) {
              tagIds = [r.tagId];
            }

            const rowDate = extractRowDate(r.label || '') || undefined;

            const row: CalcBoxRow = {
              id: r.id || String(Math.random()),
              label: r.label || '',
              total,
              tagIds,
              checked: rowChecked,
              date: rowDate
            };

            rows.push(row);

            if (isCounted && numbers.length > 0) {
              count++;
              net += total;
              if (total > 0) {
                inflows += total;
              } else {
                expenses += Math.abs(total);
              }
            }
          });

          const boxId = block.getAttribute('data-id') || block.getAttribute('id') || 'metrics_' + Math.random().toString(36).substring(2, 9);

          const tagBudgetsAttr = block.getAttribute('data-tag-budgets');
          let blockTagBudgets: Record<string, number> = {};
          if (tagBudgetsAttr) {
            try {
              const parsed = JSON.parse(tagBudgetsAttr);
              if (parsed && typeof parsed === 'object') {
                for (const key in parsed) {
                  const num = parseFloat(parsed[key]);
                  if (!isNaN(num)) {
                    blockTagBudgets[key] = num;
                  }
                }
              }
            } catch {}
          }

          snapshots.push({
            id: boxId,
            noteId: note.path,
            noteName: note.name,
            boxTitle: title,
            income,
            incomeLabel,
            currencyCode,
            excludeChecked,
            rows,
            tagBudgets: blockTagBudgets,
            stats: {
              net,
              expenses,
              inflows,
              savings: income + net,
              count
            }
          });
        });
      } catch (err) {
        console.error(`[BudgetAggregator] Failed to parse note content: ${note.path}`, err);
      }
    });

    // Compute aggregated dashboard data
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalNet = 0;

    const tagMap = new Map<string, TagBreakdown>();
    let untaggedInflows = 0;
    let untaggedSpent = 0;
    let untaggedNet = 0;

    // Initialize all enabled tags in the map with 0 budget
    calcTags.forEach(tag => {
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

    snapshots.forEach(snap => {
      totalIncome += snap.income;
      totalNet += snap.stats.net;
      totalExpenses += snap.stats.expenses;

      // Accumulate budget contribution from this snapshot/box
      calcTags.forEach(tag => {
        const budgetContribution = snap.tagBudgets?.[tag.id] || 0;

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
          entry.budget += budgetContribution;
          entry.hasBudget = entry.budget > 0;
        }
      });

      snap.rows.forEach(r => {
        const isCounted = !(snap.excludeChecked && r.checked);
        if (!isCounted) return;

        if (r.tagIds && r.tagIds.length > 0) {
          r.tagIds.forEach(tagId => {
            if (!tagMap.has(tagId)) {
              const budget = snap.tagBudgets?.[tagId] || 0;
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
    });

    // Finalize totals & budget progress per tag
    tagMap.forEach(entry => {
      entry.remaining = entry.budget - entry.spent;
      entry.percentUsed = entry.budget > 0 ? (entry.spent / entry.budget) * 100 : 0;
      entry.isOverBudget = entry.budget > 0 && entry.remaining < 0;
    });

    return {
      totalIncome,
      totalExpenses,
      totalSavings: totalIncome + totalNet,
      totalNet,
      tagBreakdown: tagMap,
      untaggedBreakdown: {
        inflows: untaggedInflows,
        spent: untaggedSpent,
        net: untaggedNet
      },
      boxes: snapshots
    };
  }
}
