import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import styles from './Home.module.css';

export default function NotFound() {
  onMount(() => {
    document.title = 'Page not found — Plainspace';
  });

  return (
    <main class={styles.container}>
      <div class={styles.hero}>
        <h1 class={styles.title}>Page not found</h1>
        <p class={styles.subtitle}>Error 404. This Space doesn't exist.</p>
        <A href="/spaces" style={{ 'margin-top': '16px', display: 'inline-block' }}>
          Browse Spaces
        </A>
      </div>
    </main>
  );
}
