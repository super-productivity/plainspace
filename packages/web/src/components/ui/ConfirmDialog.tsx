import { Show, createSignal } from 'solid-js';
import Button from './Button';
import Dialog from './Dialog';
import TextField from './TextField';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /**
   * Optional free-text input; its trimmed value is passed to onConfirm.
   * Set `confirmValue` to require an exact match (e.g. type the name to
   * confirm a destructive action) — the confirm button stays disabled until
   * the trimmed input equals it.
   */
  input?: { label: string; optionalText?: string; placeholder?: string; confirmValue?: string };
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const [value, setValue] = createSignal('');
  const confirmDisabled = () =>
    props.input?.confirmValue !== undefined && value().trim() !== props.input.confirmValue.trim();

  return (
    <Dialog
      ariaLabel={props.title}
      onClose={() => props.onCancel()}
      class={styles.dialog}
      data-testid="confirm-dialog"
    >
      <h2 class={styles.title}>{props.title}</h2>
      <p class={styles.message}>{props.message}</p>
      <Show when={props.input}>
        {(input) => (
          <TextField
            id="confirm-dialog-input"
            label={input().label}
            optionalText={input().optionalText}
            placeholder={input().placeholder}
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            data-testid="confirm-dialog-input"
          />
        )}
      </Show>
      <div class={styles.actions}>
        <Button
          variant="ghost"
          onClick={() => props.onCancel()}
          data-testid="confirm-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant={props.danger ? 'danger' : 'primary'}
          disabled={confirmDisabled()}
          onClick={() => props.onConfirm(value().trim())}
          data-testid="confirm-dialog-confirm"
        >
          {props.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
