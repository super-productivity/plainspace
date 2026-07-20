import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  Show,
  Switch,
  Match,
} from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import type { ApiToken } from '@plainspace/shared';
import { CODE_EXPIRY_MS, CODE_REQUEST_WINDOW_MS } from '@plainspace/shared';
import { api, ApiError } from '../lib/api';
import { addToast } from '../lib/toast';
import { copyText } from '../lib/clipboard';
import {
  buildClaimUrl,
  clearIdentity,
  clearPendingConnect,
  getMemberId,
  getPendingConnect,
  getPlainspaceEmail,
  getToken,
  getVerifiedWitnessSlug,
  listKnownSpaces,
  saveIdentity,
  savePendingConnect,
  savePlainspaceEmail,
  saveVerifiedWitnessSlug,
} from '../lib/identity';
import {
  Banner,
  Button,
  CollapseBody,
  CollapseToggle,
  ConfirmDialog,
  FormCard,
  LegalNotice,
  TextField,
} from '../components/ui';
import styles from './Connect.module.css';

type ConnectState = 'resolving' | 'details' | 'verify' | 'minting' | 'reveal' | 'connected';

// A verified membership already has a key active elsewhere (reconnect) or is
// ready for a one-tap mint (apiToken null). `slug` drives the local mint path
// (createApiToken); when it's null the new-device path re-calls connect with the
// held `pendingCode` and force.
interface ConnectedInfo {
  apiToken: ApiToken | null;
  slug: string | null;
  email: string;
  pendingCode: string | null;
}

// The key grants a password-equivalent, so name its blast radius before any
// mint tap (§3 rule 4) and again on the reveal.
const SCOPE_LINE =
  'One key covers all your Spaces: Super Productivity can add and update tasks in them for you. Treat it like a password; disconnect anytime from a Space settings.';

// §10.4: accept a return URL only when it is EXACTLY the superproductivity:
// scheme. Parsed with new URL(); the raw value is never interpolated into href.
function validateReturnUrl(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'superproductivity:' ? url.toString() : null;
}

