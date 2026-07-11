import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('./toast', () => ({ addToast }));

import { shareJoinLink } from './join-link';

beforeEach(() => {
  addToast.mockReset();
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('shareJoinLink', () => {
  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await shareJoinLink('summer', 'Summer trip');

    expect(share).toHaveBeenCalledWith({
      title: 'Join Summer trip on Plainspace',
      text: 'Join me in “Summer trip” on Plainspace.',
      url: `${window.location.origin}/summer/join`,
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying when native sharing is unavailable', async () => {
    await shareJoinLink('summer', 'Summer trip');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/summer/join`,
    );
    expect(addToast).toHaveBeenCalledWith(
      'Join link copied. Anyone with this link can join this Space.',
    );
  });

  it('does not copy when the user cancels native sharing', async () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')),
      configurable: true,
    });

    await shareJoinLink('summer', 'Summer trip');

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('falls back to copying when native sharing fails', async () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(new Error('Unavailable')),
      configurable: true,
    });

    await shareJoinLink('summer', 'Summer trip');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/summer/join`,
    );
  });
});
