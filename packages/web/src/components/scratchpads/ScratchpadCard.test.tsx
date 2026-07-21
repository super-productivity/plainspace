import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { Scratchpad } from '@plainspace/shared';

const { api } = vi.hoisted(() => ({
  api: {
    setScratchpadEditing: vi.fn().mockResolvedValue(undefined),
    updateScratchpad: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/api', () => ({ api }));
vi.mock('../../lib/toast', () => ({ addToast: vi.fn() }));

import ScratchpadCard from './ScratchpadCard';

const pad = {
  id: 'scratchpad-1',
  projectId: 'project-1',
  content: '',
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Scratchpad;

describe('ScratchpadCard', () => {
  it('exposes its title as a section heading and connects the collapse control to its body', () => {
    render(() => (
      <ScratchpadCard pad={pad} members={[]} editingMemberIds={[]} slug="weekend" myId="me" />
    ));

    expect(screen.getByRole('heading', { level: 2, name: 'Scratchpad' })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Scratchpad' });
    const bodyId = toggle.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId!)).toBeTruthy();
  });

  // jsdom does no layout, so the compact height itself is only assertable in a
  // browser; what this pins is that clicking the pad swaps in a *named* editor.
  it('swaps the display for an accessibly named textarea on click', () => {
    render(() => (
      <ScratchpadCard pad={pad} members={[]} editingMemberIds={[]} slug="weekend" myId="me" />
    ));

    fireEvent.click(screen.getByTestId('scratchpad-content'));

    expect(screen.getByRole('textbox', { name: 'Scratchpad notes' })).toBeTruthy();
  });
});
