import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

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
    expect(screen.getByTestId('first-shared-win-transition').dataset.visible).toBe('true');
    unmount();

    const withTask = render(() => <FirstSharedWin slug="summer" memberCount={1} taskCount={1} />);
    expect(screen.getByTestId('first-shared-win-transition').dataset.visible).toBe('false');
    withTask.unmount();

    render(() => <FirstSharedWin slug="summer" memberCount={2} taskCount={0} />);
    expect(screen.getByTestId('first-shared-win-transition').dataset.visible).toBe('false');
  });

  it('keeps the prompt mounted while animating between visible and hidden states', () => {
    const [taskCount, setTaskCount] = createSignal(0);
    render(() => <FirstSharedWin slug="summer" memberCount={1} taskCount={taskCount()} />);
    const prompt = screen.getByTestId('first-shared-win-transition');

    expect(prompt.dataset.visible).toBe('true');
    expect(prompt.getAttribute('aria-hidden')).toBeNull();
    expect(prompt.inert).toBe(false);

    setTaskCount(1);
    expect(prompt.dataset.visible).toBe('false');
    expect(prompt.getAttribute('aria-hidden')).toBe('true');
    expect(prompt.inert).toBe(true);

    setTaskCount(0);
    expect(prompt.dataset.visible).toBe('true');
    expect(prompt.getAttribute('aria-hidden')).toBeNull();
    expect(prompt.inert).toBe(false);
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
