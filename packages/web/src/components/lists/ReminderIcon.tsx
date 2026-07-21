import { Switch, Match } from 'solid-js';

/** The six states a schedule button can be in. */
export type ReminderState =
  | 'empty'
  | 'once'
  | 'once-overdue'
  | 'repeat'
  | 'resting'
  | 'repeat-overdue';

/** Gapped ring + arrowhead: the recurring frame, so a repeating item stays
 *  distinguishable from a one-off in every state it shares with one. */
const RepeatRing = () => (
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.03 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>
);

const Hands = () => <path d="M12 7v5l3 2" />;

/** Replaces the hands when the fire time has passed and the task isn't done. */
const Bang = () => (
  <>
    <path d="M12 8v4.5" />
    <path d="M12 16.2h.01" />
  </>
);

/**
 * One icon per schedule state — the state rides on the icon's shape (ring and
 * inner mark), not on stacked glyphs beside it, so the badge reads as a single
 * mark and "late" never depends on colour alone.
 */
export default function ReminderIcon(props: { state: ReminderState }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {/* 'once' is the fallback, not a Match: an unhandled state then degrades
          to the plain clock instead of rendering an empty box. */}
      <Switch
        fallback={
          <>
            <circle cx="12" cy="12" r="9" />
            <Hands />
          </>
        }
      >
        {/* Empty: clock with a + tucked into the ring's gap — the "add a
            reminder" affordance, without a separate corner badge. */}
        <Match when={props.state === 'empty'}>
          <path d="M20.7 14.3A9 9 0 1 0 14.3 20.7" />
          <Hands />
          <path d="M17 20h5" />
          <path d="M19.5 17.5v5" />
        </Match>
        <Match when={props.state === 'repeat'}>
          <RepeatRing />
          <Hands />
        </Match>
        {/* Resting (checked, waiting to reopen): the hands become a check. */}
        <Match when={props.state === 'resting'}>
          <RepeatRing />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </Match>
        {/* Overdue keeps its ring — closed for a one-off, arrowheaded for a
            recurring occurrence — so "late" doesn't erase "repeats". */}
        <Match when={props.state === 'once-overdue'}>
          <circle cx="12" cy="12" r="9" />
          <Bang />
        </Match>
        <Match when={props.state === 'repeat-overdue'}>
          <RepeatRing />
          <Bang />
        </Match>
      </Switch>
    </svg>
  );
}
