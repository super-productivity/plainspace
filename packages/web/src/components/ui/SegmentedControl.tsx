import { For, splitProps } from 'solid-js';
import styles from './SegmentedControl.module.css';

interface SegmentedControlOption {
  value: string;
  label: string;
  testId?: string;
}

interface SegmentedControlProps {
  ariaLabel: string;
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  class?: string;
}

export default function SegmentedControl(props: SegmentedControlProps) {
  const [local] = splitProps(props, ['ariaLabel', 'options', 'value', 'onChange', 'class']);
  const className = () => [styles.control, local.class ?? ''].filter(Boolean).join(' ');

  return (
    <nav class={className()} aria-label={local.ariaLabel}>
      <For each={local.options}>
        {(option) => (
          <button
            class={`${styles.button} ${local.value === option.value ? styles.active : ''}`}
            type="button"
            aria-pressed={local.value === option.value}
            onClick={() => local.onChange(option.value)}
            data-testid={option.testId}
          >
            {option.label}
          </button>
        )}
      </For>
    </nav>
  );
}
