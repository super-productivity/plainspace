import { createEffect, createSignal, Match, Show, Switch, untrack } from 'solid-js';
import type { Member } from '@plainspace/shared';
import { api, ApiError } from '../../lib/api';
import {
  getPlainspaceEmail,
  getProofToken,
  saveIdentity,
  savePlainspaceEmail,
  saveVerifiedWitnessSlug,
} from '../../lib/identity';
import { Button, TextField } from '../ui';
import styles from './EmailVerify.module.css';

interface EmailVerifyProps {
  slug: string;
  currentEmail: string | null;
  localEmailClearedAt?: number;
  onVerified: (member: Member) => void;
}

type Step = 'idle' | 'enter-code' | 'confirm-merge';

export default function EmailVerify(props: EmailVerifyProps) {
  const [step, setStep] = createSignal<Step>('idle');
  const [email, setEmail] = createSignal(untrack(() => props.currentEmail ?? getPlainspaceEmail()));
  const [code, setCode] = createSignal('');
  const [devCode, setDevCode] = createSignal<string | undefined>(undefined);
  const [mergeName, setMergeName] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  // Global account: a proof token (a verified token from another Space) + saved
  // email let the user add their email here in one click, no emailed code.
  // Captured once; cleared if the proof is rejected or the email is forgotten.
  const [quickEmail, setQuickEmail] = createSignal(untrack(() => getPlainspaceEmail()));
  const [proofToken, setProofToken] = createSignal(untrack(() => getProofToken()));
  const quickAvailable = () => !!proofToken() && !!quickEmail();
  let observedLocalEmailClearedAt = untrack(() => props.localEmailClearedAt ?? 0);

  createEffect(() => {
    const clearedAt = props.localEmailClearedAt ?? 0;
    if (clearedAt === observedLocalEmailClearedAt) return;
    observedLocalEmailClearedAt = clearedAt;
    if (!props.currentEmail && step() === 'idle') setEmail('');
    // The saved email (and its proof token) were just forgotten.
    setQuickEmail('');
    setProofToken(null);
  });

  async function quickConnect() {
    const token = proofToken();
    if (!token) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await api.connectVerified(props.slug, { proofToken: token });
      savePlainspaceEmail(quickEmail());
      saveVerifiedWitnessSlug(props.slug);
      if (res.token) {
        // Collision merge: this browser becomes the canonical member. Reload so
        // the Space reconnects (SSE, presence) under the merged member id.
        saveIdentity(props.slug, res.token, res.member.id);
        window.location.reload();
        return;
      }
      props.onVerified(res.member);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Proof no longer accepted — fall back to the emailed-code form.
        setProofToken(null);
        setError('');
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to add your email');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function sendCode(e: Event) {
    e.preventDefault();
    const value = email().trim();
    if (!value) return;

    setSubmitting(true);
    setError('');
    setEmail(value);

    try {
      const res = await api.requestVerification(props.slug, { email: value });
      setDevCode(res.devCode);
      if (res.devCode) setCode(res.devCode);
      setStep('enter-code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send verification code');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(e: Event) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code())) {
      setError('Enter the 6-digit code we emailed you.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const { member } = await api.verifyCode(props.slug, { code: code() });
      savePlainspaceEmail(email());
      saveVerifiedWitnessSlug(props.slug);
      props.onVerified(member);
    } catch (err) {
      // This email is already verified by another of the caller's own member
      // records in this Space. Offer to merge instead of failing.
      if (err instanceof ApiError && err.body.code === 'merge-available') {
        setMergeName(err.body.canonicalDisplayName ?? null);
        setStep('confirm-merge');
        setError('');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to verify code');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmMerge(e: Event) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const { member, token } = await api.verifyMerge(props.slug, { code: code() });
      // The browser is now the canonical member: re-save identity, then reload
      // so the Space reconnects (SSE, presence) under the merged member id.
      savePlainspaceEmail(email());
      saveVerifiedWitnessSlug(props.slug);
      saveIdentity(props.slug, token, member.id);
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to continue as that person');
      setSubmitting(false);
    }
  }

  function reset() {
    setStep('idle');
    setCode('');
    setDevCode(undefined);
    setMergeName(null);
    setError('');
  }

  return (
    <div class={styles.section} data-testid="email-verify-section">
      <h4 class={styles.heading}>Add an email to this Space</h4>
      <p class={styles.hint}>
        We'll use it to email a code if you need to reopen this Space elsewhere.
      </p>

      <Switch>
        <Match when={step() === 'idle' && quickAvailable()}>
          <div class={styles.form} data-testid="email-quick-connect">
            <p class={styles.hint}>Add the email you've already confirmed — no code needed.</p>
            <Show when={error()}>
              <p class={styles.error}>{error()}</p>
            </Show>
            <Button
              type="button"
              size="sm"
              onClick={quickConnect}
              disabled={submitting()}
              data-testid="email-quick-connect-button"
            >
              {submitting() ? 'Adding…' : `Add ${quickEmail()}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setProofToken(null)}
              disabled={submitting()}
              data-testid="email-quick-connect-other"
            >
              Use a different email
            </Button>
          </div>
        </Match>

        <Match when={step() === 'idle'}>
          <form class={styles.form} onSubmit={sendCode} data-testid="email-verify-request-form">
            <TextField
              id="verify-email-input"
              label="Your email"
              type="email"
              placeholder="you@example.com"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              maxLength={255}
              required
              size="sm"
              data-testid="email-verify-email-input"
            />
            <Show when={error()}>
              <p class={styles.error}>{error()}</p>
            </Show>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={submitting() || !email().trim()}
              data-testid="email-verify-send-button"
            >
              {submitting() ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        </Match>

        <Match when={step() === 'enter-code'}>
          <p class={styles.hint}>Check {email()} for a 6-digit code.</p>
          <form class={styles.form} onSubmit={verifyCode} data-testid="email-verify-code-form">
            <TextField
              id="verify-code-input"
              label="Email code"
              type="text"
              inputMode="numeric"
              autocomplete="one-time-code"
              placeholder="123456"
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              required
              size="sm"
              data-testid="email-verify-code-input"
              helperText={devCode() ? `Dev code: ${devCode()}` : undefined}
            />
            <Show when={error()}>
              <p class={styles.error}>{error()}</p>
            </Show>
            <Button
              type="submit"
              size="sm"
              disabled={submitting() || code().length !== 6}
              data-testid="email-verify-confirm-button"
            >
              {submitting() ? 'Adding…' : 'Add email'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Back
            </Button>
          </form>
        </Match>

        <Match when={step() === 'confirm-merge'}>
          <form class={styles.form} onSubmit={confirmMerge} data-testid="email-verify-merge-form">
            <p class={styles.hint}>
              This email is already used here by <strong>{mergeName() ?? 'another person'}</strong>.
              Continue as that person and move anything you just did there? This can't be undone.
            </p>
            <Show when={error()}>
              <p class={styles.error}>{error()}</p>
            </Show>
            <Button
              type="submit"
              size="sm"
              disabled={submitting()}
              data-testid="email-verify-merge-confirm-button"
            >
              {submitting() ? 'Continuing…' : 'Continue as that person'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={submitting()}>
              Cancel
            </Button>
          </form>
        </Match>
      </Switch>
    </div>
  );
}
