import { createSignal, onMount, untrack } from 'solid-js';

interface InlineRenameProps {
  /** Initial text, seeded once. Later changes to this value are ignored so a
   *  concurrent edit elsewhere can't overwrite what the user is typing. */
  value: string;
  /** Trimmed text, on Enter or blur. The caller decides whether it changed. */
  onCommit: (value: string) => void;
  /** On Escape. */
  onCancel: () => void;
  class?: string;
  ariaLabel: string;
  testId?: string;
}

// A heading that turned into an editable field: seeds a local draft, focuses +
// selects on mount, commits on Enter/blur, cancels on Escape. The draft is local
// (not bound to `value`) so an external update to the source title can't clobber
// in-progress typing. Used by checklist (ListCard) and poll/timeslot (PanelCard)
// headers so the focus + commit-ordering logic lives in one place.
export default function InlineRename(props: InlineRenameProps) {
  const [draft, setDraft] = createSignal(untrack(() => props.value));
  let ref: HTMLInputElement | undefined;
  // Guards the blur that fires as the field unmounts after Enter/Escape, so the
  // action can't run twice.
  let settled = false;

  onMount(() => {
    ref?.focus();
    ref?.select();
  });

  function commit() {
    if (settled) return;
    settled = true;
    props.onCommit(draft().trim());
  }
  function cancel() {
    if (settled) return;
    settled = true;
    props.onCancel();
  }

  return (
    <input
      ref={ref}
      class={props.class}
      value={draft()}
      onInput={(e) => setDraft(e.currentTarget.value)}
      aria-label={props.ariaLabel}
      data-testid={props.testId}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
    />
  );
}
