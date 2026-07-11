import { Index, Show, createSignal } from 'solid-js';
import { api, ApiError } from '../../lib/api';
import { Button, Dialog, TextField } from '../ui';
import {
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION_LENGTH,
  MIN_POLL_OPTIONS,
  MAX_TIMESLOT_SLOT_LENGTH,
  MAX_TIMESLOT_SLOTS,
  MAX_TIMESLOT_TITLE_LENGTH,
  MIN_TIMESLOT_SLOTS,
  MAX_CHECKLIST_TITLE_LENGTH,
} from '@plainspace/shared';
import styles from './AddPanelButton.module.css';

interface AddPanelButtonProps {
  slug: string;
}

type PanelType = 'poll' | 'timeslot' | 'checklist';

// Card chooser entries -- one card per panel type. Rendered before the form so
// adding a future panel type is one more entry, not another tab.
const PANEL_TYPES: { type: PanelType; label: string; description: string; testId: string }[] = [
  {
    type: 'checklist',
    label: 'Checklist',
    description: 'A small side list of things to tick off.',
    testId: 'add-panel-type-checklist',
  },
  {
    type: 'poll',
    label: 'Poll',
    description: 'Ask a question, one pick each.',
    testId: 'add-panel-type-poll',
  },
  {
    type: 'timeslot',
    label: 'Find a time slot',
    description: 'Propose times, see who is free.',
    testId: 'add-panel-type-timeslot',
  },
];

