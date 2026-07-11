import { For, Show, createMemo, createSignal, onMount, untrack } from 'solid-js';
import type { RepeatRule } from '@plainspace/shared';
import { Chip, Popover } from '../ui';
import styles from './ReminderPicker.module.css';

// The rule the client sends — the server owns `anchor`, so it's never in the
// payload (it's stamped from the committed remindAt server-side).
type RepeatInput = Omit<RepeatRule, 'anchor'>;

interface ReminderPickerProps {
  anchor: HTMLElement;
  remindAt: string | null;
  repeat: RepeatRule | null;
  onSet: (iso: string | null, repeat: RepeatInput | null) => void;
  onClose: () => void;
}

const WEEKDAY_TOKENS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

// The five tokens of a Monday–Friday rule, in RFC weekday order.
const WEEKDAY_SET_TOKENS = ['MO', 'TU', 'WE', 'TH', 'FR'] as const;

interface RepeatOption {
  key: string;
  /** Terse label shown on the chip. */
  short: string;
  freq: RepeatRule['freq'] | null;
  interval: number;
  /** A fixed weekday set (the Mon–Fri option). When absent, a weekly rule
   *  derives its weekday from the chosen fire day at commit time. */
  byWeekday?: RepeatRule['byWeekday'];
}

// Most options store only {freq, interval} and derive byWeekday/byMonthDay at
// commit time from the chosen fire time so the rule and its first occurrence
// agree by construction. Mon–Fri is the exception: it pins a fixed byWeekday
// set — the server treats the chosen day as the DTSTART first fire, then follows
// the set thereafter (see next-occurrence.ts).
const REPEAT_OPTIONS: RepeatOption[] = [
  { key: 'none', short: 'Once', freq: null, interval: 1 },
  { key: 'daily', short: 'Daily', freq: 'daily', interval: 1 },
  {
    key: 'weekdays',
    short: 'Mon–Fri',
    freq: 'weekly',
    interval: 1,
    byWeekday: [...WEEKDAY_SET_TOKENS],
  },
  { key: 'weekly', short: 'Weekly', freq: 'weekly', interval: 1 },
  { key: 'biweekly', short: '2 weeks', freq: 'weekly', interval: 2 },
  { key: 'monthly', short: 'Monthly', freq: 'monthly', interval: 1 },
];

// True when a weekly rule's byWeekday is exactly the Mon–Fri set (order-agnostic).
function isWeekdaySet(byWeekday: RepeatRule['byWeekday']): boolean {
  if (!byWeekday || byWeekday.length !== WEEKDAY_SET_TOKENS.length) return false;
  const present = new Set(byWeekday);
  return WEEKDAY_SET_TOKENS.every((t) => present.has(t));
}

export function repeatKeyFor(rule: RepeatRule | null): string {
  if (!rule) return 'none';
  // interval===1 guard: an every-2-weeks weekday set (raw-API only) is not the
  // Mon–Fri option and must not borrow its label.
  if (rule.freq === 'weekly' && rule.interval === 1 && isWeekdaySet(rule.byWeekday))
    return 'weekdays';
  // Match the generic options only (those without a fixed weekday set), so a
  // plain weekly rule never resolves to the Mon–Fri option that shares its
  // freq+interval.
  const match = REPEAT_OPTIONS.find(
    (o) => o.freq === rule.freq && o.interval === rule.interval && !o.byWeekday,
  );
  return match?.key ?? 'none';
}

