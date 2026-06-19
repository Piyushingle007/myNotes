# Epic: Budget-Aware Calculation Boxes — Income, Savings & Financial Tagging

> Product Specification — myNotes
> Status: **Draft for Engineering Review**
> Author role mix: Senior PM · Staff UX · Principal Architect
> Last updated: 2026-06-19

---

## 0. How to Read This Document

This is a **planning artifact**, not an implementation. It is written so an engineering
team can pick up **one story at a time**, build it, ship it, and move on without breaking
existing behavior. Every story is independently deliverable, has explicit dependencies,
and ships behind sensible defaults so the existing Calculation Box keeps working untouched.

Terminology note: in the codebase, the "Calculation Box" is the **`metrics` Tiptap node**
rendered by `src/lib/components/MetricsBlock.svelte`. Throughout this document
"Calculation Box", "Calc Box", and "Metrics block" refer to the same thing.

---

## 1. Epic Overview

### 1.1 Current State (as built today)

| Area | Today |
| --- | --- |
| Block type | A `metrics` atom node embedded in a note via Tiptap; UI in `MetricsBlock.svelte`. |
| Rows | `{ id: string; checked: boolean; label: string }`. Numbers are parsed inline from `label`. |
| Derived figures | `income` = sum of positive row values, `expenses` = abs(sum of negatives), `net`/`sum` = total. These are **derived**, not user-defined. |
| Display toggles | Per-box node attrs: `showIncome`, `showExpenses`, `showMin`, `showMax`, `showMedian`, `excludeChecked`. |
| Savings | Does **not** exist. |
| Calc tags | Do **not** exist. The only tag system is the **note** tag system (`TagDatabase`, IndexedDB stores `tags` + `note_tags`), which is for note organization and must remain isolated from this feature. |
| Settings | Global Settings modal with tabs `sync · styling · editor`; preferences persist under `mynotes_*` localStorage keys. |

### 1.2 Vision

Turn the Calculation Box from a passive number-summing widget into a lightweight
**personal budgeting surface**:

1. **Income becomes a first-class, user-defined value** (not auto-derived), architected
   for multiple income sources later.
2. **A dedicated, highly visible Savings block** answers "how much do I have left?" via
   `Savings = Income − Total`.
3. **A standalone, global Calculation Tag system** lets users categorize spend
   (Food, Rent, Travel, …) — completely separate from note tags.
4. **Opt-in per-tag totals** give aggregated insight without cluttering the default view.
5. **A clear settings architecture** separates global config (tag catalog), box-specific
   config (which summaries show here), and future user preferences.

### 1.3 Out of Scope (this epic)

- Multi-currency conversion / FX rates.
- Cross-note / cross-box budget reports and dashboards (designed for, not built).
- Recurring transactions, scheduled income, or forecasting.
- Bank/import integrations.
- Note-tag changes of any kind.

---

## 2. Product Goals

| # | Goal | Success signal |
| --- | --- | --- |
| G1 | Let users explicitly declare income per Calculation Box. | Users set income on ≥1 box without confusion; no regression for existing boxes. |
| G2 | Make remaining money instantly visible. | Savings figure visible & correct; updates live as rows/income change. |
| G3 | Provide a standalone financial categorization system. | Users create/assign calc tags; note tags remain untouched. |
| G4 | Keep the default view clean. | Tag totals & savings are opt-in / sensibly defaulted; no clutter complaints. |
| G5 | Build for scale & future budgeting/reporting. | Global tag store handles many boxes; data model supports multi-source income & reports without migration pain. |

### Non-Goals / Guardrails
- **No coupling to note tags.** Separate store, separate IDs, separate UI.
- **No breaking changes** to existing boxes — every new capability is additive and defaulted off or to legacy behavior.
- **Local-first.** Must work offline and round-trip through the existing note HTML + IndexedDB persistence and Google Drive sync.

---

## 3. UX Vision

### 3.1 Principles
1. **Progressive disclosure** — a Calculation Box still looks simple by default; budgeting power appears as the user opts in.
2. **Glanceability** — Savings is the hero number, styled for instant reading (large, color-coded: positive = safe, negative = overspent).
3. **One place to manage tags** — global tag catalog lives in Calculation Box Settings; assigning is inline and frictionless.
4. **Reversible & forgiving** — disabling a tag never destroys data; deleting prompts and explains impact.
5. **Consistent with myNotes** — reuse existing Settings modal patterns, theme tokens, and the block's existing card styling.

