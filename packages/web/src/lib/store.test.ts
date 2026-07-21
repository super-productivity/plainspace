import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ActivityEntry,
  Item,
  Member,
  PollPanel,
  Project,
  TimeSlotPanel,
  ChecklistPanel,
} from '@plainspace/shared';
import {
  addActivity,
  addItem,
  addMember,
  addPanel,
  removeItem,
  removeMember,
  removePanel,
  resetState,
  setActivity,
  setActivityHasMore,
  setPollVote,
  setProjectData,
  setScratchpadEditing,
  setTimeSlotResponse,
  state,
  updateItem,
  updateMember,
  updateProject,
} from './store';

// Minimal fixtures — only the fields the store actually reads/sorts on.
function item(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    listId: 'list-1',
    projectId: 'p1',
    text: id,
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'c1',
    position: 0,
    createdBy: null,
    remindAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    repeat: null,
    ...over,
  };
}

function member(id: string, over: Partial<Member> = {}): Member {
  return {
    id,
    projectId: 'p1',
    displayName: id,
    color: '#000',
    avatarIndex: 0,
    email: null,
    emailVerified: false,
    isCreator: false,
    role: 'member',
    tosVersion: null,
    tosAcceptedAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function poll(id: string, over: Partial<PollPanel> = {}): PollPanel {
  return {
    id,
    projectId: 'p1',
    type: 'poll',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    question: 'q?',
    options: [
      { id: 'o1', text: 'A' },
      { id: 'o2', text: 'B' },
    ],
    votes: [],
    ...over,
  };
}

function timeslot(id: string, over: Partial<TimeSlotPanel> = {}): TimeSlotPanel {
  return {
    id,
    projectId: 'p1',
    type: 'timeslot',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    title: 't',
    slots: [
      { id: 's1', label: 'Mon' },
      { id: 's2', label: 'Tue' },
    ],
    responses: [],
    ...over,
  };
}

function checklist(id: string, listId: string): ChecklistPanel {
  return {
    id,
    projectId: 'p1',
    type: 'checklist',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    listId,
    title: 'side',
  };
}

function activity(id: string, createdAt: string, over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id,
    projectId: 'p1',
    memberId: 'm1',
    action: 'item.updated',
    targetType: 'item',
    targetId: 't1',
    meta: {},
    createdAt,
    ...over,
  };
}

beforeEach(() => {
  resetState();
});

describe('item mutations', () => {
  it('addItem ignores a duplicate id (idempotent SSE echo)', () => {
    addItem(item('i1', { text: 'first' }));
    addItem(item('i1', { text: 'second' }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].text).toBe('first');
  });

  it('updateItem mutates the existing item identity and is a no-op for unknown ids', () => {
    addItem(item('i1', { text: 'old' }));
    const existing = state.items[0];
    updateItem(item('i1', { text: 'new' }));
    expect(state.items[0].text).toBe('new');
    expect(state.items[0]).toBe(existing);

    updateItem(item('ghost', { text: 'nope' }));
    expect(state.items).toHaveLength(1);
  });

  it('removeItem drops only the matching item', () => {
    addItem(item('i1'));
    addItem(item('i2'));
    removeItem('i1');
    expect(state.items.map((i) => i.id)).toEqual(['i2']);
  });
});

describe('member mutations', () => {
  it('addMember dedupes and updateMember replaces in place', () => {
    addMember(member('m1', { displayName: 'Ann' }));
    addMember(member('m1', { displayName: 'Ann2' }));
    expect(state.members).toHaveLength(1);

    updateMember(member('m1', { displayName: 'Annette' }));
    expect(state.members[0].displayName).toBe('Annette');
  });

  it('removeMember drops the matching member', () => {
    addMember(member('m1'));
    addMember(member('m2'));
    removeMember('m1');
    expect(state.members.map((m) => m.id)).toEqual(['m2']);
  });
});

describe('panel poll/timeslot writes are idempotent and type-guarded', () => {
  it('setPollVote replaces a member vote rather than appending it', () => {
    addPanel(poll('pa'));
    setPollVote('pa', 'm1', 'o1');
    setPollVote('pa', 'm1', 'o2'); // changed mind — must not double-count
    const p = state.panels[0] as PollPanel;
    expect(p.votes).toEqual([{ optionId: 'o2', memberId: 'm1' }]);
  });

  it('setPollVote with a null optionId clears the member vote', () => {
    addPanel(poll('pa', { votes: [{ optionId: 'o1', memberId: 'm1' }] }));
    setPollVote('pa', 'm1', null);
    expect((state.panels[0] as PollPanel).votes).toEqual([]);
  });

  it('setPollVote leaves a timeslot panel of the same id untouched', () => {
    addPanel(timeslot('shared'));
    setPollVote('shared', 'm1', 'o1');
    const p = state.panels[0] as TimeSlotPanel;
    expect(p.type).toBe('timeslot');
    expect(p.responses).toEqual([]);
  });

  it('setTimeSlotResponse toggles a (member, slot) response idempotently', () => {
    addPanel(timeslot('ts'));
    setTimeSlotResponse('ts', 'm1', 's1', true);
    setTimeSlotResponse('ts', 'm1', 's1', true); // re-broadcast echo
    expect((state.panels[0] as TimeSlotPanel).responses).toEqual([
      { slotId: 's1', memberId: 'm1' },
    ]);

    setTimeSlotResponse('ts', 'm1', 's1', false); // now unavailable
    expect((state.panels[0] as TimeSlotPanel).responses).toEqual([]);
  });

  it('setTimeSlotResponse leaves a poll panel of the same id untouched', () => {
    addPanel(poll('shared'));
    setTimeSlotResponse('shared', 'm1', 's1', true);
    expect((state.panels[0] as PollPanel).votes).toEqual([]);
  });
});

describe('removePanel', () => {
  it("cascade-removes a checklist panel's backing items", () => {
    addItem(item('hero', { listId: 'list-1' }));
    addItem(item('side', { listId: 'list-2' }));
    addPanel(checklist('cp', 'list-2'));

    removePanel('cp');
    expect(state.panels).toHaveLength(0);
    expect(state.items.map((i) => i.id)).toEqual(['hero']);
  });

  it('removing a poll panel leaves unrelated items alone', () => {
    addItem(item('hero', { listId: 'list-1' }));
    addPanel(poll('pa'));
    removePanel('pa');
    expect(state.items.map((i) => i.id)).toEqual(['hero']);
  });
});

describe('activity feed dedupe and ordering', () => {
  it('addActivity sorts newest-first and replaces a re-sent entry by id', () => {
    addActivity(activity('a1', '2026-01-01T10:00:00.000Z'));
    addActivity(activity('a2', '2026-01-01T12:00:00.000Z'));
    expect(state.activity.map((e) => e.id)).toEqual(['a2', 'a1']);

    // Same id re-sent with bumped meta — replace, don't duplicate.
    addActivity(activity('a1', '2026-01-01T10:00:00.000Z', { meta: { coalesced: true } }));
    expect(state.activity).toHaveLength(2);
    const a1 = state.activity.find((e) => e.id === 'a1');
    expect(a1?.meta).toEqual({ coalesced: true });
  });

  it('orders a .created entry after a sibling event sharing its timestamp + target', () => {
    // Same instant, same target: the non-created event must sort ahead so the
    // feed reads "created" at the bottom of that burst. targetId is explicit so
    // the comparator's `a.targetId === b.targetId` guard is actually exercised.
    addActivity(
      activity('created', '2026-01-01T10:00:00.000Z', { action: 'item.created', targetId: 't1' }),
    );
    addActivity(
      activity('checked', '2026-01-01T10:00:00.000Z', { action: 'item.checked', targetId: 't1' }),
    );
    expect(state.activity.map((e) => e.id)).toEqual(['checked', 'created']);
  });

  it('setActivity merges a fresh page with existing entries without duplicates', () => {
    setActivity([activity('a1', '2026-01-01T10:00:00.000Z')]);
    setActivity([
      activity('a1', '2026-01-01T10:00:00.000Z'),
      activity('a2', '2026-01-01T11:00:00.000Z'),
    ]);
    expect(state.activity.map((e) => e.id)).toEqual(['a2', 'a1']);
  });

  it('setActivity keeps the existing entry on an id collision (prev wins)', () => {
    // Asymmetry worth pinning: setActivity is a union where the already-loaded
    // copy wins, unlike addActivity which replaces on id match. A re-fetched
    // page therefore does NOT clobber an entry already in the feed.
    setActivity([activity('a1', '2026-01-01T10:00:00.000Z', { meta: { v: 1 } })]);
    setActivity([activity('a1', '2026-01-01T10:00:00.000Z', { meta: { v: 2 } })]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].meta).toEqual({ v: 1 });
  });
});

