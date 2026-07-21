import { createEffect, onCleanup, Show, For, createSignal, createMemo, untrack } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { api, ApiError } from '../lib/api';
import { useDocumentTitle } from '../lib/document-title';
import {
  hasIdentity,
  savePlainspaceEmail,
  saveVerifiedWitnessSlug,
  parseClaim,
  parseLoginLink,
  saveIdentity,
  setLastOpenSpace,
  updateIdentityName,
} from '../lib/identity';
import { createMemberId } from '../lib/member-identity';
import { byPosition } from '../lib/reorder';
import { connectSSE, disconnectSSE, handleUnauthorized } from '../lib/sse';
import { toasts, addToast, dismissToast } from '../lib/toast';
import {
  state,
  setProjectData,
  setError,
  setLoading,
  setActivity,
  setActivityHasMore,
  resetState,
  updateMember,
  removeItem,
  restoreItem,
  addActivity,
} from '../lib/store';
import Shell from '../components/layout/Shell';
import Header from '../components/layout/Header';
import MobileQuickActions from '../components/layout/MobileQuickActions';
import FirstShareNudge from '../components/onboarding/FirstShareNudge';
import ListCard from '../components/lists/ListCard';
import ScratchpadCard from '../components/scratchpads/ScratchpadCard';
import PanelColumn from '../components/panels/PanelColumn';
import ActivityFeed from '../components/activity/ActivityFeed';
import Toast from '../components/shared/Toast';
import { Banner, Button, Dialog } from '../components/ui';
import styles from './Project.module.css';

