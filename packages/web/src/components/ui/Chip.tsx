import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import styles from './Chip.module.css';

interface ChipProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class'> {
  /** Selected state within a single-select group: applies the active styling and
   *  sets aria-pressed. Omit for one-tap action chips (no toggle semantics). */
  active?: boolean;
  class?: string;
}

/** A pill-shaped button. Used standalone as a one-tap action or, with `active`,
 *  as a member of a single-select group (time-of-day, recurrence). */
export default function Chip(props: ChipProps) {
  const [local, rest] = splitProps(props, ['active', 'class']);
  const className = () =>
    [styles.chip, local.active ? styles.active : '', local.class ?? ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      {...rest}
      class={className()}
      aria-pressed={local.active === undefined ? undefined : local.active}
    />
  );
}
