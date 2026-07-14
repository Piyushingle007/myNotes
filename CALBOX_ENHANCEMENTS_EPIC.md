# Epic: Calculation Box Enhancements — Tag Filtering, Per-Tag Totals & Dedicated Budget View

> Product & Engineering Specification — myNotes
> Status: **Draft**
> Author: Copilot (AI Architect) & Piyush (Staff Engineer)
> Last updated: 2026-07-10

---

## 1. Epic Overview

### 1.1 Current State (as built today)

| Area | Today |
| --- | --- |
| Block type | A `metrics` atom node embedded in a note via Tiptap; UI in `MetricsBlock.svelte`. |
| Rows | `{ id: string; checked: boolean; label: string; tagIds?: string[] }`. Numbers are parsed inline from `label`. |
| Calc Tags | Standalone global `calc_tags` store in IndexedDB (completely separate from note tags). Users can assign one or more tags per row. |
| Tag Totals | Per-box reactive aggregation via `tagTotals` ($derived map of `tagId -> total`). Rendered as "Category Breakdown" chips when tags are selected in `visibleTagTotals`. |
| Stats Footer | Displays count, income, inflows, expenses, net, average, min, max, median. |
| Savings Hero | `Savings = Income + Net Total`, color-coded green/red. |
| Mobile Navigation | Bottom tab bar with: Home, Tags, Library, Daily, Focus. No dedicated budget/calc tab. |
| Desktop Layout | Sidebar + note list + editor. No dedicated budget overview page. |
| Filtering | `excludeChecked` toggle excludes checked rows. **No tag-based filtering exists.** |

### 1.2 Vision

Extend the Calculation Box with three major enhancements:

1. **Tag-based filtering** — Let users filter rows by one or more tags to focus on specific spending categories.
2. **Dedicated per-tag totals with +/- breakdown** — Show income (positive) and expense (negative) amounts per tag, making category-level budgets visible at a glance.
3. **A dedicated Budget View** — A new mobile tab and desktop page optimized for the Calculation Box experience, providing an aggregated dashboard of all calc boxes across notes.

### 1.3 Out of Scope (this epic)

- Cross-note budget reporting with date-range queries (future dashboard).
- Multi-currency / FX conversion.
- Bank/import integrations.
- Changes to the note-tag system (completely isolated).
- Recurring transactions or forecasting.

---

## 2. Product Goals

| # | Goal | Success signal |
| --- | --- | --- |
| G1 | Users can filter calc box rows by tag(s). | Selecting a tag in the filter shows only matching rows; stats update accordingly. |
| G2 | Per-tag totals show + and − amounts. | Each tag chip displays positive inflows and negative expenses separately. |
| G3 | A dedicated budget view exists for focused financial management. | Mobile has a "Budget" tab; desktop has a budget page accessible from the sidebar/header. |
| G4 | The budget view aggregates data across all calc boxes in all notes. | Users see total spending per tag across their entire vault. |
| G5 | Clean, non-cluttered UX. | Filtering is discoverable but not intrusive; budget view is optional. |

---

## 3. Feature 1: Tag-Based Filtering in Calculation Box

### 3.1 User Story

> **As a** user with categorized expenses,
> **I want to** filter my calculation box rows by one or more tags,
> **So that** I can see only the rows relevant to a specific category (e.g., "Food" or "Travel") and get updated totals for just that subset.

### 3.2 Functional Requirements

| ID | Requirement |
| --- | --- |
| F1-01 | A filter control (chip bar or dropdown) appears above/below the row list when the box has at least one calc tag assigned to any row. |
| F1-02 | Users can select one or more tags to filter by. Multi-select is supported. |
| F1-03 | When filters are active, only rows matching **any** of the selected tags are displayed (OR logic). |
| F1-04 | An "Untagged" filter option shows rows with no tag assigned. |
| F1-05 | A "Clear All" / "Show All" action removes all active filters. |
| F1-06 | When filters are active, all computed stats (count, sum, net, average, min, max, median, savings) update to reflect **only the visible (filtered) rows**. |
| F1-07 | The filter state is **ephemeral** (not persisted to the node) — it resets on note close/reopen. |
| F1-08 | The filter bar respects `excludeChecked` — checked rows are excluded first, then tag filter is applied. |
| F1-09 | The filter UI is hidden when no tags exist in the calc tag catalog or no rows have tags assigned. |

