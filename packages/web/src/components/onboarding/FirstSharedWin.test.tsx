import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../lib/toast', () => ({ addToast }));

import FirstSharedWin from './FirstSharedWin';

beforeEach(() => {
  addToast.mockReset();
});

describe('FirstSharedWin', () => {
  it('shows only while a Space has one member and no primary tasks', () => {
    const { unmount } = render(() => (
      <FirstSharedWin slug="summer" memberCount={1} taskCount={0} />
    ));
    expect(screen.getByTestId('first-shared-win')).toBeTruthy();
    unmount();

    const withTask = render(() => <FirstSharedWin slug="summer" memberCount={1} taskCount={1} />);
    expect(screen.queryByTestId('first-shared-win')).toBeNull();
    withTask.unmount();

    render(() => <FirstSharedWin slug="summer" memberCount={2} taskCount={0} />);
    expect(screen.queryByTestId('first-shared-win')).toBeNull();
  });

  it('focuses the existing add-task input', () => {
    render(() => (
      <>
        <FirstSharedWin slug="summer" memberCount={1} taskCount={0} />
        <input data-testid="add-item-input" />
      </>
    ));
    const input = screen.getByTestId('add-item-input');
    input.scrollIntoView = vi.fn();

    fireEvent.click(screen.getByTestId('first-shared-win-add-task'));

    expect(document.activeElement).toBe(input);
  });

  it('copies the Space join link and confirms success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(() => <FirstSharedWin slug="summer" memberCount={1} taskCount={0} />);

    fireEvent.click(screen.getByTestId('first-shared-win-invite'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/summer/join`),
    );
    expect(addToast).toHaveBeenCalledWith(
      'Join link copied. Anyone with this link can join this Space.',
    );
  });

  it('surfaces a clipboard failure', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
      configurable: true,
    });
    render(() => <FirstSharedWin slug="summer" memberCount={1} taskCount={0} />);

    fireEvent.click(screen.getByTestId('first-shared-win-invite'));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not copy link'));
  });
});
