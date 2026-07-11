import type { RepeatRule } from '@plainspace/shared';

// Pure next-occurrence computation for RepeatRule. No date library: Node 22
// has full ICU but no Temporal, so all zoned arithmetic goes through
// Intl.DateTimeFormat. The series is anchored on rule.anchor (DTSTART) — every
// occurrence's wall-clock time-of-day and interval>1 phase derive from it, so
// retry/DST rewrites of remind_at never re-base the schedule.

const WEEKDAY_INDEX: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 0,
};

interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// A formatter per tz is reused across calls — constructing one is the
// expensive part of Intl. h23 so ICU renders midnight as 00, not "24".
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

// The wall-clock fields a given UTC instant has in `tz`.
function toWallClock(instant: Date, tz: string): WallClock {
  const parts = zonedFormatter(tz).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

// Days in a Gregorian month (month 1–12).
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The day-of-week (0=Sun..6=Sat) for a wall-clock calendar date, computed in
// UTC so it's independent of any zone offset.
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// Whole-day count between two calendar dates (b − a), via UTC midnights.
function dayDiff(a: WallClock, b: WallClock): number {
  const am = Date.UTC(a.year, a.month - 1, a.day);
  const bm = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bm - am) / 86_400_000);
}

// Whole-month count between two calendar dates (b − a).
function monthDiff(a: WallClock, b: WallClock): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

// Resolve a wall-clock instant in `tz` to its UTC Date, handling DST.
//
// We can't add a fixed offset because the offset itself depends on the date.
// Probe both plausible offsets around a transition: form a UTC guess from a
// nominal offset, read back its wall clock, and correct by the residual. Two
// candidates (built from the offsets just before and after) bracket any
// transition; a single probe silently misresolves in the gap/overlap.
//   - spring-forward gap (the wall time doesn't exist): neither candidate
//     round-trips; both corrections push past the gap, and we take the later
//     (post-gap) instant for that occurrence.
//   - fall-back overlap (the wall time exists twice): both candidates
//     round-trip; we take the earlier instant (RFC §3.3.5).
function wallClockToUtc(wc: WallClock, tz: string): Date {
  const nominal = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);

  // Offset (ms) that `tz` has at a given UTC instant: wall-clock-as-UTC minus
  // the instant.
  const offsetAt = (utcMs: number): number => {
    const wcAt = toWallClock(new Date(utcMs), tz);
    const asUtc = Date.UTC(
      wcAt.year,
      wcAt.month - 1,
      wcAt.day,
      wcAt.hour,
      wcAt.minute,
      wcAt.second,
    );
    return asUtc - utcMs;
  };

  // Two guesses: offset sampled a day before and a day after the nominal time
  // bracket both sides of any nearby transition.
  const offBefore = offsetAt(nominal - 86_400_000);
  const offAfter = offsetAt(nominal + 86_400_000);

  const candidates: number[] = [];
  for (const off of new Set([offBefore, offAfter])) {
    const utcMs = nominal - off;
    // Keep a candidate only if it actually renders back to the requested wall
    // clock (i.e. the offset we used is the real one at that instant).
    const back = toWallClock(new Date(utcMs), tz);
    if (
      back.year === wc.year &&
      back.month === wc.month &&
      back.day === wc.day &&
      back.hour === wc.hour &&
      back.minute === wc.minute &&
      back.second === wc.second
    ) {
      candidates.push(utcMs);
    }
  }

  if (candidates.length > 0) {
    // Overlap → earliest valid instant; unique → the one valid instant.
    return new Date(Math.min(...candidates));
  }

  // Spring-forward gap: the wall time doesn't exist. Shift to the post-gap
  // instant — apply the larger (post-transition) offset so the wall time lands
  // just past the gap.
  const post = nominal - Math.min(offBefore, offAfter);
  return new Date(post);
}