### 3.3 UI Design Specification

#### Desktop (inline within MetricsBlock)

```
┌─────────────────────────────────────────────────┐
│  📊 Calculation Box Title              ⚙️ 📤    │
├─────────────────────────────────────────────────┤
│  Income: ₹50,000                                │
├─────────────────────────────────────────────────┤
│  🔍 Filter: [All] [Food ✕] [Travel ✕] [+ More] │   ← NEW: Filter chip bar
├─────────────────────────────────────────────────┤
│  ☐ Groceries -2500         🏷️ Food    03/07/26  │
│  ☐ Zomato -800             🏷️ Food    04/07/26  │
│  ☐ Train tickets -1200     🏷️ Travel  05/07/26  │  ← hidden if Travel not selected
│  + Add Row                                      │
├─────────────────────────────────────────────────┤
│  Category Breakdown                             │
│  [🟢 Food: -3,300] [🔵 Travel: -1,200]         │
├─────────────────────────────────────────────────┤
│  Count: 2 | Net: -₹3,300 | Savings: ₹46,700   │
│  (filtered — showing 2 of 5 rows)              │  ← NEW: filter indicator
└─────────────────────────────────────────────────┘
```

#### Mobile (bottom-sheet style)

- Tapping a "Filter" icon button (funnel icon) in the block header opens a bottom sheet with tag checkboxes.
- Active filters shown as compact pills below the header.
- "Clear" button prominently available.

### 3.4 Technical Design

#### New State Variables (MetricsBlock.svelte)

```typescript
// Ephemeral filter state (not persisted)
let activeTagFilters = $state<string[]>([]); // tag IDs currently selected for filtering
let showFilterBar = $state(false); // whether filter UI is expanded

// Derived: rows after both excludeChecked and tag filter are applied
let filteredRows = $derived.by(() => {
  let result = rows.filter(r => {
    if (excludeChecked && r.checked) return false;
    return true;
  });
  
  if (activeTagFilters.length > 0) {
    result = result.filter(r => {
      const ids = getRowTagIds(r);
      if (activeTagFilters.includes('__untagged__') && ids.length === 0) return true;
      return ids.some(id => activeTagFilters.includes(id));
    });
  }
  
  return result;
});
```

#### Impact on existing `$derived` computations

- `activeRows` → rename to `baseRows` (excludeChecked only)
- New `filteredRows` used for rendering the row list
- `parsedValues`, `stats`, `tagTotals` → compute from `filteredRows` when filters are active
- Add a `isFiltered` derived boolean for UI indicator

#### Component Changes

| File | Change |
| --- | --- |
| `MetricsBlock.svelte` | Add filter chip bar UI, ephemeral state, update derived chain |
| (No other files) | Filter is entirely local to the block |

### 3.5 Acceptance Criteria

- [ ] Filter bar appears when ≥1 row has a tag assigned.
- [ ] Selecting a tag filter hides non-matching rows.
- [ ] Stats footer updates to filtered subset.
- [ ] "Showing X of Y rows" indicator visible when filter active.
- [ ] Filter resets on note close/reopen.
- [ ] Works correctly with `excludeChecked`.
- [ ] Mobile: filter accessible via bottom sheet.
- [ ] No performance regression with 100+ rows.

---

## 4. Feature 2: Per-Tag Budget with +Remaining / -Spent Display

### 4.1 User Story

> **As a** user who budgets by category,
> **I want to** set a dedicated budget amount per tag and see how much I've spent vs. how much remains,
> **So that** I can immediately see `+remaining / -spent` for each category and know if I'm over budget.

### 4.2 Core Concept

Each calc tag gets a **user-defined budget** (e.g., Food = ₹2,000). The display then shows:

