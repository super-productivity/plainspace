import { Show, createUniqueId, type JSX } from 'solid-js';
import Button from './Button';
import styles from './DisclosureSection.module.css';

interface DisclosureSectionProps {
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
  /** What the toggle announces, when the title alone reads oddly after
      "Show"/"Hide" — e.g. title "Advanced" with label "advanced settings". */
  label?: string;
  /** Prefix for `<testId>-toggle-button` and `<testId>-body`. */
  testId?: string;
  /** Section chrome (padding, dividers) belongs to the surrounding surface. */
  class?: string;
  children: JSX.Element;
}

// Secondary settings that stay folded until asked for. Distinct from
// Collapsible: that folds a whole card on its title row and remembers the
// choice per device, so the heading itself is the button. Here the heading
// stays plain text next to a Show/Hide button, and the state is per-visit —
// a settings surface should open in the same, quiet state every time.
//
// The body uses `hidden` rather than Collapsible's `inert`: nothing needs to
// survive the fold, so dropping it out of the tab order and the a11y tree
// outright is both simpler and stricter.
export default function DisclosureSection(props: DisclosureSectionProps) {
  const bodyId = createUniqueId();
  const action = () => (props.open ? 'Hide' : 'Show');

  return (
    <section class={props.class}>
      <div class={styles.header}>
        <div class={styles.headingBlock}>
          {/* h3 suits the one caller (a panel titled by an h2). Take a level
              prop only once a surface actually needs a different one. */}
          <h3 class={styles.title}>{props.title}</h3>
          <Show when={props.description}>
            <p class={styles.description}>{props.description}</p>
          </Show>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => props.onToggle()}
          aria-controls={bodyId}
          aria-expanded={props.open}
          aria-label={`${action()} ${props.label ?? props.title}`}
          data-testid={props.testId ? `${props.testId}-toggle-button` : undefined}
        >
          {action()}
        </Button>
      </div>
      <div
        id={bodyId}
        class={styles.body}
        hidden={!props.open}
        data-testid={props.testId ? `${props.testId}-body` : undefined}
      >
        {props.children}
      </div>
    </section>
  );
}
