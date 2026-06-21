# EPIC: MetricsBlock (Calculation Metrics) — UI/UX Polish

> **Component**: [MetricsBlock.svelte](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte) (2,167 lines)
> **Priority**: Medium-High
> **Estimated Scope**: 12 stories across 4 themes

---

## Reference Screenshots

````carousel
![Calculation block — rows with tag dropdown open, category summaries, and footer stats](/Volumes/SSD SN770/piyush/.gemini/antigravity/brain/4fa71239-58ae-438d-b4e4-202df607d3f8/media__1782028088937.jpg)
<!-- slide -->
![Calculation block — tag dropdown showing "No Tag" and "CC amzn", category summaries below](/Volumes/SSD SN770/piyush/.gemini/antigravity/brain/4fa71239-58ae-438d-b4e4-202df607d3f8/media__1782028088939.jpg)
<!-- slide -->
![Calculation block — settings popover with Options/Categories tabs, override inputs, statistics checkboxes](/Volumes/SSD SN770/piyush/.gemini/antigravity/brain/4fa71239-58ae-438d-b4e4-202df607d3f8/media__1782028088936.jpg)
````

---

## Issues Identified

### Theme A — Table Row Layout & Alignment

| # | Issue | Where Visible |
|---|---|---|
| A1 | **Row content truncation** — Long labels like "2026-06-18 in office wrap" get cut off when the tag dropdown + sum badge + delete button are all visible. No ellipsis or wrapping strategy. | Screenshot 3 (rows are clipped at ~220px) |
| A2 | **Checkbox is unstyled native HTML** — The `<input type="checkbox">` uses the browser default, which looks jarring against the dark theme. Should use a custom styled checkbox matching the app's design system. | All screenshots — square default checkboxes |
| A3 | **Drag handle ("⋮⋮") uses text characters** — Not a proper icon; renders inconsistently across OS/browsers. Should use an SVG grip icon. | Screenshot 1, left of checkboxes |
| A4 | **Tag pill in preview mode has inconsistent inline styles** — The `.metrics-row-tag-pill` uses raw inline styles with hardcoded opacity hex suffixes (`{color}1c`, `{color}44`) instead of CSS classes. Same pattern duplicated for edit vs readonly views (lines [1272-1274](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1272-L1274) and [1290-1293](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1290-L1293)). | All screenshots — "Swiggy", "Amazon fresh", "Zepto" pills |
| A5 | **Sum badge ("+219", "+1,451") has no currency symbol** — The badge shows raw `+206` but the block is configured with `₹` currency. Inconsistent with the footer which omits it too, but the savings panel uses it. | All screenshots — right side of rows |
| A6 | **Delete button (✕) uses text character** — Not an SVG icon; renders inconsistently. Also invisible by default and only appears on hover — on mobile/touch devices this is always shown via CSS override (line [1923](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1923)), but the override uses `!important`. | Screenshots — ✕ on right |
| A7 | **Row vertical alignment breaks with multi-line labels** — When a label wraps (e.g. "2026-06-19 Swiggy chulbul dhaba 219"), the tag pill + sum badge stay vertically centered but the checkbox and drag handle don't. `align-items: center` on the row doesn't handle wrapping well. | Screenshot 1 — first row wraps to 2 lines |

---

### Theme B — Category Summaries & Tag Dropdown

| # | Issue | Where Visible |
|---|---|---|
| B1 | **Category summary chips are stacked vertically, not chips** — Despite using `flex-wrap` ([line 1330](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1330)), each chip takes full width because the container is `flex-col` from the parent layout. They look like plain list rows instead of compact chips. The color dots are 6px — too small to distinguish. | Screenshots 1 & 2 — "● Amazon fresh: +206", "● Swiggy: +219" etc. |
| B2 | **Zero-value categories shown without visual distinction** — "Blinkit: 0" and "Instamart: 0" display identically to non-zero ones. No dimming, strikethrough, or indication that they're empty. | Screenshots 1 & 2 — "● Blinkit: 0", "● Instamart: 0" |
| B3 | **Category summary has no total row** — The summary shows per-tag breakdowns but no "Total" row summing all visible category totals. The user has to mentally add them. | All screenshots |
| B4 | **Tag dropdown overlaps content** — The dropdown menu ([line 1203-1237](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1203-L1237)) positions `absolute` from the tag button, but when the row is near the bottom of the `.metrics-card-body` (which has `max-height: 400px; overflow-y: auto`), the dropdown gets clipped by the scroll container. | Screenshot 1 — dropdown is partially cut off at bottom |
| B5 | **Tag dropdown has no search/filter** — With many categories, the user must scroll a tiny 200px list. No keyboard filtering. | Screenshot 1 — dropdown list |