```
Tag Budget: ₹2,000 | Spent: ₹1,000
Display:  +1,000 / -1,000
          (remaining)  (spent)
```

- **Remaining** = Budget − |Spent| (positive means under budget)
- **Spent** = absolute sum of all negative row values tagged with this tag
- If spent exceeds budget, remaining goes negative (overspent): `-500 / -2,500`

### 4.3 Functional Requirements

| ID | Requirement |
| --- | --- |
| F2-01 | Each calc tag in the global `calc_tags` store gets a new optional `budget` field (number, default `0` = no budget set). |
| F2-02 | Users set per-tag budgets in the Settings → Calculation → Tag Catalog (inline editable field next to each tag). |
| F2-03 | The "Category Breakdown" section in each calc box shows each visible tag as: `+remaining / -spent`. |
| F2-04 | If no budget is set for a tag (budget = 0), show only the spent total: `-₹3,300 spent`. |
| F2-05 | If remaining is negative (overspent), highlight in red/warning: `-₹500 / -₹2,500 ⚠️ Over budget!`. |
| F2-06 | If remaining is positive, highlight in green: `+₹1,000 / -₹1,000`. |
| F2-07 | An optional progress bar/gauge per tag shows % spent visually (filled portion = spent/budget). |
| F2-08 | The budget view (Feature 3) aggregates per-tag budgets globally across all boxes. |
| F2-09 | Tags without any rows in the current box are hidden from the per-box breakdown (but visible in budget view if they have a budget set). |
| F2-10 | The "Untagged" bucket shows total spent only (no budget concept for untagged). |

### 4.4 UI Design Specification

#### Category Breakdown (within a Calculation Box)

```
Category Breakdown
┌──────────────────────────────────────────────────────────┐
│ 🔴 Food          Budget: ₹2,000                         │
│    +₹1,000 remaining / -₹1,000 spent                    │
│    [████████░░░░░░░░] 50%                                │
├──────────────────────────────────────────────────────────┤
│ 🔵 Travel        Budget: ₹5,000                         │
│    +₹500 remaining / -₹4,500 spent                      │
│    [█████████████░░░] 90%                                │
├──────────────────────────────────────────────────────────┤
│ 🟢 Rent          Budget: ₹15,000                        │
│    ₹0 remaining / -₹15,000 spent                        │
│    [████████████████] 100% — Fully spent                 │
├──────────────────────────────────────────────────────────┤
│ 🟣 Shopping      Budget: ₹3,000                         │
│    -₹500 remaining / -₹3,500 spent  ⚠️ Over budget!     │
│    [████████████████▓▓] 117% — Over by ₹500             │
├──────────────────────────────────────────────────────────┤
│ ⚪ Untagged      (no budget)                            │
│    -₹1,200 spent                                         │
└──────────────────────────────────────────────────────────┘
```

#### Tag Budget Setting (Settings → Calculation → Tag Catalog)

```
Tag Catalog
┌───────────────────────────────────────────────────────────┐
│  Tag Name    │  Color  │  Budget      │  Enabled │ Action │
├──────────────┼─────────┼──────────────┼──────────┼────────┤
│  Food        │  🔴     │  [₹ 2,000 ] │    ✓     │  🗑️   │
│  Travel      │  🔵     │  [₹ 5,000 ] │    ✓     │  🗑️   │
│  Rent        │  🟢     │  [₹ 15,000] │    ✓     │  🗑️   │
│  Shopping    │  🟣     │  [₹ 3,000 ] │    ✓     │  🗑️   │
└───────────────────────────────────────────────────────────┘
```

### 4.5 Technical Design

#### Schema Change — CalcTag

```typescript
// Updated CalcTag interface (in CalcTagStore / appState)
interface CalcTag {
  id: string;
  name: string;
  normalizedName: string;
  color?: string;
  enabled: boolean;
  budget: number;      // NEW — default 0 (no budget set)
  createdAt: number;
}
```

#### Enhanced `tagTotals` Derivation

