# Epic Suite: Standalone Android Expense Auto-Tracker — "CalBox Money"

> Product & Engineering Specification — **new, standalone native Android app**
> Status: **Detailed Planning**
> Platform: **Kotlin + Jetpack Compose (Material 3)** · Distribution: **Personal / sideload**
> Relationship to myNotes web app: **fully independent** — no shared code, storage, or backend.
> Currency baseline: **INR (₹)**, India-first SMS/UPI ecosystem.

---

## 0. How to read this document

This is written **story-wise and epic-wise**. It is organized as:

1. **Vision, personas, principles** — the "why".
2. **Epic Map** — 9 epics (E0–E8), each a shippable slice.
3. **Per-epic detail** — every epic has: *Goal · User Stories (with acceptance criteria) · Technical tasks · Edge cases*.
4. **Deep-dive: Bank/Statement reconciliation** — answering "is this possible?" honestly.
5. **Improvised feature suggestions** — new ideas beyond your original 5.
6. **Cross-cutting**: data model, parser strategy, roadmap, risks, success metrics.

User stories use the format **`US-<epic>.<n>`** with Gherkin-style acceptance criteria so they can be
lifted straight into a tracker or sprint board.

---

## 1. Vision

> "My phone already knows I spent ₹450 at Swiggy — so the app **just adds it**. My budget and savings
> already updated. Later, whenever I feel like it, I flick through a stack of cards and, on the ones I
> care about, tweak the tag or add a note. The transaction was never waiting on me."

CalBox Money turns the myNotes **Calculation Box + Budget** concept (rows of amounts → income − spend =
savings, per-category tags, per-tag budgets) into an **autonomous, native** money tracker that *captures*
spend from device signals, *understands* it (vendor + place-type), **records it immediately**, and *then*
offers an optional, low-friction way to enrich it (better tag / description).

### 1.1 Interaction model — CRITICAL (auto-add, then enrich)

This app is **not** an "approve each transaction" app. The distinction is core to the whole design:

| | Approval model (❌ NOT this) | **Auto-add + enrich model (✅ THIS APP)** |
| --- | --- | --- |
| When does a txn count? | Only after the user confirms it. | **Immediately on capture** — before any human touch. |
| Budget/savings update | After confirmation. | **The moment the SMS/push is parsed.** |
| What is the swipe card for? | Letting the transaction "in". | **Editing** an already-live transaction: change tag, add description. |
| What does swiping do? | Accept/reject a pending item. | **Saves your edit** and marks the card reviewed — the txn already existed and already counted. |
| If the user never opens the app? | Nothing gets tracked. | **Everything is still fully tracked**; cards just remain "un-enriched". |

So: **the machine owns creation; the human optionally owns refinement.** The Tinder-style stack is an
*enrichment/editing* surface sitting on top of transactions that are already real and already in the budget.

### 1.2 Design pillars
- **Auto-add, never gate.** A parsed txn is created and counted instantly; user action is *never* required for it to exist.
- **Enrich, don't approve.** The swipe stack edits description/tags on live txns; it does not decide whether they count.
- **Swipe = commit an edit.** Left/right save the (possibly auto-suggested) values and mark reviewed — with undo.
- **Ask once, learn forever.** Every edit becomes a rule that auto-applies retroactively and forward.
- **On-device & private.** No transaction data leaves the phone in Phases 0–4.
- **Confidence, not certainty.** Low-confidence guesses are surfaced first for enrichment, but still counted meanwhile.

---

## 2. Personas

| Persona | Description | Primary need |
| --- | --- | --- |
| **Piyush — the optimizer** | Power user, many UPI txns/day, wants precise category budgets & savings rate. | Automation + accuracy + analytics |
| **Aarti — the avoider** | Hates manual trackers, abandons them in a week. | Effortless capture, gentle nudges |
| **Rohan — the privacy hawk** | Won't use apps that upload SMS. | Provable on-device processing |
| **Future: Play-Store user** | Can't grant SMS permission. | Notification-only capture mode |

---

## 3. Epic Map

