import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import styles from './TextField.module.css';

type TextFieldSize = 'sm' | 'md';

interface TextFieldProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class'> {
  label?: JSX.Element;
  optionalText?: string;
  helperText?: JSX.Element;
  error?: JSX.Element;
  fieldClass?: string;
  inputClass?: string;
  size?: TextFieldSize;
}

export default function TextField(props: TextFieldProps) {
  const [local, rest] = splitProps(props, [
    'label',
    'optionalText',
    'helperText',
    'error',
    'fieldClass',
    'inputClass',
    'size',
    'id',
    'aria-describedby',
  ]);
  const size = () => local.size ?? 'md';
  const fieldClass = () => [styles.field, local.fieldClass ?? ''].filter(Boolean).join(' ');
  const inputClass = () =>
    [styles.input, styles[size()], local.inputClass ?? ''].filter(Boolean).join(' ');
  const helperId = () => (local.id && local.helperText ? `${local.id}-helper` : undefined);
  const errorId = () => (local.id && local.error ? `${local.id}-error` : undefined);
  const describedBy = () =>
    [local['aria-describedby'], helperId(), errorId()].filter(Boolean).join(' ') || undefined;

  return (
    <div class={fieldClass()}>
      <Show when={local.label}>
        <label class={styles.label} for={local.id}>
          {local.label}
          <Show when={local.optionalText}>
            {' '}
            <span class={styles.optional}>{local.optionalText}</span>
          </Show>
        </label>
      </Show>
      <input
        {...rest}
        id={local.id}
        class={inputClass()}
        aria-invalid={local.error ? 'true' : undefined}
        aria-describedby={describedBy()}
      />
      <Show when={local.helperText}>
        <p id={helperId()} class={styles.helper}>
          {local.helperText}
        </p>
      </Show>
      <Show when={local.error}>
        <p id={errorId()} class={styles.error}>
          {local.error}
        </p>
      </Show>
    </div>
  );
}