```typescript
interface TagBudgetBreakdown {
  tagId: string;
  budget: number;        // user-defined budget for this tag
  spent: number;         // absolute sum of negative row values (always positive number)
  remaining: number;     // budget - spent (negative = overspent)
  percentUsed: number;   // (spent / budget) * 100, capped display at 150%
  isOverBudget: boolean;
  hasBudget: boolean;    // budget > 0
}

let tagBudgetTotals = $derived.by(() => {
  const map = new Map<string, TagBudgetBreakdown>();
  let untaggedSpent = 0;

  filteredRows.forEach(r => {
    const numbers = getRowNumbers(r.label);
    if (numbers.length === 0) return;
    const total = numbers.reduce((sum, n) => sum + n, 0);
    
    // Only negative values count as "spent"
    if (total >= 0) return;
    const spentAmount = Math.abs(total);

    const ids = getRowTagIds(r);
    if (ids.length > 0) {
      ids.forEach(tagId => {
        const tag = appState.calcTags.find(t => t.id === tagId);
        if (!map.has(tagId)) {
          const budget = tag?.budget || 0;
          map.set(tagId, {
            tagId,
            budget,
            spent: 0,
            remaining: budget,
            percentUsed: 0,
            isOverBudget: false,
            hasBudget: budget > 0,
          });
        }
        const entry = map.get(tagId)!;
        entry.spent += spentAmount;
        entry.remaining = entry.budget - entry.spent;
        entry.percentUsed = entry.budget > 0 ? (entry.spent / entry.budget) * 100 : 0;
        entry.isOverBudget = entry.remaining < 0;
      });
    } else {
      untaggedSpent += spentAmount;
    }
  });

  return { map, untaggedSpent };
});
```

#### IndexedDB Migration

- Add `budget` field to `calc_tags` store (default `0`).
- DB version increment with upgrade handler that sets `budget = 0` on existing tags.

#### UI Component Changes

| File | Change |
| --- | --- |
| `MetricsBlock.svelte` | Replace current Category Breakdown chips with budget-aware cards showing `+remaining / -spent` and optional progress bar. |
| `SettingsModal.svelte` / `MobileSettings.svelte` | Add budget input field in Tag Catalog editor row. |
| `appState.svelte.ts` | Update `CalcTag` interface, update CRUD methods. |
| `CalcTagSchema.ts` (or equivalent) | Add `budget` to schema, migration logic. |

### 4.6 Acceptance Criteria

- [ ] Each calc tag has a user-editable `budget` field in Settings.
- [ ] Category Breakdown shows `+remaining / -spent` when budget > 0.
- [ ] When budget = 0, only shows `-spent` (no remaining).
- [ ] Overspent state is visually highlighted (red, warning icon).
- [ ] Progress bar shows % of budget used.
- [ ] Over-budget shows bar exceeding 100% (capped visually at ~120%).
- [ ] Untagged bucket shows total spent only (no budget).
- [ ] Respects active tag filters from Feature 1.
- [ ] Respects `excludeChecked` toggle.
- [ ] Budget field persists in IndexedDB, syncs with Google Drive.
- [ ] Existing tags without budget default gracefully to 0 (no regression).

---


## 5. Feature 3: Dedicated Budget View (Mobile Tab + Desktop Page)

### 5.1 User Story

> **As a** user who tracks budgets across multiple notes,
> **I want** a dedicated view/page optimized for my calculation boxes,
> **So that** I can see an aggregated financial overview without navigating into individual notes.

### 5.2 Functional Requirements

| ID | Requirement |
| --- | --- |
| F3-01 | **Mobile**: A new "Budget" tab in the bottom navigation bar (6th tab, icon: `Wallet` or `PiggyBank`). |
| F3-02 | **Desktop**: A new page/panel accessible from the sidebar or header, similar to how "Focus" view works. |
| F3-03 | The view aggregates data from **all** calculation boxes across all notes in the vault. |
| F3-04 | Shows a global dashboard: total income (sum of all box incomes), total expenses, total savings. |
| F3-05 | Shows per-tag aggregated totals across all boxes (with +/− breakdown from Feature 2). |
| F3-06 | Lists individual calc boxes as collapsible cards, showing their note name, box title, and key stats. |
| F3-07 | Tapping/clicking a box card navigates to that note (opens the editor at that block). |
| F3-08 | Tag-based filtering (Feature 1) is available at the global level in the budget view. |
| F3-09 | Supports quick "add expense" action — select a note's calc box and append a row. |
| F3-10 | Mobile-optimized: swipeable sections, pull-to-refresh, bottom sheet for quick-add. |
| F3-11 | Desktop-optimized: multi-column layout, pinnable tags, sortable columns. |

