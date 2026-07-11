import { A } from '@solidjs/router';
import styles from './Home.module.css';

export default function NotFound() {
  return (
    <div class={styles.container}>
      <div class={styles.hero}>
        <h1 class={styles.title}>404</h1>
        <p class={styles.subtitle}>This space doesn't exist.</p>
        <A href="/" style={{ 'margin-top': '16px', display: 'inline-block' }}>
          Create a new Space
        </A>
      </div>
    </div>
  );
}