---

### Theme C — Settings Popover Polish

| # | Issue | Where Visible |
|---|---|---|
| C1 | **Settings popover is entirely inline-styled** — Almost every element inside the settings dropdown uses raw `style=""` attributes instead of CSS classes. The tab header has inline borders/margins/padding ([line 678](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L678)), input fields duplicate the same inline style string 3 times ([lines 724, 738, 752](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L724)), and override labels have inline `font-size: 11px`. | Screenshot 3 — Options tab |
| C2 | **Checkboxes in settings are unstyled native inputs** — "Show Statistics" section checkboxes (Income, Inflows, Expenses, Savings, Min, Max, Median) use raw browser checkboxes. The "Show Category Summaries" section also uses them, but with blue checked style from the OS, clashing with the dark theme. | Screenshot 3 — unchecked = gray squares, checked = blue fills |
| C3 | **"Block Overrides" section labels have poor hierarchy** — "Income Label Override:", "Currency Symbol Override:", "Income Placeholder Override:" all look the same with no grouping or visual separation between them. Just stacked inputs with tiny labels. | Screenshot 3 — middle section |
| C4 | **Settings popover has no max-height constraint** — When all statistics and many categories are shown, the popover can extend beyond the viewport. No scrollable region for the options list. | Screenshot 3 — popover extends to bottom |
| C5 | **No close button or title in settings popover** — The settings dropdown has tab buttons but no header with title or explicit close button. User must click outside. | Screenshot 3 |

---

### Theme D — Statistics Footer & General

| # | Issue | Where Visible |
|---|---|---|
| D1 | **Footer stat badges ("COUNT", "NET TOTAL", "AVERAGE") use generic monospace** — `font-family: monospace` ([line 1809](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1809)) falls back to system monospace which is Courier on some OS. Should use `var(--font-mono)` consistently. | Screenshots 1 & 2 — bottom bar |
| D2 | **"+ Add Row" button lacks visual distinction** — It's just text with no background, no border, no icon background. Easily missed. Should look like a subtle CTA. | Screenshots 1 & 2 — below last row |
| D3 | **No separator between rows section and category summaries** — The category summary chips sit immediately below the rows with only a dashed border-top. Visually they blend together, especially since both use the same font-size. | Screenshots 1 & 2 |
| D4 | **Massive inline style usage throughout the component** — Over 40 instances of inline `style=""` in the template. Should be extracted to CSS classes for maintainability and consistency. Key offenders: tag total chips ([line 1335](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1335)), settings inputs, category items. | Throughout file |
| D5 | **Card header "📊" emoji icon** — Uses a raw emoji for the block icon ([line 650](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L650)). Renders differently across OS/browsers. Should use a consistent SVG icon like `BarChart3` from lucide. | Screenshot 3 — "📊 Daily Kharcha" |

---

## User Stories

### Story MB-001 — Custom Styled Checkboxes
**Priority**: High | **Theme**: A + C

Replace all native `<input type="checkbox">` elements with custom-styled toggle/checkbox controls matching the app's design system.

**Scope**:
- Row checkboxes (line [1135-1143](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1135-L1143))
- Settings "Exclude checked rows" checkbox (line [700-707](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L700-L707))
- All "Show Statistics" checkboxes (lines [759-842](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L759-L842))
- All "Show Category Summaries" checkboxes (lines [847-873](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L847-L873))
- Category "Active" toggle (line [1015-1024](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1015-L1024))

**Acceptance Criteria**:
- [ ] Custom checkbox renders as a rounded square with `var(--accent)` fill when checked
- [ ] Check mark uses SVG, not emoji or text
- [ ] Consistent appearance on macOS, Windows, Android
- [ ] Smooth transition on check/uncheck (0.15s)

---

### Story MB-002 — Replace Text Icons with SVGs
**Priority**: Medium | **Theme**: A

Replace text-character icons (drag handle `⋮⋮`, delete `✕`, dropdown chevron `▼`) with consistent SVG icons from lucide-svelte.

**Scope**:
- Drag handle at line [1134](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1134) → `GripVertical`
- Delete button at line [1314](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1314) → `X`
- Dropdown chevron at line [1188](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1188) → `ChevronDown`
- Header emoji at line [650](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L650) → `BarChart3`