export default function AddPanelButton(props: AddPanelButtonProps) {
  const [open, setOpen] = createSignal(false);
  // null = the card chooser is showing; a type = that type's form is showing.
  const [panelType, setPanelType] = createSignal<PanelType | null>(null);
  const [question, setQuestion] = createSignal('');
  const [options, setOptions] = createSignal<string[]>(['', '']);
  const [title, setTitle] = createSignal('');
  const [slots, setSlots] = createSignal<string[]>(['', '']);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  // Shared focus refs -- the visible form (poll options / time slots) owns them
  // while it's mounted; reset() and switching type clear them.
  const optionRefs: (HTMLInputElement | undefined)[] = [];

  function reset() {
    setPanelType(null);
    setQuestion('');
    setOptions(['', '']);
    setTitle('');
    setSlots(['', '']);
    setError('');
    setSubmitting(false);
    optionRefs.length = 0;
  }

  function closeDialog() {
    if (submitting()) return;
    setOpen(false);
    reset();
  }

  function selectType(type: PanelType) {
    setPanelType(type);
    setError('');
    optionRefs.length = 0;
  }

  // Back to the chooser. Field values are kept so a peek back doesn't lose work.
  function backToChooser() {
    if (submitting()) return;
    setPanelType(null);
    setError('');
    optionRefs.length = 0;
  }

  const isPoll = () => panelType() === 'poll';
  const isChecklist = () => panelType() === 'checklist';

  function nonEmptyCount(values: string[]) {
    return values.filter((v) => v.trim().length > 0).length;
  }

  // Client mirror of CreatePanelSchema -- the server still validates. A
  // checklist is created empty, so only its title is required.
  const canSubmit = () => {
    if (submitting()) return false;
    if (isPoll())
      return question().trim().length > 0 && nonEmptyCount(options()) >= MIN_POLL_OPTIONS;
    if (isChecklist()) return title().trim().length > 0;
    return title().trim().length > 0 && nonEmptyCount(slots()) >= MIN_TIMESLOT_SLOTS;
  };

  // The active row-editor's state, keyed by panel type, so add/remove/focus
  // share one implementation across poll options and time slots.
  const rows = () => (isPoll() ? options() : slots());
  const setRows = (next: string[]) => (isPoll() ? setOptions(next) : setSlots(next));
  const minRows = () => (isPoll() ? MIN_POLL_OPTIONS : MIN_TIMESLOT_SLOTS);
  const maxRows = () => (isPoll() ? MAX_POLL_OPTIONS : MAX_TIMESLOT_SLOTS);
  const maxRowLength = () => (isPoll() ? MAX_POLL_OPTION_LENGTH : MAX_TIMESLOT_SLOT_LENGTH);

  function updateRow(idx: number, value: string) {
    setRows(rows().map((o, i) => (i === idx ? value : o)));
  }

  function addRow() {
    if (rows().length >= maxRows()) return;
    const nextIdx = rows().length;
    setRows([...rows(), '']);
    requestAnimationFrame(() => optionRefs[nextIdx]?.focus());
  }

  function removeRow(idx: number) {
    if (rows().length <= minRows()) return;
    setRows(rows().filter((_, i) => i !== idx));
    // Keep refs in lockstep with rendered rows -- otherwise the focus target
    // below points at a detached input.
    optionRefs.splice(idx, 1);
    requestAnimationFrame(() => {
      const next = optionRefs[idx] ?? optionRefs[optionRefs.length - 1];
      next?.focus();
    });
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit()) return;
    setSubmitting(true);
    setError('');
    try {
      if (isPoll()) {
        await api.createPanel(props.slug, {
          type: 'poll',
          question: question().trim(),
          options: options()
            .map((o) => o.trim())
            .filter((o) => o.length > 0),
        });
      } else if (isChecklist()) {
        await api.createPanel(props.slug, { type: 'checklist', title: title().trim() });
      } else {
        await api.createPanel(props.slug, {
          type: 'timeslot',
          title: title().trim(),
          slots: slots()
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        });
      }
      // Panel arrives via SSE -- do NOT add from the HTTP response (matches
      // AddItem.tsx). addPanel's id-dedup in the store is only a safety net.
      setOpen(false);
      reset();
    } catch (err) {
      const fallback = isPoll()
        ? 'Could not create poll. Try again.'
        : isChecklist()
          ? 'Could not create checklist. Try again.'
          : 'Could not create time slot. Try again.';
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }

  const dialogTitle = () =>
    !panelType()
      ? 'Add a panel'
      : isPoll()
        ? 'New poll'
        : isChecklist()
          ? 'New checklist'
          : 'New time slot';
  const rowsLabel = () => (isPoll() ? 'Options' : 'Slots');
  const rowTestId = () => (isPoll() ? 'add-panel-option' : 'add-panel-slot');
  const rowNoun = () => (isPoll() ? 'Option' : 'Slot');

  return (
    <>
      <Button
        variant="ghost"
        fullWidth
        class={styles.trigger}
        onClick={() => setOpen(true)}
        data-testid="add-panel-button"
      >
        + Add panel
      </Button>
      <Show when={open()}>
        <Dialog
          ariaLabel="Add panel"
          onClose={closeDialog}
          class={styles.dialog}
          data-testid="add-panel-dialog"
        >
          <h2 class={styles.dialogTitle}>{dialogTitle()}</h2>

          <Show
            when={panelType()}
            fallback={
              <div class={styles.chooser}>
                <Index each={PANEL_TYPES}>
                  {(entry) => (
                    <button
                      type="button"
                      class={styles.typeCard}
                      onClick={() => selectType(entry().type)}
                      data-testid={entry().testId}
                    >
                      <span class={styles.typeCardTitle}>{entry().label}</span>
                      <span class={styles.typeCardDesc}>{entry().description}</span>
                    </button>
                  )}
                </Index>
              </div>
            }
          >
            <form class={styles.form} onSubmit={handleSubmit}>
              <Show
                when={isPoll()}
                fallback={
                  <TextField
                    id="add-panel-title"
                    label="Title"
                    value={title()}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                    maxLength={
                      isChecklist() ? MAX_CHECKLIST_TITLE_LENGTH : MAX_TIMESLOT_TITLE_LENGTH
                    }
                    placeholder={isChecklist() ? 'Name your checklist' : 'What are you scheduling?'}
                    autofocus
                    data-testid="add-panel-title"
                  />
                }
              >
                <TextField
                  id="add-panel-question"
                  label="Question"
                  value={question()}
                  onInput={(e) => setQuestion(e.currentTarget.value)}
                  maxLength={MAX_POLL_QUESTION_LENGTH}
                  placeholder="What do you want to ask?"
                  autofocus
                  data-testid="add-panel-question"
                />
              </Show>
              <Show when={!isChecklist()}>
                <div class={styles.optionsBlock}>
                  <span class={styles.optionsLabel}>{rowsLabel()}</span>
                  {/* `<Index>` is keyed by position, not value -- two empty rows
                    ('', '') would collide under `<For>` and Solid would
                    unmount/remount the row mid-keystroke, dropping focus. */}
                  <Index each={rows()}>
                    {(value, idx) => (
                      <div class={styles.optionRow}>
                        <input
                          ref={(el) => {
                            optionRefs[idx] = el;
                          }}
                          class={styles.optionInput}
                          type="text"
                          value={value()}
                          onInput={(e) => updateRow(idx, e.currentTarget.value)}
                          maxLength={maxRowLength()}
                          placeholder={`${rowNoun()} ${idx + 1}`}
                          aria-label={`${rowNoun()} ${idx + 1}`}
                          data-testid={rowTestId()}
                        />
                        <Show when={rows().length > minRows()}>
                          <button
                            type="button"
                            class={styles.removeRow}
                            onClick={() => removeRow(idx)}
                            aria-label={`Remove ${rowNoun().toLowerCase()} ${idx + 1}`}
                          >
                            ×
                          </button>
                        </Show>
                      </div>
                    )}
                  </Index>
                  <Show when={rows().length < maxRows()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={addRow}
                      data-testid={isPoll() ? 'add-panel-add-option' : 'add-panel-add-slot'}
                    >
                      + Add {rowNoun().toLowerCase()}
                    </Button>
                  </Show>
                </div>
              </Show>
              <Show when={error()}>
                <p class={styles.error} role="alert">
                  {error()}
                </p>
              </Show>
              <div class={styles.actions}>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={backToChooser}
                  disabled={submitting()}
                  data-testid="add-panel-back"
                >
                  ← Back
                </Button>
                <Button
                  type="submit"
                  disabled={!canSubmit()}
                  data-testid={
                    isPoll()
                      ? 'add-panel-submit'
                      : isChecklist()
                        ? 'add-panel-checklist-submit'
                        : 'add-panel-timeslot-submit'
                  }
                >
                  {submitting()
                    ? 'Creating…'
                    : isPoll()
                      ? 'Create poll'
                      : isChecklist()
                        ? 'Create checklist'
                        : 'Create time slot'}
                </Button>
              </div>
            </form>
          </Show>
        </Dialog>
      </Show>
    </>
  );
}