| Epic | Name | One-line outcome | Depends on |
| --- | --- | --- | --- |
| **E0** | Foundation & Native CalBox | A working local budget app (manual entry) — the "money model" proven. | — |
| **E1** | Onboarding & Permissions | User grants SMS/notification access with trust, or opts into manual mode. | E0 |
| **E2** | SMS Ingestion & Parsing | Every bank/UPI SMS becomes a structured transaction. | E1 |
| **E3** | Vendor & Category Engine | Auto-tag by vendor; auto-create/merge tags; place-type classification. | E2 |
| **E4** | Notifications & Inline Capture | New-entry notification with reply-to-describe. | E2, E3 |
| **E5** | Swipe Stack ("Tinder for txns") | Fast card-stack to **enrich** (tag + description) already-counted txns. | E3 |
| **E6** | Budget, Savings & Insights | Dashboards, budgets, savings rate, trends. | E3 |
| **E7** | Notification-Listener & Advanced Capture | Bank push capture + optional accessibility scraping. | E2 |
| **E8** | Import & Reconciliation | Email/PDF/CSV statement import & matching (the "bank data" answer). | E3, E6 |

---

## 4. Epic Details

### E0 — Foundation & Native CalBox
**Goal:** Ship a fully local budgeting app with manual entry so the money math (income − spend = savings,
per-category tags & budgets) is correct *before* automation is layered on.

**User stories**
- **US-0.1** — *As a user, I want to add an expense manually so I can track spend even without automation.*
  - **Given** the app is open, **when** I tap "＋ Add expense" and enter amount, category, date, note,
    **then** it is saved and appears in the current month's list and totals.
- **US-0.2** — *As a user, I want to define categories (tags) with color, icon and a monthly budget.*
  - **Given** the Categories screen, **when** I create "Food" with ₹8,000 budget, **then** it's usable on any transaction and shows a budget bar.
- **US-0.3** — *As a user, I want to set my monthly income so savings = income − spend is shown.*
  - **Given** income = ₹90,000 and spend = ₹52,000, **then** the dashboard shows savings ₹38,000 and a savings rate of ~42%.
- **US-0.4** — *As a user, I want my data to persist offline across restarts.*
  - **Given** I force-close and reopen, **then** all transactions/categories/budgets remain.

**Technical tasks:** Kotlin/Compose project, Hilt DI, Room schema (see §6), Material 3 theme (light/dark),
navigation graph (Dashboard · Transactions · Categories · Inbox · Settings), money type as `amountMinor:Long`.

**Edge cases:** negative/zero amounts, currency formatting, month boundaries, timezone of `occurredAt`.

---

### E1 — Onboarding & Permissions
**Goal:** Earn permission grants by explaining *why* each is needed, with a graceful manual-only fallback.

**User stories**
- **US-1.1** — *As a privacy-conscious user, I want to understand exactly what the app reads before I grant SMS access.*
  - **Given** the SMS step, **then** I see plain-language copy: "We read only bank/UPI SMS, on your device, and never upload them," with a "Why?" expander and a "Skip — I'll add manually" option.
- **US-1.2** — *As a user, I want to grant notification-posting permission so I get new-entry alerts (Android 13+).*
  - **Given** Android 13+, **when** I proceed, **then** the `POST_NOTIFICATIONS` prompt appears; if denied, capture still works and items land silently in the inbox.
- **US-1.3** — *As a user, I want to optionally enable bank-push capture via the notification-listener special-access screen.*
  - **Given** I tap "Enable push capture", **then** I'm deep-linked to the system listener settings and returned to a confirmation state.
- **US-1.4** — *As a returning user, I want capture to keep working after reboot.*
  - **Given** the device reboots, **then** receivers/services re-arm (`RECEIVE_BOOT_COMPLETED`) without me reopening the app.

**Technical tasks:** onboarding flow (Compose pager), runtime permission handling, foreground-service
notification channel, boot receiver, a "Permissions health" screen showing what's granted/degraded.

**Edge cases:** partial grants, OEM battery-killers (Xiaomi/Oppo) killing services → show OEM-specific
"allow autostart" guidance.

---

### E2 — SMS Ingestion & Parsing
**Goal:** Convert raw bank/UPI SMS into structured transactions with high recall; never silently drop an unknown.

**User stories**
- **US-2.1** — *As a user, when my bank texts me about a debit, I want it captured and counted automatically — no confirmation needed.*
  - **Given** an incoming SMS "Rs.450.00 debited...VPA swiggy@hdfcbank...", **when** received, **then** a transaction (amount 450, DEBIT, vendor "swiggy", date parsed) is created as **CONFIRMED** and **immediately included in budget/savings**, with `reviewed=false` so it can later be enriched.
