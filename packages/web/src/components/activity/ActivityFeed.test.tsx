import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import type { ActivityEntry, Member } from '@plainspace/shared';

const { getActivity } = vi.hoisted(() => ({ getActivity: vi.fn() }));

vi.mock('../../lib/api', () => ({ api: { getActivity } }));
vi.mock('../../lib/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/store')>()),
  setActivity: vi.fn(),
  setActivityHasMore: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ addToast: vi.fn() }));

import ActivityFeed from './ActivityFeed';

function member(id: string, displayName: string): Member {
  return {
    id,
    projectId: 'p1',
    displayName,
    color: '#888888',
    avatarIndex: 0,
    email: null,
    emailVerified: false,
    isCreator: false,
    role: 'member',
    tosVersion: null,
    tosAcceptedAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

// Newest first; each entry a minute older than the previous so ordering is stable.
function entry(id: string, memberId: string, minutesAgo: number, text: string): ActivityEntry {
  return {
    id,
    projectId: 'p1',
    memberId,
    action: 'item.created',
    targetType: 'item',
    targetId: id,
    meta: { text },
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

describe('ActivityFeed same-actor grouping', () => {
  const members = [member('m1', 'Johannes'), member('m2', 'Blair')];

  it('renders the avatar once for a run of same-actor events', () => {
    const entries = [
      entry('a1', 'm1', 1, 'Book the agriturismo'),
      entry('a2', 'm1', 2, 'Rent a car'),
      entry('a3', 'm1', 3, 'Plan the Siena day trip'),
    ];
    const { getAllByTestId, queryAllByTestId } = render(() => (
      <ActivityFeed entries={entries} members={members} slug="s1" hasMore={false} />
    ));

    // Three rows, but only the first shows an avatar.
    expect(getAllByTestId('activity-row')).toHaveLength(3);
    expect(queryAllByTestId('activity-avatar')).toHaveLength(1);

    // Continuation rows keep the name in the DOM (for screen readers) but hide
    // it visually; the subject stays visible on every row.
    const rows = getAllByTestId('activity-row');
    expect(rows[1]!.querySelector('.visually-hidden')?.textContent).toBe('Johannes');
    expect(rows[1]!.textContent).toContain('Rent a car');
  });

  it('starts a new avatar when the actor changes', () => {
    const entries = [
      entry('a1', 'm1', 1, 'first'),
      entry('a2', 'm2', 2, 'second'),
      entry('a3', 'm1', 3, 'third'),
    ];
    const { queryAllByTestId } = render(() => (
      <ActivityFeed entries={entries} members={members} slug="s1" hasMore={false} />
    ));
    // Alternating actors: every row keeps its avatar, exactly as before.
    expect(queryAllByTestId('activity-avatar')).toHaveLength(3);
  });

  it('loads the next page with the oldest activity id as the stable cursor', async () => {
    const entries = [entry('a1', 'm1', 1, 'first'), entry('a2', 'm1', 2, 'second')];
    getActivity.mockResolvedValue({ entries: [], hasMore: false });
    const { getByTestId } = render(() => (
      <ActivityFeed entries={entries} members={members} slug="s1" hasMore={true} />
    ));

    fireEvent.click(getByTestId('activity-load-older'));

    await waitFor(() => expect(getActivity).toHaveBeenCalledWith('s1', 'a2'));
  });
});
