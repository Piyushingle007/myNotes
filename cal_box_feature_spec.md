# Cal Box & Budget App — Feature Specification & Open Design Guide

This document specifies the complete feature set, data schemas, calculation engine rules, and UI requirements for building a standalone **Cal Box / Budget Application**. 

It is structured specifically for UI designers, frontend engineers, and AI agents building a custom user interface from scratch using modern design principles.

---

## 1. Executive Summary & Core Concept

The **Cal Box App** is a flexible, document-driven financial tracking and calculation tool. Unlike rigid expense trackers, it combines **freeform text calculations** (smart label parsing) with **structured ledger management** and **category envelope budgeting**.

### Mental Model
1. **Cal Boxes (Ledgers / Sheets / Accounts)**: Isolated financial containers (e.g., *"Monthly Household Budget"*, *"Trip to Japan"*, *"Freelance Q3"*).
2. **Line Items (Transactions)**: Individual entries inside a box containing text, numbers, natural dates, and multi-category tags.
3. **Smart Label Math Engine**: Freeform descriptions automatically parse math expressions (e.g. `"Groceries 120 + 45.50 - 10 #food"` → Total: `155.50`).
4. **Category Envelopes & Budgets**: Dynamic category tags with user-defined budget caps and real-time spent/remaining progress tracking.
5. **Dashboard & Analytics**: Global and per-box aggregation of income, inflows, expenses, net balance, and savings.

---

## 2. Data Models & Schemas

### 2.1 `CalcTag` (Category Schema)
```typescript
interface CalcTag {
  id: string;            // Unique identifier (UUID or slug)
  name: string;          // Category display name (e.g. "Food", "Rent")
  normalizedName: string;// Lowercase name for unique validation (e.g. "food")
  enabled: boolean;      // Global visibility toggle
  createdAt: number;     // Timestamp
  color?: string;        // Hex color code (e.g. "#ef4444")
  budget: number;        // Default global budget limit (optional)
}
```

### 2.2 `CalcBoxRow` (Line Item / Transaction Schema)
```typescript
interface CalcBoxRow {
  id: string;            // Unique row ID
  label: string;         // Raw text (e.g. "2026-07-24 Supermarket 45.50 #groceries")
  total: number;         // Computed numeric result from label
  tagIds: string[];      // Associated Category Tag IDs
  checked: boolean;      // Completed/settled status toggle
  date?: string;         // Extracted ISO date (YYYY-MM-DD)
}
```

### 2.3 `CalcBoxSnapshot` (Ledger / Sheet Schema)
```typescript
interface CalcBoxSnapshot {
  id: string;            // Unique box ID
  noteId?: string;       // Associated document path (if embedded)
  boxTitle: string;      // Ledger Title (e.g. "July 2026 Household")
  income: number;        // Base starting income/budget (e.g. 5000)
  incomeLabel: string;   // Label for base income (default "Income")
  currencyCode: string;  // Currency symbol (e.g. "₹", "$", "€", "£")
  excludeChecked: boolean;// If true, checked items are omitted from math
  tagBudgets: Record<string, number>; // Per-box budget caps per category tagId
  rows: CalcBoxRow[];
  stats: {
    net: number;         // Total sum of all counted rows (+ inflows, - expenses)
    expenses: number;    // Absolute sum of negative totals (|total|)
    inflows: number;     // Sum of positive totals
    savings: number;     // Starting Income + Net balance
    count: number;       // Number of active counted transactions
  };
}
```

---

## 3. Calculation & Parsing Engine Rules

### 3.1 Smart Number Parsing (`getRowNumbers`)
The engine extracts numeric values from freeform line descriptions using regular expressions while ignoring non-monetary numbers:
- **Valid Math Expressions**:
  - `"Dinner 25 + 15"` → `[25, 15]` → Total = `40`
  - `"Refund -20"` → `[-20]` → Total = `-20`
  - `"Coffee 4.50"` → `[4.50]` → Total = `4.50`
- **Rule**: Numbers attached directly to words (e.g., `"v2.0"`, `"MP3"`, `"Room 404"`) are excluded from math.
- **Rule**: Dates (e.g., `2026-07-24`, `12/05/2026`) are stripped prior to number extraction to prevent date numbers from skewing calculations.

