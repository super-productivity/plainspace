import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import type { Member } from '@plainspace/shared';
import { api, ApiError } from '../lib/api';
import { useDocumentTitle } from '../lib/document-title';
import {
  clearIdentity,
  getLastOpenSpace,
  getMemberId,
  getPlainspaceEmail,
  getProofToken,
  listKnownSpaces,
  parseClaim,
  saveIdentity,
  savePlainspaceEmail,
  saveVerifiedWitnessSlug,
  updateIdentityName,
} from '../lib/identity';
import { Avatar, Button, FormCard, LegalNotice, TextField } from '../components/ui';
import { canInstall, promptInstall } from '../lib/pwa-install';
import styles from './Home.module.css';

const MAX_AVATARS = 5;
const LOGIN_EMAIL_COOLDOWN_MS = 30_000;

type Step = 'details' | 'verify';
type View = 'none' | 'choice' | 'login' | 'open' | 'create';

// Accept a full Space link, a bare path, or just the slug, optionally carrying
// a "#claim=<token>.<memberId>" hand-off fragment. Returns the slug plus any
// claimed identity, or null if nothing slug-like is present.
function parseSpaceLink(
  raw: string,
): { slug: string; claim: ReturnType<typeof parseClaim> } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed, window.location.origin);
  } catch {
    return null;
  }
  const slug = url.pathname.split('/').filter(Boolean)[0];
  if (!slug) return null;
  return { slug, claim: parseClaim(url.hash) };
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = createSignal('');
  const [purpose, setPurpose] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [email, setEmail] = createSignal(getPlainspaceEmail());
  const [code, setCode] = createSignal('');
  const [devCode, setDevCode] = createSignal<string | undefined>(undefined);
  const [step, setStep] = createSignal<Step>('details');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  const [codeError, setCodeError] = createSignal('');
  const [knownSpaces, setKnownSpaces] = createSignal(listKnownSpaces());
  const [membersBySlug, setMembersBySlug] = createSignal<Record<string, Member[]>>({});

  const hasKnown = untrack(knownSpaces).length > 0;
  const [view, setView] = createSignal<View>(hasKnown ? 'none' : 'choice');

  // Open a Space by link or slug.
  const [link, setLink] = createSignal('');
  const [linkError, setLinkError] = createSignal('');

  // "Find my Spaces": email the address owner links to their Spaces.
  const [findEmail, setFindEmail] = createSignal(getPlainspaceEmail());
  const [findSubmitting, setFindSubmitting] = createSignal(false);
  const [findCooldownRemaining, setFindCooldownRemaining] = createSignal(0);
  const [findError, setFindError] = createSignal('');
  const [findInfo, setFindInfo] = createSignal('');
  const [devSpaces, setDevSpaces] = createSignal<{ slug: string; name: string }[] | undefined>(
    undefined,
  );
  let pageHeading: HTMLHeadingElement | undefined;
  let projectNameInput: HTMLInputElement | undefined;
  let findEmailInput: HTMLInputElement | undefined;
  let spaceLinkInput: HTMLInputElement | undefined;
  let verificationCodeInput: HTMLInputElement | undefined;
  let findCooldownInterval: number | undefined;

  function orderMembers(slug: string, members: Member[]): Member[] {
    const myId = getMemberId(slug);
    if (!myId) return members;
    const mine = members.find((m) => m.id === myId);
    const others = members.filter((m) => m.id !== myId);
    return mine ? [mine, ...others] : members;
  }

  useDocumentTitle(() => 'Plainspace — Simple shared spaces');

  onMount(() => {
    if (location.pathname === '/') {
      const lastOpenSpace = getLastOpenSpace();
      if (lastOpenSpace) {
        navigate(`/${lastOpenSpace.slug}`, { replace: true });
        return;
      }
    }

    for (const space of knownSpaces()) {
      api
        .getProjectSummary(space.slug)
        .then((summary) => {
          updateIdentityName(space.slug, summary.name);
          setKnownSpaces(listKnownSpaces());
          setMembersBySlug((prev) => ({
            ...prev,
            [space.slug]: orderMembers(space.slug, summary.members),
          }));
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
            clearIdentity(space.slug);
            setKnownSpaces(listKnownSpaces());
          }
        });
    }
  });

  onCleanup(() => {
    if (findCooldownInterval !== undefined) window.clearInterval(findCooldownInterval);
  });

  // Focus follows a *change* of view. The first run is the initial paint, where
  // focus already sits at the document start — moving it there would only scroll
  // the heading into view and undo the browser's scroll restoration.
  let viewSettled = false;
  createEffect(() => {
    const activeView = view();
    const activeStep = step();
    if (!viewSettled) {
      viewSettled = true;
      return;
    }
    if (activeView === 'create') {
      (activeStep === 'verify' ? verificationCodeInput : projectNameInput)?.focus();
    } else if (activeView === 'login') {
      findEmailInput?.focus();
    } else if (activeView === 'open') {
      spaceLinkInput?.focus();
    } else {
      pageHeading?.focus();
    }
  });

  function startFindCooldown() {
    const cooldownUntil = Date.now() + LOGIN_EMAIL_COOLDOWN_MS;

    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setFindCooldownRemaining(remaining);
      if (remaining === 0 && findCooldownInterval !== undefined) {
        window.clearInterval(findCooldownInterval);
        findCooldownInterval = undefined;
      }
    };

    if (findCooldownInterval !== undefined) window.clearInterval(findCooldownInterval);
    updateCooldown();
    findCooldownInterval = window.setInterval(updateCooldown, 1_000);
  }

  function handleOpenSpace(e: Event) {
    e.preventDefault();
    setLinkError('');
    const parsed = parseSpaceLink(link());
    if (!parsed) {
      setLinkError('Enter a Space link, e.g. https://plainspace.org/abc123');
      return;
    }
    if (parsed.claim) saveIdentity(parsed.slug, parsed.claim.token, parsed.claim.memberId);
    navigate(`/${parsed.slug}`);
  }

  async function handleFindSpaces(e: Event) {
    e.preventDefault();
    if (findSubmitting() || findCooldownRemaining() > 0) return;

    const value = findEmail().trim();
    if (!value) return;

    setFindSubmitting(true);
    setFindError('');
    setFindInfo('');
    setDevSpaces(undefined);

    try {
      const res = await api.findSpaces({ email: value });
      setFindInfo(res.message);
      setDevSpaces(res.devSpaces);
      startFindCooldown();
    } catch (err) {
      setFindError(err instanceof ApiError ? err.message : 'Failed to find your Spaces');
    } finally {
      setFindSubmitting(false);
    }
  }

  async function createProject(opts?: { code?: string; proofToken?: string }) {
    const result = await api.createProject({
      name: name().trim(),
      purpose: purpose().trim(),
      displayName: displayName().trim(),
      email: email().trim(),
      ...(opts?.code ? { code: opts.code } : {}),
      ...(opts?.proofToken ? { proofToken: opts.proofToken } : {}),
    });
    savePlainspaceEmail(email().trim());
    // This new Space is now a verified witness for the saved email.
    saveVerifiedWitnessSlug(result.project.slug);
    saveIdentity(result.project.slug, result.token, result.member.id, result.project.name);
    navigate(`/${result.project.slug}`);
  }

  async function handleDetailsSubmit(e: Event) {
    e.preventDefault();
    if (!name().trim() || !displayName().trim() || !email().trim()) return;

    setSubmitting(true);
    setError('');
    setCodeError('');

    // Global account: if this browser already proved this email in another
    // Space, its token stands in for the code. Fall back to the emailed code
    // only if the proof is rejected (token rotated / different email).
    const proofToken = getProofToken();
    if (proofToken && email().trim().toLowerCase() === getPlainspaceEmail().toLowerCase()) {
      try {
        await createProject({ proofToken });
        return;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) {
          setError(err instanceof ApiError ? err.message : 'Failed to create Space');
          setSubmitting(false);
          return;
        }
        // Proof no longer accepted — drop through to the code flow.
      }
    }

    try {
      const res = await api.requestCreationCode({ email: email().trim() });
      setDevCode(res.devCode);
      if (res.devCode) setCode(res.devCode);
      setStep('verify');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send verification code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySubmit(e: Event) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code())) {
      setError('');
      setCodeError('Enter the 6-digit code we just emailed you.');
      return;
    }

    setSubmitting(true);
    setError('');
    setCodeError('');

    try {
      await createProject({ code: code() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setCodeError(err.message);
      else setError(err instanceof ApiError ? err.message : 'Failed to create Space');
      setSubmitting(false);
    }
  }

  function showCreateView() {
    setStep('details');
    setError('');
    setCodeError('');
    setCode('');
    setDevCode(undefined);
    if (!email().trim()) setEmail(getPlainspaceEmail());
    setView('create');
  }

  function showLoginView() {
    setFindError('');
    setFindInfo('');
    setDevSpaces(undefined);
    if (!findEmail().trim()) setFindEmail(getPlainspaceEmail());
    setView('login');
  }

  function showOpenView() {
    setLinkError('');
    setView('open');
  }

  function showHomeView() {
    setView(knownSpaces().length > 0 ? 'none' : 'choice');
  }

  return (
    <main class={styles.container}>
      <div class={styles.hero}>
        <img src="/favicon.svg" alt="" class={styles.logoMark} />
        <h1 ref={(element) => (pageHeading = element)} class={styles.title} tabindex="-1">
          Plainspace
        </h1>
        <p class={styles.subtitle}>
          The simplest way to stay aligned with people who don't use your tools.
        </p>
        <Show when={canInstall()}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={promptInstall}
            data-testid="install-app-button"
          >
            Install app
          </Button>
        </Show>
      </div>

      <Show when={knownSpaces().length > 0}>
        <div class={styles.spaces} data-testid="known-spaces">
          <h2 class={styles.spacesHeading}>Your Spaces</h2>
          <ul class={styles.spacesList}>
            <For each={knownSpaces()}>
              {(space) => {
                const members = () => membersBySlug()[space.slug] ?? [];
                const visible = () => members().slice(0, MAX_AVATARS);
                const overflow = () => Math.max(0, members().length - MAX_AVATARS);
                const myId = getMemberId(space.slug);
                return (
                  <li>
                    <A
                      href={`/${space.slug}`}
                      class={styles.spaceLink}
                      data-testid="known-space-link"
                    >
                      <span class={styles.spaceName}>{space.name ?? space.slug}</span>
                      <Show when={members().length > 0}>
                        <span class={styles.avatarRow} aria-hidden="true">
                          <For each={visible()}>
                            {(member) => (
                              <Avatar
                                name={member.displayName}
                                color={member.color}
                                size="sm"
                                letters={1}
                                title={member.displayName}
                                class={`${styles.stackAvatar} ${member.id === myId ? styles.selfAvatar : ''}`}
                              />
                            )}
                          </For>
                          <Show when={overflow() > 0}>
                            <Avatar
                              name={`+${overflow()}`}
                              size="sm"
                              class={styles.stackAvatar}
                            >{`+${overflow()}`}</Avatar>
                          </Show>
                        </span>
                      </Show>
                    </A>
                  </li>
                );
              }}
            </For>
          </ul>
          <Show when={view() === 'none'}>
            <div class={styles.actions}>
              <Button
                type="button"
                variant="ghost"
                onClick={showLoginView}
                data-testid="show-login-button"
              >
                Find my Spaces
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={showCreateView}
                data-testid="show-create-button"
              >
                Create a Space
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={showOpenView}
                data-testid="show-open-button"
              >
                Have a Space link? Open it
              </Button>
            </div>
          </Show>
        </div>
      </Show>

      {/* The 'none' view only renders the Spaces list above; once onMount clears
          dead Spaces (404/401) the list can empty out, which would otherwise
          strand the visitor on a bare hero (just the optional Install button).
          Treat an empty list under 'none' like a first visit and offer onboarding. */}
      <Show when={view() === 'choice' || (view() === 'none' && knownSpaces().length === 0)}>
        <div class={styles.choicePanel} data-testid="onboarding-choice">
          {/* New visitors land here with no known Spaces, so creating one is
              the hero action; finding existing Spaces is the returning-user
              path. */}
          <Button type="button" fullWidth onClick={showCreateView} data-testid="show-create-button">
            Create a Space
          </Button>
          <Button
            type="button"
            variant="secondary"
            fullWidth
            onClick={showLoginView}
            data-testid="show-login-button"
          >
            Find my Spaces
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={showOpenView}
            data-testid="show-open-button"
          >
            Have a Space link? Open it
          </Button>
        </div>

        {/* A faded peek at the paper-panel UI so a first-time visitor sees what
            a Space looks like, not just text on the grid. Decorative only. */}
        <div class={styles.vignette} aria-hidden="true">
          <div class={styles.miniPanel}>
            <span class={styles.miniPanelTitle}>Trip to Lisbon</span>
            <ul class={styles.miniList}>
              <li class={styles.miniItemDone}>
                <span class={styles.miniCheck} />
                Book the flights
              </li>
              <li>
                <span class={styles.miniCheck} />
                Find a place to stay
              </li>
              <li>
                <span class={styles.miniCheck} />
                Make a list of spots
              </li>
            </ul>
          </div>
        </div>
      </Show>

      <Show when={view() === 'login'}>
        <div class={styles.spaces}>
          <FormCard
            onSubmit={handleFindSpaces}
            aria-busy={findSubmitting() ? 'true' : undefined}
            data-testid="find-email-form"
          >
            <h2 class={styles.panelTitle}>Find my Spaces</h2>
            <p class={styles.subtitle}>
              Enter an email you added to a Space. We'll send links to the Spaces connected to it.
            </p>
            <TextField
              id="find-email"
              label="Your email"
              type="email"
              autocomplete="email"
              placeholder="e.g. you@example.com"
              value={findEmail()}
              onInput={(e) => setFindEmail(e.currentTarget.value)}
              maxLength={255}
              required
              ref={(element) => (findEmailInput = element)}
              data-testid="find-email-input"
            />
            {findError() && (
              <p class={styles.error} role="alert">
                {findError()}
              </p>
            )}
            {findInfo() && (
              <p class={styles.subtitle} role="status">
                {findInfo()}
              </p>
            )}
            <Show when={devSpaces() && devSpaces()!.length > 0}>
              <ul class={styles.spacesList}>
                <For each={devSpaces()}>
                  {(s) => (
                    <li>
                      <A href={`/${s.slug}`} class={styles.spaceLink}>
                        <span class={styles.spaceName}>
                          {s.name} (dev: /{s.slug})
                        </span>
                      </A>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Button
              class={styles.submit}
              type="submit"
              disabled={findSubmitting() || findCooldownRemaining() > 0 || !findEmail().trim()}
              data-testid="find-email-button"
            >
              {findSubmitting()
                ? 'Sending...'
                : findCooldownRemaining() > 0
                  ? `Send again in ${findCooldownRemaining()}s`
                  : 'Send Space links'}
            </Button>
          </FormCard>

          <div class={styles.actions}>
            <Button type="button" variant="ghost" onClick={showOpenView}>
              Have a Space link? Open it
            </Button>
            <Button type="button" variant="ghost" onClick={showCreateView}>
              Create a Space instead
            </Button>
            <Show when={knownSpaces().length > 0}>
              <Button type="button" variant="ghost" onClick={showHomeView}>
                Back to your Spaces
              </Button>
            </Show>
            <Show when={knownSpaces().length === 0}>
              <Button type="button" variant="ghost" onClick={showHomeView}>
                Back
              </Button>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={view() === 'open'}>
        <div class={styles.spaces}>
          <FormCard onSubmit={handleOpenSpace} data-testid="open-space-form">
            <h2 class={styles.panelTitle}>Open a Space link</h2>
            <p class={styles.subtitle}>Paste a Space link or slug to open it on this device.</p>

            <TextField
              id="space-link"
              label="Space link"
              type="text"
              inputMode="url"
              autocomplete="off"
              placeholder="https://plainspace.org/abc123"
              value={link()}
              onInput={(e) => setLink(e.currentTarget.value)}
              required
              ref={(element) => (spaceLinkInput = element)}
              data-testid="space-link-input"
              error={linkError()}
            />

            <Button class={styles.submit} type="submit" data-testid="open-space-button">
              Open Space
            </Button>
          </FormCard>

          <div class={styles.actions}>
            <Button type="button" variant="ghost" onClick={showLoginView}>
              Find my Spaces instead
            </Button>
            <Button type="button" variant="ghost" onClick={showCreateView}>
              Create a Space instead
            </Button>
            <Show when={knownSpaces().length > 0}>
              <Button type="button" variant="ghost" onClick={showHomeView}>
                Back to your Spaces
              </Button>
            </Show>
            <Show when={knownSpaces().length === 0}>
              <Button type="button" variant="ghost" onClick={showHomeView}>
                Back
              </Button>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={view() === 'create' && step() === 'details'}>
        <FormCard
          onSubmit={handleDetailsSubmit}
          aria-busy={submitting() ? 'true' : undefined}
          data-testid="create-project-form"
        >
          <TextField
            id="project-name"
            label="What are you working on?"
            type="text"
            placeholder="e.g. Summer Trip Planning"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            maxLength={100}
            required
            ref={(element) => (projectNameInput = element)}
            data-testid="project-name-input"
          />

          <TextField
            id="project-purpose"
            label="One-line purpose"
            optionalText="(optional)"
            type="text"
            placeholder="e.g. Planning our two weeks in Tuscany"
            value={purpose()}
            onInput={(e) => setPurpose(e.currentTarget.value)}
            maxLength={280}
            data-testid="project-purpose-input"
          />

          <TextField
            id="display-name"
            label="Your display name"
            type="text"
            autocomplete="name"
            placeholder="e.g. Johannes"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
            maxLength={40}
            required
            data-testid="display-name-input"
          />

          <TextField
            id="email"
            label="Your email"
            type="email"
            autocomplete="email"
            placeholder="e.g. you@example.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            maxLength={255}
            required
            data-testid="email-input"
            helperText="We'll send a 6-digit code to confirm it's you."
          />

          {error() && (
            <p class={styles.error} role="alert">
              {error()}
            </p>
          )}

          <LegalNotice action="creating a Space" />

          <Button
            class={styles.submit}
            type="submit"
            disabled={submitting() || !name().trim() || !displayName().trim() || !email().trim()}
            data-testid="create-project-button"
          >
            {submitting() ? 'Sending code…' : 'Continue'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={showLoginView}
            data-testid="have-space-button"
          >
            Find my Spaces
          </Button>
        </FormCard>
      </Show>

      <Show when={view() === 'create' && step() === 'verify'}>
        <FormCard
          onSubmit={handleVerifySubmit}
          aria-busy={submitting() ? 'true' : undefined}
          data-testid="verify-code-form"
        >
          <TextField
            id="verification-code"
            label={`Enter the code we sent to ${email()}`}
            type="text"
            inputMode="numeric"
            autocomplete="one-time-code"
            placeholder="123456"
            value={code()}
            onInput={(e) => {
              setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6));
              setCodeError('');
            }}
            maxLength={6}
            required
            ref={(element) => (verificationCodeInput = element)}
            data-testid="verify-code-input"
            helperText={devCode() ? `Dev code: ${devCode()}` : undefined}
            error={codeError()}
          />

          {error() && (
            <p class={styles.error} role="alert">
              {error()}
            </p>
          )}

          <LegalNotice action="creating a Space" />

          <Button
            class={styles.submit}
            type="submit"
            disabled={submitting() || code().length !== 6}
            data-testid="verify-code-button"
          >
            {submitting() ? 'Creating…' : 'Create Space'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStep('details');
              setError('');
              setCodeError('');
              setCode('');
              setDevCode(undefined);
            }}
          >
            Back
          </Button>
        </FormCard>
      </Show>
    </main>
  );
}