### 5.3 UI Design Specification

#### Mobile — Budget Tab

```
┌────────────────────────────────────────────────┐
│  💰 Budget Overview           [⚙️] [+ Quick Add]│
├────────────────────────────────────────────────┤
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │        Total Savings: ₹32,500            │  │
│  │    ┌─────────┐   ┌──────────────┐       │  │
│  │    │ Income  │   │   Expenses   │       │  │
│  │    │ ₹80,000 │   │   -₹47,500   │       │  │
│  │    └─────────┘   └──────────────┘       │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Category Totals                               │
│  ┌──────────────────────────────────────────┐  │
│  │ 🔴 Food        -₹12,300                 │  │
│  │ 🔵 Travel      -₹8,200                  │  │
│  │ 🟢 Rent        -₹15,000                 │  │
│  │ 🟣 Freelance   +₹15,000 / -₹2,000      │  │
│  │ ⚪ Untagged    -₹10,000                 │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  🔍 Filter by tag: [All] [Food] [Travel] ...  │
│                                                │
│  Your Calc Boxes                               │
│  ┌──────────────────────────────────────────┐  │
│  │ 📝 July Budget (in "Monthly Expenses")  │  │
│  │    Income: ₹50,000 | Net: -₹32,000     │  │
│  │    Savings: ₹18,000                     │  │
│  ├──────────────────────────────────────────┤  │
│  │ 📝 Travel Fund (in "Vacation Plans")    │  │
│  │    Income: ₹30,000 | Net: -₹15,500     │  │
│  │    Savings: ₹14,500                     │  │
│  └──────────────────────────────────────────┘  │
│                                                │
├────────────────────────────────────────────────┤
│  [Home] [Tags] [Library] [Daily] [Budget] [Focus]│
└────────────────────────────────────────────────┘
```

#### Desktop — Budget Page (Two-Column Layout)

```
┌──────────┬─────────────────────────────────────────────────────────────┐
│ Sidebar  │  💰 Budget Dashboard                                        │
│          │  ┌───────────────────────────────────────────────────────┐  │
│  Home    │  │  Summary Cards (Horizontal)                           │  │
│  Focus   │  │  [Income ₹80K] [Expenses -₹47.5K] [Savings ₹32.5K]  │  │
│  Budget ←│  └───────────────────────────────────────────────────────┘  │
│  Library │                                                             │
│  Daily   │  ┌─────────────────────────┬────────────────────────────┐  │
│  Tags    │  │ Category Breakdown       │  Quick Actions             │  │
│          │  │                          │                            │  │
│          │  │ 🔴 Food       -₹12,300  │  [+ Add Expense]           │  │
│          │  │   +₹0 / -₹12,300       │  [📊 Export Report]        │  │
│          │  │                          │                            │  │
│          │  │ 🔵 Travel     -₹8,200   │  Filter by Tag:            │  │
│          │  │   +₹0 / -₹8,200        │  ☑ Food  ☑ Travel          │  │
│          │  │                          │  ☐ Rent  ☑ Freelance       │  │
│          │  │ 🟣 Freelance  +₹13,000  │                            │  │
│          │  │   +₹15K / -₹2K         │                            │  │
│          │  └─────────────────────────┴────────────────────────────┘  │
│          │                                                             │
│          │  ┌───────────────────────────────────────────────────────┐  │
│          │  │ Calculation Boxes                                      │  │
│          │  │                                                        │  │
│          │  │ ┌──────────────────────┐ ┌──────────────────────────┐ │  │
│          │  │ │ July Budget          │ │ Travel Fund               │ │  │
│          │  │ │ Note: Monthly Exp.   │ │ Note: Vacation Plans      │ │  │
│          │  │ │ Income: ₹50K         │ │ Income: ₹30K              │ │  │
│          │  │ │ Expenses: -₹32K      │ │ Expenses: -₹15.5K        │ │  │
│          │  │ │ Savings: ₹18K        │ │ Savings: ₹14.5K          │ │  │
│          │  │ │ [Open Note →]        │ │ [Open Note →]             │ │  │
│          │  │ └──────────────────────┘ └──────────────────────────┘ │  │
│          │  └───────────────────────────────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────┘
```

