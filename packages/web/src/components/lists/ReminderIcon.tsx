import { Switch, Match } from 'solid-js';

/** The five states a schedule button can be in, most specific first. */
export type ReminderState = 'empty' | 'once' | 'repeat' | 'resting' | 'overdue';

/** Gapped ring + arrowhead: the recurring frame shared by repeat/resting/overdue. */
const RepeatRing = () => (
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.03 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>
);

const Hands = () => <path d="M12 7v5l3 2" />;

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
      <Switch>
        {/* Empty: clock with a + tucked into the ring's gap — the "add a
            reminder" affordance, without a separate corner badge. */}
        <Match when={props.state === 'empty'}>
          <path d="M20.7 14.3A9 9 0 1 0 14.3 20.7" />
          <Hands />
          <path d="M17 20h5" />
          <path d="M19.5 17.5v5" />
        </Match>
        <Match when={props.state === 'once'}>
          <circle cx="12" cy="12" r="9" />
          <Hands />
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
        {/* Overdue (fire passed while undone): the hands become a bang. */}
        <Match when={props.state === 'overdue'}>
          <RepeatRing />
          <path d="M12 8v4.5" />
          <path d="M12 16.2h.01" />
        </Match>
      </Switch>
    </svg>
  );
}
