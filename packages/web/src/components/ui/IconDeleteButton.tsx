import styles from './IconDeleteButton.module.css';

interface IconDeleteButtonProps {
  onClick: () => void;
  /** Used for both aria-label and the native tooltip, e.g. "Delete poll". */
  label: string;
  disabled?: boolean;
  testId?: string;
}

// The small trash-icon button shown in card headers (panels + checklist lists).
// Extracted so PanelCard and ListCard share one source for the icon and its
// hover/focus styling instead of each carrying a verbatim copy.
export default function IconDeleteButton(props: IconDeleteButtonProps) {
  return (
    <button
      type="button"
      class={styles.button}
      onClick={() => props.onClick()}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      data-testid={props.testId}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </svg>
    </button>
  );
}
