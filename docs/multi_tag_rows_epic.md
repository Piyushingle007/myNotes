# EPIC: Multi-Tag Rows for MetricsBlock (Calculation Box)

> **Component**: `src/lib/components/MetricsBlock.svelte`
> **Priority**: High
> **Type**: Feature + UI Redesign
> **Status**: Implemented

---

## Summary

Today each calculation row can be assigned to **exactly one** budget category (`tagId`). Users
frequently need a single expense to belong to **several** categories at once — e.g. an
order that is both *"Groceries"* and *"Amazon"*, or a bill that is both *"Rent"* and
*"Shared"*. This epic upgrades the row → category relationship from **one-to-one** to
**one-to-many** (`tagIds: string[]`) and redesigns the tag picker + row display to support
multiple tags cleanly.

---

## Goals

- A row can carry **0..N** category tags.
- Backward compatible: existing rows with a single `tagId` migrate transparently to `tagIds`.
- The category breakdown attributes a row's total to **every** tag it carries.
- The tag picker becomes a **multi-select** surface (toggle, stays open, Done to dismiss).
- The row shows **multiple pills** with graceful overflow (`+N`) so layout never breaks.

---

## Data Model Change

| Before | After |
|---|---|
| `{ id, checked, label, tagId?: string }` | `{ id, checked, label, tagIds?: string[] }` |

**Migration rule** (applied on load, non-destructive):
```
tagIds = Array.isArray(r.tagIds) ? r.tagIds
       : (r.tagId ? [r.tagId] : [])
```

**Category attribution**: a row with tags `[A, B]` and total `200` contributes `+200` to
**both** A and B totals. This is an intentional "membership" model (a row can count toward
multiple budgets). The breakdown **Total** row is therefore a sum of category memberships
and may legitimately exceed the net of unique rows — documented in the UI affordance.

---

## UI Redesign

### Tag Picker (multi-select)
- The trigger button shows:
  - `No Tag` when empty,
  - a colored dot + name when exactly one tag,
  - **stacked colored dots + `N tags`** when multiple.
- The dropdown items become **toggles** with a mini check indicator; selecting does **not**
  close the menu.
- `No Tag` is replaced by **`Clear tags`** (disabled when the row has none).
- A sticky **`Done`** button closes the picker (click-away and `Esc` still work).
- Search filter still appears when > 5 categories; `Enter` toggles the first match.

### Row Pills
- A dedicated `.metrics-row-tags` container renders all tags as pills.
- Up to **2** pills are shown inline; the remainder collapse into a single **`+N`** pill
  with a `title` listing the hidden category names.
- Works identically in edit-preview and read-only modes.

---

## User Stories

### MT-001 — Multi-tag data model & migration
**Priority**: High
- [x] `rows` type uses `tagIds?: string[]`
- [x] Load-time migration converts legacy `tagId` → `tagIds`
- [x] `saveRows()` persists the array form
- [x] No console errors for legacy documents

### MT-002 — Category totals attribute to all tags
**Priority**: High
- [x] `tagTotals` adds a row's total to **every** tag in `tagIds`
- [x] Rows with no tags fall into `untaggedTotal`
- [x] Breakdown chips & the **Total** row reflect multi-membership

### MT-003 — Multi-select tag picker
**Priority**: High
- [x] Items toggle on click and the dropdown stays open
- [x] Selected items show a check indicator + highlighted state
- [x] `Clear tags` removes all (disabled when empty)
- [x] `Done` button + click-away + `Esc` dismiss the picker
- [x] Search `Enter` toggles the first filtered match
- [x] Disabled categories already on the row remain visible/removable

### MT-004 — Trigger button reflects selection
**Priority**: Medium
- [x] Empty → `No Tag`
- [x] One → dot + name
- [x] Many → stacked dots + `N tags`
- [x] Accent border when at least one tag is set

### MT-005 — Multi-pill row display with overflow
**Priority**: High
- [x] Renders all assigned tags as pills (preview + read-only)
- [x] Shows first 2 pills then a `+N` overflow pill
- [x] `+N` pill `title` lists the hidden category names
- [x] Layout never overflows or pushes the sum badge off-row

### MT-006 — Settings "Category Summaries" unaffected
**Priority**: Low
- [x] Per-category visibility toggles continue to work with multi-tag rows
- [x] Deleting a category removes it from every row's `tagIds`
  (handled centrally via existing `deleteCalcTag`; rows resolve missing ids defensively)

---

## Verification

```bash
cd /Users/bti-002071/Documents/myNotes && npm run check
cd /Users/bti-002071/Documents/myNotes && npm run build
```

Manual:
- Open an existing note containing a calc box with single-tag rows → tags preserved.
- Assign 3 tags to a row → 3 memberships in breakdown, `+1` overflow pill shown.
- Toggle tags off via the picker; use `Clear tags`; confirm persistence after reload.
- Verify read-only rendering and the mobile bottom-sheet picker.