// Build the rule to commit, deriving byWeekday/byMonthDay from `fireIso` so the
// first occurrence satisfies the rule. getDay()/getDate() are browser-local,
// which agrees with `tz` only because tz IS the browser's zone — if tz ever
// becomes user-selectable, derive these in tz instead.
export function buildRepeat(key: string, fireIso: string): RepeatInput | null {
  const opt = REPEAT_OPTIONS.find((o) => o.key === key);
  if (!opt || !opt.freq) return null;
  const d = new Date(fireIso);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (opt.freq === 'weekly') {
    // Mon–Fri pins its set; a plain weekly derives the weekday from the fire day.
    const byWeekday = opt.byWeekday ?? [WEEKDAY_TOKENS[d.getDay()]];
    return { freq: 'weekly', interval: opt.interval, byWeekday, tz };
  }
  if (opt.freq === 'monthly') {
    return { freq: 'monthly', interval: opt.interval, byMonthDay: d.getDate(), tz };
  }
  return { freq: 'daily', interval: opt.interval, tz };
}

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const WEEKDAY_NAMES: Record<(typeof WEEKDAY_TOKENS)[number], string> = {
  SU: 'Sunday',
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
};

/** Lowercase cadence phrase ("weekly on Tuesday", "monthly on the 28th") —
 *  shared by the preview line here and the reminder tooltip in ListItem. */
export function describeRepeat(
  rule: Pick<RepeatRule, 'freq' | 'interval' | 'byWeekday' | 'byMonthDay'>,
): string {
  const n = rule.interval;
  if (rule.freq === 'daily') return n > 1 ? `every ${n} days` : 'daily';
  if (rule.freq === 'weekly') {
    if (n === 1 && isWeekdaySet(rule.byWeekday)) return 'every weekday';
    const base = n > 1 ? `every ${n} weeks` : 'weekly';
    const day = rule.byWeekday?.[0];
    return day ? `${base} on ${WEEKDAY_NAMES[day]}` : base;
  }
  const base = n > 1 ? `every ${n} months` : 'monthly';
  return rule.byMonthDay ? `${base} on the ${ordinal(rule.byMonthDay)}` : base;
}

