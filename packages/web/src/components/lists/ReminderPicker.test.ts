import { describe, expect, it } from 'vitest';
import { buildRepeat, describeRepeat, monthGrid, ordinal, repeatKeyFor } from './ReminderPicker';

// Build a local instant the same way the picker does (LOCAL constructor), then
// hand its ISO string to buildRepeat — mirroring the real commit path.
function localIso(y: number, mo: number, d: number, h = 9, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

describe('buildRepeat', () => {
  it('derives byWeekday from the fire instant for weekly rules', () => {
    // 2026-06-22 is a Monday → token MO.
    const rule = buildRepeat('weekly', localIso(2026, 5, 22));
    expect(rule).toMatchObject({ freq: 'weekly', interval: 1, byWeekday: ['MO'] });
  });

  it('derives byMonthDay from the fire instant for monthly rules', () => {
    const rule = buildRepeat('monthly', localIso(2026, 0, 31));
    expect(rule).toMatchObject({ freq: 'monthly', interval: 1, byMonthDay: 31 });
  });

  it('emits a plain daily rule with no weekday/monthday', () => {
    const rule = buildRepeat('daily', localIso(2026, 5, 22));
    expect(rule).toMatchObject({ freq: 'daily', interval: 1 });
    expect(rule).not.toHaveProperty('byWeekday');
    expect(rule).not.toHaveProperty('byMonthDay');
  });

  it('captures a non-empty tz string (the browser zone)', () => {
    const rule = buildRepeat('daily', localIso(2026, 5, 22));
    expect(typeof rule?.tz).toBe('string');
    expect(rule?.tz.length).toBeGreaterThan(0);
  });

  it('returns null for the no-repeat key', () => {
    expect(buildRepeat('none', localIso(2026, 5, 22))).toBeNull();
  });

  it('pins the full Mon–Fri set for the weekdays option, regardless of fire day', () => {
    // Saturday 2026-06-20 — the set must NOT collapse to the fire day's weekday.
    const rule = buildRepeat('weekdays', localIso(2026, 5, 20));
    expect(rule).toMatchObject({
      freq: 'weekly',
      interval: 1,
      byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'],
    });
  });
});

describe('repeatKeyFor', () => {
  it('maps a stored rule back to its option key', () => {
    expect(repeatKeyFor(null)).toBe('none');
    expect(
      repeatKeyFor({ freq: 'weekly', interval: 2, tz: 'UTC', anchor: '2026-06-22T07:00:00.000Z' }),
    ).toBe('biweekly');
  });

  it('disambiguates the Mon–Fri set from a plain weekly rule', () => {
    expect(
      repeatKeyFor({
        freq: 'weekly',
        interval: 1,
        byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'],
        tz: 'UTC',
        anchor: '2026-06-22T07:00:00.000Z',
      }),
    ).toBe('weekdays');
    expect(
      repeatKeyFor({
        freq: 'weekly',
        interval: 1,
        byWeekday: ['TU'],
        tz: 'UTC',
        anchor: '2026-06-22T07:00:00.000Z',
      }),
    ).toBe('weekly');
  });
});

describe('describeRepeat', () => {
  it('phrases the Mon–Fri set as "every weekday"', () => {
    expect(
      describeRepeat({ freq: 'weekly', interval: 1, byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'] }),
    ).toBe('every weekday');
  });

  it('phrases a single-day weekly rule with the weekday name', () => {
    expect(describeRepeat({ freq: 'weekly', interval: 1, byWeekday: ['TU'] })).toBe(
      'weekly on Tuesday',
    );
  });
});

describe('monthGrid', () => {
  it('starts on Monday and covers the whole month in whole weeks', () => {
    // June 2026: the 1st is a Monday, so no lead days; 30 days → exactly 5 weeks.
    const cells = monthGrid(new Date(2026, 5, 1));
    expect(cells.length % 7).toBe(0);
    // Monday-first: every cell at a week boundary is a Monday (getDay() === 1).
    for (let i = 0; i < cells.length; i += 7) {
      expect(cells[i].getDay()).toBe(1);
    }
    // The grid spans every day of the target month.
    const inMonth = cells.filter((d) => d.getMonth() === 5);
    expect(inMonth).toHaveLength(30);
    expect(inMonth[0].getDate()).toBe(1);
    expect(inMonth[inMonth.length - 1].getDate()).toBe(30);
  });

  it('includes lead days from the previous month for a mid-week 1st', () => {
    // Feb 2026: the 1st is a Sunday → six lead days (Mon–Sat of the prior week).
    const cells = monthGrid(new Date(2026, 1, 1));
    expect(cells[0].getDay()).toBe(1); // Monday
    expect(cells[0].getMonth()).toBe(0); // January lead day
    expect(cells.length % 7).toBe(0);
  });

  it('collapses a 28-day February starting Monday to 4 weeks with no phantom row', () => {
    // Feb 2027: the 1st is a Monday and the month is 28 days → exactly 4 weeks.
    // Regression guard: the trim must not leave a trailing all-March week.
    const cells = monthGrid(new Date(2027, 1, 1));
    expect(cells).toHaveLength(28);
    // Every cell is in February (no lead or trailing neighbour-month days).
    expect(cells.every((d) => d.getMonth() === 1)).toBe(true);
    expect(cells[0].getDate()).toBe(1);
    expect(cells[27].getDate()).toBe(28);
  });

  it('keeps six weeks when the month genuinely needs them', () => {
    // Aug 2026: the 1st is a Saturday → 5 lead days + 31 days spills into a 6th
    // week, so the grid must be 42 cells (no week wrongly trimmed).
    const cells = monthGrid(new Date(2026, 7, 1));
    expect(cells).toHaveLength(42);
    expect(cells.filter((d) => d.getMonth() === 7)).toHaveLength(31);
  });
});

describe('ordinal', () => {
  it('renders the day suffix used by the monthly-skip hint', () => {
    expect(ordinal(31)).toBe('31st');
    expect(ordinal(28)).toBe('28th');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
  });
});
