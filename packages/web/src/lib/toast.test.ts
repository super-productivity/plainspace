import { beforeEach, describe, expect, it } from 'vitest';
import { addToast, dismissToast, toasts } from './toast';

// The toasts signal is a module singleton, so drain it before each test.
beforeEach(() => {
  for (const t of toasts()) dismissToast(t.id);
});

describe('addToast dedupe', () => {
  it('returns the id needed to dismiss the toast later', () => {
    const id = addToast('Saved');

    expect(id).toBe(toasts()[0].id);
  });

  it('keeps both "Undo" toasts when two same-named items are deleted', () => {
    // Regression: dedupe used to key on message text alone, so deleting two
    // items called "Buy milk" collapsed into one toast and dropped the second
    // item's Undo. Actionable toasts must each survive.
    addToast('Deleted "Buy milk"', () => {}, 'Undo');
    addToast('Deleted "Buy milk"', () => {}, 'Undo');

    expect(toasts()).toHaveLength(2);
    expect(toasts().every((t) => t.actionLabel === 'Undo')).toBe(true);
    // Distinct ids so each renders its own dismissible affordance.
    expect(toasts()[0].id).not.toBe(toasts()[1].id);
  });

  it('dedupes repeated passive (action-less) toasts with identical text', () => {
    addToast('Could not save changes');
    addToast('Could not save changes');

    expect(toasts()).toHaveLength(1);
  });

  it('does not let a passive toast suppress a later actionable one', () => {
    addToast('Item removed');
    addToast('Item removed', () => {}, 'Undo');

    expect(toasts()).toHaveLength(2);
  });
});
