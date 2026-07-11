import { createSignal } from 'solid-js';
import { render, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addToast, dismissToast, shareJoinLink } = vi.hoisted(() => ({
  addToast: vi.fn(),
  dismissToast: vi.fn(),
  shareJoinLink: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({ addToast, dismissToast }));
vi.mock('../../lib/join-link', () => ({ shareJoinLink }));

import FirstShareNudge from './FirstShareNudge';

beforeEach(() => {
  addToast.mockReset();
  addToast.mockReturnValue('share-toast');
  dismissToast.mockReset();
  shareJoinLink.mockReset();
});

describe('FirstShareNudge', () => {
  it('does not interrupt the initial empty or established Space state', async () => {
    const [establishedTaskCount, setEstablishedTaskCount] = createSignal(3);
    render(() => (
      <>
        <FirstShareNudge
          slug="summer"
          projectName="Summer trip"
          sharingMode="open"
          isCreator
          memberCount={1}
          taskCount={0}
        />
        <FirstShareNudge
          slug="launch"
          projectName="Launch"
          sharingMode="open"
          isCreator
          memberCount={1}
          taskCount={establishedTaskCount()}
        />
      </>
    ));

    setEstablishedTaskCount(0);
    setEstablishedTaskCount(1);
    await Promise.resolve();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('offers sharing after a solo creator adds a task to an open Space', async () => {
    const [taskCount, setTaskCount] = createSignal(0);
    render(() => (
      <FirstShareNudge
        slug="summer"
        projectName="Summer trip"
        sharingMode="open"
        isCreator
        memberCount={1}
        taskCount={taskCount()}
      />
    ));

    setTaskCount(1);

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        'Task added. Share this Space to plan together.',
        expect.any(Function),
        'Share',
      ),
    );
    const action = addToast.mock.calls[0][1] as () => void;
    action();
    expect(shareJoinLink).toHaveBeenCalledWith('summer', 'Summer trip');
  });

  it('does not offer an unusable or irrelevant share action', async () => {
    const [taskCount, setTaskCount] = createSignal(0);
    render(() => (
      <>
        <FirstShareNudge
          slug="private"
          projectName="Private"
          sharingMode="private"
          isCreator
          memberCount={1}
          taskCount={taskCount()}
        />
        <FirstShareNudge
          slug="guest"
          projectName="Guest"
          sharingMode="open"
          isCreator={false}
          memberCount={1}
          taskCount={taskCount()}
        />
        <FirstShareNudge
          slug="team"
          projectName="Team"
          sharingMode="open"
          isCreator
          memberCount={2}
          taskCount={taskCount()}
        />
      </>
    ));

    setTaskCount(1);

    await Promise.resolve();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('offers sharing only once per visit after task deletion and re-addition', async () => {
    const [taskCount, setTaskCount] = createSignal(0);
    render(() => (
      <FirstShareNudge
        slug="summer"
        projectName="Summer trip"
        sharingMode="open"
        isCreator
        memberCount={1}
        taskCount={taskCount()}
      />
    ));

    setTaskCount(1);
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    setTaskCount(0);
    setTaskCount(1);
    await Promise.resolve();

    expect(addToast).toHaveBeenCalledTimes(1);
  });

  it('removes its share action when navigating away from the Space', async () => {
    const [taskCount, setTaskCount] = createSignal(0);
    const { unmount } = render(() => (
      <FirstShareNudge
        slug="summer"
        projectName="Summer trip"
        sharingMode="open"
        isCreator
        memberCount={1}
        taskCount={taskCount()}
      />
    ));

    setTaskCount(1);
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    unmount();

    expect(dismissToast).toHaveBeenCalledWith('share-toast');
  });

  it('removes and disables a share action that becomes ineligible', async () => {
    const [taskCount, setTaskCount] = createSignal(0);
    const [memberCount, setMemberCount] = createSignal(1);
    render(() => (
      <FirstShareNudge
        slug="summer"
        projectName="Summer trip"
        sharingMode="open"
        isCreator
        memberCount={memberCount()}
        taskCount={taskCount()}
      />
    ));

    setTaskCount(1);
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    const action = addToast.mock.calls[0][1] as () => void;
    setMemberCount(2);

    await waitFor(() => expect(dismissToast).toHaveBeenCalledWith('share-toast'));
    action();
    expect(shareJoinLink).not.toHaveBeenCalled();
  });
});