**Acceptance Criteria**:
- [ ] All four icons replaced with lucide-svelte components
- [ ] Icons use `currentColor` and inherit parent color
- [ ] Consistent 12-14px sizing across all icons

---

### Story MB-003 — Extract Inline Styles to CSS Classes
**Priority**: High | **Theme**: D

Move all inline `style=""` attributes to proper CSS classes in the `<style>` block. This is the largest technical debt item.

**Key areas to extract**:
- Settings dropdown tab header (line [678](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L678))
- Settings override inputs (3 identical style strings at lines [724, 738, 752](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L724))
- Settings override labels (lines [716, 730, 744](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L716))
- Category manager items (line [918](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L918))
- Color picker button and popover (lines [932, 944](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L932))
- Tag total chips (line [1335](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1335))
- Tag pill (lines [1273, 1292](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1273))
- Category summary section container (line [1330](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1330))

**Acceptance Criteria**:
- [ ] Zero inline `style=""` on structural/layout elements
- [ ] Dynamic styles (colors from tag data) remain inline but minimal (only `background`, `border-color`, `color`)
- [ ] All spacing uses design tokens (`var(--spacing-*)`)
- [ ] No visual regression

---

### Story MB-004 — Category Summary Chip Redesign
**Priority**: High | **Theme**: B

Redesign the category summary section from a vertical list to a proper chip/pill layout with visual improvements.

**Scope**: Lines [1328-1345](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1328-L1345)

**Acceptance Criteria**:
- [ ] Chips flow horizontally with wrapping (actual chip layout, not full-width rows)
- [ ] Color dots are 8px (up from 6px) with a subtle glow matching the tag color
- [ ] Zero-value chips are dimmed (opacity: 0.5) with gray text instead of green/red
- [ ] Each chip has subtle background tint from the tag color (10% opacity)
- [ ] Clear visual separator (section label "Category Breakdown" + divider) between rows and summaries
- [ ] Optional: Add a total row at the bottom of the chip section

---

### Story MB-005 — Tag Dropdown Positioning Fix
**Priority**: High | **Theme**: B

Fix the tag picker dropdown being clipped by the scrollable `.metrics-card-body` container.

**Scope**: Lines [1166-1238](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1166-L1238)

**Acceptance Criteria**:
- [ ] Dropdown renders outside the scroll container (use `position: fixed` with calculated coordinates, or portal)
- [ ] Dropdown auto-flips above the button when near the bottom edge
- [ ] Dropdown dismisses on scroll of the parent container
- [ ] Dropdown stays positioned correctly when the page scrolls

---

### Story MB-006 — Settings Popover UX Improvements
**Priority**: Medium | **Theme**: C

Improve the settings popover with proper structure, scrolling, and a close button.

**Scope**: Lines [674-1058](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L674-L1058)

**Acceptance Criteria**:
- [ ] Add a small header bar with "⚙ Block Settings" title and an X close button
- [ ] Options tab content area is scrollable with `max-height: 320px`
- [ ] "Block Overrides" section has a card-like background with grouped inputs
- [ ] Override inputs have focus rings matching accent color
- [ ] Escape key closes the popover
- [ ] Popover has entry animation (fade + scale from top-right)

---

### Story MB-007 — Row Layout & Wrapping Improvements
**Priority**: Medium | **Theme**: A

Improve how rows handle long text, multi-line wrapping, and the relationship between label, tag pill, sum badge, and delete button.

**Scope**: Lines [1097-1317](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1097-L1317)

**Acceptance Criteria**:
- [ ] Label text truncates with ellipsis in preview mode (single line)
- [ ] Full text shown on hover tooltip or in edit mode
- [ ] Tag pill, sum badge, and delete button are flex-shrink: 0 and right-aligned as a group
- [ ] Checkbox and drag handle align to the top of the row when label wraps
- [ ] Row minimum height is 36px for consistent spacing

---

### Story MB-008 — "Add Row" Button Enhancement
**Priority**: Low | **Theme**: D

Make the "+ Add Row" button more visually prominent and consistent with the app's button design.

**Scope**: Lines [1320-1325](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1320-L1325) and CSS at [1739-1760](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1739-L1760)

**Acceptance Criteria**:
- [ ] Button has a dashed border and subtle background
- [ ] Plus icon uses SVG from lucide (`Plus`)
- [ ] Full-width within the card body
- [ ] Hover state changes border to solid with accent tint

---

### Story MB-009 — Footer Stats Bar Polish
**Priority**: Medium | **Theme**: D