### 3.2 Date Extraction (`extractRowDate`)
Automatically extracts ISO dates from line text:
- Matches formats: `YYYY-MM-DD`, `DD/MM/YYYY`, `MM-DD-YYYY`, `DD-MM-YYYY`.
- Converts extracted dates to standardized `YYYY-MM-DD` strings for calendar grouping and timeline sorting.

### 3.3 Income vs. Expense Logic
- **Inflow (Income/Refund)**: Row total `> 0`.
- **Expense**: Row total `< 0` (or positive numbers in an expense-oriented entry context).
- **Net Calculation**: Sum of all counted row totals.
- **Savings / Remaining Liquid Cash**: `Base Income + Net`.

### 3.4 `excludeChecked` Toggle Behavior
- When `excludeChecked = true`: Checking off a row marks it as "settled" or "paid" and **removes it from the live balance math**.
- When `excludeChecked = false`: Checked rows remain included in total calculations (checkbox acts strictly as a visual task check).

---

## 4. Required UI Views & Open Design Specs

For building a new UI from scratch, the app requires 5 core screens/views:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CAL BOX APP UI STRUCTURE                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. HEADER & KPI CARDS (Income, Expenses, Net, Savings, Currency)      │
├────────────────────────────────────────────────────────────────────────┤
│ 2. LEDGER / BOX SELECTOR (Tabs, Cards, or Dropdown)                   │
├──────────────────────┬─────────────────────────────────────────────────┤
│ 3. TRANSACTIONS TAB  │ 4. CATEGORIES & BUDGETS TAB                      │
│ - Search & Filters   │ - Category Envelopes & Progress Bars            │
│ - Transaction List   │ - Budget Cap Editor                             │
│ - Quick-Add Modal    │ - Category Palette Creator                      │
├──────────────────────┴─────────────────────────────────────────────────┤
│ 5. ANALYTICS & EXPORTS (Pie/Bar Charts, Excel/CSV Export)              │
└────────────────────────────────────────────────────────────────────────┘
```

---

### View 1: Global Summary & KPI Header Cards

Displays high-level financial metrics across the active box or aggregated across all boxes.

#### Required UI Elements:
- **Currency Switcher**: Dropdown/selector for default currency (`$`, `₹`, `€`, `£`, `¥`).
- **4 Key Metric Cards**:
  1. **Total Income / Base Budget**: Displays base starting income (e.g., `$5,000`).
  2. **Total Expenses**: Displays absolute total spent (color-coded red/coral).
  3. **Total Net Flow**: Difference between inflows and expenses (color-coded green for positive, red for negative).
  4. **Total Savings / Ending Balance**: Base Income + Net Flow (color-coded accent blue/indigo).
- **Primary Quick-Add Button (`+ Add Transaction`)**: Prominently floating or header-stationed CTA.

---

### View 2: Ledger / Box Selector (Multi-Account Management)

Allows users to create, switch between, and configure separate calculation sheets/ledgers.

#### Required UI Elements:
- **Box Selector List / Tabs / Dropdown**:
  - Displays list of active ledgers (e.g. *"July Household"*, *"Freelance Q3"*).
  - Shows mini badge with net balance and currency for each box.
  - Switch active box with 1 click.
- **Create New Box Button**:
  - Input field for Box Title (e.g. *"Vacation Fund"*).
  - Initial Starting Income input.
  - Currency selection.
- **Box Settings Drawer / Modal**:
  - Edit Title & Starting Income.
  - Toggle `Exclude Checked Rows from Calculation` switch.
  - Per-Category Budget allocation table for this specific box.

---

### View 3: Transaction List & Interactive Entry Sheet

The core workspace where transactions are added, edited, filtered, and checked off.

#### Required UI Elements:
- **Toolbar**:
  - **Search Bar**: Real-time label text filtering.
  - **Category Filter Chips**: Multi-select category tags to filter rows.
  - **Sort Dropdown**: Sort by Date (newest/oldest), Amount (highest/lowest), or Default insertion order.
  - **Show/Hide Settled Items**: Toggle visibility of checked rows.
- **Transaction Table / Card List**:
  - **Checkbox**: Toggle settled status.
  - **Date Badge**: Interactive calendar pill showing transaction date (`YYYY-MM-DD`). Clicking opens a date-picker popover.
  - **Description & Math Label**: Editable description containing text and numbers.
  - **Category Tag Pills**: Colored pills showing assigned categories. Clicking opens the tag picker popover.
  - **Computed Total Pill**: Prominently formatted amount badge (green for positive inflow, red for expense).
  - **Actions Menu**: Edit, Delete, Duplicate row.
- **Quick-Add Transaction Modal / Drawer**:
  - Description input (e.g. `"Grocery shopping 45.50"`).
  - Type toggle: `Expense` vs `Inflow`.
  - Amount numeric input.
  - Date selector.
  - Category multi-select tags.

---

### View 4: Category Envelope Budgeting View

A dedicated view for monitoring budget limits, category spending, and over-budget alerts.

#### Required UI Elements:
- **Category Progress Cards / Grid**:
  - **Category Header**: Color swatch dot, Category Name, Pinned icon.
  - **Budget vs Spent Numbers**: e.g., `"Spent: $450 / Budget: $500"`.
  - **Progress Bar**:
    - Animated progress bar indicating percentage used (`(spent / budget) * 100`).
    - Color changes to Amber at 85% and Red/Warning pattern when over 100%.
  - **Remaining Balance Pill**: Displays remaining budget (e.g., `"$50 remaining"` or `"Over budget by $25"`).
  - **Inline Budget Editor**: Click budget number to edit budget cap directly.
- **Category Manager Modal / Panel**:
  - Create new Category (Name + Color picker).
  - Color palette swatches (Preset color dots + custom HEX color input).
  - Enable/Disable global category toggle.
  - Delete category.

---

### View 5: Analytics & Data Export

Visual reports and data portability features.

#### Required UI Elements:
- **Charts & Visualizations**:
  - **Expense Distribution Chart**: Pie or Doughnut chart showing spending distribution by category tag.
  - **Monthly / Timeline Trend Chart**: Bar or Line chart tracking inflows vs expenses over time.
  - **Top Spending Categories Breakdown**: Ranked list of highest expense categories.
- **Data Export Options**:
  - **Export to Excel (`.xlsx`)**: Generates a multi-sheet formatted workbook with formulas, category summaries, and raw transaction data.
  - **Export to CSV (`.csv`)**: Downloads raw transaction table.
  - **Export / Import JSON (`.json`)**: Backup and restore all boxes and categories.

---

## 5. Key User Flows & State Interactions

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRIMARY USER WORKFLOWS                          │
├────────────────────────────────────────────────────────────────────────┤
│ Flow A: Create Box ──> Set Starting Income ──> Set Category Budgets     │
│ Flow B: Add Line Item ──> Auto-Parse Amount & Date ──> Assign Categories│
│ Flow C: Check Off Settled Line Item ──> Recalculate Net & Savings Math │
│ Flow D: Monitor Budget Progress ──> Trigger Over-Budget Warning        │
│ Flow E: Export Sheet to Formatted Excel Workbook                       │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Creating a Ledger**: User creates a "Monthly Budget", sets starting income to `$4,000`, and selects `$`.
2. **Adding Expenses**: User types `"Groceries 120 + 35 #food"`. The parser automatically extracts `$155.00` total and tags it under `#food`.
3. **Tracking Budgets**: The `#food` category card updates: `Spent: $155`, `Remaining: $345` out of a `$500` budget limit. Progress bar animates to 31%.
4. **Settling Transactions**: User checks the box next to `"Electricity Bill 110"`. If `excludeChecked` is enabled, `$110` is removed from expenses and added back to the liquid cash balance.
5. **Reporting**: User exports the ledger to an Excel `.xlsx` sheet with formatted headers, borders, and sum formulas.

---

## 6. Recommended Architecture Stack for Standalone App

- **UI Framework**: Svelte 5 / React / Vue (using Open Design tokens & Glassmorphism/Neumorphism principles).
- **Styling**: Vanilla CSS / Tailwind CSS with modern HSL color tokens and CSS variables.
- **State Management**: Reactive stores (Svelte Runes / Zustand / Pinia).
- **Persistence**: IndexedDB / LocalStorage / OPFS / SQLite (via Tauri or Electron).
- **Charting**: Chart.js / Recharts.
- **Exports**: `exceljs`, `papaparse`.

---

```text
docs: create comprehensive Cal Box & Budget feature specification for standalone app creation
```