// Smallest occurrence of `rule` strictly after `after`. Returns a UTC Date.
// The anchor itself counts as the first occurrence (DTSTART semantics), even
// when it violates byWeekday/byMonthDay.
export function nextOccurrence(rule: RepeatRule, after: Date): Date {
  const tz = rule.tz;
  const anchorInstant = new Date(rule.anchor);
  const anchor = toWallClock(anchorInstant, tz);

  // The anchor is always the first occurrence; nothing before it.
  if (after.getTime() < anchorInstant.getTime()) return anchorInstant;

  const afterWc = toWallClock(after, tz);

  if (rule.freq === 'daily') return nextDaily(rule, anchor, anchorInstant, afterWc, after, tz);
  if (rule.freq === 'weekly') return nextWeekly(rule, anchor, anchorInstant, afterWc, after, tz);
  return nextMonthly(rule, anchor, anchorInstant, afterWc, after, tz);
}

// Largest occurrence strictly before `before`, or null when `before` is at or
// before the anchor (the anchor is the first occurrence — nothing precedes it).
// This inverts the check-off advance: when a recurring task is un-checked the
// pointer is rolled back to the occurrence completion stepped off of. `before`
// is expected to be an occurrence (the stored remind_at pointer always is).
//
// Returning null for the anchor is what keeps a pre-completed FUTURE occurrence
// in place on un-check: its remind_at is still the anchor, so there is nothing
// to roll back. A genuinely completed occurrence has remind_at advanced past the
// anchor, so its predecessor exists and is restored.
export function previousOccurrence(rule: RepeatRule, before: Date): Date | null {
  const anchorMs = new Date(rule.anchor).getTime();
  if (before.getTime() <= anchorMs) return null;

  // Seed a probe strictly before `before` by doubling the look-back until the
  // first occurrence at/after it lands before `before`, then walk forward to the
  // last occurrence below `before`. Doubling is correct for any gap — monthly
  // byMonthDay rules skip short months (Jan 31 → Mar 31), leap-only Feb-29 rules
  // span years — without hard-coding a per-frequency window. It stays cheap: for
  // a dense series the probe clears the gap in one or two doublings; for a sparse
  // one it falls back to the anchor (the worst case is O(occurrences), and a
  // sparse series has few). nextOccurrence is strictly increasing and exclusive,
  // so probing from `probe − 1` can't skip an occurrence sitting exactly on it.
  let span = 86_400_000; // 1 day
  let probeMs = Math.max(anchorMs, before.getTime() - span);
  while (
    probeMs > anchorMs &&
    nextOccurrence(rule, new Date(probeMs - 1)).getTime() >= before.getTime()
  ) {
    span *= 2;
    probeMs = Math.max(anchorMs, before.getTime() - span);
  }

  let prev: Date | null = null;
  let cur = nextOccurrence(rule, new Date(probeMs - 1));
  while (cur.getTime() < before.getTime()) {
    prev = cur;
    cur = nextOccurrence(rule, cur);
  }
  return prev;
}

// Midnight (00:00:00) of the calendar day that `instant` falls on in `tz`, as a
// UTC Date. Lets the sweep decide when a recurring task's occurrence DAY has
// begun, independent of the occurrence's wall-clock time-of-day.
export function startOfDayInTz(instant: Date, tz: string): Date {
  const wc = toWallClock(instant, tz);
  return wallClockToUtc({ ...wc, hour: 0, minute: 0, second: 0 }, tz);
}

