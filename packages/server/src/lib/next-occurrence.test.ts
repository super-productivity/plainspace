import { describe, expect, it } from 'vitest';
import type { RepeatRule } from '@plainspace/shared';
import { nextOccurrence, previousOccurrence } from './next-occurrence.js';

// Helper: the wall-clock fields an instant has in a zone, for asserting
// time-of-day stability across DST without hard-coding offsets.
function wall(instant: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} ${g('weekday')}`;
}

const minus1ms = (iso: string) => new Date(new Date(iso).getTime() - 1);

describe('nextOccurrence — anchor is first occurrence', () => {
  it('returns the anchor for after = anchor − 1ms (daily)', () => {
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-03-10T08:00:00.000Z',
    };
    expect(nextOccurrence(rule, minus1ms(rule.anchor)).toISOString()).toBe(rule.anchor);
  });

  it('counts a rule-violating anchor as the first occurrence (Tue anchor + byWeekday MO)', () => {
    // 2026-06-16 is a Tuesday; the rule only allows Mondays. DTSTART semantics
    // still make the anchor the first occurrence, else the sweep's first fire
    // would fail the isOccurrence check and never reactivate.
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 1,
      byWeekday: ['MO'],
      tz: 'Europe/Berlin',
      anchor: '2026-06-16T07:00:00.000Z',
    };
    expect(nextOccurrence(rule, minus1ms(rule.anchor)).toISOString()).toBe(rule.anchor);
    // The next occurrence after the anchor jumps to the following Monday.
    const next = nextOccurrence(rule, new Date(rule.anchor));
    expect(wall(next, 'Europe/Berlin')).toContain('Mon');
    expect(wall(next, 'Europe/Berlin')).toBe('2026-06-22 09:00 Mon');
  });

  it('counts a rule-violating monthly anchor (day 15 anchor + byMonthDay 20) as first', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 20,
      tz: 'Europe/Berlin',
      anchor: '2026-06-15T07:00:00.000Z',
    };
    expect(nextOccurrence(rule, minus1ms(rule.anchor)).toISOString()).toBe(rule.anchor);
    const next = nextOccurrence(rule, new Date(rule.anchor));
    expect(wall(next, 'Europe/Berlin')).toBe('2026-06-20 09:00 Sat');
  });
});

describe('nextOccurrence — daily', () => {
  const rule: RepeatRule = {
    freq: 'daily',
    interval: 1,
    tz: 'Europe/Berlin',
    anchor: '2026-06-01T07:00:00.000Z', // 09:00 Berlin (CEST)
  };

  it('advances to the next day at the same wall-clock time', () => {
    const after = new Date('2026-06-01T07:00:00.000Z');
    expect(nextOccurrence(rule, after).toISOString()).toBe('2026-06-02T07:00:00.000Z');
  });

  it('catches up once after multi-day downtime (strictly-after, storm-free)', () => {
    // Server down for 3 days; the next sweep fires once for the next day.
    const after = new Date('2026-06-04T12:00:00.000Z');
    expect(nextOccurrence(rule, after).toISOString()).toBe('2026-06-05T07:00:00.000Z');
  });
});

describe('nextOccurrence — daily interval 2 phase preservation', () => {
  const rule: RepeatRule = {
    freq: 'daily',
    interval: 2,
    tz: 'Europe/Berlin',
    anchor: '2026-06-01T07:00:00.000Z',
  };

  it('keeps the every-other-day phase', () => {
    // Anchor Jun 1 → occurrences Jun 1, 3, 5, 7…
    expect(nextOccurrence(rule, new Date('2026-06-01T07:00:00.000Z')).toISOString()).toBe(
      '2026-06-03T07:00:00.000Z',
    );
    expect(nextOccurrence(rule, new Date('2026-06-03T07:00:00.000Z')).toISOString()).toBe(
      '2026-06-05T07:00:00.000Z',
    );
  });

  it('preserves phase after catch-up across an odd number of periods', () => {
    // After Jun 6 (an off day, one period past Jun 5), the next on-phase day is
    // Jun 7 — not Jun 6. An odd-day catch-up must not flip the phase.
    expect(nextOccurrence(rule, new Date('2026-06-06T12:00:00.000Z')).toISOString()).toBe(
      '2026-06-07T07:00:00.000Z',
    );
  });
});

describe('nextOccurrence — weekly', () => {
  it('every Tuesday at the anchor time', () => {
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-06-16T07:00:00.000Z', // Tuesday 09:00 Berlin
    };
    const next = nextOccurrence(rule, new Date(rule.anchor));
    expect(next.toISOString()).toBe('2026-06-23T07:00:00.000Z');
  });

  it('multi-BYDAY: Monday and Thursday', () => {
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 1,
      byWeekday: ['MO', 'TH'],
      tz: 'Europe/Berlin',
      anchor: '2026-06-15T07:00:00.000Z', // Monday
    };
    // From Monday → Thursday same week.
    expect(wall(nextOccurrence(rule, new Date('2026-06-15T07:00:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-06-18 09:00 Thu',
    );
    // From Thursday → next Monday.
    expect(wall(nextOccurrence(rule, new Date('2026-06-18T07:00:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-06-22 09:00 Mon',
    );
  });

  it('interval 2 (biweekly) preserves the anchor week phase', () => {
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 2,
      byWeekday: ['MO'],
      tz: 'Europe/Berlin',
      anchor: '2026-06-15T07:00:00.000Z', // Monday, week A
    };
    // Next is two weeks later, not one.
    expect(wall(nextOccurrence(rule, new Date('2026-06-15T07:00:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-06-29 09:00 Mon',
    );
    // Catch-up from the skipped (odd) week still lands on the phase week.
    expect(wall(nextOccurrence(rule, new Date('2026-06-23T12:00:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-06-29 09:00 Mon',
    );
  });
});

describe('nextOccurrence — monthly', () => {
  it('on the 15th each month', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 15,
      tz: 'Europe/Berlin',
      anchor: '2026-01-15T08:00:00.000Z', // 09:00 Berlin (CET)
    };
    const next = nextOccurrence(rule, new Date('2026-01-15T08:00:00.000Z'));
    // Feb is still CET (09:00 = 08:00Z).
    expect(wall(next, 'Europe/Berlin')).toBe('2026-02-15 09:00 Sun');
  });

  it('on the 31st skips shorter months (Jan 31 → Mar 31)', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 31,
      tz: 'Europe/Berlin',
      anchor: '2026-01-31T08:00:00.000Z',
    };
    // Feb has no 31st → skip to Mar 31 (note Mar 31 is CEST, 09:00 = 07:00Z).
    const next = nextOccurrence(rule, new Date('2026-01-31T08:00:00.000Z'));
    expect(wall(next, 'Europe/Berlin')).toBe('2026-03-31 09:00 Tue');
  });

  it('on the 29th skips non-leap February (Jan 29 2027 → Mar 29 2027)', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 29,
      tz: 'Europe/Berlin',
      anchor: '2027-01-29T08:00:00.000Z',
    };
    // 2027 is not a leap year → Feb 29 doesn't exist → Mar 29.
    const next = nextOccurrence(rule, new Date('2027-01-29T08:00:00.000Z'));
    expect(wall(next, 'Europe/Berlin')).toBe('2027-03-29 09:00 Mon');
  });

  it('interval 2 preserves the month phase', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 2,
      byMonthDay: 10,
      tz: 'Europe/Berlin',
      anchor: '2026-01-10T08:00:00.000Z',
    };
    // Jan → Mar → May …
    expect(wall(nextOccurrence(rule, new Date('2026-01-10T08:00:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-03-10 09:00 Tue',
    );
    // Catch-up from April (an off month) lands on May, not April.
    expect(wall(nextOccurrence(rule, new Date('2026-04-15T12:00:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-05-10 09:00 Sun',
    );
  });
});

describe('nextOccurrence — DST Europe/Berlin', () => {
  it('spring-forward: daily 02:30 shifts past the gap that day only', () => {
    // EU spring transition 2026: Sun 2026-03-29 02:00 → 03:00. A 02:30 local
    // reminder doesn't exist that day; it must shift past the gap, and the
    // very next day returns to 02:30.
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-03-27T01:30:00.000Z', // 02:30 Berlin (CET) on Mar 27
    };
    // Mar 28 → 02:30 still valid.
    expect(wall(nextOccurrence(rule, new Date('2026-03-27T01:30:00.000Z')), 'Europe/Berlin')).toBe(
      '2026-03-28 02:30 Sat',
    );
    // Mar 29 → gap; shift to 03:30 (post-gap) for that occurrence only.
    const transitionDay = nextOccurrence(rule, new Date('2026-03-28T01:30:00.000Z'));
    expect(wall(transitionDay, 'Europe/Berlin')).toBe('2026-03-29 03:30 Sun');
    // Mar 30 → back to 02:30, NOT 03:30 (series never re-bases).
    expect(wall(nextOccurrence(rule, transitionDay), 'Europe/Berlin')).toBe('2026-03-30 02:30 Mon');
  });

  it('weekly Sunday 02:30 returns to 02:30 the week after spring-forward', () => {
    // The EU transition is always a Sunday 02:00; a weekly Sunday-02:30 rule
    // hits the gap every spring and must return to 02:30 the next week.
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 1,
      byWeekday: ['SU'],
      tz: 'Europe/Berlin',
      anchor: '2026-03-22T01:30:00.000Z', // Sun Mar 22 02:30 CET
    };
    // Mar 29 (transition Sunday) → shifted past the gap.
    const gap = nextOccurrence(rule, new Date('2026-03-22T01:30:00.000Z'));
    expect(wall(gap, 'Europe/Berlin')).toBe('2026-03-29 03:30 Sun');
    // Apr 5 → back to 02:30.
    expect(wall(nextOccurrence(rule, gap), 'Europe/Berlin')).toBe('2026-04-05 02:30 Sun');
  });

  it('fall-back: ambiguous 02:30 resolves to the earlier instant', () => {
    // EU fall transition 2026: Sun 2026-10-25 03:00 → 02:00 (02:00–03:00 occurs
    // twice). A daily 02:30 rule on that day picks the earlier (CEST) instant.
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-10-23T00:30:00.000Z', // 02:30 Berlin (CEST) Oct 23
    };
    const ambiguous = nextOccurrence(rule, new Date('2026-10-24T00:30:00.000Z'));
    // Earlier instant is the CEST one: 02:30 CEST = 00:30Z (not 01:30Z).
    expect(ambiguous.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(wall(ambiguous, 'Europe/Berlin')).toBe('2026-10-25 02:30 Sun');
  });

  it('keeps 09:00 local stable across the spring transition', () => {
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-03-28T08:00:00.000Z', // 09:00 CET
    };
    // Crossing into CEST, 09:00 local is now 07:00Z — time-of-day stable.
    const next = nextOccurrence(rule, new Date('2026-03-28T08:00:00.000Z'));
    expect(wall(next, 'Europe/Berlin')).toBe('2026-03-29 09:00 Sun');
    expect(next.toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });
});

describe('nextOccurrence — southern hemisphere (Pacific/Auckland)', () => {
  it('handles the September spring-forward (gap shifts forward)', () => {
    // NZ spring 2026: Sun 2026-09-27 02:00 → 03:00.
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Pacific/Auckland',
      anchor: '2026-09-25T14:30:00.000Z', // 02:30 Auckland Sep 26 (NZST)
    };
    // `after` is Sep 27 01:30 local (pre-gap), so the Sep 27 occurrence is
    // still ahead. Sep 27 02:30 doesn't exist → shifts to 03:30.
    const gap = nextOccurrence(rule, new Date('2026-09-26T13:30:00.000Z'));
    expect(wall(gap, 'Pacific/Auckland')).toBe('2026-09-27 03:30 Sun');
    // Sep 28 back to 02:30.
    expect(wall(nextOccurrence(rule, gap), 'Pacific/Auckland')).toBe('2026-09-28 02:30 Mon');
  });
});

describe('nextOccurrence — fractional offset (Asia/Kathmandu +05:45)', () => {
  it('resolves the anchor time-of-day in a non-integer-offset zone', () => {
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Asia/Kathmandu',
      anchor: '2026-06-01T03:15:00.000Z', // 09:00 Kathmandu (+05:45)
    };
    const next = nextOccurrence(rule, new Date('2026-06-01T03:15:00.000Z'));
    expect(wall(next, 'Asia/Kathmandu')).toBe('2026-06-02 09:00 Tue');
    expect(next.toISOString()).toBe('2026-06-02T03:15:00.000Z');
  });
});

describe('nextOccurrence — years-old anchor (arithmetic path, not iteration)', () => {
  it('computes a daily occurrence near now from a 2015 anchor', () => {
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 3,
      tz: 'Europe/Berlin',
      anchor: '2015-06-01T07:00:00.000Z',
    };
    const after = new Date('2026-06-10T12:00:00.000Z');
    const next = nextOccurrence(rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
    // Must be the first every-3-days occurrence strictly after `after`, and on
    // the every-3-days phase from the 2015 anchor (whole-day multiple of 3).
    expect(next.getTime()).toBeLessThanOrEqual(after.getTime() + 3 * 86_400_000);
    const phaseDays = Math.round((next.getTime() - new Date(rule.anchor).getTime()) / 86_400_000);
    expect(phaseDays % 3).toBe(0);
    expect(wall(next, 'Europe/Berlin')).toContain('09:00');
  });

  it('computes a monthly-31 occurrence near now from a 2010 anchor', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 31,
      tz: 'Europe/Berlin',
      anchor: '2010-01-31T08:00:00.000Z',
    };
    const after = new Date('2026-06-10T12:00:00.000Z');
    const next = nextOccurrence(rule, after);
    // Next 31st after Jun 10 2026 is Jul 31 (Jun has only 30 days).
    expect(wall(next, 'Europe/Berlin')).toBe('2026-07-31 09:00 Fri');
  });
});

describe('previousOccurrence — inverse of the check-off advance', () => {
  // UTC keeps the interval arithmetic offset-free; DST is covered separately.
  const daily: RepeatRule = {
    freq: 'daily',
    interval: 1,
    tz: 'UTC',
    anchor: '2026-06-10T08:00:00.000Z',
  };

  it('returns null at the anchor (nothing precedes the first occurrence)', () => {
    expect(previousOccurrence(daily, new Date(daily.anchor))).toBeNull();
  });

  it('returns null before the anchor', () => {
    expect(previousOccurrence(daily, minus1ms(daily.anchor))).toBeNull();
  });

  it('steps back one day to the anchor for a daily rule', () => {
    const next = nextOccurrence(daily, new Date(daily.anchor)); // 2026-06-11 08:00Z
    expect(previousOccurrence(daily, next)?.toISOString()).toBe(daily.anchor);
  });

  it('steps a far-advanced daily pointer back exactly one day', () => {
    // remind_at advanced 10 days past the anchor → predecessor is the day before.
    expect(previousOccurrence(daily, new Date('2026-06-20T08:00:00.000Z'))?.toISOString()).toBe(
      '2026-06-19T08:00:00.000Z',
    );
  });

  it('respects interval > 1 (every 3 days)', () => {
    const every3: RepeatRule = { ...daily, interval: 3 }; // 06-10, 06-13, 06-16, 06-19…
    expect(previousOccurrence(every3, new Date('2026-06-16T08:00:00.000Z'))?.toISOString()).toBe(
      '2026-06-13T08:00:00.000Z',
    );
  });

  it('preserves wall-clock time across a DST transition (Europe/Berlin)', () => {
    // 08:00 Berlin before the 2026-03-29 spring-forward; the predecessor of a
    // post-transition occurrence must still read 08:00 local, not 07:00.
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-03-27T07:00:00.000Z', // 08:00 Berlin (CET)
    };
    const afterDst = nextOccurrence(rule, new Date('2026-03-30T00:00:00.000Z'));
    const prev = previousOccurrence(rule, afterDst)!;
    expect(prev).not.toBeNull();
    expect(wall(prev, 'Europe/Berlin')).toContain('08:00');
  });

  it('weekly: steps back to the prior allowed weekday in the same week', () => {
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 1,
      byWeekday: ['MO', 'WE', 'FR'],
      tz: 'Europe/Berlin',
      anchor: '2026-06-15T07:00:00.000Z', // Monday
    };
    const fri = nextOccurrence(rule, new Date('2026-06-18T07:00:00.000Z')); // Fri 06-19
    const prev = previousOccurrence(rule, fri)!;
    expect(wall(prev, 'Europe/Berlin')).toContain('Wed'); // 06-17
  });

  it('monthly: steps back one interval month', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 15,
      tz: 'UTC',
      anchor: '2026-01-15T08:00:00.000Z',
    };
    expect(previousOccurrence(rule, new Date('2026-04-15T08:00:00.000Z'))?.toISOString()).toBe(
      '2026-03-15T08:00:00.000Z',
    );
  });

  it('monthly: steps back across a skipped short month (day 31)', () => {
    // Occurrences: Jan 31, Mar 31 (Feb has no 31st), May 31 (Apr skipped)…
    // The predecessor of May 31 is Mar 31 — the look-back must clear the
    // two-month gap, which a fixed one-period window would miss.
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthDay: 31,
      tz: 'UTC',
      anchor: '2026-01-31T08:00:00.000Z',
    };
    expect(previousOccurrence(rule, new Date('2026-05-31T08:00:00.000Z'))?.toISOString()).toBe(
      '2026-03-31T08:00:00.000Z',
    );
  });

  it('monthly: leap-only Feb 29 every 12 months steps back ~4 years', () => {
    // Feb 29 exists only in leap years, so occurrences are 2024, 2028, 2032…
    // The look-back must span the multi-year gap, not a fixed month window.
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 12,
      byMonthDay: 29,
      tz: 'UTC',
      anchor: '2024-02-29T08:00:00.000Z',
    };
    expect(previousOccurrence(rule, new Date('2032-02-29T08:00:00.000Z'))?.toISOString()).toBe(
      '2028-02-29T08:00:00.000Z',
    );
  });
});

describe('nextOccurrence — impossible rules (raw API)', () => {
  it('returns a far-future instant, never a past one, when no occurrence exists', () => {
    // Every 12 months on the 31st, anchored in April (30 days): no month in
    // the series ever has a 31st. A past return value would make the sweep
    // re-fire the row every tick (notification storm).
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 12,
      byMonthDay: 31,
      tz: 'Europe/Berlin',
      anchor: '2026-04-15T07:00:00.000Z',
    };
    const after = new Date('2026-06-10T12:00:00.000Z');
    const next = nextOccurrence(rule, after);
    expect(next.getTime()).toBeGreaterThan(Date.UTC(9000, 0, 1));
  });
});
