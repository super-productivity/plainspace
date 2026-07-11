import { A } from '@solidjs/router';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer class={styles.footer}>
      <A href="/impressum">Impressum</A>
      <span class={styles.separator} aria-hidden>
        ·
      </span>
      <A href="/contact">Contact</A>
      <span class={styles.separator} aria-hidden>
        ·
      </span>
      <A href="/privacy">Privacy</A>
      <span class={styles.separator} aria-hidden>
        ·
      </span>
      <A href="/terms">Terms</A>
      <span class={styles.separator} aria-hidden>
        ·
      </span>
      <A href="/subprocessors">Subprocessors</A>
      <span class={styles.separator} aria-hidden>
        ·
      </span>
      <A href="/dsa-notice">Report illegal content</A>
    </footer>
  );
}