### 3.2 Conceptual layout of an enhanced Calculation Box

```
┌─ Calculation Box: "October Budget" ───────────────── ⚙ ─┐
│  Income      ₹ 50,000            [+ add source]*         │  ← Income zone (S2; multi-source future)
│ ───────────────────────────────────────────────────────│
│  Rows:                                                   │
│   ▢  Groceries  -2000     [Food ▾]                       │  ← inline tag picker (S6)
│   ▢  Cab        -300      [Travel ▾]                     │
│   ▢  SIP        -12000    [Investment ▾]                 │
│   [+ add row]                                            │
│ ───────────────────────────────────────────────────────│
│  Total (expenses)   ₹ 14,300                             │  ← existing stats
│ ╔═══════════════════════════════════════════════════╗   │
│ ║  SAVINGS            ₹ 35,700   ▲ safe              ║   │  ← hero Savings block (S4)
│ ╚═══════════════════════════════════════════════════╝   │
│  Tag totals (opt-in):  Food ₹2,000 · Investment ₹12,000 │  ← only enabled tags (S8/S9)
└─────────────────────────────────────────────────────────┘
   * multi-source is a future toggle; MVP shows single income field
```

### 3.3 Settings surface

A new **"Calculation"** section/tab in the global Settings modal:
- **Tag Catalog** — create, rename, recolor, enable/disable, delete tags (global).
- **Tag total visibility defaults** — which tag summaries are shown.
- **Display defaults** — default Savings visibility, default income label/currency symbol.
- Clear labeling that this is **separate from Note Tags**.

---

## 4. Information Architecture

### 4.1 Where each setting lives

| Setting | Scope | Home | Persistence |
| --- | --- | --- | --- |
| Tag catalog (the tags themselves) | **Global** | Settings → Calculation → Tag Catalog | IndexedDB (new calc-tag store) |
| Tag enabled/disabled | **Global** | Settings → Calculation | IndexedDB calc-tag store |
| Tag color | **Global** | Settings → Calculation | IndexedDB calc-tag store |
| Which tag totals are visible | **Global default + per-box override** | Global default in Settings; override on the box | Default: localStorage `mynotes_*`; override: node attr |
| Income value | **Per-box** | On the box | Node attr (`income` / `incomeSources`) |
| Income label / currency symbol | **Global default, per-box override** | Settings default; box override | localStorage default + node attr |
| Show/hide Savings | **Per-box** (global default) | On the box | Node attr (`showSavings`) |
| Tag assignment on a row | **Per-row (per-box)** | Inline on row | Inside `data` rows JSON |

### 4.2 System boundaries (critical)

```
        NOTE ORGANIZATION                 FINANCIAL CATEGORIZATION
   ┌──────────────────────────┐      ┌──────────────────────────────┐
   │ TagDatabase (existing)   │      │ CalcTagStore (NEW)           │
   │  DB: myNotesMetadata_<v> │      │  DB: myNotesMetadata_<v>     │
   │  stores: tags, note_tags │  ✗   │  store: calc_tags (NEW)      │
   │  used by: note sidebar   │ ──── │  used by: Calculation Boxes  │
   └──────────────────────────┘ no   └──────────────────────────────┘
                                link
```
**Hard rule:** no shared IDs, no shared store, no shared UI, no read/write across the boundary.

---

## 5. Feature Breakdown (themes → stories)

| Theme | Stories |
| --- | --- |
| A. Income as first-class value | S1, S2, S3 |
| B. Savings block | S4, S5 |
| C. Calc tag system (data + global mgmt) | S6 (data), S7 (CRUD UI), S10 (enable/disable) |
| D. Tag assignment on rows | S8 |
| E. Tag-based totals (opt-in) | S9, S11 |
| F. Settings architecture | S12 |
| G. Persistence, sync & scale | S13, S14 |
| H. Multi-source income (future-ready) | S15 |

---

## 6. Detailed User Stories

> Format per story: **Value · Scope · Dependencies · Acceptance Criteria · UX/Edge notes**.
> Stories are intentionally small (≈1 dev task each).

