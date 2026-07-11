# Concept: Repeating tasks (recurring reminders)

Status: reviewed (3 adversarial sub-agent passes), revision 3
Date: 2026-06-11

## Goal

Let an item repeat on a schedule — the primary use case being a recurring
reminder ("daily reminder to take meds", "trash every Tuesday", "pay rent on
the 1st"). When an occurrence comes due, the item:

1. fires a notification through the existing reminder pipeline (push, email
   fallback), and
2. reactivates: `checked` flips back to `false` and the item returns to the
   todo column, so a chore checked off last week pops back into the list.

## Non-goals (explicit, to keep KISS)

- **Completion-relative repetition** ("3 days after I last watered the
  plants"). Not expressible in RRULE, conflicts with the fixed-schedule model.
  Out of scope; revisit only on real demand.
- **Per-occurrence rows / history.** One item row cycles in place. The
  activity log already records who checked what and when.
- **Full RRULE support** (BYSETPOS, COUNT, UNTIL, EXDATE, …). We implement a
  strict, forward-compatible subset — see "RRULE compatibility".
- **A recurrence-rule builder UI.** The repeat option is one `<select>` in
  the existing ReminderPicker.

## Deployment assumption

The sweep runs in a **single process** (the in-process `running` guard in
`reminder-sweep.ts` serializes ticks). The self-heal step below relies on
this. If the server is ever scaled to multiple processes, the self-heal must
be age-gated (only re-arm rows stale for > a few sweep intervals, which needs
a claimed-at timestamp). Stated here so the constraint is explicit rather
than implicit.

## Data model

One new nullable `jsonb` column on `items` (Drizzle `.$type<RepeatRule>()`,
same pattern as `lists.columns` / `polls.options`):

```ts
// packages/shared/src/types.ts
export interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly';
  /** every N days/weeks/months; 1–365 */
  interval: number;
  /** weekly only — RRULE weekday tokens, e.g. ['MO','TH'] */
  byWeekday?: ('MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU')[];
  /** monthly only — 1–31 */
  byMonthDay?: number;
  /** IANA zone captured from the browser when the rule is set,
   *  e.g. 'Europe/Berlin'. Maps to RRULE TZID. */
  tz: string;
  /** ISO instant of the first occurrence — RRULE DTSTART. Set by the
   *  SERVER, never sent by the client, never mutated by the sweep. Changes
   *  ONLY when the rule is first created or when a PATCH explicitly sets
   *  remindAt (see API rules — re-stamping on unrelated PATCHes would leak
   *  retry/DST-shifted timestamps into the series). Sole source of the
   *  series' wall-clock time-of-day and interval>1 phase. */
  anchor: string;
}

export interface Item {
  // ...existing fields...
  repeat: RepeatRule | null;
}
```

`remindAt` keeps its existing meaning and doubles as **"next due fire"** for
repeating items. No second timestamp column. Invariant: `repeat != null`
implies `remindAt != null` (enforced at the API layer; self-healed by the
sweep). One discipline rule: `remind_at` must only ever be written from JS
`Date` values (ms precision), never from SQL `now()`/`DEFAULT` — the column
is µs-precision timestamptz, and a µs-resolution value would break the
millisecond-equality occurrence check in the sweep. All current writers
already comply.

**Why a stored `anchor` is load-bearing (review finding):** an earlier draft
derived time-of-day and phase from the `remindAt` being fired. That value is
mutable — the transient-failure retry path rewrites it to `now + 60–120s`
jitter, a crash between claim and re-arm nulls it, and a DST-gap shift
rewrites it — so a daily 09:00 reminder would drift to 09:01:37 forever
after one failed push, a biweekly series could flip phase after a catch-up
retry, and a crashed row couldn't be healed at all. Anchoring on an
immutable DTSTART (exactly what RFC 5545 requires) fixes all four failure
modes with one field.

Why `jsonb` and not an RRULE string column: zod validates the structure
precisely (a string needs a parser to validate), the sweep consumes it
without parsing, and serializing the subset _to_ RRULE text later is a
~10-line pure function. Why not separate columns: the fields are only ever
read together.

### Migration

Hand-written SQL, matching how migrations `0013`–`0016` were done in this
repo (no `drizzle-kit generate` — the `meta/` snapshots stop at 0012):

1. `packages/server/drizzle/0017_items_repeat.sql`:
   `ALTER TABLE items ADD COLUMN repeat jsonb;`
2. Hand-add the `0017` entry to `drizzle/meta/_journal.json` (same pattern
   as 0013–0016; tests apply migrations via `migrate()` reading the journal,
   so a missing entry breaks every server test).

No backfill; existing one-shot reminders are untouched (`repeat IS NULL` ⇒
exact current behavior).

## RRULE compatibility

The stored model maps **losslessly** onto RFC 5545 — `anchor`+`tz` are
DTSTART;TZID, the rest is the RRULE line, using RRULE's own vocabulary:

| RepeatRule                                              | iCalendar                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `{freq:'daily', interval:2, tz, anchor}`                | `DTSTART;TZID=<tz>:<anchor as local time>` + `RRULE:FREQ=DAILY;INTERVAL=2` |
| `{freq:'weekly', interval:1, byWeekday:['MO','TH'], …}` | `RRULE:FREQ=WEEKLY;BYDAY=MO,TH`                                            |
| `{freq:'monthly', interval:1, byMonthDay:31, …}`        | `RRULE:FREQ=MONTHLY;BYMONTHDAY=31`                                         |

Semantics, with honesty about where we follow the RFC and where we
deliberately diverge:

- **Time-of-day and phase** always derive from `anchor` interpreted in `tz`
  (DTSTART semantics). A 09:00 Europe/Berlin daily reminder stays at 09:00
  local across DST transitions.
- **Monthly on the 29th–31st**: months lacking that day are skipped. This
  matches plain `BYMONTHDAY=31` per RFC §3.3.10, but is a **product choice**,
  not RFC-compelled (clamping is expressible as
  `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`). The UI preview states it
  ("Monthly on the 31st — skips shorter months"); a "last day of month"
  option can be added later if demanded.
- **Weekly with interval > 1**: week boundary is Monday (RFC default
  WKST=MO); phase is the anchor's week.
- **DST spring-forward** (occurrence lands on a nonexistent local time):
  fire at the post-gap instant, that occurrence only — the series stays
  anchored. This **deliberately diverges** from RFC §3.3.10, which says to
  skip such occurrences; shifting matches Google Calendar / Temporal
  `'compatible'` behavior and is the right call for a meds reminder. A
  future strict .ics consumer would omit that one occurrence — acceptable.
- **DST fall-back** (ambiguous local time): the earlier instant, matching
  RFC §3.3.5.
- **Catch-up policy** ("fire once after downtime, skip missed occurrences")
  is a _delivery_ policy, not a rule-semantics change — the recurrence set
  is unchanged, so future export stays valid.

## Next-occurrence computation

New pure module `packages/server/src/lib/next-occurrence.ts`:

```ts
/** Smallest occurrence of `rule` (anchor + expansion) strictly after
 *  `after`. Returns a UTC Date. */
export function nextOccurrence(rule: RepeatRule, after: Date): Date;
```

- "Strictly after `after`" makes catch-up automatic and storm-free: if the
  server was down three days, a daily reminder fires **once** on the next
  sweep tick, then schedules normally. The anchor itself counts as the first
  occurrence (`nextOccurrence(rule, anchor − 1ms)` equals `anchor`) — and
  this MUST hold **even when the anchor violates `byWeekday`/`byMonthDay`**
  (a raw API client can pair a Tuesday `remindAt` with `byWeekday: ['MO']`;
  RFC DTSTART-counts-as-instance semantics, unit-tested explicitly),
  otherwise the very first fire fails the occurrence check below and never
  reactivates.
- Don't iterate from the anchor: compute the candidate near `after` with
  day/week/month-count arithmetic in wall-clock space (anchor phase via
  modular arithmetic), then resolve to a UTC instant in `tz`. A years-old
  anchor costs nothing.
- Node 22 has full ICU but no `Temporal`, and the repo has no date library —
  use an `Intl.DateTimeFormat`-based zoned-time helper, no new dependency.
  Realistic size **50–80 lines**, not trivial: it needs the two-candidate
  offset algorithm (probe both plausible offsets around a transition and
  pick per the gap/ambiguity policy above — a single offset probe silently
  misresolves near transitions), `hourCycle: 'h23'` (ICU renders midnight
  as "24" otherwise), and wall-clock-field iteration rather than adding
  86 400 s (23/25-hour days). This module is the concentrated risk of the
  feature and gets the densest unit tests.

## Sweep changes (`reminder-sweep.ts`)

The atomic claim (`UPDATE … SET remind_at = NULL … RETURNING`) stays exactly
as is. Recurrence is handled in `deliverForItem`, after delivery (matching
the existing code structure):

```
fire (claimed row, remindAt now NULL, claimed.remindAt = the fired instant)
  ├─ deliver push/email                                  (unchanged)
  └─ post-delivery write, one UPDATE, guarded by
     WHERE id = … AND remind_at IS NULL AND deleted_at IS NULL:
       if repeat == null:        (unchanged: retryAt on transient failure)
       else:
         // .getTime() equality — Date === compares references
         isOccurrence = nextOccurrence(repeat, fired − 1ms).getTime()
                          == fired.getTime()
         remindAt  = needsRetry ? retryAt : nextOccurrence(repeat, now)
         if isOccurrence:        // a real occurrence, not a retry echo
           checked = false, checkedBy = null,
           columnId = 'todo' WHERE columnId = 'done'
```

Notes:

- **Retry vs. occurrence discrimination (review finding):** a retry fire's
  `remindAt` is `retryAt` (jittered), which is never a member of the
  occurrence set, so the `isOccurrence` check is a one-liner against the
  stored anchor. Without it, this sequence silently undoes user work:
  occurrence fires 09:00 → reactivated → push fails transiently → retry
  queued 09:02 → user checks the item off 09:01 → retry tick **re-unchecks
  it**. With the check, a retry only re-attempts delivery.
- **Retry never pollutes the schedule:** `retryAt` lands in `remindAt` only;
  `anchor` is untouched, so after a successful retry `nextOccurrence(rule,
now)` returns the same next occurrence it would have — idempotent.
- **Reactivation happens on the occurrence fire** even if delivery needs a
  retry — reactivating the row is independent of notification delivery.
- **Reactivation target column**: hardcoded `'todo'`, mirroring the existing
  uncheck behavior in `routes/items.ts`. Same known limitation w.r.t. custom
  column ids; not made worse here.
- **Crash safety / self-heal**: if the process dies between claim and the
  post-delivery write, the row is stranded (`repeat` set, `remindAt` NULL ⇒
  never fires again). Each sweep tick therefore starts with a repair pass:
  `SELECT … WHERE repeat IS NOT NULL AND remind_at IS NULL AND deleted_at IS
NULL`, then per row a compare-and-set
  `UPDATE … SET remind_at = nextOccurrence(repeat, now) WHERE id = … AND
remind_at IS NULL`. The stored anchor is what makes the healed time-of-day
  and phase correct (nothing else survives the crash). Within one process
  the `running` guard guarantees the repair never sees a row that is merely
  mid-delivery; this is the single-process assumption stated above.
- **SSE**: the existing `item.updated` broadcast with `memberId: null`
  already carries the whole serialized item; reactivation reaches online
  clients with zero new event types. The web store's `updateItem` handler
  (find-by-id replace) needs no changes — verified.
- **No activity entry** for auto-reactivation: the sweep records no activity
  today, and "the system unchecked X" in the feed is noise. The fired
  reminder is the user-visible signal.

## API & validation

`UpdateItemSchema` (packages/shared/src/validation.ts) gains:

```ts
repeat: RepeatRuleInputSchema.nullable().optional(),
```

- `RepeatRuleInputSchema` is the rule **without `anchor`** — the server owns
  the anchor. Strict zod object: `freq` enum; `interval` int 1–365;
  `byWeekday` only with `freq === 'weekly'` (non-empty, deduped, max 7);
  `byMonthDay` int 1–31 only with `freq === 'monthly'` (`.superRefine`).
- `tz` validated by construction —
  `try { new Intl.DateTimeFormat(undefined, { timeZone: tz }) } catch` —
  **not** by membership in `Intl.supportedValuesOf('timeZone')`: ICU
  canonicalization differs across engines (a browser may send `Europe/Kiev`
  where Node 22 lists only `Europe/Kyiv`), so set-membership 422s
  legitimate clients. The constructor accepts aliases; fewer lines too.

Route rules (PATCH handler in `routes/items.ts`):

- Setting `repeat` non-null **requires** an effective `remindAt` (in the
  same request or already on the row) → else 422.
- **Anchor stamping — narrow by design (review finding):** the server writes
  `repeat.anchor := effective remindAt` only when
  (a) `repeat` transitions null → non-null (rule creation), or
  (b) the request payload explicitly sets a non-null `remindAt`
  (re-scheduling re-anchors the series: new time-of-day, new phase).
  Every other PATCH — text, position, assignee, check/uncheck, or a payload
  merely carrying an unchanged `repeat` — leaves `anchor` untouched. A
  blanket "re-stamp whenever repeat is non-null" rule was rejected: between
  a transient delivery failure and its retry, `remindAt` holds a jittered
  retry timestamp (and after a DST gap, a shifted instant); re-stamping then
  would leak that into the series — permanent 09:01:37 drift, and it would
  even defeat the retry/occurrence discriminator (the retry instant would
  _become_ an occurrence and re-uncheck an item the user just checked).
  The sweep never touches `anchor` under any path.
  (Note the picker UI always sends `remindAt` + `repeat` together, so rule
  (b) covers all normal UI edits; rule-only PATCHes exist only for raw API
  clients and safely keep the old anchor.)
- Clearing `remindAt` (null) also clears `repeat` (a rule without a next
  occurrence is meaningless). Clearing `repeat` keeps `remindAt` as a
  one-shot reminder.
- Manual check/uncheck of a recurring item touches only
  `checked`/`checkedBy`/`columnId` (existing logic) — no interaction with
  `repeat`/`remindAt`/`anchor` (guaranteed by the narrow stamping rule
  above); verified against the current PATCH handler.
- No change to POST (recurrence is configured via the reminder picker, same
  as reminders today).

`serializeItem` passes `repeat` through (jsonb → JSON). Note:
`serialize.test.ts` asserts the exact serialized key set and must be updated
alongside the `Item` type.

## Web UI

All inside the existing `ReminderPicker` popover (one new control) plus a
badge:

- **Repeat `<select>`** under the date-time input, defaulting to the item's
  current rule: `Doesn't repeat | Daily | Weekly | Every 2 weeks | Monthly`.
  The select stores only `{freq, interval}`; **`byWeekday` / `byMonthDay`
  are derived at commit time from the committed fire time**, so rule and
  first occurrence agree by construction (picking Feb 28 + Monthly yields
  `byMonthDay: 28`, never an impossible 31). When a date-time is already
  picked, option labels enrich live ("Weekly on Tuesday", "Monthly on the
  28th"). `tz` is filled from
  `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **All three commit paths send the pair** `(remindAt, repeat)`: the Save
  button and the preset chips commit the current select value with their
  respective times (a preset click = that time + whatever repeat is
  selected); Clear sends `(null, null)`. `onSet` widens accordingly;
  `ListItem` sends both fields in one PATCH (`api.updateItem` already takes
  a record — no API-client change).
- Preview line extends to e.g. "Tue, Jun 16 · in 5d · repeats weekly".
- **ListItem badge**: the existing reminder badge already renders whenever
  `remindAt` is set (no checked-state gate — verified, including CSS), so
  recurring items keep their badge on checked rows automatically because the
  sweep re-arms `remindAt`. The only change: add a ↻ glyph when
  `item.repeat` is set. No checked-state branch needed.
- Styleguide route: add the repeat select + badge state to `/_styleguide`
  per project convention.

What deliberately does _not_ exist: custom interval input, multi-weekday
selection, end dates (UNTIL/COUNT — clearing `repeat` is the escape hatch).
The jsonb model already holds byWeekday arrays, so multi-day ("MO,TH") is a
pure UI extension later.

## Edge cases

| Case                                                              | Behavior                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item checked off, occurrence due                                  | Reactivated (unchecked → todo) + notified.                                                                                                                                                                            |
| Item still unchecked when due                                     | Notified again; remindAt advances. (Repeat-until-done is the point of a reminder.)                                                                                                                                    |
| User checks item off between occurrence fire and a delivery retry | Stays checked — retry fires deliver-only (isOccurrence discriminator).                                                                                                                                                |
| Item soft-deleted                                                 | Claim already excludes deleted rows; recurrence pauses. On restore, next tick fires the overdue occurrence once (existing documented behavior), then schedules normally.                                              |
| Item hard-deleted by retention                                    | Row gone, recurrence gone.                                                                                                                                                                                            |
| Server downtime over multiple occurrences                         | Exactly one catch-up fire; phase preserved because it derives from `anchor`, not the missed fires.                                                                                                                    |
| Transient push/email outage                                       | Existing jittered retry; occurrence not skipped; schedule unpolluted (anchor immutable).                                                                                                                              |
| Delivery outage spanning the next occurrence                      | The overlapped occurrence is skipped — the post-retry write-back arms strictly after now. Same policy as downtime catch-up, but triggered by a delivery-side outage on a healthy server.                              |
| User edits text/position/checked while a retry is pending         | Anchor untouched (narrow stamping rule); retry stays a deliver-only echo.                                                                                                                                             |
| Crash between claim and re-arm                                    | Self-heal re-arms next tick at the correct time-of-day/phase (from anchor). The mid-flight occurrence's notification and reactivation are lost (one missed un-check per crash) — consistent with the catch-up policy. |
| DST spring-forward                                                | That occurrence shifts past the gap; series stays at the anchored local time (next week is 02:30 again, not 03:30 forever).                                                                                           |
| DST fall-back                                                     | Earlier instant (RFC §3.3.5).                                                                                                                                                                                         |
| Monthly on the 31st                                               | Short months skipped; stated in UI preview.                                                                                                                                                                           |
| User edits text/assignee between occurrences                      | Claim RETURNING carries the current row; already honored today.                                                                                                                                                       |
| User re-schedules a recurring item                                | Series re-anchors to the new time (server rewrites `anchor`).                                                                                                                                                         |
| Assigned vs. unassigned                                           | Unchanged: assigned → that member, else all project members.                                                                                                                                                          |

## Privacy / legal touchpoints

- No new personal data category. `tz` is a coarse signal already implied by
  reminder timestamps; it lives inside project data covered by the existing
  retention and erasure runbooks (item deletion scrubs it with the row).
- Recurring notifications are user-configured, not marketing — no consent
  surface changes. One-line update to the reminders entry in `docs/ropa.md`
  ("one-time or recurring").

## Testing

- **Unit — `nextOccurrence`** (bulk of the risk): daily/weekly/monthly happy
  paths; anchor-is-first-occurrence; interval-2 phase preservation incl.
  catch-up across an odd number of periods; DST spring/fall in
  Europe/Berlin and a southern-hemisphere zone (Pacific/Auckland); the
  Sunday-02:30 Berlin weekly rule (EU transitions happen Sunday 02:00 — the
  gap case recurs every spring, must not re-base); monthly 31st skipping;
  weekly multi-BYDAY; non-integer offset (Asia/Kathmandu); years-old anchor
  (performance/correctness of the arithmetic path).
- **Unit — sweep**: occurrence fire reactivates + advances; retry fire is
  deliver-only (no re-uncheck); transient failure then success lands on the
  unpolluted next occurrence; self-heal re-arms a stranded row at the
  anchored time; non-recurring behavior unchanged (regression).
- **Unit — anchor stamping**: text/position/checked PATCH on a recurring
  item leaves `anchor` byte-identical (including while `remindAt` holds a
  retry timestamp); explicit `remindAt` PATCH re-stamps; rule creation
  stamps; mismatched anchor (Tuesday remindAt + `byWeekday:['MO']`) still
  counts as first occurrence.
- **Validation**: byWeekday on daily rejected; bad tz rejected, alias tz
  (`Europe/Kiev`) accepted; repeat without remindAt 422; remindAt-clear
  cascades; client-sent `anchor` ignored/stripped.
- **Test plumbing**: extend `test/helpers.ts` `addItem` with
  `repeat`/`columnId` params; update `serialize.test.ts` key-set assertion.
- **E2E** (Playwright): set "Daily" in the picker, assert ↻ badge and PATCH
  payload. Extend `docs/manual-smoke-reminders.md` with a recurrence section
  for real-push verification.

## Effort

Migration + journal entry, ~60–80 lines `next-occurrence.ts`, ~50-line sweep
diff, ~25 lines validation, ~10 lines route (anchor stamping), ~90 lines
picker UI, tests ≈ the same again. Roughly 550–750 LOC total including
tests; no new dependencies.

## Alternatives considered

- **RRULE string column + rrule.js now**: heavier dependency with known tz
  quirks, validation requires parsing, buys nothing until calendar interop
  exists. The jsonb subset (with anchor = DTSTART) maps onto it losslessly
  later. Rejected (YAGNI).
- **Template + spawned instance rows**: per-occurrence history, but more
  schema, "edit this vs. all" semantics, retention questions. Rejected
  (KISS) — activity log covers history.
- **Completion-relative repeats**: popular for chores, but incompatible with
  RRULE and fixed-time reminders. Rejected for v1; the jsonb column could
  host a `freq:'after-completion'` variant later, outside the RRULE-mappable
  subset.
- **Deriving anchor from the fired `remindAt` (rev-1 design)**: rejected
  after adversarial review — see "Why a stored `anchor` is load-bearing".

## Review log

**Pass 1+2** — two adversarial sub-agent reviews (2026-06-11) against rev 1.
Confirmed findings, addressed in rev 2: missing stored DTSTART (critical —
broke self-heal, retry idempotency, DST stability, and the lossless-mapping
claim); retry re-running reactivation could undo a user's check-off (major);
self-heal vs. multi-process claim contradiction (major — resolved by stating
the single-process assumption + compare-and-set); spring-forward divergence
from RFC mis-labeled as RFC-following (minor); `supportedValuesOf` tz
validation rejects engine aliases (minor); Intl helper LOC estimate doubled;
monthly-31 skip re-labeled product choice; migration journal-entry step and
two test-file touches added; badge persistence claim corrected (already
true today via `remindAt`, no special-casing needed); preset/clear commit
paths specified.

**Pass 3** — fresh-eyes verification of rev 2 (2026-06-11). Verified PASS:
the isOccurrence discriminator (ms-equality survives the timestamptz
round-trip because every writer is a JS Date; retry-instant collision is
benign), self-heal fire semantics, jsonb anchor round-trip, the
single-process self-heal reasoning against the actual `running` guard.
Found one major flaw in rev 2 itself: blanket anchor re-stamping on any
PATCH carrying `repeat` re-leaked retry/DST timestamps into the series via
unrelated edits (rename, drag-reorder, check-off) — fixed by the narrow
stamping rule (rev 3). Minors folded in: `.getTime()` equality spelled out;
anchor-counts-as-occurrence required even for rule-violating anchors;
crash-loss honesty in the edge-case table; never write `remind_at` via SQL
`now()` (µs precision would break ms equality).
