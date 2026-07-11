import { createStore, produce } from 'solid-js/store';
import type {
  Project,
  Member,
  List,
  Item,
  Scratchpad,
  Attachment,
  ActivityEntry,
  PanelView,
} from '@plainspace/shared';

export interface ProjectState {
  project: Project | null;
  list: List | null;
  items: Item[];
  members: Member[];
  scratchpad: Scratchpad | null;
  scratchpadEditors: string[];
  attachments: Attachment[];
  panels: PanelView[];
  activity: ActivityEntry[];
  // Whether the server has activity older than what's currently loaded.
  activityHasMore: boolean;
  presence: string[];
  loading: boolean;
  error: string | null;
  connected: boolean;
}

const [state, setState] = createStore<ProjectState>({
  project: null,
  list: null,
  items: [],
  members: [],
  scratchpad: null,
  scratchpadEditors: [],
  attachments: [],
  panels: [],
  activity: [],
  activityHasMore: false,
  presence: [],
  loading: true,
  error: null,
  connected: false,
});

export { state };

// Exported for ActivityFeed, which re-sorts after filtering to known actions —
// single definition so the two orderings can't drift.
export function sortActivity(entries: ActivityEntry[]) {
  return [...entries].sort((a, b) => {
    const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    if (a.targetId === b.targetId) {
      const aCreated = a.action.endsWith('.created');
      const bCreated = b.action.endsWith('.created');
      if (aCreated !== bCreated) return aCreated ? 1 : -1;
    }
    return 0;
  });
}

export function setProjectData(data: {
  project: Project;
  list: List;
  items: Item[];
  members: Member[];
  scratchpad: Scratchpad;
  attachments?: Attachment[];
  panels: PanelView[];
}) {
  setState({
    project: data.project,
    list: data.list,
    items: data.items,
    members: data.members,
    scratchpad: data.scratchpad,
    attachments: data.attachments ?? [],
    panels: data.panels,
    loading: false,
    error: null,
  });
}

export function updateProject(project: Project) {
  setState('project', project);
}

export function setError(error: string) {
  setState({ error, loading: false });
}

export function setLoading(loading: boolean) {
  setState({ loading });
}

export function updateList(list: List) {
  setState('list', list);
}

// Item mutations
export function addItem(item: Item) {
  setState('items', (prev) => {
    if (prev.some((i) => i.id === item.id)) return prev;
    return [...prev, item];
  });
}

export function updateItem(item: Item) {
  setState(
    produce((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return;
      // Skip byte-identical updates: the actor applies its PATCH response and
      // then receives the SSE echo of the same item — replacing the object
      // twice would remount the <For>-keyed row twice and restart in-flight
      // check/strike animations. Both sides come from serializeItem, so the
      // JSON key order is stable.
      if (JSON.stringify(s.items[idx]) === JSON.stringify(item)) return;
      s.items[idx] = item;
    }),
  );
}

// Optimistic reorder write. A path write (not whole-object replacement) so
// the item keeps its object reference and <For> reconciles the move instead
// of remounting the row (which would re-trigger the entrance animation).
export function setItemPosition(itemId: string, position: number) {
  setState('items', (i) => i.id === itemId, 'position', position);
}

// Optimistic move between lists: rewrite listId + position together, preserving
// the item's object reference. Each list's <For> filters on listId, so the
// source card drops the row and the destination card mounts it — a drag-and-
// drop hand-off — without touching unrelated rows.
export function moveItem(itemId: string, listId: string, position: number) {
  setState(
    'items',
    (i) => i.id === itemId,
    produce((item) => {
      item.listId = listId;
      item.position = position;
    }),
  );
}

export function removeItem(itemId: string) {
  setState('items', (prev) => prev.filter((i) => i.id !== itemId));
}

export function restoreItem(item: Item) {
  addItem(item);
}

// Member mutations
export function addMember(member: Member) {
  setState('members', (prev) => {
    if (prev.some((m) => m.id === member.id)) return prev;
    return [...prev, member];
  });
}

export function updateMember(member: Member) {
  setState(
    produce((s) => {
      const idx = s.members.findIndex((m) => m.id === member.id);
      if (idx !== -1) s.members[idx] = member;
    }),
  );
}

export function removeMember(memberId: string) {
  setState('members', (prev) => prev.filter((m) => m.id !== memberId));
}

export function updateScratchpad(pad: Scratchpad) {
  setState('scratchpad', pad);
}

export function setScratchpadEditing(memberId: string, editing: boolean) {
  setState('scratchpadEditors', (prev) => {
    if (!editing) return prev.filter((id) => id !== memberId);
    if (prev.includes(memberId)) return prev;
    return [...prev, memberId];
  });
}