### S1 — Add an explicit Income field to a Calculation Box
- **User value:** I can state my income directly instead of relying on auto-derivation.
- **Scope:** Add an `income` node attribute (number, default `0`) to the `metrics` node. Render a single, editable Income input at the top of the box. Numeric validation & formatting. Does **not** yet affect Savings or totals.
- **Dependencies:** none (pure additive on existing node).
- **Acceptance criteria:**
  - [ ] New `income` attr exists on the `metrics` node, default `0`, parsed/serialized in `parseHTML`/`renderHTML` like existing attrs.
  - [ ] An Income input is visible at the top of the box; editing persists via `updateAttributes`.
  - [ ] Empty/invalid input coerces to `0`; negative income is allowed but flagged visually (it's unusual).
  - [ ] Existing boxes with no `income` attr load with `income = 0` and behave exactly as before.
- **Edge/UX:** thousands formatting on blur, raw number on focus; respects locale/currency symbol from S12 default (fallback `₹`).

### S2 — Decouple income display from auto-derived "income"
- **User value:** The box shows the income I declared, not a number guessed from positive rows.
- **Scope:** Where the box currently surfaces derived `income` (from positive row values), introduce a clear separation: keep the derived figure available internally but treat the **user-defined `income`** as the authoritative "Income". Update labels to avoid confusion (e.g., derived positive sum becomes "Credits/Inflows" if shown).
- **Dependencies:** S1.
- **Acceptance criteria:**
  - [ ] The headline "Income" reflects the user-entered value from S1.
  - [ ] The legacy derived positive-sum is either hidden by default or relabeled so it can't be mistaken for Income.
  - [ ] `showIncome` toggle semantics documented: it now governs the user-defined Income display, not the derived figure.
  - [ ] No regression to `expenses`/`net`/`sum`.
- **Edge/UX:** Migration messaging not needed (additive), but document the semantic change in code comments.

### S3 — Income labeling & currency symbol
- **User value:** My income reads naturally ("Salary", "₹").
- **Scope:** Optional `incomeLabel` (string, default "Income") and currency symbol sourced from global default (S12). Per-box label override.
- **Dependencies:** S1; soft-dependency on S12 for the global default (can ship with hardcoded `₹` then wire to S12).
- **Acceptance criteria:**
  - [ ] Income row shows label (default "Income") and currency symbol.
  - [ ] Per-box label override persists as a node attr.
  - [ ] Falls back gracefully when S12 default not present.

### S4 — Savings block (hero) with `Savings = Income − Total`
- **User value:** I instantly see how much money I have left.
- **Scope:** Compute `savings = income − total`, where `total` is the box's net expense figure (define precisely; see Data Model §10). Render a prominent, color-coded Savings panel. Live-updates with rows & income.
- **Dependencies:** S1 (income), existing stats (`net`/`sum`).
- **Acceptance criteria:**
  - [ ] Savings = Income − Total, recomputed reactively (`$derived`) on any row/income/excludeChecked change.
  - [ ] Positive savings styled "safe"; zero neutral; negative styled "overspent" with clear affordance.
  - [ ] Respects `excludeChecked` consistently with how Total is computed.
  - [ ] Currency formatting consistent with Income (S3).
  - [ ] Correct when there are zero rows (Savings = Income).
- **Edge/UX:** Define the sign convention for "Total" explicitly in code (see §10.2). Very large/negative numbers must not break layout (truncate/scale font).

### S5 — Per-box Savings visibility toggle (`showSavings`)
- **User value:** I can hide Savings on boxes where it's irrelevant.
- **Scope:** `showSavings` node attr (boolean). Toggle in box settings popover. Global default from S12.
- **Dependencies:** S4, S12 (for default).
- **Acceptance criteria:**
  - [ ] `showSavings` default follows global preference (fallback: shown when an income is set, else hidden).
  - [ ] Toggling persists per box.
  - [ ] Existing boxes default sensibly (hidden if `income = 0`).

### S6 — Calculation Tag data layer (standalone store)
- **User value (enabler):** A reliable, isolated home for financial tags.
- **Scope:** New persistence module `CalcTagStore` (e.g., `src/lib/storage/CalcTagSchema.ts`) using a **new IndexedDB object store `calc_tags`** in the existing metadata DB — **no reuse** of `tags`/`note_tags`. Bump DB version with additive `onupgradeneeded`. Define `CalcTag` type. CRUD methods only (no UI yet).
- **Dependencies:** none (data only). Must coordinate IndexedDB version bump with `TagDatabase`.
- **Acceptance criteria:**
  - [ ] `CalcTag { id; name; normalizedName; color?; enabled: boolean; createdAt; sortOrder? }` defined.
  - [ ] New store `calc_tags` created via version upgrade **without** touching `tags`/`note_tags`.
  - [ ] Case-insensitive uniqueness on `normalizedName` (mirror existing pattern).
  - [ ] CRUD: `addCalcTag`, `listCalcTags`, `updateCalcTag`, `deleteCalcTag`, plus `setEnabled`.
  - [ ] Zero references to note-tag store from this module and vice versa.
- **Edge/UX:** Concurrency — adding a duplicate returns the existing tag (mirror `addTag` ConstraintError handling).

### S7 — Global Tag Catalog UI (create / rename / recolor / delete)
- **User value:** I manage all my financial categories in one place.
- **Scope:** UI in Settings → Calculation → Tag Catalog. List tags; create; inline rename; color picker; delete with confirm. Reactive to `CalcTagStore`.
- **Dependencies:** S6, S12 (the Settings section host).
- **Acceptance criteria:**
  - [ ] Create tag (trimmed, non-empty, unique case-insensitive) → appears immediately.
  - [ ] Rename updates `name` + `normalizedName`; duplicate rename blocked with inline error.
  - [ ] Recolor persists; default color assigned on create.
  - [ ] Delete asks for confirmation and states impact (assignments cleared / become "Untagged").
  - [ ] Clear copy: "These tags are separate from Note Tags."
- **Edge/UX:** Empty state with examples (Food, Rent, Travel, Investment, Shopping, Utilities) and a one-click "add starter set".

### S8 — Assign a tag to a calculation row
- **User value:** I can categorize each line item.
- **Scope:** Extend row shape to `{ id; checked; label; tagId?: string }`. Inline tag picker per row showing **enabled** tags + "None". Persisted inside `data` JSON.
- **Dependencies:** S6 (tags exist), S7 (to have tags to pick).
- **Acceptance criteria:**
  - [ ] Each row has an optional `tagId`; picker lists enabled tags + "None".
  - [ ] Selecting/clearing persists via `saveRows()` (existing `data` attr).
  - [ ] Tag chip shows tag color.
  - [ ] Rows created before this story load with `tagId` undefined (treated as Untagged) — no data loss.
  - [ ] Deleting a tag (S7) leaves orphaned `tagId`s handled gracefully as Untagged (see §9).
- **Edge/UX:** Picker must not interfere with existing inline number parsing / date insertion.

### S9 — Compute per-tag totals (engine, no default display)
- **User value (enabler):** The data behind "Food = ₹5,000".
- **Scope:** A `$derived` map of `tagId → total` for the box, using the same row-value parsing and `excludeChecked` rules. Internal only; **not shown by default**.
- **Dependencies:** S8.
- **Acceptance criteria:**
  - [ ] Per-tag totals computed reactively over active rows.
  - [ ] "Untagged" bucket computed.
  - [ ] No UI rendered yet (or rendered only behind S11 flags).
  - [ ] Performance: O(rows) per recompute; no per-tag full scans.

### S10 — Enable / disable tags globally
- **User value:** I can retire a category without deleting its history.
- **Scope:** `enabled` flag on `CalcTag` (from S6). Toggle in Tag Catalog (S7). Disabled tags: hidden from row pickers (S8) and from tag-total visibility options (S11), but existing assignments retained.
- **Dependencies:** S6, S7, S8.
- **Acceptance criteria:**
  - [ ] Toggling `enabled` persists globally and reflects everywhere immediately.
  - [ ] Disabled tag is hidden from new-assignment pickers but rows already using it keep the assignment (shown muted/"disabled").
  - [ ] Disabled tags don't appear in S11 visibility chooser.
- **Edge/UX:** Re-enabling restores normal behavior with no data change.

### S11 — Choose which tag totals are visible (opt-in)
- **User value:** I see only the category summaries I care about.
- **Scope:** Visibility selection — global default set (S12) plus per-box override. Renders enabled, selected tag totals beneath the box. Default: **none visible**.
- **Dependencies:** S9 (totals), S10 (enabled set), S12 (global defaults host).
- **Acceptance criteria:**
  - [ ] By default, **no** tag totals are shown.
  - [ ] User can enable specific tag totals; selection persists (per-box override; falls back to global default).
  - [ ] Only enabled tags are selectable.
  - [ ] Visible totals update live with rows.
  - [ ] Hiding all returns the box to the clean default.
- **Edge/UX:** Compact chip row; overflow scrolls/wraps; "Untagged" optionally selectable.

### S12 — Calculation Box Settings section (global config home)
- **User value:** One coherent place for all calc-box configuration.
- **Scope:** Add a **"Calculation"** tab to the existing Settings modal (extend `settingsActiveTab` union and Settings UI). Hosts: Tag Catalog (S7), global tag-total visibility defaults (S11), display defaults (currency symbol, default income label, default `showSavings`). Persist global prefs under `mynotes_calc_*` localStorage keys.
- **Dependencies:** soft-dependencies on S6/S7/S11 (it hosts them) — can be built as an empty shell first, then populated.
- **Acceptance criteria:**
  - [ ] New "Calculation" tab appears in Settings alongside `sync · styling · editor`.
  - [ ] Hosts sub-sections with clear separation from Note Tags.
  - [ ] Global prefs persist under `mynotes_calc_*` and load on startup.
  - [ ] No impact on existing tabs.
- **Edge/UX:** Tab order and naming consistent with existing modal; responsive on mobile (Capacitor/Android).

### S13 — Persistence & note HTML round-trip
- **User value:** My income, savings prefs, and row tags survive reload, export, and reopen.
- **Scope:** Ensure all new node attrs (`income`, `incomeLabel`, `showSavings`, tag-total visibility override) and row `tagId`s serialize into the note HTML via the `metrics` node `parseHTML`/`renderHTML`, and that calc tags persist in IndexedDB. Verify with the existing note generate/parse pipeline.
- **Dependencies:** S1, S5, S8, S11.
- **Acceptance criteria:**
  - [ ] Save → reload note preserves income, savings visibility, and row tag assignments.
  - [ ] Calc tag catalog persists across app restarts.
  - [ ] Malformed/legacy attrs degrade gracefully to defaults.
- **Edge/UX:** Backward compatibility: notes authored before this epic open cleanly.

### S14 — Sync & multi-note scalability
- **User value:** Works across all my notes and syncs without conflicts.
- **Scope:** Confirm calc tags (IndexedDB) and per-box attrs (in note HTML) behave under Google Drive sync. Tags are global per vault; box attrs travel with the note. Validate performance with many boxes/notes.
- **Dependencies:** S6, S13.
- **Acceptance criteria:**
  - [ ] Many calculation boxes across many notes render without noticeable lag.
  - [ ] Tag catalog is consistent across all boxes in the vault (single source of truth).
  - [ ] Sync round-trip preserves box attrs (they live in note content) and doesn't corrupt the tag store.
  - [ ] Define and document conflict behavior for the global tag catalog (last-write-wins acceptable for MVP; see Risks).
- **Edge/UX:** Tag catalog is **not** embedded per note (avoids divergence); only `tagId` references travel in note content.

### S15 — Multi-source income (future-ready scaffolding)
- **User value:** Eventually, I can track several income streams.
- **Scope:** Introduce `incomeSources?: Array<{ id; label; amount }>` as the forward-compatible model; MVP uses a single derived `income = sum(incomeSources)` or the scalar `income` from S1. Ship data model + (optionally) a hidden/flagged "add source" affordance.
- **Dependencies:** S1, S4.
- **Acceptance criteria:**
  - [ ] Data model supports `incomeSources` without breaking the scalar `income` path.
  - [ ] Savings (S4) computes from total income whether single or multi-source.
  - [ ] Multi-source UI may remain behind a flag for MVP but the model is migration-free when enabled.
- **Edge/UX:** When 0 or 1 source, UI stays as the simple single Income field.

---

## 7. Acceptance Criteria Summary (traceability)

| Story | Primary AC theme | Verifiable artifact |
| --- | --- | --- |
| S1 | income attr + input | node attr, persisted value |
| S2 | income vs derived separation | labels, no regression |
| S3 | labels & currency | per-box label override |
| S4 | Savings = Income − Total | reactive derived value |
| S5 | showSavings toggle | node attr |
| S6 | calc_tags store | new IndexedDB store |
| S7 | tag CRUD UI | Settings catalog |
| S8 | row tagId | rows JSON |
| S9 | per-tag totals engine | derived map |
| S10 | enable/disable | enabled flag |
| S11 | opt-in tag totals | per-box/global visibility |
| S12 | Calculation settings tab | new settings tab |
| S13 | persistence round-trip | save/reload integrity |
| S14 | sync & scale | multi-note consistency |
| S15 | multi-source model | forward-compatible schema |

---

## 8. UI/UX Requirements

1. **Savings is the hero.** Largest type in the box; color-coded (safe / neutral / overspent); single-line glance value with currency symbol.
2. **Income is unmistakable.** Top-anchored, labeled, editable; clearly distinct from derived row sums.
3. **Tag chips** carry their global color; muted style for disabled tags still attached to rows.
4. **Inline tag picker** on each row must coexist with existing inline number parsing, checkboxes, drag-reorder, and `@today` date insertion without conflict.
5. **Opt-in by default.** Tag totals hidden until chosen; Savings hidden when no income set.
6. **Settings clarity.** The Calculation tab must explicitly state separation from Note Tags; provide empty states and a starter tag set.
7. **Responsive.** Works in the web app and Android (Capacitor); touch targets ≥44px; no horizontal overflow on small screens.
8. **Theming.** Use existing theme tokens; positive/negative colors must remain legible across all 30+ themes.
9. **Accessibility.** Inputs labeled; color is never the only signal for overspent (add icon/text); keyboard operable pickers.
10. **No surprise destruction.** Deleting/disabling tags always explains impact before acting.

---

## 9. Edge Cases

| # | Scenario | Expected behavior |
| --- | --- | --- |
| E1 | Box has no income set | Savings hidden by default (S5); if shown, Savings = −Total (or 0 if no rows). |
| E2 | Income < 0 | Allowed; flagged as unusual; Savings math still valid. |
| E3 | No rows | Total = 0; Savings = Income. |
| E4 | Row has no number in label | Ignored in totals (existing behavior preserved). |
| E5 | Row tagged but value unparsable | Counts as ₹0 toward that tag's total. |
| E6 | Tag deleted while assigned to rows | Assignment becomes "Untagged"; rows keep their values; per-tag total for the deleted tag disappears. |
| E7 | Tag disabled while assigned | Assignment retained & shown muted; tag removed from new-pick lists and visibility chooser. |
| E8 | Duplicate tag name (case-insensitive) | Create/rename blocked; on create-duplicate, return existing tag (mirror `addTag`). |
| E9 | `excludeChecked` on | Excluded rows must be excluded from Total, Savings, **and** per-tag totals consistently. |
| E10 | Legacy box (pre-epic) opened | Loads with `income=0`, no row tags, Savings hidden — identical to old behavior. |
| E11 | Same tag id referenced across many notes; tag recolored/renamed | Change reflects everywhere (global catalog), since only `tagId` is stored in notes. |
| E12 | Sync conflict on tag catalog | MVP last-write-wins; never corrupts note-tag store; document & flag for future merge strategy. |
| E13 | Very large numbers / long currency strings | Layout scales/truncates; Savings stays single-line and readable. |
| E14 | Note tag store and calc tag store coexist | Zero cross-reads/writes; deleting a note tag never affects calc tags and vice versa. |
| E15 | Multi-source income with 0 sources | Treated as income 0; UI shows single empty Income field. |

---

## 10. Data Model Considerations

### 10.1 Calculation Box (`metrics` node attributes)

```ts
// Existing (unchanged):
// id, title, data (JSON rows), excludeChecked,
// showIncome, showExpenses, showMin, showMax, showMedian

// NEW attributes (all additive, defaulted for backward-compat):
income: number;                 // default 0  (S1)
incomeLabel?: string;           // default "Income" (S3)
incomeSources?: IncomeSource[]; // future multi-source (S15); when present, income = sum(amounts)
showSavings?: boolean;          // default: shown only if income > 0 (S5)
visibleTagTotals?: string[];    // per-box override of which tag totals show (S11); undefined => use global default
```

```ts
interface IncomeSource {  // S15
  id: string;
  label: string;          // e.g. "Salary", "Freelance"
  amount: number;
}
```

### 10.2 Row shape

```ts
// Before:
interface Row { id: string; checked: boolean; label: string; }

// After (S8) — additive:
interface Row { id: string; checked: boolean; label: string; tagId?: string; }
```

**Total / sign convention (define once, use everywhere):**
- `Total` for Savings is the box's net of row values over active rows (respecting `excludeChecked`).
- Decide and document explicitly: if rows are entered as **negative expenses** (current parsing supports signed numbers), then `net` is already income−expense-like; Savings should be `income + net` OR `income − expenseTotal` depending on user mental model.
- **Recommended:** Savings = `income − expenseTotal`, where `expenseTotal = abs(sum of negative row values)` plus optionally positive non-income rows — **must be finalized with a quick design spike in S4** and encoded in a single helper so all summaries (Total, Savings, per-tag) agree.

### 10.3 Calculation Tags (NEW store)

```ts
interface CalcTag {            // S6
  id: string;                  // UUID
  name: string;                // "Food"
  normalizedName: string;      // "food" (unique, case-insensitive)
  color?: string;              // hex
  enabled: boolean;            // default true (S10)
  createdAt: number;
  sortOrder?: number;          // optional manual ordering
}
```

- **Store:** new IndexedDB object store **`calc_tags`** inside the existing
  `myNotesMetadata_<vault>` database (additive version bump). **No** relation store is
  needed because assignments live inline on rows (`tagId`) — this avoids a global
  note↔tag join table and keeps assignments traveling with note content.
- **Isolation invariant:** `calc_tags` is never read/written by note-tag code, and
  `tags`/`note_tags` are never touched by calc code.

### 10.4 Preferences (localStorage)

```
mynotes_calc_currency_symbol   // default "₹"
mynotes_calc_income_label      // default "Income"
mynotes_calc_show_savings      // global default for new boxes
mynotes_calc_visible_tag_totals// global default tag-total visibility (array)
```

---

## 11. Future Expansion Opportunities

1. **Multi-source income** fully enabled (S15 UI on).
2. **Cross-box / cross-note budget dashboard** — aggregate per-tag spend across the whole vault (the global tag catalog + inline `tagId`s make this query-friendly).
3. **Budgets & limits per tag** ("Food budget ₹5,000" with progress bars).
4. **Recurring income/expense templates** and monthly rollover.
5. **Reports & charts** (trend lines, category pie, savings rate).
6. **Multi-currency** with per-box currency and conversion.
7. **Export** (CSV/Sheets) of categorized transactions.
8. **Smart tag suggestions** based on row label text.
9. **Per-tag color theming in charts** reusing `CalcTag.color`.

The data model deliberately stores tag references inline and the tag catalog globally,
which is exactly the shape needed for vault-wide reporting without migration.

---

## 12. Story Dependencies

```
S6 (calc tag data) ──► S7 (tag CRUD UI) ──► S8 (assign on row) ──► S9 (per-tag totals)
   │                       │                     │                      │
   │                       └──► S10 (enable/disable) ──────────────────►│
   │                                                                    ▼
S12 (Calc Settings tab) ◄── hosts S7, S11                         S11 (opt-in tag totals)

S1 (income field) ──► S2 (decouple) ──► S3 (labels/currency)
   │
   └──► S4 (Savings) ──► S5 (showSavings toggle)
                 │
                 └──► S15 (multi-source income, future)

S13 (persistence) depends on: S1, S5, S8, S11
S14 (sync & scale) depends on: S6, S13
```

| Story | Hard deps | Soft deps |
| --- | --- | --- |
| S1 | — | — |
| S2 | S1 | — |
| S3 | S1 | S12 |
| S4 | S1 | — |
| S5 | S4 | S12 |
| S6 | — | coordinate IDB version w/ TagDatabase |
| S7 | S6 | S12 |
| S8 | S6, S7 | — |
| S9 | S8 | — |
| S10 | S6, S7, S8 | — |
| S11 | S9, S10 | S12 |
| S12 | — | S6, S7, S11 (hosts them) |
| S13 | S1, S5, S8, S11 | — |
| S14 | S6, S13 | — |
| S15 | S1, S4 | — |

---

## 13. Recommended Development Order

> Two parallel tracks (Income/Savings and Tags) converge at Settings & persistence.

1. **S1** — Income field (immediate, isolated value).
2. **S2** — Decouple income from derived sum (removes confusion early).
3. **S4** — Savings block (hero value; the headline feature).
4. **S12 (shell)** — Add Calculation settings tab as an empty host.
5. **S6** — Calc tag data layer (unblocks all tag work).
6. **S7** — Tag Catalog CRUD UI (inside S12).
7. **S8** — Assign tags on rows.
8. **S9** — Per-tag totals engine.
9. **S10** — Enable/disable tags.
10. **S11** — Opt-in tag-total visibility.
11. **S5** — Savings visibility toggle (after Savings + Settings exist).
12. **S3** — Income label & currency (polish; wire to S12).
13. **S13** — Persistence/round-trip hardening.
14. **S14** — Sync & scalability validation.
15. **S15** — Multi-source income (future track / when prioritized).

Rationale: deliver visible user value fast (Income → Savings), stand up the settings
host, then build the tag system bottom-up (data → UI → assignment → totals → visibility),
finishing with cross-cutting persistence/sync hardening.

---

## 14. MVP vs Future Enhancements

### MVP (ship first)
- S1 Income field
- S2 Decouple derived income
- S4 Savings block (the headline)
- S5 Savings visibility toggle
- S6 Calc tag data layer
- S7 Tag Catalog CRUD
- S8 Assign tags on rows
- S12 Calculation settings tab
- S13 Persistence round-trip

> MVP delivers: explicit income, a prominent Savings figure, and a working, isolated,
> global tag system you can assign to rows — all persisted and backward-compatible.

### Fast-Follow (v1.1)
- S9 Per-tag totals engine
- S10 Enable/disable tags
- S11 Opt-in tag-total visibility
- S3 Income labels & currency
- S14 Sync & scale hardening

### Future (v2+)
- S15 Multi-source income (UI on)
- Vault-wide budget dashboard & reports
- Per-tag budgets/limits
- Recurring transactions, multi-currency, export

---

## 15. Risks and Mitigations

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Accidental coupling between calc tags and note tags | Data corruption, broken note org | Med | Separate store (`calc_tags`), separate module, code-review invariant, tests asserting no cross-access. |
| R2 | IndexedDB version-bump collision with `TagDatabase` | DB upgrade failures | Med | Single coordinated `onupgradeneeded` that only **adds** `calc_tags`; never alter existing stores; test upgrade from current version. |
| R3 | Ambiguous "Total" sign convention breaks Savings | Wrong financial figures | High | S4 design spike to define one convention; centralize in a single helper used by Total, Savings, per-tag totals. |
| R4 | Backward compatibility for existing boxes/notes | Regressions, data loss | High | All new attrs additive & defaulted; legacy boxes behave identically (E10); round-trip tests (S13). |
| R5 | Tag catalog sync conflicts (two devices) | Lost/duplicated tags | Med | MVP last-write-wins, documented; never corrupt note-tag store; future merge strategy by `normalizedName`. |
| R6 | UI clutter undermines "clean by default" goal | User dissatisfaction | Med | Opt-in tag totals (default none); Savings hidden when no income; progressive disclosure. |
| R7 | Inline tag picker conflicts with number/date parsing | Broken row input | Med | Keep picker UI outside the label text field; regression tests on parsing, `@today`, checkboxes, drag. |
| R8 | Performance with many boxes/notes | Lag | Low/Med | Global catalog loaded once; per-box totals O(rows); virtualize/lazy where needed; validate in S14. |
| R9 | Deleting tags surprises users | Data confusion | Low | Confirm dialogs explaining impact (assignments → Untagged); disable instead of delete encouraged. |
| R10 | Currency/locale assumptions (₹ hardcoded) | Wrong formatting for some users | Low | Centralize currency symbol in S12 pref; default `₹`, overridable. |

---

## Appendix A — Files likely touched (orientation, not prescriptive)

| Concern | File(s) |
| --- | --- |
| Calculation Box UI & math | `src/lib/components/MetricsBlock.svelte` |
| `metrics` node attributes / parse/render | `src/lib/components/Editor.svelte` (Metrics extension) |
| New calc tag store | `src/lib/storage/CalcTagSchema.ts` (new) |
| Existing note tags (do **not** modify) | `src/lib/storage/TagSchema.ts` |
| App state, settings tabs, prefs | `src/lib/stores/appState.svelte.ts` |
| Settings modal UI host | Settings component (referenced by `showSettings`/`settingsActiveTab`) |
| Note HTML persistence round-trip | `appState.svelte.ts` (`generateHtmlNote` / parse) |

## Appendix B — Definition of Done (per story)
- [ ] Behavior matches acceptance criteria.
- [ ] No regression to existing Calculation Box behavior (legacy boxes verified).
- [ ] New attrs/data persist and round-trip through note HTML / IndexedDB.
- [ ] No cross-access between calc tags and note tags.
- [ ] Works on web + Android (Capacitor), responsive & accessible.
- [ ] Code commented where semantics changed (esp. income/total/savings convention).