### 5.4 Additional UX Ideas for the Budget View

| Idea | Description | Priority |
| --- | --- | --- |
| **Monthly Trend** | A simple sparkline or bar chart showing total expenses per month (derived from row dates). | P2 (future) |
| **Pin Tags** | Users can "pin" tags to always show at the top of the category breakdown. | P1 |
| **Budget Goals** | Set a spending limit per tag (e.g., Food ≤ ₹15,000/month) and show progress bars. | P2 (future) |
| **Quick Add Expense** | Bottom sheet / floating action button to quickly add a row to any calc box. Pick box → enter amount + tag → save. | P1 |
| **Search Rows** | Search across all calc box rows globally (useful for finding specific transactions). | P1 |
| **Sort by Amount** | Sort category breakdown by highest spend, alphabetical, or custom order. | P1 |
| **Time Period Selector** | Filter the view by date range (this week / this month / custom) using dates parsed from row labels. | P2 (future) |
| **Donut Chart** | Visual pie/donut chart of expenses by category. Tap a slice to filter. | P2 (future) |
| **Export** | Export the aggregated budget data as CSV/XLSX from the budget view. | P1 |

### 5.5 Technical Design

#### Data Aggregation Layer

A new utility/service that scans all notes to extract calc box data:

```typescript
// src/lib/services/BudgetAggregator.ts

interface CalcBoxSnapshot {
  noteId: string;
  noteName: string;
  boxTitle: string;      // from the metrics node's title/first row
  income: number;
  rows: Array<{
    id: string;
    label: string;
    total: number;
    tagIds: string[];
    checked: boolean;
    date?: string;       // parsed date from label
  }>;
  stats: {
    net: number;
    expenses: number;
    inflows: number;
    savings: number;
  };
}

interface BudgetDashboardData {
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  totalNet: number;
  tagBreakdown: Map<string, TagBreakdown>;  // reuses interface from Feature 2
  untaggedBreakdown: TagBreakdown;
  boxes: CalcBoxSnapshot[];
}

class BudgetAggregator {
  // Scans all notes in the vault for metrics blocks
  // Parses their HTML content to extract calc box data
  // Returns aggregated dashboard data
  async aggregate(notes: NoteRecord[]): Promise<BudgetDashboardData>;
}
```

#### New Components

| File | Purpose |
| --- | --- |
| `src/lib/components/BudgetView.svelte` | Main budget dashboard component (shared mobile/desktop) |
| `src/lib/components/BudgetSummaryCards.svelte` | The income/expenses/savings hero cards |
| `src/lib/components/BudgetCategoryList.svelte` | Per-tag breakdown list with +/- |
| `src/lib/components/BudgetBoxCard.svelte` | Individual calc box summary card |
| `src/lib/components/BudgetQuickAdd.svelte` | Quick-add expense bottom sheet/modal |
| `src/lib/services/BudgetAggregator.ts` | Data aggregation service |

#### Navigation Changes

| File | Change |
| --- | --- |
| `MobileTabBar.svelte` | Add "Budget" tab (icon: `Wallet` from lucide-svelte) |
| `mobileNav.svelte.ts` | Add `'budget'` to `MobileTab` type, handle navigation |
| `AppLayout.svelte` | Add `budget` tab rendering in mobile view |
| `appState.svelte.ts` | Add `'budget'` to `activeTab` type |
| `Sidebar.svelte` | Add "Budget" nav item for desktop |
| `AppHeader.svelte` | Add "Budget" header nav button for desktop |
| `App.svelte` | Add hash routing for `#budget` |