export default function Connect() {
  const [searchParams] = useSearchParams();
  const returnUrl = () => validateReturnUrl(searchParams.return);

  const [state, setState] = createSignal<ConnectState>('resolving');
  const [name, setName] = createSignal('');
  const [spaceName, setSpaceName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [code, setCode] = createSignal('');
  const [devCode, setDevCode] = createSignal<string | undefined>(undefined);
  const [error, setError] = createSignal('');
  const [codeError, setCodeError] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  const [reveal, setReveal] = createSignal<{
    token: string;
    created: boolean;
    spaceName: string | null;
    // A #claim hand-off link to the just-connected Space, so the user can open
    // it already signed in — even in a fresh browser that never saw the connect
    // step. Null when the slug's local identity isn't available to build one.
    spaceHref: string | null;
  } | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [done, setDone] = createSignal(false);

  const [connected, setConnected] = createSignal<ConnectedInfo | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = createSignal(false);

  const [howOpen, setHowOpen] = createSignal(false);
  const [safeOpen, setSafeOpen] = createSignal(false);
  const [resendRemaining, setResendRemaining] = createSignal(0);
  const [exitNote, setExitNote] = createSignal(false);
  const howBodyId = createUniqueId();
  const safeBodyId = createUniqueId();

  let headingRef: HTMLHeadingElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let codeInput: HTMLInputElement | undefined;
  let keyRef: HTMLElement | undefined;
  let resendTimer: number | undefined;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const nextState = state();
    if (nextState === 'resolving') return;
    if (nextState === 'details') nameInput?.focus();
    else if (nextState === 'verify') codeInput?.focus();
    else headingRef?.focus();
  });

  onCleanup(() => {
    if (resendTimer) clearInterval(resendTimer);
    if (copyTimer) clearTimeout(copyTimer);
  });

  function startResendCountdown(requestedAt: number) {
    const until = requestedAt + CODE_REQUEST_WINDOW_MS;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setResendRemaining(remaining);
      if (remaining === 0 && resendTimer) {
        clearInterval(resendTimer);
        resendTimer = undefined;
      }
    };
    if (resendTimer) clearInterval(resendTimer);
    tick();
    if (resendRemaining() > 0) resendTimer = window.setInterval(tick, 1000);
  }

  function showConnected(info: ConnectedInfo) {
    setConnected(info);
    setState('connected');
  }

  // Resolve a known slug into a connect/reconnect screen, or return false to fall
  // through. A dead witness/Space (401/404) is self-healed so it stops routing
  // returning users to the cold details form.
  async function resolveFromSlug(slug: string): Promise<boolean> {
    try {
      const { token } = await api.getApiToken(slug);
      showConnected({
        apiToken: token,
        slug,
        email: getPlainspaceEmail(),
        pendingCode: null,
      });
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) clearIdentity(slug);
      return false;
    }
  }

  onMount(async () => {
    document.title = 'Connect Super Productivity — Plainspace';

    // 0. Resume a paused verify first (§ Screen B) so a reload/app-switch doesn't
    // dead-end on the 2-min resend cooldown with a valid code sitting unused.
    const pending = getPendingConnect();
    if (pending && Date.now() - pending.requestedAt < CODE_EXPIRY_MS) {
      setEmail(pending.email);
      // Restore the details a brand-new user typed so a post-verify createProject
      // has a non-empty displayName (else it 422-loops — see PendingConnect).
      setName(pending.name ?? '');
      setSpaceName(pending.spaceName ?? '');
      startResendCountdown(pending.requestedAt);
      setState('verify');
      return;
    }
    if (pending) clearPendingConnect();

    // 1. A live verified witness → reconnect (has key) or one-tap (no key yet).
    const witnessSlug = getVerifiedWitnessSlug();
    if (witnessSlug && (await resolveFromSlug(witnessSlug))) return;

    // 2. Any other known Space with a local token (stale-witness / join-only).
    for (const space of listKnownSpaces()) {
      if (space.slug === witnessSlug || !getToken(space.slug)) continue;
      if (await resolveFromSlug(space.slug)) return;
    }

    // 3. Brand-new or returning-on-new-device: email → code tells them apart.
    setEmail(getPlainspaceEmail());
    setState('details');
  });

  async function requestCodeAndVerify(addr: string) {
    const res = await api.requestCreationCode({ email: addr });
    setEmail(addr);
    setDevCode(res.devCode);
    setCode(res.devCode ?? '');
    const requestedAt = Date.now();
    // Carry the details so a resume (which lands on the field-less verify screen)
    // can still complete createProject for a brand-new user (§ Screen B).
    savePendingConnect({
      email: addr,
      step: 'verify',
      requestedAt,
      name: name().trim(),
      spaceName: spaceName().trim(),
    });
    startResendCountdown(requestedAt);
    setState('verify');
  }

  async function handleDetailsSubmit(e: Event) {
    e.preventDefault();
    if (!name().trim() || !email().trim()) return;
    setSubmitting(true);
    setError('');
    setCodeError('');
    try {
      await requestCodeAndVerify(email().trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (resendRemaining() > 0) return;
    setError('');
    setCodeError('');
    try {
      await requestCodeAndVerify(email().trim());
    } catch {
      // 429 (still cooling down): restart the countdown from the stored stamp.
      const p = getPendingConnect();
      if (p) startResendCountdown(p.requestedAt);
      setError('Please wait a moment before requesting another code.');
    }
  }

  function handleVerifySubmit(e: Event) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code())) {
      setError('');
      setCodeError('Enter the 6-digit code we emailed you.');
      return;
    }
    setError('');
    setCodeError('');
    void connectOrCreate(code());
  }

  function seedWitness(w: {
    slug: string;
    memberToken: string;
    memberId: string;
    projectName: string;
  }) {
    saveIdentity(w.slug, w.memberToken, w.memberId, w.projectName);
    saveVerifiedWitnessSlug(w.slug);
  }

  async function connectOrCreate(verifyCode: string) {
    setState('minting');
    try {
      const r = await api.connect({ email: email().trim(), code: verifyCode });
      if (r.status === 'already-connected') {
        savePlainspaceEmail(r.email);
        // The server signs this device in on a verified code: seed the witness
        // so "Open your Space" works and a later visit resolves warm instead of
        // hitting the join form.
        if (r.witness) seedWitness(r.witness);
        showConnected({
          apiToken: r.apiToken,
          slug: r.witness?.slug ?? null,
          email: r.email,
          pendingCode: verifyCode,
        });
        return;
      }
      if (r.status === 'connected') {
        // Seed this device as a witness, then reveal the key.
        savePlainspaceEmail(r.email);
        seedWitness(r.witness);
        clearPendingConnect();
        revealKey(r.token, { created: false, spaceName: null, slug: r.witness.slug });
      }
    } catch (e) {
      // §10.5: fall back to createProject ONLY on the machine discriminator, not
      // a bare 404 – any stray 404 would otherwise spawn a duplicate junk Space.
      if (e instanceof ApiError && e.body?.code === 'no-account') {
        await createFirstSpace(verifyCode);
      } else {
        if (e instanceof ApiError && e.status === 401) setCodeError(e.message);
        else setError('Could not connect. Please try again.');
        setState('verify');
      }
    }
  }

  async function createFirstSpace(verifyCode: string) {
    try {
      const res = await api.createProject({
        name: spaceName().trim() || `${name().trim()}'s Plainspace`,
        displayName: name().trim(),
        email: email().trim(),
        code: verifyCode,
      });
      savePlainspaceEmail(email().trim());
      seedWitness({
        slug: res.project.slug,
        memberToken: res.token,
        memberId: res.member.id,
        projectName: res.project.name,
      });
      const t = await api.createApiToken(res.project.slug);
      clearPendingConnect();
      revealKey(t.token, { created: true, spaceName: res.project.name, slug: res.project.slug });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setCodeError(err.message);
      else
        setError(
          err instanceof ApiError ? err.message : 'Could not set up your Space – please try again.',
        );
      setState('verify');
    }
  }

  // One-tap connect for a verified witness that has no key yet.
  async function connectLocal(slug: string) {
    setState('minting');
    try {
      // §10.7 TOCTOU: re-check for an active token right before minting.
      const existing = await api.getApiToken(slug);
      if (existing.token) {
        showConnected({
          apiToken: existing.token,
          slug,
          email: getPlainspaceEmail(),
          pendingCode: null,
        });
        return;
      }
      const t = await api.createApiToken(slug);
      revealKey(t.token, { created: false, spaceName: null, slug });
    } catch (e) {
      // A known Space whose membership isn't email-verified can't mint (400 "Add
      // an email…"). Don't loop on a broken one-tap – send them through email →
      // code, which `connect` recognizes by email anyway.
      if (e instanceof ApiError && e.status === 400) {
        setEmail(getPlainspaceEmail());
        setState('details');
        return;
      }
      addToast('Could not connect. Please try again.');
      showConnected({ apiToken: null, slug, email: getPlainspaceEmail(), pendingCode: null });
    }
  }

  async function regenerate() {
    setConfirmRegenerate(false);
    const info = connected();
    if (!info) return;
    setState('minting');
    try {
      // A held verification code (returning user via email→code) regenerates
      // through the account-level force mint: it refreshes ToS and does the
      // atomic revoke+mint. Prefer it whenever a code is present — a witness slug
      // is now also set on that path (for "Open your Space"), so keying on the
      // slug would wrongly route through createApiToken, skip the ToS refresh, and
      // hand a stale-ToS user an inert key. A local-witness reconnect has no code
      // and mints directly with its member session.
      if (info.pendingCode) {
        const r = await api.connect({ email: info.email, code: info.pendingCode, force: true });
        if (r.status === 'connected') {
          savePlainspaceEmail(r.email);
          seedWitness(r.witness);
          clearPendingConnect();
          revealKey(r.token, { created: false, spaceName: null, slug: r.witness.slug });
        } else {
          showConnected(info); // shouldn't happen with force; keep the reconnect screen
        }
        return;
      }
      if (info.slug) {
        const t = await api.createApiToken(info.slug);
        revealKey(t.token, { created: false, spaceName: null, slug: info.slug });
      }
    } catch (e) {
      // §10.6: the held code can expire (10-min window). Don't dead-end – request
      // a fresh one and route back to verify.
      if (e instanceof ApiError && e.status === 401 && info.pendingCode) {
        try {
          await requestCodeAndVerify(info.email);
          addToast('Your code expired – we sent a new one.');
        } catch {
          addToast('Could not send a new code. Please try again.');
          showConnected(info);
        }
      } else {
        addToast('Could not generate a new key. Please try again.');
        showConnected(info);
      }
    }
  }

  // A claim link to open the Space signed in. seedWitness (or a resolved witness)
  // has already saved the slug's token + memberId locally by the time we reveal,
  // so read them back; null-safe if either is somehow missing.
  function spaceHrefFor(slug: string | null): string | null {
    if (!slug) return null;
    const token = getToken(slug);
    const memberId = getMemberId(slug);
    return token && memberId ? buildClaimUrl(slug, token, memberId) : null;
  }

  function revealKey(
    token: string,
    opts: { created: boolean; spaceName: string | null; slug: string | null },
  ) {
    setReveal({
      token,
      created: opts.created,
      spaceName: opts.spaceName,
      spaceHref: spaceHrefFor(opts.slug),
    });
    setCopied(false);
    setCopyFailed(false);
    setSaved(false);
    setDone(false);
    setState('reveal');
  }

  async function handleCopy() {
    const r = reveal();
    if (!r) return;
    // §10.3: flip copied/saved ONLY when the copy actually happened – a failed
    // write must not open the gate on a copy that never happened.
    if (await copyText(r.token)) {
      setCopyFailed(false);
      setCopied(true);
      setSaved(true);
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
  }

  // Tap-to-select is an equal path that also satisfies the gate (§10.3).
  function handleSelectKey() {
    if (!keyRef) return;
    window.getSelection()?.selectAllChildren(keyRef);
    setSaved(true);
  }

  function finishReveal() {
    const url = returnUrl();
    if (url) {
      window.location.href = url;
      return;
    }
    setDone(true);
  }

  function exitToSp() {
    const url = returnUrl();
    if (url) {
      window.location.href = url;
      return;
    }
    setExitNote(true);
  }

  return (
    <main
      class={styles.container}
      aria-busy={state() === 'resolving' || state() === 'minting' ? 'true' : undefined}
    >
      <div class={styles.header}>
        <img src="/favicon.svg" alt="" class={styles.logo} />
        <Show when={state() === 'resolving'}>
          <h1 ref={(element) => (headingRef = element)} class={styles.title} tabindex="-1">
            Connect Super Productivity
          </h1>
        </Show>
        <Show when={state() === 'details'}>
          <h1 ref={(element) => (headingRef = element)} class={styles.title} tabindex="-1">
            Set up your first Space
          </h1>
        </Show>
        <Show when={state() === 'verify'}>
          <h1 ref={(element) => (headingRef = element)} class={styles.title} tabindex="-1">
            Check your email
          </h1>
        </Show>
        <Show when={state() === 'minting'}>
          <h1 ref={(element) => (headingRef = element)} class={styles.title} tabindex="-1">
            Setting up your connection
          </h1>
        </Show>
      </div>
      <Show when={state() === 'details' || state() === 'verify'}>
        <span class={styles.chip}>Opened from Super Productivity</span>
      </Show>

      <Switch>
        <Match when={state() === 'resolving'}>
          <p class={styles.spinner} role="status" aria-live="polite">
            Loading…
          </p>
        </Match>

        <Match when={state() === 'details'}>
          <p class={styles.lead}>
            Some tasks involve people who'll never open Super Productivity – a client, a coworker, a
            friend or your family. Plainspace gives them a shared page they can open in any browser:
            no app, no login. Assign them a task in SP and it shows up here for them to follow.
          </p>

          <div class={styles.expanders}>
            <CollapseToggle
              collapsed={!howOpen()}
              onToggle={() => setHowOpen((v) => !v)}
              controls={howBodyId}
              testId="how-toggle"
            >
              How does this work?
            </CollapseToggle>
            <CollapseBody id={howBodyId} collapsed={!howOpen()}>
              <div class={styles.expanderBody}>
                The people you assign tasks to can follow along in Plainspace – no Super
                Productivity account needed. You keep working in SP; they see just their shared
                list.
              </div>
            </CollapseBody>
            <CollapseToggle
              collapsed={!safeOpen()}
              onToggle={() => setSafeOpen((v) => !v)}
              controls={safeBodyId}
              testId="safe-toggle"
            >
              Is this safe?
            </CollapseToggle>
            <CollapseBody id={safeBodyId} collapsed={!safeOpen()}>
              <div class={styles.expanderBody}>
                <ul>
                  <li>No passwords – your email is your login.</li>
                  <li>We only store the shared lists (Spaces) you make.</li>
                  <li>The key covers only your own Spaces, and you can revoke it anytime.</li>
                  <li>You're on the real plainspace.org – check your address bar.</li>
                </ul>
              </div>
            </CollapseBody>
          </div>

          <FormCard
            onSubmit={handleDetailsSubmit}
            aria-busy={submitting() ? 'true' : undefined}
            data-testid="connect-details-form"
          >
            <TextField
              id="connect-name"
              label="Your name"
              type="text"
              autocomplete="name"
              placeholder="e.g. Johannes"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              maxLength={40}
              required
              ref={(element) => (nameInput = element)}
              data-testid="connect-name-input"
              helperText="This is how people you share a task with see you."
            />
            <TextField
              id="connect-space"
              label="Name your first Space"
              type="text"
              placeholder="e.g. Johannes's Plainspace"
              value={spaceName()}
              onInput={(e) => setSpaceName(e.currentTarget.value)}
              maxLength={100}
              data-testid="connect-space-input"
              helperText="A shared list you and specific people can see. (We'll create this if it's your first time.)"
            />
            <TextField
              id="connect-email"
              label="Your email"
              type="email"
              autocomplete="email"
              placeholder="e.g. you@example.com"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              maxLength={255}
              required
              data-testid="connect-email-input"
              helperText="No password to make. We email one 6-digit code to confirm it's you – that's your login."
            />

            <Show when={error()}>
              <p class={styles.error} role="alert">
                {error()}
              </p>
            </Show>

            <LegalNotice action="connecting" />

            <Button
              class={styles.submit}
              type="submit"
              disabled={submitting() || !name().trim() || !email().trim()}
              data-testid="connect-details-submit"
            >
              {submitting() ? 'Sending code…' : 'Continue – email me a code'}
            </Button>
          </FormCard>
        </Match>

        <Match when={state() === 'verify'}>
          <FormCard onSubmit={handleVerifySubmit} data-testid="connect-verify-form">
            <p class={styles.note}>
              We sent a 6-digit code to {email()}. Enter it and your Space goes live.
            </p>
            <TextField
              id="connect-code"
              label="Enter the code"
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
              ref={(element) => (codeInput = element)}
              data-testid="connect-code-input"
              helperText={devCode() ? `Dev code: ${devCode()}` : undefined}
              error={codeError()}
            />

            <Show when={error()}>
              <p class={styles.error} role="alert">
                {error()}
              </p>
            </Show>

            <Button
              class={styles.submit}
              type="submit"
              disabled={code().length !== 6}
              data-testid="connect-verify-submit"
            >
              Connect
            </Button>

            <Button
              type="button"
              variant="ghost"
              disabled={resendRemaining() > 0}
              onClick={handleResend}
              data-testid="connect-resend"
            >
              {resendRemaining() > 0
                ? `Resend in ${Math.floor(resendRemaining() / 60)}:${String(resendRemaining() % 60).padStart(2, '0')}`
                : "Didn't get it? Resend"}
            </Button>
            <p class={styles.note}>
              Still nothing? Check spam – some work mail servers delay it a minute or two.
            </p>
          </FormCard>
        </Match>

        <Match when={state() === 'minting'}>
          <p class={styles.spinner} role="status" aria-live="polite">
            Setting up {spaceName().trim() ? `"${spaceName().trim()}"` : 'your connection'}…
          </p>
        </Match>

        <Match when={state() === 'reveal' && reveal()}>
          {(r) => (
            <div class={styles.card} data-testid="connect-reveal">
              <h1 ref={(element) => (headingRef = element)} class={styles.title} tabindex="-1">
                {r().created
                  ? `Your Space "${r().spaceName}" is ready`
                  : 'Welcome back – we connected this to your existing Spaces'}
              </h1>
              <p class={styles.note}>
                One last step: paste this key into Super Productivity so it can post here for you.
              </p>
              <Banner variant="warning" title="Shown once">
                Copy it now – you won't see it again.
              </Banner>
              <code
                ref={keyRef}
                class={styles.codeBox}
                onClick={handleSelectKey}
                data-testid="connect-key"
              >
                {r().token}
              </code>
              <Button size="sm" onClick={handleCopy} data-testid="connect-copy">
                {copied() ? 'Copied ✓' : copyFailed() ? 'Copy failed' : 'Copy key'}
              </Button>
              <Show when={copied()}>
                <span class="visually-hidden" role="status">
                  Key copied.
                </span>
              </Show>
              <Show when={copyFailed()}>
                <p class={styles.warn} role="alert">
                  Copy failed – tap the key above to select it.
                </p>
              </Show>
              <p class={styles.scope}>{SCOPE_LINE} Lasts 1 year.</p>

              <Show
                when={!done()}
                fallback={
                  <p class={styles.note} role="status">
                    You're all set – switch back to Super Productivity and paste your key into the
                    Connect box. You can close this tab.
                  </p>
                }
              >
                <Button
                  class={styles.submit}
                  disabled={!saved()}
                  onClick={finishReveal}
                  data-testid="connect-finish"
                >
                  {returnUrl() ? 'Open Super Productivity' : "I've saved my key"}
                </Button>
              </Show>

              {/* Open the new Space already signed in. The #claim link carries
                  the identity, so it works even if the user lands here in a
                  fresh browser that never saw the connect step — otherwise a
                  first visit hits the join form and asks them to pick a name. */}
              <Show when={r().spaceHref && saved()}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => window.open(r().spaceHref!, '_blank', 'noopener')}
                  data-testid="connect-open-space"
                >
                  Open your Space
                </Button>
              </Show>
            </div>
          )}
        </Match>

        <Match when={state() === 'connected' && connected()}>
          {(info) => (
            <div class={styles.card} data-testid="connect-reconnect">
              <Show
                when={info().apiToken}
                fallback={
                  <>
                    <h1
                      ref={(element) => (headingRef = element)}
                      class={styles.title}
                      tabindex="-1"
                    >
                      Connect Super Productivity
                    </h1>
                    <p class={styles.scope}>{SCOPE_LINE}</p>
                    <Button
                      class={styles.submit}
                      onClick={() => info().slug && connectLocal(info().slug!)}
                      data-testid="connect-onetap"
                    >
                      Connect Super Productivity
                    </Button>
                  </>
                }
              >
                {(token) => (
                  <>
                    <h1
                      ref={(element) => (headingRef = element)}
                      class={styles.title}
                      tabindex="-1"
                    >
                      Super Productivity needs a key
                    </h1>
                    <Show when={info().email}>
                      <p class={styles.note}>You already have one active for {info().email}.</p>
                    </Show>
                    <p class={styles.meta}>
                      Created {new Date(token().createdAt).toLocaleDateString()}
                      {token().lastUsedAt
                        ? ` · Last used ${new Date(token().lastUsedAt!).toLocaleDateString()}`
                        : ' · Never used'}
                    </p>
                    <p class={styles.note}>
                      If this copy of SP already has it, you're set. Otherwise, generate a fresh key
                      below.
                    </p>
                    <p class={styles.scope}>{SCOPE_LINE}</p>
                    <Button
                      class={styles.submit}
                      onClick={() => setConfirmRegenerate(true)}
                      data-testid="connect-regenerate"
                    >
                      Generate a new key
                    </Button>
                    <p class={styles.warn}>
                      ⚠ Disconnects the old key everywhere, including Super Productivity on your
                      other devices.
                    </p>
                  </>
                )}
              </Show>

              {/* Signed in on this device (created via connect or seeded from an
                  already-connected response), so offer a direct way into the
                  Space instead of leaving the user to find it and hit the join
                  form. */}
              <Show when={spaceHrefFor(info().slug)}>
                {(href) => (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => window.open(href(), '_blank', 'noopener')}
                    data-testid="connect-open-space"
                  >
                    Open your Space
                  </Button>
                )}
              </Show>

              <Button type="button" variant="ghost" onClick={exitToSp} data-testid="connect-back">
                Back to Super Productivity
              </Button>
              <Show when={exitNote()}>
                <p class={styles.note} role="status">
                  You can close this tab and reconnect from Super Productivity anytime.
                </p>
              </Show>
            </div>
          )}
        </Match>
      </Switch>

      <Show when={confirmRegenerate()}>
        <ConfirmDialog
          title="Generate a new key?"
          message="One key works across all your Spaces and apps. Generating a new one instantly disconnects the old key everywhere. If you use Super Productivity on another device, that device will be signed out."
          confirmLabel="Generate a new key"
          danger
          onConfirm={regenerate}
          onCancel={() => setConfirmRegenerate(false)}
        />
      </Show>
    </main>
  );
}
