import { A } from '@solidjs/router';
import { useDocumentTitle } from '../lib/document-title';
import styles from './Home.module.css';

export default function NotFound() {
  useDocumentTitle(() => 'Page not found — Plainspace');

  return (
    <main class={styles.container}>
      <div class={styles.hero}>
        <h1 class={styles.title}>Page not found</h1>
        {/* Also the fallback for a missing Space, so this has to read right for
            both a bad Space link and any other unknown path. */}
        <p class={styles.subtitle}>Error 404. We couldn't find that page.</p>
        {/* /spaces rather than /, which bounces straight back into the last
            open Space. Not labelled "Browse Spaces": there is no public
            directory, and a first-time visitor lands on onboarding. */}
        <A href="/spaces" style={{ 'margin-top': '16px', display: 'inline-block' }}>
          Go to Plainspace
        </A>
      </div>
    </main>
  );
}
