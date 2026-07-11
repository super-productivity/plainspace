import { A } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { api, ApiError } from '../lib/api';
import { Button, LegalPage, TextField } from '../components/ui';
import styles from './Legal.module.css';

type Category = 'general' | 'bug' | 'privacy' | 'legal' | 'dsa-notice';

// Must match the ContactMessageSchema cap in @plainspace/shared.
const MESSAGE_MAX = 4000;

// Auto-attached to bug reports so we don't have to ask follow-up questions
// about the user's environment. We deliberately omit the page URL: this is a
// client-side-routed SPA, so `document.referrer` reflects the entry document,
// not the in-app route the user was on.
function bugDiagnostics(): string {
  const lines = [
    `App version: ${__APP_VERSION__}`,
    `Browser: ${navigator.userAgent}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
  ];
  return `\n\n---\nTechnical info (auto-attached)\n${lines.join('\n')}`;
}

export default function Contact() {
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [category, setCategory] = createSignal<Category>('general');
  const [message, setMessage] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [error, setError] = createSignal('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setSubmitting(true);
    setSent(false);
    setError('');

    try {
      const diagnostics = category() === 'bug' ? bugDiagnostics() : '';
      // Clamp the combined body to the server cap. Since the user's text is
      // already <= MESSAGE_MAX (textarea), this only ever clips the appended
      // diagnostics tail, never what the user wrote.
      const body = (message().trim() + diagnostics).slice(0, MESSAGE_MAX);
      await api.contact({
        ...(name().trim() ? { name: name().trim() } : {}),
        email: email().trim(),
        category: category(),
        message: body,
      });
      setSent(true);
      setName('');
      setEmail('');
      setCategory('general');
      setMessage('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your message');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LegalPage title="Contact" meta="Second contact channel for direct communication">
      <p>
        Use this form for general questions, Space-deletion requests, legal notices, privacy
        requests, or support. You can also write directly to{' '}
        <a href="mailto:hello@plainspace.org">hello@plainspace.org</a>.
      </p>

      <form class={styles.form} onSubmit={handleSubmit}>
        <TextField
          id="contact-name"
          label="Name"
          optionalText="(optional)"
          type="text"
          maxLength={100}
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />

        <TextField
          id="contact-email"
          label="Email"
          type="email"
          maxLength={255}
          required
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />

        <label class={styles.formLabel} for="contact-category">
          Topic
        </label>
        <select
          id="contact-category"
          class={styles.formSelect}
          value={category()}
          onChange={(e) => setCategory(e.currentTarget.value as Category)}
        >
          <option value="general">General question or support</option>
          <option value="bug">Bug or problem report</option>
          <option value="privacy">Privacy or data-protection request</option>
          <option value="legal">Legal notice</option>
          <option value="dsa-notice">Illegal content notice (DSA Art. 16)</option>
        </select>
        <Show when={category() === 'bug'}>
          <p class={styles.formHint}>
            To help us debug, your app version and browser details are attached automatically.
          </p>
        </Show>
        <Show when={category() === 'dsa-notice'}>
          <p class={styles.formHint}>
            Please include the URL or item identifier, why you believe the content is illegal, your
            contact details, and a statement that you have a good-faith belief that the information
            is accurate and complete (DSA Art. 16(2)).
          </p>
        </Show>

        <label class={styles.formLabel} for="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          class={styles.formTextarea}
          maxLength={MESSAGE_MAX}
          required
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
        />

        <p class={styles.formHint}>
          We use your message and email address only to process and answer your request. Details are
          in the <A href="/privacy">Privacy Policy</A>.
        </p>

        <Show when={error()}>
          <p class={styles.formError}>{error()}</p>
        </Show>
        <Show when={sent()}>
          <p class={styles.formSuccess}>Message sent.</p>
        </Show>

        <Button type="submit" disabled={submitting() || !email().trim() || !message().trim()}>
          {submitting() ? 'Sending...' : 'Send message'}
        </Button>
      </form>
    </LegalPage>
  );
}