- **US-2.2** — *As a new user, I want my last 90 days of SMS scanned so I start with history, not a blank app.*
  - **Given** I grant SMS access, **when** onboarding finishes, **then** a one-time backfill parses historical bank SMS and populates transactions (deduped), all already counted.
- **US-2.3** — *As a user, I don't want OTPs, promos, or delivery texts treated as expenses.*
  - **Given** a promotional/OTP SMS, **then** it is classified non-financial and ignored (with a debuggable log).
- **US-2.4** — *As a user, when a bank uses a format the app can't confidently parse, I still don't want to lose it.*
  - **Given** an unparseable-but-likely-financial SMS where even the amount is uncertain, **then** it is created as `NEEDS_INPUT` (surfaced at the top of the stack) rather than silently dropped. **This is the only case where a txn isn't auto-counted** — because the amount itself is unknown. If the amount *is* extractable, the txn is auto-counted even when the category is unknown.
- **US-2.5** — *As a user, I don't want the same spend counted twice.*
  - **Given** both an SMS and a push notification for one txn, **then** dedup (amount + vendor + ±90s window) keeps a single record.

**Technical tasks:** `SmsReceiver : BroadcastReceiver`, `ContentResolver` backfill, a **sender-keyed regex
rule library** (e.g. `*-HDFCBK`, `*-SBIINB`, `*-ICICIT`), amount/direction/vendor/date/balance extractors,
non-financial classifier (keyword + structure), dedup service, WorkManager reprocess queue.

**Edge cases:** multi-currency SMS, reversals/refunds (CREDIT), partial/auth-hold messages, decimal &
thousands separators, Hindi/Hinglish templates, split SMS (multipart), amount ranges ("Rs.1,00,000").

---

### E3 — Vendor & Category Engine
**Goal:** Deliver requests #2 and #3 — map vendor→tag (auto-create/merge) and generalize place-type.

**User stories**
- **US-3.1** — *As a user, I want all spend from the same vendor to share one category automatically.*
  - **Given** I set "swiggy" → Food once, **then** every past and future "swiggy" txn becomes Food (a persisted `VENDOR` rule applied retroactively).
- **US-3.2** — *As a user, when a brand-new vendor appears, I want it auto-tagged with a best guess (or "Uncategorized") — never blocked.*
  - **Given** an unseen vendor, **then** the engine assigns the best dictionary match (with confidence) or falls back to an "Uncategorized" category; either way the txn is **already counted**, and the card is surfaced for optional enrichment — it is never held back waiting for a decision.
- **US-3.3** — *As a user, I want to merge several vendor spellings/aliases into one vendor/tag.*
  - **Given** "SWIGGY", "Swiggy Instamart", "BUNDL TECH" all being Swiggy, **when** I multi-select and "Merge", **then** they unify (`mergedIntoVendorId`) and share history & category.
- **US-3.4** — *As a user, I want the app to generalize where I spent (restaurant / online shopping / fuel / transport).*
  - **Given** a vendor, **then** a place-type category is inferred via (1) keyword dictionary, (2) MCC code if present, (3) optional on-device ML — each contributing a confidence score, best match wins.
- **US-3.5** — *As a user, I want my corrections to make the classifier smarter over time.*
  - **Given** I re-categorize a vendor, **then** the correction is stored and future similar vendors are nudged toward that category.

**Technical tasks:** vendor normalizer (strip UPI handles/ref-ids/casing), `VendorCategoryRule`
(VENDOR/KEYWORD/MCC/REGEX + priority), curated **built-in merchant dictionary** (Swiggy/Zomato→Food,
Amazon/Flipkart/Myntra→Online Shopping, HPCL/IOCL→Fuel, Uber/Ola→Transport, Jio/Airtel→Bills…), ISO-18245
MCC table, retro-apply engine, merge UI, correction store feeding a (later) TFLite/ML Kit classifier.

**Edge cases:** vendor collisions (same string, different real merchant), marketplace passthroughs
(Razorpay/PayU/BharatPe intermediaries hiding the real vendor), one txn spanning two categories (split).

---

