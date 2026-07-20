import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { onMount, Show } from 'solid-js';
import styles from '../../routes/Legal.module.css';

interface LegalPageProps {
  title: string;
  meta?: string;
  children: JSX.Element;
}

export default function LegalPage(props: LegalPageProps) {
  onMount(() => {
    document.title = `${props.title} — Plainspace`;
  });

  return (
    <main class={styles.container}>
      <h1 class={styles.title}>{props.title}</h1>
      <Show when={props.meta}>
        <p class={styles.meta}>{props.meta}</p>
      </Show>

      <div class={styles.body}>{props.children}</div>

      <A href="/" class={styles.backLink}>
        ← Back
      </A>
    </main>
  );
}
