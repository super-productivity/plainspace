import { Show, createSignal, onCleanup } from 'solid-js';
import { api } from '../../lib/api';
import { addItem } from '../../lib/store';
import styles from './AddItem.module.css';

interface AddItemProps {
  slug: string;
  listId: string;
  placeholder?: string;
}

// Delay before the loading spinner appears. Fast submits (<200ms) finish
// before this elapses, so the + icon stays put — no flicker.
const SPINNER_DELAY_MS = 200;

export default function AddItem(props: AddItemProps) {
  const [text, setText] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [showSpinner, setShowSpinner] = createSignal(false);
  const [error, setError] = createSignal('');
  let inputRef: HTMLInputElement | undefined;
  let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
  const errorId = 'add-item-error';

  onCleanup(() => clearTimeout(spinnerTimer));

  const canSubmit = () => text().trim().length > 0 && !submitting();

  function handleFormClick(e: MouseEvent) {
    if (e.target !== inputRef) inputRef?.focus();
  }

  function handleInput(value: string) {
    setText(value);
    if (error()) setError('');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !text()) return;
    e.preventDefault();
    setText('');
    setError('');
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const val = text().trim();
    if (!val || submitting()) return;

    setSubmitting(true);
    setError('');
    spinnerTimer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    try {
      // Render the new row from the POST response instead of waiting for the
      // SSE `item.created` echo: if the stream isn't subscribed yet when the
      // server broadcasts, the creator would otherwise miss its own item.
      // addItem dedupes by id, so the later echo is a no-op.
      const { item } = await api.createItem(props.slug, { text: val, listId: props.listId });
      addItem(item);
      setText('');
      requestAnimationFrame(() => inputRef?.focus());
    } catch {
      setError("Couldn't add task. Try again.");
    } finally {
      clearTimeout(spinnerTimer);
      setShowSpinner(false);
      setSubmitting(false);
    }
  }

  return (
    <form
      class={`${styles.form} ${submitting() ? styles.submitting : ''} ${
        error() ? styles.error : ''
      }`}
      onSubmit={handleSubmit}
      onClick={handleFormClick}
      aria-busy={submitting() ? 'true' : undefined}
    >
      <div class={styles.field}>
        <input
          ref={inputRef}
          class={styles.input}
          type="text"
          value={text()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder ?? 'Add an item…'}
          maxLength={500}
          aria-invalid={error() ? 'true' : undefined}
          aria-describedby={error() ? errorId : undefined}
          data-testid="add-item-input"
        />
        <Show when={error()}>
          <span class={styles.errorMessage} id={errorId}>
            {error()}
          </span>
        </Show>
      </div>
      <button
        type="submit"
        class={styles.button}
        disabled={!canSubmit()}
        aria-label={submitting() ? 'Adding item' : 'Add item'}
        data-testid="add-item-button"
      >
        <Show
          when={showSpinner()}
          fallback={
            <svg
              class={styles.icon}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          }
        >
          <span class={styles.spinner} aria-hidden="true" />
        </Show>
      </button>
    </form>
  );
}
