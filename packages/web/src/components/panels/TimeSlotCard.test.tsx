import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { Member, TimeSlotPanel } from '@plainspace/shared';

const { api, addToast } = vi.hoisted(() => ({
  api: { respondTimeSlot: vi.fn(), deletePanel: vi.fn(), updatePanel: vi.fn() },
  addToast: vi.fn(),
}));
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return { ApiError: actual.ApiError, api };
});
vi.mock('../../lib/toast', () => ({ addToast, toasts: () => [], dismissToast: vi.fn() }));

import TimeSlotCard from './TimeSlotCard';
import { ApiError } from '../../lib/api';

function member(id: string): Member {
  return {
    id,
    projectId: 'p1',
    displayName: id,
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

function panel(over: Partial<TimeSlotPanel> = {}): TimeSlotPanel {
  return {
    id: 'ts1',
    projectId: 'p1',
    type: 'timeslot',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    title: 'When?',
    slots: [
      { id: 's1', label: 'Mon' },
      { id: 's2', label: 'Tue' },
    ],
    responses: [],
    ...over,
  };
}

beforeEach(() => {
  api.respondTimeSlot.mockReset().mockResolvedValue(undefined);
  addToast.mockReset();
});

describe('TimeSlotCard rendering', () => {
  it('counts responders per slot and drops responses from members who left', () => {
    render(() => (
      <TimeSlotCard
        panel={panel({
          responses: [
            { slotId: 's1', memberId: 'm1' },
            { slotId: 's1', memberId: 'ghost' }, // no longer a member
            { slotId: 's2', memberId: 'm1' },
            { slotId: 's2', memberId: 'm2' },
          ],
        })}
        members={[member('m1'), member('m2')]}
        slug="abc"
        myId="m1"
      />
    ));
    const counts = screen.getAllByTestId('timeslot-slot-count').map((e) => e.textContent);
    expect(counts).toEqual(['1', '2']);
    expect(screen.getAllByTestId('timeslot-responder-avatar')).toHaveLength(3);
  });

  it("reflects the caller's own responses with aria-pressed", () => {
    render(() => (
      <TimeSlotCard
        panel={panel({ responses: [{ slotId: 's2', memberId: 'm1' }] })}
        members={[member('m1')]}
        slug="abc"
        myId="m1"
      />
    ));
    const slots = screen.getAllByTestId('timeslot-slot');
    expect(slots[0].getAttribute('aria-pressed')).toBe('false');
    expect(slots[1].getAttribute('aria-pressed')).toBe('true');
  });
});

describe('TimeSlotCard responding', () => {
  it('marks availability on a slot the caller has not answered', async () => {
    render(() => <TimeSlotCard panel={panel()} members={[member('m1')]} slug="abc" myId="m1" />);
    fireEvent.click(screen.getAllByTestId('timeslot-slot')[0]);
    await waitFor(() => expect(api.respondTimeSlot).toHaveBeenCalledWith('abc', 'ts1', 's1', true));
  });

  it('withdraws availability when the caller toggles their own slot off', async () => {
    render(() => (
      <TimeSlotCard
        panel={panel({ responses: [{ slotId: 's1', memberId: 'm1' }] })}
        members={[member('m1')]}
        slug="abc"
        myId="m1"
      />
    ));
    fireEvent.click(screen.getAllByTestId('timeslot-slot')[0]);
    await waitFor(() =>
      expect(api.respondTimeSlot).toHaveBeenCalledWith('abc', 'ts1', 's1', false),
    );
  });

  it('disables only the in-flight slot, leaving the others answerable', async () => {
    let resolve!: () => void;
    api.respondTimeSlot.mockReturnValueOnce(new Promise<void>((r) => (resolve = () => r())));
    render(() => <TimeSlotCard panel={panel()} members={[member('m1')]} slug="abc" myId="m1" />);
    const slots = screen.getAllByTestId('timeslot-slot') as HTMLButtonElement[];
    fireEvent.click(slots[0]);
    await waitFor(() => expect(slots[0].disabled).toBe(true));
    // The other slot stays independently answerable — per-slot, not whole-card.
    expect(slots[1].disabled).toBe(false);

    resolve();
    await waitFor(() => expect(slots[0].disabled).toBe(false));
  });

  it('toasts on a non-404 failure but stays silent on a 404', async () => {
    api.respondTimeSlot.mockRejectedValueOnce(new ApiError(500, { error: 'boom' }));
    render(() => <TimeSlotCard panel={panel()} members={[member('m1')]} slug="abc" myId="m1" />);
    fireEvent.click(screen.getAllByTestId('timeslot-slot')[0]);
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));

    api.respondTimeSlot.mockRejectedValueOnce(new ApiError(404, { error: 'gone' }));
    fireEvent.click(screen.getAllByTestId('timeslot-slot')[1]);
    await waitFor(() => expect(api.respondTimeSlot).toHaveBeenCalledTimes(2));
    expect(addToast).toHaveBeenCalledTimes(1);
  });
});
