import { For, Show, createMemo, createSignal } from 'solid-js';
import { ACTIVITY_ACTIONS, type ActivityEntry, type Member } from '@plainspace/shared';
import { api } from '../../lib/api';
import { setActivity, setActivityHasMore, sortActivity } from '../../lib/store';
import { addToast } from '../../lib/toast';
import NudgeButton from '../nudge/NudgeButton';
import { Avatar } from '../ui';
import styles from './ActivityFeed.module.css';

const COLLAPSED_COUNT = 5;

interface ActivityFeedProps {
  entries: ActivityEntry[];
  members: Member[];
  slug: string;
  // Whether the server holds activity older than what's loaded.
  hasMore: boolean;
}

// Friendly label for a panel type in the activity feed -- the internal
// discriminant 'timeslot' renders as "time slot", matching the rest of the UI.
function panelTypeLabel(type: unknown): string {
  return type === 'timeslot' ? 'time slot' : String(type ?? 'panel');
}

function formatAction(
  entry: ActivityEntry,
  members: Member[],
): { actor: string; verb: string; subject: string } {
  const member = members.find((m) => m.id === entry.memberId);
  const actor = member?.displayName ?? 'Someone';
  const meta = entry.meta as Record<string, unknown>;
  const text = String(meta.text ?? '');

  switch (entry.action) {
    case 'item.created':
      return { actor, verb: 'added', subject: `"${text}"` };
    case 'item.checked':
      return { actor, verb: 'completed', subject: `"${text}"` };
    case 'item.unchecked':
      return { actor, verb: 'unchecked', subject: `"${text}"` };
    case 'item.assigned':
      return { actor, verb: 'assigned', subject: `"${text}"` };
    case 'item.deleted':
      return { actor, verb: 'deleted', subject: text ? `"${text}"` : 'a task' };
    case 'item.updated':
      return { actor, verb: 'edited', subject: `"${text}"` };
    case 'item.restored':
      return { actor, verb: 'restored', subject: text ? `"${text}"` : 'a task' };
    case 'list.updated':
      return { actor, verb: 'updated', subject: 'list' };
    case 'scratchpad.updated':
      return { actor, verb: 'edited', subject: 'scratchpad' };
    case 'attachment.created':
      return { actor, verb: 'attached', subject: `"${String(meta.filename ?? '')}"` };
    case 'attachment.deleted':
      return { actor, verb: 'removed attachment', subject: `"${String(meta.filename ?? '')}"` };
    case 'member.joined':
      return { actor: String(meta.displayName ?? actor), verb: 'joined', subject: '' };
    case 'member.updated':
      return { actor, verb: 'changed name to', subject: `"${String(meta.displayName ?? '')}"` };
    case 'member.removed':
      return { actor, verb: 'removed', subject: 'someone' };
    case 'member.merged':
      return {
        actor,
        verb: 'merged in',
        subject: String(meta.fromDisplayName ?? 'another person'),
      };
    case 'panel.created':
      return { actor, verb: 'added', subject: `a ${panelTypeLabel(meta.type)}` };
    case 'panel.deleted':
      return { actor, verb: 'removed', subject: `a ${panelTypeLabel(meta.type)}` };
    default:
      return { actor, verb: '', subject: '' };
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const KNOWN_ACTIONS = new Set(ACTIVITY_ACTIONS);

export default function ActivityFeed(props: ActivityFeedProps) {
  const [expanded, setExpanded] = createSignal(false);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const sortedEntries = createMemo(() =>
    sortActivity(props.entries.filter((e) => KNOWN_ACTIONS.has(e.action))),
  );
  const visibleEntries = createMemo(() =>
    sortedEntries().slice(0, expanded() ? sortedEntries().length : COLLAPSED_COUNT),
  );
  const extraCount = createMemo(() =>
    expanded() ? 0 : Math.max(0, sortedEntries().length - COLLAPSED_COUNT),
  );
  // Flag each visible row as a continuation when its actor matches the row
  // directly above, so a run of same-actor events shows the avatar + name once
  // instead of repeating them. Computed over the visible slice so the collapse
  // boundary and paging stay consistent (the first visible row is never a
  // continuation, even if the entry above it in history shares the actor).
  const groupedRows = createMemo(() => {
    const list = visibleEntries();
    return list.map((entry, i) => ({
      entry,
      cont: i > 0 && list[i - 1]!.memberId === entry.memberId,
    }));
  });

  // Page in older entries from the server, using the oldest loaded entry as the
  // cursor. Merges into the store, so the SSE-fed live list and the paged
  // history stay one deduped, sorted collection.
  async function loadOlder() {
    const oldest = sortedEntries()[sortedEntries().length - 1];
    if (!oldest || loadingOlder()) return;
    setLoadingOlder(true);
    try {
      const res = await api.getActivity(props.slug, oldest.id);
      setActivity(res.entries);
      setActivityHasMore(res.hasMore);
    } catch {
      addToast('Could not load older activity. Please try again.');
    } finally {
      setLoadingOlder(false);
    }
  }

  function memberFor(entry: ActivityEntry) {
    return props.members.find((m) => m.id === entry.memberId);
  }

  return (
    <Show when={visibleEntries().length > 0}>
      <section class={styles.bar} data-testid="activity-feed" aria-label="Recent activity">
        <div class={styles.header}>
          <h2 class={styles.title}>Recent activity</h2>
          <NudgeButton slug={props.slug} />
        </div>
        <ul class={styles.list}>
          <For each={groupedRows()}>
            {(row) => {
              const { entry, cont } = row;
              const m = memberFor(entry);
              const f = formatAction(entry, props.members);
              return (
                <li
                  class={styles.row}
                  classList={{ [styles.continuation]: cont }}
                  data-testid="activity-row"
                >
                  <Show when={!cont}>
                    <Avatar
                      name={m?.displayName ?? '·'}
                      color={m?.color}
                      size="sm"
                      letters={1}
                      class={styles.activityAvatar}
                      data-testid="activity-avatar"
                    />
                  </Show>
                  <span class={styles.text} data-testid="activity-entry">
                    {/* On a same-actor run keep the repeated name for screen
                        readers but hide it visually, so each row still says who. */}
                    <strong classList={{ 'visually-hidden': cont }}>{f.actor}</strong> {f.verb}{' '}
                    <span class={styles.subject}>{f.subject}</span>
                  </span>
                  <span class={styles.time}>{timeAgo(entry.createdAt)}</span>
                </li>
              );
            }}
          </For>
          <Show when={extraCount() > 0}>
            <li class={styles.moreRow}>
              <button
                type="button"
                class={styles.morePill}
                aria-expanded={expanded()}
                onClick={() => setExpanded(true)}
                data-testid="activity-more"
              >
                {extraCount()} more
              </button>
            </li>
          </Show>
          <Show when={extraCount() === 0 && props.hasMore}>
            <li class={styles.moreRow}>
              <button
                type="button"
                class={styles.morePill}
                onClick={loadOlder}
                disabled={loadingOlder()}
                data-testid="activity-load-older"
              >
                {loadingOlder() ? 'Loading…' : 'Load older'}
              </button>
            </li>
          </Show>
        </ul>
      </section>
    </Show>
  );
}