Polish the statistics footer grid for better visual hierarchy and consistency.

**Scope**: Lines [1363-1423](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1363-L1423) and CSS at [1762-1823](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1762-L1823)

**Acceptance Criteria**:
- [ ] Use `var(--font-mono)` instead of raw `monospace`
- [ ] "Net Total" value shows currency symbol prefix
- [ ] Stat badges have subtle gradient background instead of flat color
- [ ] Labels use `var(--font-size-3xs)` from design tokens
- [ ] Grid gracefully handles 3, 5, or 7 visible stats without orphan columns

---

### Story MB-010 — Tag Dropdown Search/Filter
**Priority**: Low | **Theme**: B

Add a search input at the top of the tag picker dropdown for quick filtering when many categories exist.

**Scope**: Lines [1203-1237](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1203-L1237)

**Acceptance Criteria**:
- [ ] Search input appears at top of dropdown when > 5 categories exist
- [ ] Filters categories by name (case-insensitive)
- [ ] "No Tag" option is always visible
- [ ] Auto-focuses the search input on open
- [ ] Enter key selects the first matching category

---

### Story MB-011 — Design Token Migration
**Priority**: Medium | **Theme**: D

Replace all hardcoded values (colors, spacing, border-radius, shadows) with design tokens from the app's design system.

**Key hardcoded values to replace**:
- `rgba(0,0,0,0.25)` → `var(--bg-inset)` or appropriate token
- `rgba(255,255,255,0.02)`, `0.03`, `0.04`, `0.05`, `0.06`, `0.08` → `color-mix()` with tokens
- `#2a2d35` fallbacks → should rely on `var(--border-color)` without fallback (already defined globally)
- `#888` → `var(--text-tertiary)`
- `12px`, `8px`, `6px`, `4px` spacing → `var(--spacing-sm)`, `var(--spacing-xs)`, `var(--spacing-2xs)`, `var(--spacing-3xs)`
- `border-radius: 4px`, `6px`, `12px` → `var(--radius-sm)`, `var(--radius-standard)`, `var(--radius-lg)`

**Acceptance Criteria**:
- [ ] All spacing uses `--spacing-*` tokens
- [ ] All border-radius uses `--radius-*` tokens
- [ ] All colors reference CSS variables (no raw hex except tag-specific dynamic colors)
- [ ] Fallback values removed where the token is guaranteed to be defined

---

### Story MB-012 — Mobile Responsiveness Polish
**Priority**: Medium | **Theme**: D

Improve the mobile experience (< 600px breakpoint) for the MetricsBlock.

**Scope**: Lines [1903-1942](file:///Volumes/SSD%20SN770/piyush/Documents/notes%20app/myNotes/src/lib/components/MetricsBlock.svelte#L1903-L1942)

**Acceptance Criteria**:
- [ ] Settings popover renders as a bottom sheet on mobile instead of a dropdown
- [ ] Tag dropdown renders as a bottom sheet on mobile
- [ ] Category summary chips stack 2-per-row on mobile
- [ ] Stats grid uses 3 columns on mobile (not `auto-fit` which causes 2-column with orphan)
- [ ] Row drag handle has larger touch target (44px minimum)
- [ ] Delete button always visible on mobile (already done but needs `!important` removed)
- [ ] Savings panel text sizes scale down proportionally

---

## Implementation Priority Order

| Phase | Stories | Rationale |
|---|---|---|
| **Phase 1 — Foundation** | MB-003 (Inline styles), MB-011 (Design tokens) | Must be done first to avoid conflicts with subsequent UI changes |
| **Phase 2 — Core Visual** | MB-001 (Checkboxes), MB-002 (Icons), MB-004 (Category chips) | Highest visual impact |
| **Phase 3 — Interaction** | MB-005 (Dropdown fix), MB-006 (Settings popover), MB-007 (Row layout) | Fixes functional issues |
| **Phase 4 — Polish** | MB-008 (Add Row), MB-009 (Footer stats), MB-010 (Dropdown search), MB-012 (Mobile) | Final polish layer |

---

## Verification

```bash
cd "/Volumes/SSD SN770/piyush/Documents/notes app/myNotes" && npm run check
cd "/Volumes/SSD SN770/piyush/Documents/notes app/myNotes" && npm run build
```

Manual verification:
- Test each story in both edit and read-only modes
- Test on mobile viewport (< 600px)
- Verify no visual regressions in dark/light themes
- Verify drag-and-drop still works after row layout changes