### E4 — Notifications & Inline Capture
**Goal:** Deliver request #4 — notify on new entry with a frictionless way to add a description.

**Goal:** Deliver request #4 — notify that an expense was **already recorded**, with a fast way to enrich it.
The notification is informational + an edit shortcut; it is **never** an approve/reject prompt.

**User stories**
- **US-4.1** — *As a user, I want a notification the moment a new expense is captured — telling me it's already tracked.*
  - **Given** a new confirmed txn, **then** a notification "Added: ₹450 · Swiggy · Food (tap to edit)" appears; the txn is **already in my budget** whether or not I interact.
- **US-4.2** — *As a user, I want to add a description straight from the notification without opening the app.*
  - **Given** the notification, **when** I use the "Add note" **RemoteInput** reply and type "team lunch", **then** it's saved to the (already-recorded) txn instantly and the card is marked reviewed.
- **US-4.3** — *As a user, I want quick actions to refine or correct the guess from the shade.*
  - **Given** the notification, **then** actions "Change category" and "Not an expense" edit the record (the latter sets status `IGNORED`, removing it from the budget) without opening the app.
- **US-4.4** — *As a user, I want to batch quiet items so I'm not spammed.*
  - **Given** many txns in a short window, **then** they can group into a summary notification ("6 new expenses added · tap to enrich"), respecting a user "quiet hours" setting.

**Technical tasks:** `NotificationCompat` + `RemoteInput`, `NotificationActionReceiver`, per-txn vs grouped
channels, quiet-hours & throttling settings, deep-links into the swipe inbox.

**Edge cases:** notification permission denied, RemoteInput on locked screen, action idempotency.

---

### E5 — Swipe Stack ("Tinder for transactions" — enrichment, not approval)
**Goal:** Deliver request #5 — a delightful place to **edit description & tags on already-recorded
transactions**. Every card represents a txn that **already exists and already counts**; the stack only
refines it. Nothing here decides whether a txn is included in the budget.

**User stories**
- **US-5.1** — *As a user, I want a swipeable stack of my recent transactions so I can enrich the ones I care about.*
  - **Given** captured txns (default filter: `reviewed=false`, most-uncertain first), **then** the stack shows one card at a time (amount, vendor, auto-tag + confidence chip, date, editable description field, raw SMS snippet). **All of them are already in my budget.**
- **US-5.2** — *As a user, I want to update the description and tag right on the card, then swipe to save.*
  - **Given** a card, **when** I edit the description and/or change the tag inline, **then** **swipe left = save my edits and mark reviewed** (advance to next). **Swipe right = keep the auto-suggested values as-is and mark reviewed.** Either way the txn stays counted; only its tag/description/reviewed-flag change.
- **US-5.3** — *As a user, I want tag changes here to teach the app.*
  - **Given** I retag a card's vendor, **then** a `VENDOR` rule is saved and applied retroactively to that vendor's other txns (§E3), so I don't have to fix each one.
- **US-5.4** — *As a user, I want to undo an accidental swipe.*
  - **Given** I mis-swipe, **then** a 5-second "Undo" snackbar restores the card and reverts the reviewed flag / edit.
- **US-5.5** — *As a user, I want to split one transaction across categories from the card.*
  - **Given** a ₹2,000 supermarket txn, **when** I split ₹1,500 Groceries / ₹500 Household, **then** the split children replace the parent in category budgets (parent total unchanged).
- **US-5.6** — *As a user, I want reaching the end of the stack to feel done, without implying anything was "pending".*
  - **Given** I clear the stack, **then** an empty state shows this month's savings & top category and says "all caught up" — reflecting that tracking never depended on me.
- **US-5.7** — *As a user, I want to re-open and edit a transaction even after it's reviewed.*
  - **Given** the Transactions list, **when** I tap any txn (reviewed or not), **then** I can re-edit tag/description; the swipe stack is just the fast path, not the only path.

**Gesture map (enrichment semantics):**
`swipe left` = **save edits + mark reviewed** · `swipe right` = **accept auto values + mark reviewed** ·
`swipe up` = category picker (assign/merge/create) · `tap` = expand (edit amount, split, full note).
*(No gesture ever means "reject/exclude" — to exclude a mis-captured item, use "Not an expense", which sets status `IGNORED`.)*