function addDays(wc: WallClock, days: number): { year: number; month: number; day: number } {
  const ms = Date.UTC(wc.year, wc.month - 1, wc.day) + days * 86_400_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextDaily(
  rule: RepeatRule,
  anchor: WallClock,
  anchorInstant: Date,
  afterWc: WallClock,
  after: Date,
  tz: string,
): Date {
  const interval = rule.interval;
  // Phase: occurrences land on days where dayDiff(anchor, day) % interval === 0.
  // Start from the first candidate day on/after `after`'s calendar date that
  // satisfies the phase, then step until the resolved instant is > after.
  const diff = dayDiff(anchor, afterWc);
  let k = Math.ceil(diff / interval);
  if (k < 0) k = 0;
  for (let guard = 0; guard < 4; guard++) {
    const date = addDays(anchor, k * interval);
    const wc = { ...date, hour: anchor.hour, minute: anchor.minute, second: anchor.second };
    const instant = wallClockToUtc(wc, tz);
    if (instant.getTime() > after.getTime() && instant.getTime() >= anchorInstant.getTime()) {
      return instant;
    }
    k++;
  }
  return NO_OCCURRENCE();
}

function nextWeekly(
  rule: RepeatRule,
  anchor: WallClock,
  anchorInstant: Date,
  afterWc: WallClock,
  after: Date,
  tz: string,
): Date {
  const interval = rule.interval;
  // Allowed weekdays (0=Sun..6=Sat). Default to the anchor's own weekday.
  const allowed = rule.byWeekday?.map((t) => WEEKDAY_INDEX[t]) ?? [
    weekdayOf(anchor.year, anchor.month, anchor.day),
  ];
  const allowedSet = new Set(allowed);

  // Week phase via Monday-based week index from the anchor (RFC WKST=MO).
  // mondayIndex(date) = whole-week count of the Monday of date's week since a
  // fixed epoch Monday. Occurrence weeks satisfy
  //   (weekIndex(day) − weekIndex(anchor)) % interval === 0.
  const anchorWeek = mondayIndex(anchor.year, anchor.month, anchor.day);

  // Scan candidate days forward from `after`'s date. The first matching day
  // whose resolved instant is strictly after `after` wins. Bounded scan:
  // interval weeks × 7 days plus slack covers the worst gap.
  const maxDays = interval * 7 + 14;
  for (let i = 0; i <= maxDays; i++) {
    const date = addDays(afterWc, i);
    const dow = weekdayOf(date.year, date.month, date.day);
    if (!allowedSet.has(dow)) continue;
    const week = mondayIndex(date.year, date.month, date.day);
    if ((((week - anchorWeek) % interval) + interval) % interval !== 0) continue;
    const wc = { ...date, hour: anchor.hour, minute: anchor.minute, second: anchor.second };
    const instant = wallClockToUtc(wc, tz);
    if (instant.getTime() > after.getTime() && instant.getTime() >= anchorInstant.getTime()) {
      return instant;
    }
  }
  return NO_OCCURRENCE();
}

// Whole-week count of the Monday of a date's week, since a fixed epoch.
// 1970-01-01 was a Thursday; offset so the value increments on Mondays.
function mondayIndex(year: number, month: number, day: number): number {
  const ms = Date.UTC(year, month - 1, day);
  const dow = new Date(ms).getUTCDay(); // 0=Sun..6=Sat
  // Days since this date's Monday (Mon→0 … Sun→6).
  const sinceMonday = (dow + 6) % 7;
  const mondayMs = ms - sinceMonday * 86_400_000;
  return Math.round(mondayMs / (7 * 86_400_000));
}

function nextMonthly(
  rule: RepeatRule,
  anchor: WallClock,
  anchorInstant: Date,
  afterWc: WallClock,
  after: Date,
  tz: string,
): Date {
  const interval = rule.interval;
  const targetDay = rule.byMonthDay ?? anchor.day;

  // Phase: occurrence months satisfy monthDiff(anchor, month) % interval === 0.
  // Start at/just before `after`'s month, then step `interval` months,
  // skipping months without `targetDay` (29–31 product choice).
  let k = Math.floor(monthDiff(anchor, afterWc) / interval);
  if (k < 0) k = 0;

  for (let guard = 0; guard < 800; guard++) {
    const monthsFromAnchor = k * interval;
    const year = anchor.year + Math.floor((anchor.month - 1 + monthsFromAnchor) / 12);
    const month = ((anchor.month - 1 + monthsFromAnchor) % 12) + 1;
    if (targetDay <= daysInMonth(year, month)) {
      const wc = {
        year,
        month,
        day: targetDay,
        hour: anchor.hour,
        minute: anchor.minute,
        second: anchor.second,
      };
      const instant = wallClockToUtc(wc, tz);
      if (instant.getTime() > after.getTime() && instant.getTime() >= anchorInstant.getTime()) {
        return instant;
      }
    }
    k++;
  }
  return NO_OCCURRENCE();
}

// Returned when the bounded search finds no occurrence — reachable via the
// raw API with a rule whose byMonthDay never exists in its locked months
// (e.g. interval=12, byMonthDay=31, April anchor). Must be a FUTURE instant:
// returning a past one would make the sweep re-claim and re-fire the row
// every tick (notification storm + perpetual re-unchecking).
function NO_OCCURRENCE(): Date {
  return new Date(Date.UTC(9999, 0, 1));
}
