import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

// jsdom does not implement document.execCommand, so define it per-test.
function setExecCommand(fn: () => boolean) {
  (document as unknown as { execCommand: unknown }).execCommand = fn;
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the Clipboard API rejects (e.g. Brave)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setClipboard({ writeText });
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);

    expect(await copyText('hello')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when the Clipboard API is missing (non-secure context)', async () => {
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);

    expect(await copyText('hello')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('returns false when both paths fail', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);

    expect(await copyText('hello')).toBe(false);
  });

  it('returns false and cleans up the textarea when execCommand throws', async () => {
    setClipboard(undefined);
    setExecCommand(() => {
      throw new Error('denied');
    });

    expect(await copyText('hello')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