**Technical tasks:** Compose card-stack with drag/fling physics, inline editable description + tag chip,
gesture→**persisted edit** mapping (not gating), retro-rule trigger on retag, undo buffer, split editor,
empty-state; a "reviewed" filter toggle so the stack can also show already-reviewed cards on demand.

**Edge cases:** editing a txn that a later import reconciles, huge backlog (virtualize), rapid swiping
race conditions, accessibility buttons mirroring every gesture.

---

### E6 — Budget, Savings & Insights
**Goal:** The native "CalBox" analytics layer — budgets, savings, trends.

**User stories**
- **US-6.1** — *As a user, I want per-category budget bars showing spent vs limit.*
- **US-6.2** — *As a user, I want my savings and savings-rate for the month, updating live.*
- **US-6.3** — *As a user, I want to switch months and compare.*
- **US-6.4** — *As a user, I want to be warned before I blow a budget.*
  - **Given** Food is at 90% mid-month, **then** I get a proactive "pace" alert.
- **US-6.5** — *As a user, I want an untagged/needs-review bucket so nothing is silently excluded.*

**Technical tasks:** reactive aggregation (Flow) → dashboard, budget-period cache, trend charts,
pace/forecast (spend-so-far vs days-elapsed), CSV/JSON export.

**Edge cases:** refunds reducing spend, mid-month budget changes, months with no income set.

---

### E7 — Notification-Listener & Advanced Capture
**Goal:** Widen capture beyond SMS (some banks only push in-app) and offer an opt-in power mode.

**User stories**
- **US-7.1** — *As a user whose bank sends push not SMS, I want those captured too.*
  - **Given** listener access + whitelisted bank packages, **then** push notifications are parsed like SMS (shared parser).
- **US-7.2** — *As a power user, I want optional accessibility-based capture for apps that neither text nor push cleanly.*
  - **Given** explicit, risk-acknowledged opt-in, **then** an Accessibility service reads payment-confirmation screens; **off by default**, with clear battery/risk warnings.

**Technical tasks:** `NotificationListenerService` with package whitelist, unify into the parser pipeline,
optional `AccessibilityService` (Phase 4, gated), dedup across all sources.

**Edge cases:** notification text lacking amount, listener revoked by system, battery-optimization kills.

---

### E8 — Import & Reconciliation (the "bank data" epic)
**Goal:** Give a *truthful* source of record by importing statements and reconciling against captured txns.
See the honest feasibility analysis in **§5**.

**User stories**
- **US-8.1** — *As a user, I want to import a bank statement PDF/CSV so my history is complete and accurate.*
  - **Given** I share a statement PDF (or CSV/OFX from net-banking), **then** it's parsed into transactions and deduped against SMS-captured ones.
- **US-8.2** — *As a user, I want the app to reconcile captured vs statement and flag mismatches.*
  - **Given** an import, **then** the app shows "matched", "in statement but not captured", "captured but not in statement" so I can trust the numbers.
- **US-8.3** — *As a user, I want to forward bank statement emails and have them auto-imported.*
  - **Given** I set up email import (see §5 for options), **then** e-statements are parsed on a schedule.

