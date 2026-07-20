import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { Member, PollPanel } from '@plainspace/shared';

const { api, addToast } = vi.hoisted(() => ({
  api: { votePoll: vi.fn(), deletePanel: vi.fn(), updatePanel: vi.fn() },
  addToast: vi.fn(),
}));
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return { ApiError: actual.ApiError, api };
});
vi.mock('../../lib/toast', () => ({ addToast, toasts: () => [], dismissToast: vi.fn() }));

import PollCard from './PollCard';
import { ApiError } from '../../lib/api';

function member(id: string, displayName = id): Member {
  return {
    id,
    projectId: 'p1',
    displayName,
    color: '#123456',
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

function poll(over: Partial<PollPanel> = {}): PollPanel {
  return {
    id: 'poll1',
    projectId: 'p1',
    type: 'poll',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    question: 'Lunch?',
    options: [
      { id: 'o1', text: 'Pizza' },
      { id: 'o2', text: 'Sushi' },
    ],
    votes: [],
    ...over,
  };
}

beforeEach(() => {
  api.votePoll.mockReset().mockResolvedValue(undefined);
  addToast.mockReset();
});

describe('PollCard rendering', () => {
  it('exposes the poll title as a section heading', () => {
    render(() => <PollCard panel={poll()} members={[member('m1')]} slug="abc" myId="m1" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Lunch?' })).toBeTruthy();
  });

  it('shows per-option counts and only avatars for members still in the list', () => {
    render(() => (
      <PollCard
        panel={poll({
          votes: [
            { optionId: 'o1', memberId: 'm1' },
            { optionId: 'o1', memberId: 'ghost' }, // left the Space — must not count
            { optionId: 'o2', memberId: 'm2' },
          ],
        })}
        members={[member('m1'), member('m2')]}
        slug="abc"
        myId="m1"
      />
    ));
    const counts = screen.getAllByTestId('poll-option-count').map((e) => e.textContent);
    expect(counts).toEqual(['1', '1']);
    // The ghost vote inflates neither the count nor the avatar row.
    expect(screen.getAllByTestId('poll-voter-avatar')).toHaveLength(2);
  });

  it("marks the caller's own option with aria-pressed", () => {
    render(() => (
      <PollCard
        panel={poll({ votes: [{ optionId: 'o2', memberId: 'm1' }] })}
        members={[member('m1')]}
        slug="abc"
        myId="m1"
      />
    ));
    const options = screen.getAllByTestId('poll-option');
    expect(options[0].getAttribute('aria-pressed')).toBe('false');
    expect(options[1].getAttribute('aria-pressed')).toBe('true');
  });
});

describe('PollCard voting', () => {
  it('casts a vote for an option the caller has not voted for', async () => {
    render(() => <PollCard panel={poll()} members={[member('m1')]} slug="abc" myId="m1" />);
    fireEvent.click(screen.getAllByTestId('poll-option')[0]);
    await waitFor(() => expect(api.votePoll).toHaveBeenCalledWith('abc', 'poll1', 'o1'));
  });

  it('clears the vote when the caller clicks their current choice (toggle off)', async () => {
    render(() => (
      <PollCard
        panel={poll({ votes: [{ optionId: 'o1', memberId: 'm1' }] })}
        members={[member('m1')]}
        slug="abc"
        myId="m1"
      />
    ));
    fireEvent.click(screen.getAllByTestId('poll-option')[0]);
    await waitFor(() => expect(api.votePoll).toHaveBeenCalledWith('abc', 'poll1', null));
  });

  it('disables every option while a vote is in flight, then re-enables them', async () => {
    let resolve!: () => void;
    api.votePoll.mockReturnValueOnce(new Promise<void>((r) => (resolve = () => r())));
    render(() => <PollCard panel={poll()} members={[member('m1')]} slug="abc" myId="m1" />);
    const options = screen.getAllByTestId('poll-option') as HTMLButtonElement[];
    fireEvent.click(options[0]);
    await waitFor(() => expect(options[1].disabled).toBe(true));

    resolve();
    await waitFor(() => expect(options[1].disabled).toBe(false));
  });

  it('toasts on a non-404 failure but stays silent on a 404 (panel already gone)', async () => {
    api.votePoll.mockRejectedValueOnce(new ApiError(500, { error: 'boom' }));
    render(() => <PollCard panel={poll()} members={[member('m1')]} slug="abc" myId="m1" />);
    fireEvent.click(screen.getAllByTestId('poll-option')[0]);
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));

    api.votePoll.mockRejectedValueOnce(new ApiError(404, { error: 'gone' }));
    fireEvent.click(screen.getAllByTestId('poll-option')[1]);
    await waitFor(() => expect(api.votePoll).toHaveBeenCalledTimes(2));
    expect(addToast).toHaveBeenCalledTimes(1); // still just the 500
  });
});