// Panel mutations — all driven by SSE handlers (non-optimistic). No
// component writes directly; mutations are idempotent so the actor processes
// its own echoes safely.
export function addPanel(panel: PanelView) {
  setState('panels', (prev) => {
    if (prev.some((p) => p.id === panel.id)) return prev;
    return [...prev, panel];
  });
}

// Update in place (Object.assign onto the existing element) so the panel keeps
// its object reference and the panels <For> updates the card instead of
// remounting it -- a remount would tear down SortableJS and reset the card's
// local UI state (done section, collapse). Mirrors the produce-based,
// reference-preserving pattern of setPollVote / setTimeSlotResponse below.
export function updatePanel(panel: PanelView) {
  setState(
    produce((s) => {
      const idx = s.panels.findIndex((p) => p.id === panel.id);
      if (idx === -1) return;
      Object.assign(s.panels[idx], panel);
    }),
  );
}

export function removePanel(panelId: string) {
  // A checklist panel's items are real `items` rows the server cascade-deletes
  // with the panel -- but no per-item event follows, so drop them here too,
  // else they'd linger invisibly in `state.items`.
  const panel = state.panels.find((p) => p.id === panelId);
  if (panel?.type === 'checklist') {
    const { listId } = panel;
    setState('items', (prev) => prev.filter((i) => i.listId !== listId));
  }
  setState('panels', (prev) => prev.filter((p) => p.id !== panelId));
}

// Remove-then-replace, NOT a blind append: idempotent so the actor safely
// processes its own poll.vote echo (sseManager broadcasts to the actor too).
export function setPollVote(panelId: string, memberId: string, optionId: string | null) {
  setState(
    produce((s) => {
      const idx = s.panels.findIndex((p) => p.id === panelId);
      if (idx === -1) return;
      const panel = s.panels[idx];
      // Early-return unless this is a poll: a poll.vote and a timeslot.response
      // can both target a panel id during a race, so guard the discriminant.
      if (panel.type !== 'poll') return;
      panel.votes = panel.votes.filter((v) => v.memberId !== memberId);
      if (optionId !== null) panel.votes.push({ optionId, memberId });
    }),
  );
}

// Remove-then-replace per (member, slot), idempotent so the actor safely
// processes its own timeslot.response echo. The type guard is load-bearing: a
// timeslot.response and a poll.vote can both target a panel id during a race --
// without it we'd push a response onto a PollPanel.
export function setTimeSlotResponse(
  panelId: string,
  memberId: string,
  slotId: string,
  available: boolean,
) {
  setState(
    produce((s) => {
      const idx = s.panels.findIndex((p) => p.id === panelId);
      if (idx === -1) return;
      const panel = s.panels[idx];
      if (panel.type !== 'timeslot') return;
      panel.responses = panel.responses.filter(
        (r) => !(r.memberId === memberId && r.slotId === slotId),
      );
      if (available) panel.responses.push({ slotId, memberId });
    }),
  );
}

// Attachment mutations
export function addAttachment(att: Attachment) {
  setState('attachments', (prev) => [...prev, att]);
}

export function removeAttachment(attId: string) {
  setState('attachments', (prev) => prev.filter((a) => a.id !== attId));
}

// Presence
export function setPresence(online: string[]) {
  setState('presence', online);
}

// Connection status
export function setConnected(connected: boolean) {
  setState('connected', connected);
}

// Activity — dedupe by server id since the actor receives the same entry
// from both the HTTP response and the SSE broadcast (and SSE replay on reconnect).
// Replace on id match so server-side coalesced entries (e.g. scratchpad edits)
// reflect their bumped createdAt + meta.
export function addActivity(entry: ActivityEntry) {
  setState('activity', (prev) => {
    const existingIndex = prev.findIndex((existing) => existing.id === entry.id);
    if (existingIndex < 0) return sortActivity([entry, ...prev]);
    const next = [...prev];
    next[existingIndex] = entry;
    return sortActivity(next);
  });
}

export function setActivity(entries: ActivityEntry[]) {
  setState('activity', (prev) => {
    const merged = new Map<string, ActivityEntry>();
    for (const entry of entries) merged.set(entry.id, entry);
    for (const entry of prev) merged.set(entry.id, entry);
    return sortActivity(Array.from(merged.values()));
  });
}

export function setActivityHasMore(hasMore: boolean) {
  setState('activityHasMore', hasMore);
}

// Reset
export function resetState() {
  setState({
    project: null,
    list: null,
    items: [],
    members: [],
    scratchpad: null,
    scratchpadEditors: [],
    attachments: [],
    panels: [],
    activity: [],
    activityHasMore: false,
    presence: [],
    loading: true,
    error: null,
    connected: false,
  });
}