**Technical tasks:** PDF text extraction (password-protected statements need the user's PDF password),
CSV/OFX/QIF parsers, a matching engine (amount + date-window + vendor fuzzy), reconciliation report UI.

---

## 5. Deep-Dive: Is "Real bank / statement API reconciliation" possible?

**Short answer: partially — not via a live bank API for a personal sideload app, but yes via statement import, and yes-in-theory via India's Account Aggregator only if you become a regulated business.**

### 5.1 Option A — Live bank APIs directly (❌ not feasible for this app)
Banks do **not** expose public per-user transaction APIs. "Open banking" in India is delivered through the
RBI **Account Aggregator (AA)** framework, not direct bank APIs.

### 5.2 Option B — Account Aggregator framework (⚠️ only as a licensed business)
- AA gives **consented, real-time, verified** bank/financial data — exactly what you'd want.
- **But** data is only delivered to a **Financial Information User (FIU)**, which must be an RBI-recognized
  regulated entity, onboarded via an AA (Finvu, OneMoney, CAMS, NADL, Anumati…) or a TSP/sandbox
  (Setu, Finbox, etc.). This needs company KYC, contracts, and compliance.
- **Verdict:** *Technically the gold standard, practically out of reach for a personal sideloaded app.*
  Keep it as a **"someday, if this becomes a registered product"** path. Architect the import layer so an
  AA data source could plug in later behind the same `TransactionSource` interface.

### 5.3 Option C — Statement import (✅ feasible now, recommended)
- **PDF e-statements:** parse text; handle password-protected PDFs (ask user for the statement password locally).
- **CSV / Excel / OFX / QIF:** most net-banking portals export these — clean, structured, easy to parse.
- **Fully on-device, no regulatory burden.** This is the realistic "reconciliation" answer → **Epic E8**.

### 5.4 Option D — Email statement scraping (⚠️ feasible with caveats)
- **On-device Gmail app notification/attachment access** is fragile.
- **Gmail API (OAuth, read-only)** works but (a) needs a Google Cloud project + OAuth consent screen and
  (b) sensitive-scope verification for public distribution — acceptable for a **personal** app using your own
  test users. Parses e-statement emails/attachments server-lessly on device.
- **Verdict:** viable for a personal build; document the OAuth setup.

### 5.5 Recommendation
Ship **C (statement import) + reconciliation** as the trustworthy source-of-record in E8. Treat **B (AA)**
as a future pluggable source. This gives you real reconciliation *without* pretending a personal app can hit
live bank APIs.

---

## 6. Data Model (Room) — expanded

```kotlin
Transaction(
  id, amountMinor:Long, currency, direction:{DEBIT,CREDIT,REFUND},
  source:{SMS,NOTIFICATION,MANUAL,IMPORT,ACCESSIBILITY}, rawText, rawSender,
  occurredAt, capturedAt, vendorId?, categoryId?, description?, tagsExtra:List<String>,
  // status: CONFIRMED is the DEFAULT for any parsed txn — it is counted immediately.
  // NEEDS_INPUT only when the amount itself couldn't be parsed. IGNORED = user marked "not an expense".
  status:{CONFIRMED,NEEDS_INPUT,IGNORED,DUPLICATE},
  reviewed:Bool,          // false = not yet enriched via swipe stack; does NOT affect budget inclusion
  countedInBudget:Bool,   // true for CONFIRMED (and split children); independent of `reviewed`
  confidence:Float, reconciled:Bool, importBatchId?, splitParentId?
)
Vendor(id, displayName, normalizedName, categoryId?, aliases:List<String>, mergedIntoVendorId?, logoRef?)
Category(id, name, color, icon, kind:{PLACE_TYPE,CUSTOM}, isSystem:Bool, monthlyBudgetMinor:Long?, archived:Bool)
VendorCategoryRule(id, matchType:{VENDOR,KEYWORD,MCC,REGEX}, pattern, categoryId, priority, source:{USER,BUILTIN,ML})
ParserRule(id, senderPattern, regex, fieldMap, bankName, enabled, version)     // updatable SMS templates
IncomeEntry(id, monthKey, amountMinor, label, source)
BudgetPeriod(id, categoryId, periodStart, limitMinor, spentMinorCache)
ImportBatch(id, source, fileName, importedAt, matched, unmatched)
Correction(id, txnId, fromCategoryId, toCategoryId, vendorNormalized, createdAt)  // trains classifier
```

---

## 7. Parser Strategy (SMS/push) — layered

1. **Sender routing** — map sender ID (`AD-HDFCBK`, `VM-SBIUPI`…) → bank profile.
2. **Template regex** (`ParserRule`, versioned & updatable) — extract amount, direction, vendor/VPA, date, balance, ref.
3. **Heuristic fallback** — generic amount/keyword extraction. If an amount is found → auto-counted `CONFIRMED` with low confidence; only if the amount itself is unknown → `NEEDS_INPUT`.
4. **Non-financial filter** — OTP/promo/delivery detection to avoid noise.
5. **Dedup** — cross-source key (amount + vendor + ±90s).
6. **Confidence scoring** — feeds inbox prioritization.

Ruleset shipped as an on-device JSON asset so new bank formats can be added without a full app rebuild.

---

## 8. Improvised / Suggested New Features (beyond your original 5)

> You asked me to improvise. These are ranked by value-to-effort. Pick what resonates.

**High value**
1. **Recurring & subscription detection** — auto-spot Netflix/rent/EMI patterns; alert on price hikes or a missed/duplicate charge.
2. **Refund & reversal matching** — link a CREDIT refund back to its original DEBIT so budgets self-correct.
3. **"Safe-to-spend" number** — like a neobank: income − committed bills − budget targets = what's truly free today.
4. **Split-transaction & shared expenses** — split one txn across categories or across people (settle-up later).
5. **Smart budget suggestions** — propose category budgets from the user's own 3-month averages.
6. **Reconciliation confidence badge** — dashboard shows "92% of spend verified against statements" to build trust.

**Medium value**
7. **Merchant enrichment** — local logo/brand pack so cards show a Swiggy logo, not "BUNDL TECH PVT".
8. **Natural-language quick add** — type "450 lunch swiggy" → parsed into a full txn.
9. **Weekly/'​monthly wrapped' digest** — a shareable, Spotify-Wrapped-style spend recap notification.
10. **Cash mode** — quick cash-spend logging with a running "cash wallet" balance.
11. **Home-screen widgets & Quick Settings tile** — today's spend / add-expense shortcut / inbox count.
12. **Geo-tagging (optional)** — attach coarse location to a txn to help disambiguate vendors.
13. **Goals & sinking funds** — "Save ₹50k for trip"; route surplus savings toward goals.

**Nice-to-have / delight**
14. **Anomaly alerts** — "You spent 3× your usual on Food this week."
15. **Bill-due radar** — from recurring detection, warn before autopay hits with low balance risk.
16. **Multi-account view** — tag txns by which bank/card, see per-account spend (from SMS sender).
17. **Biometric lock & encrypted DB (SQLCipher)** — protect sensitive financial data at rest.
18. **Export to the myNotes web CalBox format** — optional bridge so power users can pull data into a note (one-way, user-initiated) — the *only* touchpoint with the web app, and still no shared code.
19. **On-device LLM categorization (future)** — small quantized model for messy vendor strings.
20. **Voice add & Google Assistant intent** — "Hey add 200 rupees auto to transport."

---

## 9. Roadmap (phased, story-mapped)

| Phase | Epics | Outcome |
| --- | --- | --- |
| **P0** | E0 | Local manual budget app (money model correct). |
| **P1** | E1, E2 | Automatic SMS capture into a review pipeline. |
| **P2** | E3, E5 | Auto-categorization + swipe inbox (the core magic). |
| **P3** | E4, E6 | Notifications + budgets/savings/insights. |
| **P4** | E7 | Push-notification capture; optional accessibility mode. |
| **P5** | E8 | Statement import + reconciliation (trust layer). |
| **P6** | §8 picks | Recurring detection, safe-to-spend, widgets, goals, encryption… |

---

## 10. Cross-Cutting Concerns

- **Security:** SQLCipher-encrypted Room + biometric app lock (P6); no analytics SDKs; no network in P0–P4.
- **Testing:** a **corpus of anonymized bank SMS** as parser fixtures; golden-file tests per bank template; property tests for amount parsing.
- **Observability (local only):** an in-app "Parser debug" screen showing why an SMS was ignored/parsed.
- **Extensibility:** a `TransactionSource` interface (SMS, Notification, Import, future-AA) so sources are pluggable.
- **Battery:** prefer BroadcastReceiver/WorkManager over Accessibility; batch processing.
- **OEM survival:** autostart/battery-whitelist guidance for Xiaomi/Oppo/Vivo/Samsung.

---

## 11. Success Metrics
- **Capture rate:** % of real spend auto-captured (target ≥ 90% for SMS-enabled banks).
- **Auto-categorization accuracy:** % correct before user correction (target ≥ 80% after 2 weeks of learning).
- **Time-to-enrich:** median seconds to swipe through a day's cards (target < 30s) — noting tracking is complete even at zero enrichment.
- **Retention:** Aarti-persona still using it after 30 days.
- **Reconciliation coverage:** % of monthly spend verified against imported statements.

---

## 12. Explicit Non-Goals
- iOS (platform forbids SMS reading).
- Live direct bank APIs (don't exist for consumers) / becoming a regulated AA FIU.
- Cloud sync / multi-device in early phases (local-only).
- Reusing any myNotes web code, storage, or backend.
- Multi-currency FX conversion (single-currency first).