// "reopens when it fires" because an occurrence reactivates the item
// server-side (unchecks it, returns it to To Do) — see reminder-sweep. Called
// only when a fire instant exists, so the rule is derived from it directly.
function repeatSummary(key: string, fireIso: string): string {
  const rule = buildRepeat(key, fireIso);
  if (!rule) return '';
  return ` · repeats ${describeRepeat(rule)} — reopens when it fires`;
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface Preset {
  key: string;
  label: string;
  at: Date;
}

const LAST_OFFSET_KEY = 'spaces.reminder.lastOffsetMin';

function getLastOffsetMin(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_OFFSET_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function setLastOffsetMin(savedAt: Date, now: Date) {
  const mins = Math.round((savedAt.getTime() - now.getTime()) / 60_000);
  if (mins <= 0) return;
  try {
    window.localStorage.setItem(LAST_OFFSET_KEY, String(mins));
  } catch {
    /* storage may be unavailable (private mode, quota) */
  }
}

function formatLastLabel(d: Date): string {
  const opts: Intl.DateTimeFormatOptions =
    d.getMinutes() === 0
      ? { weekday: 'short', hour: 'numeric' }
      : { weekday: 'short', hour: 'numeric', minute: '2-digit' };
  return d.toLocaleString([], opts);
}

function buildPresets(now: Date): Preset[] {
  const presets: Preset[] = [];

  const lastOffset = getLastOffsetMin();
  if (lastOffset !== null) {
    const at = new Date(now.getTime() + lastOffset * 60_000);
    presets.push({ key: 'last', label: `Same as last (${formatLastLabel(at)})`, at });
  }

  presets.push({ key: '1h', label: 'In 1 hour', at: new Date(now.getTime() + 60 * 60 * 1000) });

  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  if (evening.getTime() - now.getTime() > 30 * 60 * 1000) {
    presets.push({ key: 'evening', label: 'This evening', at: evening });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  presets.push({ key: 'tomorrow', label: 'Tomorrow 9 AM', at: tomorrow });

  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  nextWeek.setHours(9, 0, 0, 0);
  presets.push({ key: 'next-week', label: 'Next week', at: nextWeek });

  return presets;
}

function formatPreview(iso: string, now: Date): string {
  const d = new Date(iso);
  const dateStr = d.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return `${dateStr} — in the past`;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${dateStr} · in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${dateStr} · in ${hours}h`;
  const days = Math.round(hours / 24);
  return `${dateStr} · in ${days}d`;
}

// Local midnight of `d` — the day-level boundary used for the past-day guard.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Monday-first day cells covering every week that intersects `viewMonth`.
// Returns local Date objects (incl. lead/trail neighbour-month days), all built
// with the local constructor so the calendar stays in browser-local time —
// matching the tz invariant the rest of the picker relies on.
export function monthGrid(viewMonth: Date): Date[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  // JS getDay() is Sunday=0; shift so Monday=0 to count lead days before the 1st.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Whole weeks needed to cover the lead gap plus every day of the month — the
  // standard calendar-grid count (4 for a 28-day month starting Monday, 6 when a
  // long month spills past five weeks). Cells are local Dates incl. lead/trail
  // neighbour-month days, matching the browser-local tz invariant.
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells: Date[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    cells.push(new Date(year, month, 1 - lead + i));
  }
  return cells;
}

const WEEKDAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Time-of-day chips: minute-of-day each chip commits to. datetime-local exposes
// no seconds, so the picker is minute-precision by design (matches the native
// input and the existing behaviour).
const TIME_CHIPS: { key: string; label: string; hours: number; minutes: number }[] = [
  { key: 'morning', label: 'Morning', hours: 9, minutes: 0 },
  { key: 'afternoon', label: 'Afternoon', hours: 14, minutes: 0 },
  { key: 'evening', label: 'Evening', hours: 18, minutes: 0 },
];

function fullDateLabel(d: Date): string {
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayTestId(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ReminderPicker(props: ReminderPickerProps) {
  const initial = untrack(() => (props.remindAt ? new Date(props.remindAt) : null));
  // Single source of truth: the chosen local instant. The calendar, the
  // time-of-day chips and the exact-time input are three views of this value.
  const [selected, setSelected] = createSignal<Date | null>(initial);
  const [repeatKey, setRepeatKey] = createSignal(untrack(() => repeatKeyFor(props.repeat)));
  // Snapshot "now" at open so presets and the preview reference the same
  // instant; otherwise the relative label could drift while the popover is open.
  const openedAt = new Date();
  const presets = buildPresets(openedAt);
  const [viewMonth, setViewMonth] = createSignal(startOfMonth(untrack(selected) ?? openedAt));

  const previewIso = createMemo(() => selected()?.toISOString() ?? null);
  const isPast = createMemo(() => {
    const d = selected();
    return d !== null && d.getTime() < Date.now();
  });
  // The server skips months that lack the anchor day (29–31), so warn before
  // the rule is committed — otherwise a Jan 31 monthly reminder silently skips
  // February.
  const monthlySkipHint = createMemo(() => {
    const d = selected();
    if (!d || repeatKey() !== 'monthly') return null;
    const day = d.getDate();
    return day >= 29 ? `Months without a ${ordinal(day)} are skipped` : null;
  });

  const today = startOfDay(openedAt);
  const grid = createMemo(() => monthGrid(viewMonth()));
  // Disable month-prev once viewing the current month: no scheduling into past
  // months (each past day cell is also individually disabled).
  const atCurrentMonth = createMemo(() => {
    const v = viewMonth();
    return v.getFullYear() === today.getFullYear() && v.getMonth() === today.getMonth();
  });

  let presetsRef: HTMLDivElement | undefined;
  onMount(() => {
    // Focus the first quick-chip on open so the popover is keyboard-usable
    // immediately (focus return on close is owned by Popover). preventScroll
    // stops the page from jumping to the portaled chip. buildPresets always
    // yields >=3 chips ("In 1 hour"/"Tomorrow"/"Next week"), so one exists.
    presetsRef?.querySelector('button')?.focus({ preventScroll: true });
  });

  function commit() {
    const d = selected();
    if (d) {
      setLastOffsetMin(d, new Date());
      props.onSet(d.toISOString(), buildRepeat(repeatKey(), d.toISOString()));
    }
    props.onClose();
  }

  // Clearing the reminder clears any recurrence too (a rule with no next
  // occurrence is meaningless).
  function clear() {
    props.onSet(null, null);
    props.onClose();
  }

  function pickPreset(at: Date) {
    setLastOffsetMin(at, new Date());
    const iso = at.toISOString();
    props.onSet(iso, buildRepeat(repeatKey(), iso));
    props.onClose();
  }

  // Tap a day: set the date part of `selected`, keeping the existing time (or
  // default 09:00 if nothing chosen yet). Built with the LOCAL constructor so
  // the committed instant stays in browser-local time. Does NOT commit.
  function pickDay(day: Date) {
    const cur = selected();
    const h = cur ? cur.getHours() : 9;
    const mi = cur ? cur.getMinutes() : 0;
    setSelected(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi));
    // Keep the view in sync when an outside-month (lead/trail) cell is tapped so
    // the new selection stays visible, matching pickTime's behaviour.
    setViewMonth(startOfMonth(day));
  }

  // Tap a time-of-day chip: set the time part. If no day chosen yet, default to
  // today — but if today at that time is already past, advance to tomorrow so
  // Save isn't dead-ended. Built with the LOCAL constructor. Does NOT commit.
  function pickTime(hours: number, minutes: number) {
    const base = selected() ?? openedAt;
    let next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes);
    // If the resulting instant is already past (today, or a chosen today, at an
    // earlier time), roll to the next day so Save isn't dead-ended. A future day
    // is never affected.
    if (next.getTime() < Date.now()) {
      next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, hours, minutes);
    }
    setSelected(next);
    setViewMonth(startOfMonth(next));
  }

  // The exact-time native input parses its local string back into `selected`
  // via the existing helpers (never string-parsed inside a combine step).
  function onExactInput(value: string) {
    const iso = localInputToIso(value);
    setSelected(iso ? new Date(iso) : null);
  }

  const isSelectedDay = (d: Date): boolean => {
    const s = selected();
    return (
      s !== null &&
      s.getFullYear() === d.getFullYear() &&
      s.getMonth() === d.getMonth() &&
      s.getDate() === d.getDate()
    );
  };
  const isToday = (d: Date): boolean => startOfDay(d).getTime() === today.getTime();
  const isPastDay = (d: Date): boolean => startOfDay(d).getTime() < today.getTime();

  function dayAriaLabel(d: Date): string {
    const base = isToday(d) ? `Today, ${fullDateLabel(d)}` : fullDateLabel(d);
    if (isPastDay(d)) return `${base}, past day, unavailable`;
    if (isSelectedDay(d)) return `${base}, selected`;
    return base;
  }

  const timeChipActive = (hours: number, minutes: number): boolean => {
    const s = selected();
    return s !== null && s.getHours() === hours && s.getMinutes() === minutes;
  };

  // Roving arrow-key navigation across the grid is out of scope for v1 — the
  // day cells are natively tabbable buttons, which is keyboard-usable.

  return (
    <Popover
      anchor={props.anchor}
      onClose={props.onClose}
      class={styles.popover}
      data-testid="reminder-picker"
    >
      <div class={styles.chips} role="group" aria-label="Reminder presets" ref={presetsRef}>
        <For each={presets}>
          {(p) => (
            <Chip onClick={() => pickPreset(p.at)} data-testid={`reminder-preset-${p.key}`}>
              {p.label}
            </Chip>
          )}
        </For>
      </div>

      <div class={styles.calendar}>
        <div class={styles.monthNav}>
          <button
            type="button"
            class={styles.navButton}
            onClick={() => setViewMonth(addMonths(viewMonth(), -1))}
            disabled={atCurrentMonth()}
            aria-label="Previous month"
            data-testid="reminder-month-prev"
          >
            ‹
          </button>
          <span class={styles.monthLabel}>
            {viewMonth().toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            class={styles.navButton}
            onClick={() => setViewMonth(addMonths(viewMonth(), 1))}
            aria-label="Next month"
            data-testid="reminder-month-next"
          >
            ›
          </button>
        </div>
        <div class={styles.weekHeader} aria-hidden="true">
          <For each={WEEKDAY_HEADERS}>{(w) => <span>{w}</span>}</For>
        </div>
        <div class={styles.grid}>
          <For each={grid()}>
            {(d) => (
              <button
                type="button"
                class={`${styles.day} ${isToday(d) ? styles.today : ''} ${
                  isSelectedDay(d) ? styles.daySelected : ''
                } ${d.getMonth() !== viewMonth().getMonth() ? styles.dayOutside : ''}`}
                onClick={() => pickDay(d)}
                disabled={isPastDay(d)}
                // Only selectable days carry toggle semantics; past days are
                // disabled and shouldn't announce a pressed state.
                aria-pressed={isPastDay(d) ? undefined : isSelectedDay(d)}
                aria-label={dayAriaLabel(d)}
                data-testid={`reminder-day-${dayTestId(d)}`}
              >
                {d.getDate()}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class={styles.timeRow} role="group" aria-label="Time of day">
        <span class={styles.timeLabel}>Time of day</span>
        <div class={styles.chips}>
          <For each={TIME_CHIPS}>
            {(t) => (
              <Chip
                active={timeChipActive(t.hours, t.minutes)}
                onClick={() => pickTime(t.hours, t.minutes)}
                data-testid={`reminder-time-${t.key}`}
              >
                {t.label}
              </Chip>
            )}
          </For>
        </div>
      </div>

      <details class={styles.exact}>
        <summary class={styles.exactToggle} data-testid="reminder-exact-toggle">
          Set exact time
        </summary>
        <input
          type="datetime-local"
          class={styles.input}
          value={selected() ? isoToLocalInput(selected()!.toISOString()) : ''}
          onInput={(e) => onExactInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && selected() && !isPast()) commit();
          }}
          data-testid="reminder-input"
        />
      </details>

      <div class={styles.repeatRow} role="group" aria-label="Repeat">
        <span class={styles.timeLabel}>Repeat</span>
        <div class={styles.chips}>
          <For each={REPEAT_OPTIONS}>
            {(opt) => (
              <Chip
                active={repeatKey() === opt.key}
                onClick={() => setRepeatKey(opt.key)}
                data-testid={`reminder-repeat-${opt.key}`}
              >
                {opt.short}
              </Chip>
            )}
          </For>
        </div>
      </div>

      {/* Not a live region: the preview text changes on every day/time/repeat
          tap and the controls already announce their own state, so announcing
          the full summary each time would be noise. The skip warning below is
          the one discrete, actionable message worth voicing. */}
      <p
        class={`${styles.preview} ${isPast() ? styles.previewPast : ''}`}
        data-testid="reminder-preview"
      >
        <Show when={previewIso()} fallback="No time chosen yet">
          {formatPreview(previewIso()!, openedAt)}
          {repeatSummary(repeatKey(), previewIso()!)}
        </Show>
      </p>
      <Show when={monthlySkipHint()}>
        <p class={styles.preview} aria-live="polite" data-testid="reminder-monthly-hint">
          {monthlySkipHint()}
        </p>
      </Show>

      <div class={styles.actions}>
        {props.remindAt && (
          <button type="button" class={styles.clear} onClick={clear} data-testid="reminder-clear">
            Clear
          </button>
        )}
        <button
          type="button"
          class={styles.save}
          onClick={commit}
          disabled={!selected() || isPast()}
          data-testid="reminder-save"
        >
          Save
        </button>
      </div>
    </Popover>
  );
}

// First-of-month at local midnight, used to normalise the calendar view anchor.
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Add `delta` months, clamping to the 1st so day-of-month overflow (e.g. Jan 31
// → Mar) can't skip a month.
function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
