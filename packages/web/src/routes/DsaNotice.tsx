import { A } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { api, ApiError } from '../lib/api';
import { Button, LegalPage, TextField } from '../components/ui';
import styles from './Legal.module.css';

type Category = 'copyright' | 'defamation' | 'hate-speech' | 'csam' | 'illegal-product' | 'other';

const CATEGORY_LABELS: Record<Category, string> = {
  copyright: 'Copyright infringement',
  defamation: 'Defamation / libel',
  'hate-speech': 'Hate speech or harassment',
  csam: 'Child sexual abuse material (anonymous report allowed)',
  'illegal-product': 'Illegal product or service',
  other: 'Other illegal content',
};

export default function DsaNotice() {
  const [contentLocation, setContentLocation] = createSignal('');
  const [category, setCategory] = createSignal<Category>('other');
  const [reason, setReason] = createSignal('');
  const [submitterName, setSubmitterName] = createSignal('');
  const [submitterEmail, setSubmitterEmail] = createSignal('');
  const [goodFaith, setGoodFaith] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [submittedId, setSubmittedId] = createSignal<string | null>(null);
  const [error, setError] = createSignal('');

  // Art. 16(2)(c): the CSAM path may be submitted anonymously. We hide the
  // contact fields when csam is selected; submitterEmail then becomes optional.
  const isCsam = createMemo(() => category() === 'csam');
  const emailRequired = createMemo(() => !isCsam());

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!goodFaith()) {
      setError(
        'Please confirm the good-faith statement required by Article 16(2) of the EU Digital Services Act.',
      );
      return;
    }
    setSubmitting(true);
    setError('');
    setSubmittedId(null);

    try {
      const res = await api.submitDsaNotice({
        contentLocation: contentLocation().trim(),
        category: category(),
        reason: reason().trim(),
        ...(submitterName().trim() ? { submitterName: submitterName().trim() } : {}),
        ...(submitterEmail().trim() && !isCsam()
          ? { submitterEmail: submitterEmail().trim() }
          : {}),
        goodFaithConfirmed: true,
      });
      setSubmittedId(res.noticeId);
      setContentLocation('');
      setReason('');
      setSubmitterName('');
      setSubmitterEmail('');
      setGoodFaith(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your notice');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LegalPage
      title="Report illegal content (DSA Art. 16)"
      meta="EU Digital Services Act notice-and-action mechanism"
    >
      <p>
        Use this form to report content on Plainspace that you believe is illegal under EU or German
        law. We will acknowledge receipt and assess your notice in a timely and non-arbitrary
        manner, as required by Article 16 of the EU Digital Services Act (Regulation (EU)
        2022/2065). See the <A href="/terms">Terms of Service §8</A> and our{' '}
        <A href="/privacy">Privacy Policy</A> for context.
      </p>

      <Show when={submittedId()}>
        {(id) => (
          <p class={styles.formSuccess} role="status">
            Notice received. Reference: <code>{id()}</code>. You will receive an acknowledgement
            email if you provided one.
          </p>
        )}
      </Show>

      <form
        class={styles.form}
        onSubmit={handleSubmit}
        aria-busy={submitting() ? 'true' : undefined}
      >
        <TextField
          id="dsa-content-location"
          label="Where is the content?"
          helperText="URL or item ID — anything that helps us find it."
          type="text"
          autocomplete="url"
          maxLength={500}
          required
          value={contentLocation()}
          onInput={(e) => setContentLocation(e.currentTarget.value)}
        />

        <label class={styles.formLabel} for="dsa-category">
          Category
        </label>
        <select
          id="dsa-category"
          class={styles.formSelect}
          value={category()}
          onChange={(e) => setCategory(e.currentTarget.value as Category)}
        >
          <For each={Object.keys(CATEGORY_LABELS) as Category[]}>
            {(value) => <option value={value}>{CATEGORY_LABELS[value]}</option>}
          </For>
        </select>

        <Show when={isCsam()}>
          <p class={styles.formHint}>
            Anonymous CSAM reports are accepted under Art. 16(2)(c). You may omit your name and
            email; we will not be able to follow up with you but will act on the report.
          </p>
        </Show>

        <label class={styles.formLabel} for="dsa-reason">
          Why is this content illegal?
        </label>
        <textarea
          id="dsa-reason"
          class={styles.formTextarea}
          maxLength={4000}
          minLength={20}
          required
          aria-describedby="dsa-reason-hint"
          value={reason()}
          onInput={(e) => setReason(e.currentTarget.value)}
        />
        <p id="dsa-reason-hint" class={styles.formHint}>
          A substantiated explanation, including any applicable law or right that is being violated.
          Minimum 20 characters.
        </p>

        <Show when={!isCsam()}>
          <TextField
            id="dsa-submitter-name"
            label="Your name"
            optionalText="(optional)"
            type="text"
            autocomplete="name"
            maxLength={100}
            value={submitterName()}
            onInput={(e) => setSubmitterName(e.currentTarget.value)}
          />

          <TextField
            id="dsa-submitter-email"
            label="Your email"
            type="email"
            autocomplete="email"
            maxLength={255}
            required={emailRequired()}
            value={submitterEmail()}
            onInput={(e) => setSubmitterEmail(e.currentTarget.value)}
          />
        </Show>

        <label class={styles.formCheckboxRow}>
          <input
            type="checkbox"
            checked={goodFaith()}
            onChange={(e) => setGoodFaith(e.currentTarget.checked)}
          />
          <span>
            I confirm I have a good-faith belief that the information and allegations in this notice
            are accurate and complete (DSA Art. 16(2)(d)).
          </span>
        </label>

        <Show when={error()}>
          <p class={styles.formError} role="alert">
            {error()}
          </p>
        </Show>

        <Button
          type="submit"
          disabled={
            submitting() ||
            !contentLocation().trim() ||
            reason().trim().length < 20 ||
            (!isCsam() && !submitterEmail().trim()) ||
            !goodFaith()
          }
        >
          {submitting() ? 'Sending…' : 'Submit notice'}
        </Button>
      </form>
    </LegalPage>
  );
}