export default function Project() {
  const params = useParams<{ slug: string; itemId?: string }>();
  const navigate = useNavigate();
  const [termsRequired, setTermsRequired] = createSignal(false);
  const [termsProjectName, setTermsProjectName] = createSignal('this Space');
  const [acceptingTerms, setAcceptingTerms] = createSignal(false);
  const [termsError, setTermsError] = createSignal('');
  const [showMembers, setShowMembers] = createSignal(false);
  const [focusEmailVerification, setFocusEmailVerification] = createSignal(false);
  const [loadAttempt, setLoadAttempt] = createSignal(0);
  // Marks a load as user-initiated, so only a retry moves focus.
  let retryFocusPending = false;

  // A plain memo on params.slug would miss the localStorage write the #claim=
  // hand-off does inside the effect below (same slug, so nothing re-tracks).
  // createMemberId keeps it a signal the effect refreshes once identity settles.
  const { myId, refresh: refreshMyId } = createMemberId(params.slug);
  const currentMember = createMemo(() => {
    const id = myId();
    return id ? state.members.find((member) => member.id === id) : undefined;
  });
  const auxTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let sessionStarted = false;
  let loadController: AbortController | null = null;

  function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
  }

  function handleMembersOpenChange(open: boolean) {
    setShowMembers(open);
    if (!open) setFocusEmailVerification(false);
  }

  function handleConnectEmailClick() {
    setFocusEmailVerification(true);
    setShowMembers(true);
  }

  function focus(testId: string) {
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus();
  }

  // Retry owns focus across the reload: onto the loading indicator now, then
  // onto whatever the finished load put in its place (see `settleRetryFocus`).
  function handleRetry() {
    retryFocusPending = true;
    setLoadAttempt((attempt) => attempt + 1);
    focus('project-loading');
  }

  // Called once the load has fully settled -- not when `state.project` arrives,
  // which happens while the activity fetch is still able to fail into the error
  // screen. The terms dialog owns modal focus, so there we only stand down.
  function settleRetryFocus() {
    if (!retryFocusPending) return;
    retryFocusPending = false;
    if (termsRequired()) return;
    focus(state.error ? 'project-error-heading' : 'project-name');
  }

  // SSE carries no event ids and the server buffers nothing, so a reconnect
  // after a dropped stream can miss mutations. Re-fetch the full snapshot and
  // reconcile (setProjectData/setActivity are id-merged/replace, so this is
  // safe to apply alongside live events). Best-effort: a 401 here is handled
  // by the SSE stream's own auth path, and a slug change mid-flight is dropped.
  async function resyncProjectSession(slug: string) {
    try {
      const data = await api.getProject(slug);
      if (params.slug !== slug) return;
      setProjectData(data);
      const activityData = await api.getActivity(slug);
      if (params.slug !== slug) return;
      setActivity(activityData.entries);
    } catch {
      /* SSE handles auth/redirect; a transient failure resyncs next reconnect */
    }
  }

  async function loadProjectSession(slug: string, signal: AbortSignal) {
    if (!sessionStarted) {
      sessionStarted = true;
      // Open the stream BEFORE fetching the snapshot: a mutation landing
      // between the snapshot's DB read and the stream opening would be missed
      // and never reconciled (no event ids, no server-side buffering). This
      // narrows the gap to the sub-second window where the two requests race
      // server-side; an event the snapshot then clobbers is healed by the
      // next event touching that entity (a clobbered DELETION stays stale
      // until the next reconnect resync — accepted, same trade
      // resyncProjectSession makes).
      connectSSE(slug, () => void resyncProjectSession(slug));
    }

    const data = await api.getProject(slug, signal);
    setProjectData(data);
    updateIdentityName(slug, data.project.name);
    setLastOpenSpace(slug);

    const activityData = await api.getActivity(slug, undefined, signal);
    setActivity(activityData.entries);
    setActivityHasMore(activityData.hasMore);

    if (params.itemId) {
      const itemId = params.itemId;
      const t1 = setTimeout(() => {
        const el = document.querySelector(`[data-item-id="${itemId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight');
          const t2 = setTimeout(() => el.classList.remove('highlight'), 2000);
          auxTimers.set('_hl', t2);
        }
      }, 300);
      auxTimers.set('_dl', t1);
    }
  }

  async function handleAcceptTerms() {
    const slug = params.slug;
    setAcceptingTerms(true);
    setTermsError('');

    // Single controller covers both the POST and the follow-up project load,
    // so a slug change mid-flight (which calls loadController?.abort()) tears
    // down the whole flow instead of letting the POST's success handler
    // resurrect state into the freshly-reset store.
    const controller = new AbortController();
    loadController?.abort();
    loadController = controller;

    try {
      const result = await api.acceptTerms(slug, controller.signal);
      updateMember(result.member);
      setTermsRequired(false);
    } catch (err) {
      if (isAbortError(err)) return;
      setTermsError(
        err instanceof ApiError ? err.message : 'Could not accept the current legal terms',
      );
      setAcceptingTerms(false);
      return;
    }

    try {
      await loadProjectSession(slug, controller.signal);
    } catch (err) {
      if (isAbortError(err)) return;
      // The stream may already be connected; don't leave it dispatching into
      // the store behind the error screen.
      disconnectSSE();
      sessionStarted = false;
      setError(err instanceof ApiError ? err.message : 'Failed to load Space');
    } finally {
      setAcceptingTerms(false);
    }
  }

  // Same node in both loading branches (top-level and behind the terms gate) so
  // the retry-focus effect below always has its target, whichever one is up.
  function renderLoading() {
    return (
      <div
        class={styles.loading}
        role="status"
        aria-label="Loading Space"
        tabindex="-1"
        data-testid="project-loading"
      >
        Loading Space…
      </div>
    );
  }

  function renderTermsDialog() {
    return (
      <Dialog
        ariaLabel="Accept updated legal terms"
        onClose={() => {}}
        class={styles.termsDialog}
        data-testid="terms-acceptance-dialog"
      >
        <h1 data-testid="terms-heading">Updated Legal Terms</h1>
        <p>
          Plainspace needs your active acceptance of the current{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer">
            Terms
          </a>{' '}
          and{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>{' '}
          before you continue using {termsProjectName()}.
        </p>
        <Show when={termsError()}>
          <p class={styles.termsError} role="alert">
            {termsError()}
          </p>
        </Show>
        <div class={styles.termsActions}>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Leave for now
          </Button>
          <Button onClick={handleAcceptTerms} disabled={acceptingTerms()}>
            {acceptingTerms() ? 'Accepting...' : 'Accept and continue'}
          </Button>
        </div>
      </Dialog>
    );
  }

  useDocumentTitle(() => {
    if (state.loading) return 'Opening Space — Plainspace';
    if (state.error) return 'Couldn’t open Space — Plainspace';
    if (termsRequired()) return 'Accept updated legal terms — Plainspace';
    return state.project ? `${state.project.name} — Plainspace` : 'Opening Space — Plainspace';
  });

  createEffect(() => {
    loadAttempt();
    const slug = params.slug;

    // Tear down anything from a previous slug before starting fresh.
    loadController?.abort();
    disconnectSSE();
    auxTimers.forEach((t) => clearTimeout(t));
    auxTimers.clear();
    sessionStarted = false;
    resetState();
    setTermsRequired(false);
    setTermsProjectName('this Space');
    setAcceptingTerms(false);
    setTermsError('');
    setShowMembers(false);
    setFocusEmailVerification(false);

    // "Use on another device" hand-off: a sibling browser opened
    // /{slug}#claim=<token>.<memberId>. The token rides in the URL fragment
    // (not the query) so it never reaches the server's access logs and is
    // never sent as a Referer. Persist the identity and strip the fragment.
    const claim = parseClaim(window.location.hash);
    if (claim) {
      const url = new URL(window.location.href);
      window.history.replaceState(null, '', url.pathname + url.search);
      saveIdentity(slug, claim.token, claim.memberId);
    }

    // "Find my Spaces" magic recovery link: /{slug}#login=<code>.<email>.
    // Redeemed below (async) for a fresh token before the identity check.
    const loginLink = parseLoginLink(window.location.hash);
    if (loginLink) {
      const url = new URL(window.location.href);
      window.history.replaceState(null, '', url.pathname + url.search);
    }

    const controller = new AbortController();
    loadController = controller;

    (async () => {
      try {
        // One emailed link signs the owner in here and in every other Space
        // sharing the verified email (verify-login-code rotates them all). On
        // an expired/used/invalid code, fall through to the normal recover path.
        if (loginLink) {
          // Remember the email regardless of outcome so a failed/expired code
          // still lands on the recover form with the address prefilled.
          savePlainspaceEmail(loginLink.email);
          try {
            const res = await api.verifyLoginCode(slug, loginLink);
            saveIdentity(slug, res.token, res.member.id);
            for (const s of res.otherSpaces) saveIdentity(s.slug, s.token, s.memberId, s.name);
            saveVerifiedWitnessSlug(slug);
          } catch {
            // expired/used/invalid — fall through to the recover form below.
          }
        }

        if (!hasIdentity(slug)) {
          // Only a failed/expired magic link lands on the recover form (email
          // prefilled). A plain no-identity visit goes to the normal join form,
          // even when a global email is remembered — otherwise returning users
          // joining a new Space get the recover flow instead of joining.
          navigate(`/${slug}/join${loginLink ? '?recover=1' : ''}`, { replace: true });
          return;
        }

        // Identity for this slug is now settled (including the #claim= hand-off
        // and any #login= redemption above); refresh myId so currentMember and
        // own-row highlighting resolve.
        refreshMyId(slug);

        const status = await api.getTermsStatus(slug, controller.signal);
        setTermsProjectName(status.project.name);

        if (status.terms.acceptanceRequired) {
          setTermsRequired(true);
          setLoading(false);
          return;
        }

        await loadProjectSession(slug, controller.signal);
      } catch (err) {
        if (isAbortError(err)) return;
        if (err instanceof ApiError && err.status === 401) {
          // Server already invalidated the token; the shared handler clears
          // credentials (incl. push, when this was the last Space) and lands
          // on join/recover — same path the SSE stream's 401 takes.
          handleUnauthorized(slug);
        } else {
          // The stream may already be connected; don't leave it dispatching
          // into the store behind the error screen.
          disconnectSSE();
          setError(err instanceof ApiError ? err.message : 'Failed to load Space');
        }
      } finally {
        // Guarded: an aborted run settles *after* its replacement has already
        // started, so only the current load may claim the focus hand-off.
        // Untracked: the no-identity branch returns before any `await`, so this
        // runs synchronously inside the effect body -- reading `state.error`
        // there would subscribe the *load* effect to it and re-run the whole
        // teardown on the next failure.
        if (loadController === controller) untrack(settleRetryFocus);
      }
    })();
  });

  onCleanup(() => {
    loadController?.abort();
    disconnectSSE();
    auxTimers.forEach((t) => clearTimeout(t));
    auxTimers.clear();
  });

  // The hero list shows only the primary list's items. Checklist panels are
  // real lists too, so their items also live in `state.items` (keyed by their
  // own listId) -- filter here so they don't leak into the hero list.
  const sortedItems = createMemo(() =>
    state.items.filter((i) => i.listId === state.list?.id).sort(byPosition),
  );

  async function handleDeleteItem(itemId: string) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return false;
    try {
      await api.deleteItem(params.slug, itemId);
      // Apply the confirmed result directly instead of waiting for the SSE
      // echo — during a reconnect window the echo can be seconds away (or
      // missed entirely until resync). Idempotent with the echo.
      removeItem(itemId);
      addToast(
        `"${item.text}" deleted`,
        async () => {
          const restored = await api.restoreItem(params.slug, itemId);
          restoreItem(restored.item);
          if (restored.activity) addActivity(restored.activity);
        },
        'Undo',
      );
      return true;
    } catch {
      // SSE will resync if the delete actually went through.
      addToast('Could not delete the item. Please try again.');
      return false;
    }
  }

  return (
    <Show when={!state.loading} fallback={<main class={styles.statePage}>{renderLoading()}</main>}>
      <Show
        when={!state.error}
        fallback={
          <main class={styles.statePage}>
            <div class={styles.error}>
              <h1 tabindex="-1" data-testid="project-error-heading">
                Couldn’t open this Space
              </h1>
              <p role="alert">{state.error}</p>
              <div class={styles.errorActions}>
                <Button onClick={handleRetry}>Try again</Button>
                <A href="/spaces" class={styles.backLink}>
                  Back to Spaces
                </A>
              </div>
            </div>
          </main>
        }
      >
        {/* The terms gate is deliberately not a <main>: Dialog renders through a
            Portal, so whenever the gate is up that wrapper would be an empty
            landmark with the heading living outside it. */}
        <Show
          when={state.project}
          fallback={
            <div class={styles.termsGate} data-testid="terms-gate">
              <Show when={termsRequired()} fallback={renderLoading()}>
                {renderTermsDialog()}
              </Show>
            </div>
          }
        >
          <Shell>
            <Show when={!state.connected && !state.loading}>
              <div class={styles.reconnecting} role="status" data-testid="reconnecting-banner">
                Reconnecting...
              </div>
            </Show>
            <Header
              project={state.project!}
              members={state.members}
              presence={state.presence}
              slug={params.slug}
              myId={myId() ?? ''}
              myRole={currentMember()?.role ?? 'member'}
              isCreator={currentMember()?.isCreator ?? false}
              showMembers={showMembers()}
              focusEmailVerification={focusEmailVerification()}
              onMembersOpenChange={handleMembersOpenChange}
            />

            <FirstShareNudge
              slug={params.slug}
              projectName={state.project!.name}
              sharingMode={state.project!.sharingMode}
              isCreator={currentMember()?.isCreator ?? false}
              memberCount={state.members.length}
              taskCount={sortedItems().length}
            />

            <Show when={currentMember() && !currentMember()!.emailVerified}>
              <Banner
                data-testid="email-connection-banner"
                icon={
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                }
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleConnectEmailClick}
                    data-testid="email-connection-button"
                  >
                    Add your email
                  </Button>
                }
              >
                This browser can open this Space. Add an email to reopen it elsewhere.
              </Banner>
            </Show>

            <main class={styles.content}>
              <div class={styles.lists}>
                <Show when={state.list}>
                  <ListCard
                    list={state.list!}
                    items={sortedItems()}
                    members={state.members}
                    attachments={state.attachments}
                    slug={params.slug}
                    myId={myId() ?? ''}
                    onDeleteItem={handleDeleteItem}
                  />
                </Show>
              </div>

              <div class={styles.scratchpads} data-testid="scratchpads-section">
                <Show when={state.scratchpad}>
                  <ScratchpadCard
                    pad={state.scratchpad!}
                    members={state.members}
                    editingMemberIds={state.scratchpadEditors}
                    slug={params.slug}
                    myId={myId() ?? ''}
                  />
                </Show>
                <PanelColumn
                  panels={state.panels}
                  items={state.items}
                  members={state.members}
                  slug={params.slug}
                  myId={myId() ?? ''}
                />
              </div>

              <Show when={state.activity.length > 0}>
                <div class={styles.activityPanel}>
                  <ActivityFeed
                    entries={state.activity}
                    members={state.members}
                    slug={params.slug}
                    hasMore={state.activityHasMore}
                  />
                </div>
              </Show>
            </main>

            {/* The live region is this always-mounted host, not the individual
                toasts: a region inserted in the same tick as its content is
                unreliably announced (VoiceOver in particular). Toasts are the
                only channel for some failures, so they have to be dependable.
                aria-atomic is explicit because role="status" implies true, which
                would re-read every visible toast each time one is added. */}
            <div class={styles.toasts} role="status" aria-atomic="false">
              <For each={toasts()}>
                {(toast) => (
                  <Toast
                    message={toast.message}
                    action={toast.action}
                    actionLabel={toast.actionLabel}
                    onDismiss={() => dismissToast(toast.id)}
                  />
                )}
              </For>
            </div>

            <MobileQuickActions />
          </Shell>
        </Show>
      </Show>
    </Show>
  );
}