describe('scratchpad editors', () => {
  it('adds, dedupes, and removes editing members', () => {
    setScratchpadEditing('m1', true);
    setScratchpadEditing('m1', true);
    expect(state.scratchpadEditors).toEqual(['m1']);
    setScratchpadEditing('m1', false);
    expect(state.scratchpadEditors).toEqual([]);
  });
});

describe('updateProject', () => {
  function project(name: string, updatedAt: string): Project {
    return {
      id: 'p1',
      slug: 's',
      name,
      purpose: '',
      sharingMode: 'open',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt,
    };
  }

  it('applies a newer snapshot', () => {
    updateProject(project('first', '2026-01-01T00:00:01.000Z'));
    updateProject(project('second', '2026-01-01T00:00:02.000Z'));
    expect(state.project?.name).toBe('second');
  });

  it('applies the first snapshot when nothing is held', () => {
    updateProject(project('only', '2026-01-01T00:00:01.000Z'));
    expect(state.project?.name).toBe('only');
  });

  // A settings PATCH response that lost a race with a newer write must not
  // revert the store to its stale snapshot.
  it('ignores a snapshot older than the one held', () => {
    updateProject(project('newer', '2026-01-01T00:00:02.000Z'));
    updateProject(project('stale', '2026-01-01T00:00:01.000Z'));
    expect(state.project?.name).toBe('newer');
  });

  // Same-timestamp writes carry the same state, so neither is stale.
  it('applies a snapshot with an equal timestamp', () => {
    updateProject(project('a', '2026-01-01T00:00:01.000Z'));
    updateProject(project('b', '2026-01-01T00:00:01.000Z'));
    expect(state.project?.name).toBe('b');
  });
});

describe('setProjectData / resetState', () => {
  const data = {
    project: { slug: 's' } as never,
    list: { id: 'list-1' } as never,
    items: [item('i1')],
    members: [member('m1')],
    scratchpad: { id: 'sp' } as never,
    panels: [],
  };

  it('clears loading/error and defaults attachments to an empty array', () => {
    setProjectData(data);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.attachments).toEqual([]);
    expect(state.items).toHaveLength(1);
  });

  it('reconciles a resync snapshot without remounting existing items', () => {
    setProjectData(data);
    const existing = state.items[0];

    setProjectData({ ...data, items: [item('i1', { text: 'fresh from resync' })] });

    expect(state.items[0]).toBe(existing);
    expect(state.items[0].text).toBe('fresh from resync');
  });

  it('resetState returns to the empty loading state', () => {
    setProjectData(data);
    setActivityHasMore(true);
    resetState();
    expect(state.project).toBeNull();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(true);
    // A stale activityHasMore must not leak into the next Space's session.
    expect(state.activityHasMore).toBe(false);
  });
});
