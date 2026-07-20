import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  untrack,
} from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import type { Member, Project } from '@plainspace/shared';
import { api } from '../../lib/api';
import {
  clearIdentity,
  clearPlainspaceEmail,
  getPlainspaceEmail,
  hasIdentity,
  listKnownSpaces,
  type KnownSpace,
} from '../../lib/identity';
import { clearPushSubscription } from '../../lib/push';
import { updateMember } from '../../lib/store';
import { addToast } from '../../lib/toast';
import MemberChip from './MemberChip';
import ApiTokens from './ApiTokens';
import DeviceLink from './DeviceLink';
import EmailVerify from './EmailVerify';
import SharingModeControl from './SharingModeControl';
import SpaceDetailsControl from './SpaceDetailsControl';
import { Badge, Button, ConfirmDialog, Dialog } from '../ui';
import styles from './MemberList.module.css';

// Largest-fitting unit so old joins read "2 months ago", not "63 days ago".
const JOIN_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

function joinedAgo(dateStr: string): string {
  const seconds = Math.round((new Date(dateStr).getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return 'joined just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, secs] of JOIN_UNITS) {
    if (Math.abs(seconds) >= secs) return `joined ${rtf.format(Math.round(seconds / secs), unit)}`;
  }
  return 'joined just now';
}

interface MemberListProps {
  project: Project;
  members: Member[];
  presence: string[];
  myId: string;
  myRole: string;
  isCreator: boolean;
  slug: string;
  focusEmailVerification?: boolean;
  onClose: () => void;
}

export default function MemberList(props: MemberListProps) {
  const navigate = useNavigate();
  const [rememberedEmail, setRememberedEmail] = createSignal(getPlainspaceEmail());
  const [localEmailClearedAt, setLocalEmailClearedAt] = createSignal(0);
  const [accountOpen, setAccountOpen] = createSignal(
    untrack(() => Boolean(props.focusEmailVerification)),
  );
  const [spaceSettingsOpen, setSpaceSettingsOpen] = createSignal(false);
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const accountBodyId = createUniqueId();
  const spaceSettingsBodyId = createUniqueId();
  const advancedBodyId = createUniqueId();
  const isAdmin = () => props.myRole === 'admin' || props.isCreator;
  const me = createMemo(() => props.members.find((m) => m.id === props.myId));
  const onlineCount = createMemo(
    () => props.members.filter((m) => props.presence.includes(m.id)).length,
  );
  // Online first, then admins, then alphabetical — so the panel surfaces who's
  // here now and who can act, instead of raw insertion order.
  const sortedMembers = createMemo(() => {
    const online = new Set(props.presence);
    const rank = (m: Member) => (online.has(m.id) ? 0 : 2) + (m.role === 'admin' ? 0 : 1);
    return [...props.members].sort(
      (a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName),
    );
  });
  // Spaces this device has no local token for but the verified email belongs to,
  // fetched once when the account opens so the list works cross-device (not
  // just from localStorage) without loading hidden account data eagerly.
  const [serverSpaces, setServerSpaces] = createSignal<KnownSpace[]>([]);
  let fetchedSpaces = false;
  createEffect(() => {
    if (fetchedSpaces || !accountOpen() || !me()?.emailVerified) return;
    fetchedSpaces = true;
    // Leave the guard set on failure: the effect re-runs on reactive churn and
    // we don't want to hammer a failing endpoint. A panel reopen retries.
    api
      .mySpaces(props.slug)
      .then((res) => setServerSpaces(res.spaces))
      .catch(() => {});
  });
  const otherSpaces = createMemo(() => {
    const bySlug = new Map<string, KnownSpace>();
    for (const space of listKnownSpaces()) bySlug.set(space.slug, space);
    for (const space of serverSpaces()) if (!bySlug.has(space.slug)) bySlug.set(space.slug, space);
    return [...bySlug.values()]
      .filter((space) => space.slug !== props.slug)
      .sort((a, b) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug));
  });
  let emailSection: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.focusEmailVerification || me()?.emailVerified || !emailSection) return;
    setAccountOpen(true);
    setTimeout(() => {
      emailSection?.scrollIntoView({ block: 'start' });
      emailSection?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }, 0);
  });

  createEffect(() => {
    if (!me()?.emailVerified) return;
    setRememberedEmail(getPlainspaceEmail());
  });

  // DSA Art. 17 requires a Statement of Reasons whenever we restrict or
  // remove a person's content/access. The removal dialog collects a short
  // reason so the affected person receives a structured explanation by email.
  const [removeTarget, setRemoveTarget] = createSignal<Member | null>(null);
  const [confirmingLeave, setConfirmingLeave] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  async function handleRemove(member: Member, reason: string) {
    setRemoveTarget(null);
    await api
      .removeMember(props.slug, member.id, reason ? { reason } : undefined)
      .catch(() => void addToast(`Could not remove ${member.displayName}. Please try again.`));
  }

  async function handleToggleRole(member: Member) {
    const newRole = member.role === 'admin' ? 'member' : 'admin';
    await api
      .updateMemberRole(props.slug, member.id, { role: newRole })
      .catch(
        () => void addToast(`Could not change ${member.displayName}'s role. Please try again.`),
      );
  }

  async function handleExport() {
    try {
      const blob = await api.exportSelf(props.slug);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plainspace-export-${props.slug}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast('Could not download your data. Please try again.');
    }
  }

  function clearLocalSession() {
    clearIdentity(props.slug);
    // Drop the device-wide saved email only once no Spaces remain, so the next
    // person on a shared browser isn't left with the prior user's email
    // prefilled on Home/Join. Leaving one of several Spaces keeps the prefill.
    if (listKnownSpaces().length === 0) clearPlainspaceEmail();
    navigate('/');
  }

  // Drop this device's session for the current Space and return home. Shared by
  // the leave and delete-Space flows: in both, our member row + token are
  // already gone server-side, so we clear the local mirror to match.
  async function leaveSpaceLocally() {
    // The server-side subscription row was already cascade-deleted; the
    // browser-side unsubscribe rules live in clearPushSubscription.
    await clearPushSubscription(props.slug);
    clearLocalSession();
  }

  async function handleSignOut() {
    try {
      // Unsubscribe before revocation while this request can still authenticate.
      await clearPushSubscription(props.slug);
      await api.logoutSession(props.slug);
      clearLocalSession();
    } catch {
      addToast('Could not securely sign out. Please try again.');
    }
  }

  async function handleLeave() {
    setConfirmingLeave(false);
    try {
      await api.deleteSelf(props.slug);
      await leaveSpaceLocally();
    } catch {
      addToast('Could not leave the Space. Please try again.');
    }
  }

  async function handleDeleteSpace() {
    setConfirmingDelete(false);
    try {
      await api.deleteSpace(props.slug);
      await leaveSpaceLocally();
    } catch {
      addToast('Could not delete the Space. Please try again.');
    }
  }

  function handleClearSavedEmail() {
    clearPlainspaceEmail();
    setRememberedEmail('');
    setLocalEmailClearedAt((value) => value + 1);
  }

  return (
    <Dialog
      onClose={props.onClose}
      ariaLabel={`People (${props.members.length})`}
      placement="side"
      class={styles.panel}
      data-testid="member-list-panel"
    >
      <div class={styles.header}>
        <h2 class={styles.title}>People ({props.members.length})</h2>
        <button
          type="button"
          class={styles.closeButton}
          onClick={() => props.onClose()}
          aria-label="Close"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6 6 18" />
          </svg>
        </button>
      </div>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>
          People
          <Show when={onlineCount() > 0}>
            <span class={styles.onlineCount}> · {onlineCount()} online</span>
          </Show>
        </h3>
        <div class={styles.list}>
          <For each={sortedMembers()}>
            {(member) => {
              const isOnline = () => props.presence.includes(member.id);
              const isSelf = () => member.id === props.myId;

              return (
                <div class={styles.row} data-testid="member-row">
                  <div class={styles.info}>
                    <MemberChip member={member} online={isOnline()} />
                    <div class={styles.meta}>
                      {/* Presence is shown as a color dot on the avatar; this keeps it
                          available to screen readers and color-blind users. */}
                      <Show when={isOnline()}>
                        <span class="visually-hidden">online</span>
                      </Show>
                      <Show when={member.role === 'admin'}>
                        <Badge variant="role">admin</Badge>
                      </Show>
                      <span class={styles.joined}>{joinedAgo(member.joinedAt)}</span>
                    </div>
                  </div>
                  <Show when={isAdmin() && !isSelf()}>
                    <div class={styles.actions}>
                      <Show when={props.isCreator}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleRole(member)}
                          title={member.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                        >
                          {member.role === 'admin' ? 'Demote' : 'Promote'}
                        </Button>
                      </Show>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRemoveTarget(member)}
                        data-testid="remove-member-button"
                      >
                        Remove
                      </Button>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </section>

      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <div>
            <h3 class={styles.sectionTitle}>Your account</h3>
            <p class={styles.helpText}>Your Spaces, email, session, and personal data.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAccountOpen((open) => !open)}
            aria-controls={accountBodyId}
            aria-expanded={accountOpen()}
            aria-label={`${accountOpen() ? 'Hide' : 'Show'} account settings`}
            data-testid="account-toggle-button"
          >
            {accountOpen() ? 'Hide' : 'Show'}
          </Button>
        </div>
        <div
          id={accountBodyId}
          class={styles.disclosureBody}
          hidden={!accountOpen()}
          data-testid="account-body"
        >
          <div>
            <h4 class={styles.subsectionTitle}>Your Spaces</h4>
            <div class={styles.spacesList}>
              <For each={otherSpaces()}>
                {(space) => (
                  <A
                    // Spaces without a local token on this device (discovered via the
                    // server) deep-link into open-by-email so one tap starts recovery.
                    href={
                      hasIdentity(space.slug) ? `/${space.slug}` : `/${space.slug}/join?recover=1`
                    }
                    class={styles.spaceLink}
                    onClick={() => props.onClose()}
                    data-testid="panel-space-link"
                  >
                    {space.name ?? space.slug}
                  </A>
                )}
              </For>
              <A
                href="/spaces"
                class={`${styles.spaceLink} ${styles.overviewLink}`}
                onClick={() => props.onClose()}
                data-testid="spaces-overview-link"
              >
                Find, create, or open a Space…
              </A>
            </div>
          </div>

          <Show when={me()}>
            {(member) => (
              <div>
                <h4 class={styles.subsectionTitle}>You</h4>
                <div class={styles.selfRow} style={{ '--member-accent': member().color }}>
                  <div class={styles.info}>
                    <MemberChip member={member()} online={props.presence.includes(member().id)} />
                    <span class={styles.joined}>{joinedAgo(member().joinedAt)}</span>
                    <p class={styles.helpText}>
                      {member().emailVerified
                        ? 'An email is connected to this Space for finding and reopening it.'
                        : 'This browser can open this Space. Add an email to reopen it elsewhere.'}
                    </p>
                  </div>
                  <div class={styles.actions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleSignOut}
                      title="Revoke this browser session without leaving the Space"
                      data-testid="sign-out-button"
                    >
                      Sign out on this device
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleExport}
                      title="Download a JSON copy of your data in this Space"
                      data-testid="export-data-button"
                    >
                      Download my data
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setConfirmingLeave(true)}
                      data-testid="leave-space-button"
                    >
                      Leave Space
                    </Button>
                  </div>
                </div>

                <Show when={rememberedEmail()}>
                  {(email) => (
                    <div class={styles.localEmailRow}>
                      <p class={styles.helpText}>
                        Saved on this device for email forms: <strong>{email()}</strong>
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleClearSavedEmail}
                        data-testid="forget-plainspace-email-button"
                      >
                        Clear saved email
                      </Button>
                    </div>
                  )}
                </Show>

                <Show when={!member().emailVerified}>
                  <div ref={(el) => (emailSection = el)} class={styles.subsection}>
                    <EmailVerify
                      slug={props.slug}
                      currentEmail={member().email}
                      localEmailClearedAt={localEmailClearedAt()}
                      onVerified={(member) => updateMember(member)}
                    />
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </section>

      <Show when={isAdmin()}>
        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <div>
              <h3 class={styles.sectionTitle}>Space settings</h3>
              <p class={styles.helpText}>Space details, sharing, and deletion.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSpaceSettingsOpen((open) => !open)}
              aria-controls={spaceSettingsBodyId}
              aria-expanded={spaceSettingsOpen()}
              aria-label={`${spaceSettingsOpen() ? 'Hide' : 'Show'} Space settings`}
              data-testid="space-settings-toggle-button"
            >
              {spaceSettingsOpen() ? 'Hide' : 'Show'}
            </Button>
          </div>
          <div
            id={spaceSettingsBodyId}
            class={styles.disclosureBody}
            hidden={!spaceSettingsOpen()}
            data-testid="space-settings-body"
          >
            <SpaceDetailsControl slug={props.slug} project={props.project} />
            <SharingModeControl
              slug={props.slug}
              project={props.project}
              emailVerified={me()?.emailVerified ?? false}
            />
            {/* Deleting the whole Space is an ownership-level action: creator only,
                matching the server's requireCreator gate. */}
            <Show when={props.isCreator}>
              <div class={styles.dangerZone}>
                <div>
                  <p class={styles.dangerTitle}>Delete this Space</p>
                  <p class={styles.helpText}>
                    Permanently removes this Space and everything in it for everyone here. This
                    cannot be undone.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setConfirmingDelete(true)}
                  data-testid="delete-space-button"
                >
                  Delete Space
                </Button>
              </div>
            </Show>
          </div>
        </section>
      </Show>

      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <div>
            <h3 class={styles.sectionTitle}>Advanced</h3>
            <p class={styles.helpText}>Device link and API tokens.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-controls={advancedBodyId}
            aria-expanded={advancedOpen()}
            aria-label={`${advancedOpen() ? 'Hide' : 'Show'} advanced settings`}
            data-testid="advanced-toggle-button"
          >
            {advancedOpen() ? 'Hide' : 'Show'}
          </Button>
        </div>
        <div
          id={advancedBodyId}
          class={styles.disclosureBody}
          hidden={!advancedOpen()}
          data-testid="advanced-body"
        >
          <DeviceLink slug={props.slug} myId={props.myId} />
          <ApiTokens slug={props.slug} emailVerified={me()?.emailVerified ?? false} />
        </div>
      </section>

      <Show when={removeTarget()}>
        {(member) => (
          <ConfirmDialog
            title={`Remove ${member().displayName}?`}
            message="The reason is emailed to this person as a DSA Art. 17 Statement of Reasons. Leave it blank to remove without notice."
            confirmLabel="Remove"
            danger
            input={{ label: 'Reason for removal', optionalText: '(optional)' }}
            onConfirm={(reason) => handleRemove(member(), reason)}
            onCancel={() => setRemoveTarget(null)}
          />
        )}
      </Show>

      <Show when={confirmingLeave()}>
        <ConfirmDialog
          title="Leave this Space?"
          message="Your access record will be deleted. Content you created stays visible to the other people here but is no longer attributed to you. This cannot be undone."
          confirmLabel="Leave Space"
          danger
          onConfirm={handleLeave}
          onCancel={() => setConfirmingLeave(false)}
        />
      </Show>

      <Show when={confirmingDelete()}>
        <ConfirmDialog
          title="Delete this Space?"
          message={`This permanently deletes "${props.project.name}" — every list, item, panel, and person — for everyone here. This cannot be undone. Type the Space name to confirm.`}
          confirmLabel="Delete Space"
          danger
          input={{
            label: 'Space name',
            placeholder: props.project.name,
            confirmValue: props.project.name,
          }}
          onConfirm={handleDeleteSpace}
          onCancel={() => setConfirmingDelete(false)}
        />
      </Show>
    </Dialog>
  );
}
