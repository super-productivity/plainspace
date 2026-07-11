import { describe, expect, it } from 'vitest';
import { RepeatRuleInputSchema, UpdateItemSchema } from '@plainspace/shared';

const base = { freq: 'daily', interval: 1, tz: 'Europe/Berlin' } as const;

describe('RepeatRuleInputSchema', () => {
  it('accepts a minimal daily rule', () => {
    expect(RepeatRuleInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects byWeekday on a daily rule', () => {
    expect(RepeatRuleInputSchema.safeParse({ ...base, byWeekday: ['MO'] }).success).toBe(false);
  });

  it('accepts byWeekday on a weekly rule', () => {
    expect(
      RepeatRuleInputSchema.safeParse({ ...base, freq: 'weekly', byWeekday: ['MO', 'TH'] }).success,
    ).toBe(true);
  });

  it('rejects duplicate byWeekday tokens', () => {
    expect(
      RepeatRuleInputSchema.safeParse({ ...base, freq: 'weekly', byWeekday: ['MO', 'MO'] }).success,
    ).toBe(false);
  });

  it('rejects byMonthDay on a weekly rule', () => {
    expect(
      RepeatRuleInputSchema.safeParse({ ...base, freq: 'weekly', byMonthDay: 15 }).success,
    ).toBe(false);
  });

  it('accepts byMonthDay on a monthly rule', () => {
    expect(
      RepeatRuleInputSchema.safeParse({ ...base, freq: 'monthly', byMonthDay: 31 }).success,
    ).toBe(true);
  });

  it('rejects interval out of range', () => {
    expect(RepeatRuleInputSchema.safeParse({ ...base, interval: 0 }).success).toBe(false);
    expect(RepeatRuleInputSchema.safeParse({ ...base, interval: 366 }).success).toBe(false);
  });

  it('rejects an unknown time zone', () => {
    expect(RepeatRuleInputSchema.safeParse({ ...base, tz: 'Mars/Phobos' }).success).toBe(false);
  });

  it('accepts an alias time zone (Europe/Kiev) that may not be in supportedValuesOf', () => {
    // The constructor accepts the legacy alias even where Node lists only
    // Europe/Kyiv; set-membership validation would wrongly 422 it.
    expect(RepeatRuleInputSchema.safeParse({ ...base, tz: 'Europe/Kiev' }).success).toBe(true);
  });

  it('strips a client-sent anchor (server owns it)', () => {
    const parsed = RepeatRuleInputSchema.parse({ ...base, anchor: '1999-01-01T00:00:00.000Z' });
    expect('anchor' in parsed).toBe(false);
  });
});

describe('UpdateItemSchema repeat wiring', () => {
  it('accepts repeat:null', () => {
    expect(UpdateItemSchema.safeParse({ repeat: null }).success).toBe(true);
  });

  it('accepts a remindAt + repeat pair', () => {
    expect(
      UpdateItemSchema.safeParse({ remindAt: '2026-06-01T07:00:00.000Z', repeat: base }).success,
    ).toBe(true);
  });

  it('rejects an invalid repeat rule nested in an item update', () => {
    expect(UpdateItemSchema.safeParse({ repeat: { ...base, byWeekday: ['MO'] } }).success).toBe(
      false,
    );
  });
});
