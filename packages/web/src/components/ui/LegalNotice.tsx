import styles from './LegalNotice.module.css';

interface LegalNoticeProps {
  /** The action that constitutes acceptance, e.g. "creating a Space", "joining this Space". */
  action: string;
}

export default function LegalNotice(props: LegalNoticeProps) {
  return (
    <p class={styles.notice}>
      By {props.action}, you agree to our{' '}
      <a href="/terms" target="_blank" rel="noopener noreferrer">
        Terms
      </a>{' '}
      and{' '}
      <a href="/privacy" target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>
      , and confirm you are at least 16.
    </p>
  );
}
