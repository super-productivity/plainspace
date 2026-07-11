import { createSignal, onMount, Show } from 'solid-js';
import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { api, ApiError } from '../lib/api';
import {
  getPlainspaceEmail,
  hasIdentity,
  saveIdentity,
  savePlainspaceEmail,
  saveVerifiedWitnessSlug,
} from '../lib/identity';
import { Button, FormCard, LegalNotice, TextField } from '../components/ui';
import NotFound from './NotFound';
import styles from './Home.module.css';

type Mode = 'join' | 'recover-email' | 'recover-verify';

export default function Join() {
  const params = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = createSignal('');
  const [recoverEmail, setRecoverEmail] = createSignal(getPlainspaceEmail());
  const [recoverCode, setRecoverCode] = createSignal('');
  const [devCode, setDevCode] = createSignal<string | undefined>(undefined);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  const [info, setInfo] = createSignal('');
  const [mode, setMode] = createSignal<Mode>('join');
  const [projectInfo, setProjectInfo] = createSignal<{ name: string; sharingMode: string } | null>(
    null,
  );
  const [loading, setLoading] = createSignal(true);
  const [notFound, setNotFound] = createSignal(false);

  onMount(async () => {
    // Already a member in this browser — likely re-opened the join link.
    // Skip the join form so the user doesn't accidentally create a duplicate.
    if (hasIdentity(params.slug)) {
      navigate(`/${params.slug}`, { replace: true });
      return;
    }
    try {
      const projectData = await api.getProjectInfo(params.slug);
      setProjectInfo(projectData);
      // Deep link from "Your Spaces" for a Space this device has no token for:
      // jump straight to open-by-email (email prefilled) instead of the join form.
      if (searchParams.recover) startRecover();
    } catch (err) {
      // A dead or mistyped link gets the 404 page, not a join form that can
      // never succeed; only transient failures keep the form usable.
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError('Could not load this Space. Please try again.');
    }
    setLoading(false);
  });

  const isPrivate = () => projectInfo()?.sharingMode === 'private';

  function startRecover() {
    setError('');
    setInfo('');
    if (!recoverEmail().trim()) setRecoverEmail(getPlainspaceEmail());
    setRecoverCode('');
    setDevCode(undefined);
    setMode('recover-email');
  }

  function backToJoin() {
    setError('');
    setInfo('');
    setMode('join');
  }

  function goToSpace() {
    navigate(`/${params.slug}`);
  }

  function backToRecoverEmail() {
    setError('');
    setInfo('');
    setRecoverCode('');
    setDevCode(undefined);
    setMode('recover-email');
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!displayName().trim()) return;

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const result = await api.joinProject(params.slug, {
        displayName: displayName().trim(),
      });
      saveIdentity(params.slug, result.token, result.member.id, projectInfo()?.name);
      goToSpace();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to join Space');
      setSubmitting(false);
    }
  }

  async function handleRecoverRequest(e: Event) {
    e.preventDefault();
    const email = recoverEmail().trim();
    if (!email) return;

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const res = await api.requestLoginCode(params.slug, { email });
      setDevCode(res.devCode);
      if (res.devCode) setRecoverCode(res.devCode);
      setInfo(`If this email is connected to this Space, check ${email} for a code.`);
      setMode('recover-verify');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoverVerify(e: Event) {
    e.preventDefault();
    if (!/^\d{6}$/.test(recoverCode())) {
      setError('Enter the 6-digit code we emailed you.');
      return;
    }

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const result = await api.verifyLoginCode(params.slug, {
        email: recoverEmail().trim(),
        code: recoverCode(),
      });
      savePlainspaceEmail(recoverEmail().trim());
      // This Space's verified token can now prove the email for new Spaces.
      saveVerifiedWitnessSlug(params.slug);
      saveIdentity(params.slug, result.token, result.member.id, projectInfo()?.name);
      // One verification reopened every Space sharing this email; persist their
      // freshly rotated tokens so they're ready on this device too.
      for (const space of result.otherSpaces) {
        saveIdentity(space.slug, space.token, space.memberId, space.name);
      }
      navigate(`/${params.slug}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open Space');
      setSubmitting(false);
    }
  }

  return (
    <Show when={!notFound()} fallback={<NotFound />}>
      <div class={styles.container}>
        <Show
          when={!loading()}
          fallback={
            <div class={styles.hero}>
              <p>Loading...</p>
            </div>
          }
        >
          <Show when={mode() === 'join'}>
            <Show
              when={isPrivate()}
              fallback={
                <>
                  <div class={styles.hero}>
                    <h1 class={styles.title}>Join {projectInfo()?.name || 'Space'}</h1>
                    <p class={styles.subtitle}>
                      Choose the name people will see. You can add an email later if you want a way
                      back in.
                    </p>
                  </div>

                  <FormCard onSubmit={handleSubmit} data-testid="join-form">
                    <TextField
                      id="display-name"
                      label="Your display name"
                      type="text"
                      placeholder="e.g. Anna"
                      value={displayName()}
                      onInput={(e) => setDisplayName(e.currentTarget.value)}
                      maxLength={40}
                      required
                      autofocus
                      data-testid="join-display-name-input"
                    />

                    {error() && <p class={styles.error}>{error()}</p>}

                    <LegalNotice action="joining this Space" />

                    <Button
                      class={styles.submit}
                      type="submit"
                      disabled={submitting() || !displayName().trim()}
                      data-testid="join-button"
                    >
                      {submitting() ? 'Joining...' : 'Join Space'}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={startRecover}
                      data-testid="recover-link"
                    >
                      Already joined? Open by email
                    </Button>
                  </FormCard>
                </>
              }
            >
              <div class={styles.hero}>
                <h1 class={styles.title}>{projectInfo()?.name || 'Space'}</h1>
                <p class={styles.subtitle}>Joining is off for this Space.</p>
                <p class={styles.subtitle} style={{ 'margin-top': '8px' }}>
                  Already in it? Open by email.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={startRecover}
                  data-testid="recover-link"
                >
                  Open by email
                </Button>
              </div>
            </Show>
          </Show>

          <Show when={mode() === 'recover-email'}>
            <div class={styles.hero}>
              <h1 class={styles.title}>Open {projectInfo()?.name || 'this Space'} by email</h1>
              <p class={styles.subtitle}>
                Use the email you added to this Space. We'll send you a 6-digit code.
              </p>
            </div>

            <FormCard onSubmit={handleRecoverRequest} data-testid="recover-email-form">
              <TextField
                id="recover-email"
                label="Your email"
                type="email"
                placeholder="e.g. you@example.com"
                value={recoverEmail()}
                onInput={(e) => setRecoverEmail(e.currentTarget.value)}
                maxLength={255}
                required
                autofocus
                data-testid="recover-email-input"
              />

              {error() && <p class={styles.error}>{error()}</p>}

              <Button
                class={styles.submit}
                type="submit"
                disabled={submitting() || !recoverEmail().trim()}
                data-testid="recover-email-button"
              >
                {submitting() ? 'Sending code…' : 'Send code'}
              </Button>

              <Button type="button" variant="ghost" onClick={backToJoin}>
                Back
              </Button>
            </FormCard>
          </Show>

          <Show when={mode() === 'recover-verify'}>
            <div class={styles.hero}>
              <h1 class={styles.title}>Enter your code</h1>
              <p class={styles.subtitle}>
                {info() || `Check ${recoverEmail()} for a 6-digit code.`}
              </p>
            </div>

            <FormCard onSubmit={handleRecoverVerify} data-testid="recover-verify-form">
              <TextField
                id="recover-code"
                label="Email code"
                type="text"
                inputMode="numeric"
                autocomplete="one-time-code"
                placeholder="123456"
                value={recoverCode()}
                onInput={(e) =>
                  setRecoverCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))
                }
                maxLength={6}
                required
                autofocus
                data-testid="recover-code-input"
                helperText={devCode() ? `Dev code: ${devCode()}` : undefined}
              />

              {error() && <p class={styles.error}>{error()}</p>}

              <Button
                class={styles.submit}
                type="submit"
                disabled={submitting() || recoverCode().length !== 6}
                data-testid="recover-verify-button"
              >
                {submitting() ? 'Opening…' : 'Open Space'}
              </Button>

              <Button type="button" variant="ghost" onClick={backToRecoverEmail}>
                Back
              </Button>
            </FormCard>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