#### Persistence

- Budget view itself has no new persistence needs — it reads from existing note content.
- "Pinned tags" for the budget view: stored in `localStorage` under `mynotes_budget_pinned_tags`.
- Quick-add recent selections: stored in `localStorage` under `mynotes_budget_quick_add_recent`.

### 5.6 Acceptance Criteria

- [ ] Mobile: "Budget" tab visible in bottom nav, navigates to budget view.
- [ ] Desktop: "Budget" accessible from sidebar/header, renders full-page view.
- [ ] Dashboard shows aggregated income, expenses, savings across all calc boxes.
- [ ] Per-tag breakdown shows all tags with +/- amounts.
- [ ] Individual calc box cards are listed, clickable to open the note.
- [ ] Tag filtering works at the global level (filters all boxes' contributions).
- [ ] Quick-add expense flow works end-to-end.
- [ ] Responsive: mobile is single-column, desktop is multi-column.
- [ ] Performance: aggregation completes in <500ms for 50 notes with calc boxes.
- [ ] Pull-to-refresh on mobile re-aggregates data.

---

## 6. Story Decomposition

### Phase 1: Tag Filtering (In-Box)

| Story ID | Title | Complexity | Dependencies |
| --- | --- | --- | --- |
| CB-F01 | Add ephemeral tag filter state to MetricsBlock | S | None |
| CB-F02 | Implement filter chip bar UI (desktop) | M | CB-F01 |
| CB-F03 | Implement filter bottom-sheet UI (mobile) | M | CB-F01 |
| CB-F04 | Update derived stats/totals to respect active filters | M | CB-F01 |
| CB-F05 | Add "Showing X of Y" filter indicator | S | CB-F04 |

### Phase 2: Per-Tag Budget (+Remaining / -Spent)

| Story ID | Title | Complexity | Dependencies |
| --- | --- | --- | --- |
| CB-T01 | Add `budget` field to CalcTag schema + IndexedDB migration | M | None |
| CB-T02 | Add budget input field to Tag Catalog UI (Settings) | M | CB-T01 |
| CB-T03 | Compute per-tag `spent`, `remaining`, `percentUsed` in MetricsBlock | M | CB-T01 |
| CB-T04 | Redesign Category Breakdown UI with `+remaining / -spent` display | M | CB-T03 |
| CB-T05 | Add progress bar per tag (% of budget used) | S | CB-T04 |
| CB-T06 | Over-budget visual warning state (red highlight, ⚠️ icon) | S | CB-T04 |
| CB-T07 | Show "Untagged" bucket with spent-only display | S | CB-T03 |

### Phase 3: Budget View — Infrastructure

| Story ID | Title | Complexity | Dependencies |
| --- | --- | --- | --- |
| CB-B01 | Create BudgetAggregator service (scan all notes, extract calc box data) | L | None |
| CB-B02 | Add 'budget' to activeTab type and routing (mobile + desktop) | M | None |
| CB-B03 | Create BudgetView shell component with responsive layout | M | CB-B02 |
| CB-B04 | Wire BudgetAggregator into BudgetView with reactive updates | M | CB-B01, CB-B03 |

### Phase 4: Budget View — UI Panels

| Story ID | Title | Complexity | Dependencies |
| --- | --- | --- | --- |
| CB-B05 | Build BudgetSummaryCards (income/expenses/savings hero) | M | CB-B04 |
| CB-B06 | Build BudgetCategoryList (per-tag totals with +/- across all boxes) | M | CB-B04, CB-T01 |
| CB-B07 | Build BudgetBoxCard list (individual box summaries) | M | CB-B04 |
| CB-B08 | Add global tag filtering to the budget view | M | CB-B06, CB-F01 |
| CB-B09 | Implement "Open Note" navigation from box cards | S | CB-B07 |
| CB-B10 | Build Quick-Add Expense flow (bottom sheet/modal) | L | CB-B04 |

### Phase 5: Polish & Extras

| Story ID | Title | Complexity | Dependencies |
| --- | --- | --- | --- |
| CB-P01 | Pin tags in budget view (localStorage persistence) | S | CB-B06 |
| CB-P02 | Sort category breakdown (amount/alpha/custom) | S | CB-B06 |
| CB-P03 | Search rows across all calc boxes | M | CB-B04 |
| CB-P04 | Export aggregated budget data (XLSX) | M | CB-B04 |
| CB-P05 | Pull-to-refresh on mobile budget view | S | CB-B03 |
| CB-P06 | Desktop multi-column responsive optimization | M | CB-B03 |

---

## 7. Implementation Roadmap

### Phase 1: Tag Filtering (Stories CB-F01 → CB-F05)
- **Why**: Immediate value — users can filter within existing calc boxes.
- **Outcome**: Filter chips appear, stats recalculate, UX feels focused.

### Phase 2: Per-Tag Budget (Stories CB-T01 → CB-T07)
- **Why**: Answers "how much have I spent vs. how much remains per category?"
- **Outcome**: Each tag shows `+remaining / -spent` with progress bar. Users set budgets in Settings.

### Phase 3: Budget View Infrastructure (Stories CB-B01 → CB-B04)
- **Why**: Builds the data pipeline and navigation scaffolding.
- **Outcome**: Budget tab exists, aggregates data, renders a shell.

### Phase 4: Budget View UI (Stories CB-B05 → CB-B10)
- **Why**: Delivers the full visual dashboard experience.
- **Outcome**: Users see their complete financial picture in one place.

### Phase 5: Polish (Stories CB-P01 → CB-P06)
- **Why**: Quality-of-life enhancements.
- **Outcome**: Pinning, sorting, search, export — power user features.

---

## 8. Key Technical Decisions & Considerations

| Decision | Rationale |
| --- | --- |
| Filter state is ephemeral (not in node attrs) | Filters are a temporary view concern, not data. Avoids polluting the document model and sync. |
| BudgetAggregator parses note HTML | Notes are stored as HTML in IndexedDB. The aggregator uses DOMParser to find `<div data-type="metrics">` blocks and extract their `data` attributes. |
| Budget view is a new `activeTab` value | Follows existing pattern (home, tags, library, daily, focus). Minimal routing changes needed. |
| Per-tag +/- breakdown replaces current simple total | Enhanced version is strictly better — shows net when only one direction, shows both when mixed. |
| Quick-add modifies note content via the same `updateAttributes` pipeline | Ensures consistency with how rows are saved today. Opens the note in memory, appends the row, saves. |

---

## 9. Open Questions

| # | Question | Impact |
| --- | --- | --- |
| Q1 | Should the mobile bottom nav support 6 tabs, or should Budget replace one of the existing tabs? | Nav bar space on small screens. |
| Q2 | Should per-tag totals in the budget view be computed lazily (on navigate) or eagerly (background indexing)? | Performance vs. freshness trade-off. |
| Q3 | Should the budget view support filtering by note/notebook as well? | Scope creep vs. usefulness. |
| Q4 | Quick-add: should it create a new row in an existing box or also support creating a new calc box? | Complexity. |

---

## 10. File Reference (Current Codebase)

| File | Relevance |
| --- | --- |
| `src/lib/components/MetricsBlock.svelte` | Main calc box component — Features 1 & 2 live here |
| `src/lib/components/MobileTabBar.svelte` | Add Budget tab |
| `src/lib/stores/mobileNav.svelte.ts` | Navigation state for mobile tabs |
| `src/lib/stores/appState.svelte.ts` | Global app state including `activeTab` |
| `src/lib/components/AppLayout.svelte` | Mobile tab view rendering |
| `src/lib/components/Sidebar.svelte` | Desktop sidebar navigation |
| `src/lib/components/AppHeader.svelte` | Desktop header navigation |
| `src/App.svelte` | Hash routing |
| `src/lib/utils/exportMetricsXlsx.ts` | Existing export logic — extend for budget view |
| `CALCULATION_BOX_EPIC.md` | Existing epic for calc box features |

---

*End of Epic*
