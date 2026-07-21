import { Show, createMemo, createSignal } from 'solid-js';
import type { ChecklistPanel, Item, List, Member } from '@plainspace/shared';
import { api } from '../../lib/api';
import { addActivity, removeItem, restoreItem, state } from '../../lib/store';
import { addToast } from '../../lib/toast';
import { ConfirmDialog } from '../ui';
import ListCard from '../lists/ListCard';

interface ChecklistCardProps {
  panel: ChecklistPanel;
  // All project items; the card filters to its own backing list. Checklist
  // items are real `items` rows, so this is just the shared project items.
  items: Item[];
  members: Member[];
  slug: string;
  myId: string;
}

// A checklist panel IS a regular task list rendered as a side card: it reuses
// ListCard wholesale (same chrome, open/done split, rows, add, drag-reorder) so
// the layout matches the hero list exactly. The only additions are the panel
// title, a header actions menu (rename / collapse / delete), and a confirm
// dialog gating the delete (which removes the backing list and all its items).
export default function ChecklistCard(props: ChecklistCardProps) {
  const [confirming, setConfirming] = createSignal(false);

  // ListCard needs a List; synthesize one from the panel. It only reads
  // list.id (AddItem's target); columns stay null (kanban isn't surfaced).
  const list = createMemo<List>(() => ({
    id: props.panel.listId,
    projectId: props.panel.projectId,
    columns: null,
    createdBy: props.panel.createdBy,
    createdAt: props.panel.createdAt,
  }));

  // Just filter to this list's items; ListCard re-sorts each open/done section
  // by position internally, so sorting here would be redundant work.
  const items = createMemo(() => props.items.filter((i) => i.listId === props.panel.listId));

  // Same delete-with-undo flow as the hero list (Project.tsx#handleDeleteItem),
  // reading the shared store (not the prop) so the lookup isn't a tracked read.
  async function handleDeleteItem(itemId: string) {
    const slug = props.slug; // capture so the undo closure doesn't read a tracked prop
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return false;
    try {
      await api.deleteItem(slug, itemId);
      // Apply the confirmed result directly (same as Project.tsx) instead of
      // waiting for the SSE echo, which can be seconds away mid-reconnect.
      removeItem(itemId);
      addToast(
        `"${item.text}" deleted`,
        async () => {
          const restored = await api.restoreItem(slug, itemId);
          restoreItem(restored.item);
          if (restored.activity) addActivity(restored.activity);
        },
        'Undo',
      );
      return true;
    } catch {
      addToast('Could not delete the item. Please try again.');
      return false;
    }
  }

  async function handleDeleteList() {
    setConfirming(false);
    try {
      await api.deletePanel(props.slug, props.panel.id);
    } catch {
      addToast('Could not delete the checklist. Please try again.');
    }
  }

  // Non-optimistic: the heading updates when the panel.updated SSE echo lands.
  async function handleRename(title: string) {
    try {
      await api.updatePanel(props.slug, props.panel.id, { title });
    } catch {
      addToast('Could not rename the checklist. Please try again.');
    }
  }

  return (
    <>
      <ListCard
        list={list()}
        items={items()}
        members={props.members}
        attachments={[]}
        slug={props.slug}
        myId={props.myId}
        title={props.panel.title}
        cardTestId="checklist-card"
        deleteTestId="checklist-delete"
        onDeletePanel={() => setConfirming(true)}
        onRenamePanel={handleRename}
        onDeleteItem={handleDeleteItem}
      />
      <Show when={confirming()}>
        <ConfirmDialog
          title="Delete checklist?"
          message={`"${props.panel.title}" and all its items will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete checklist"
          danger
          onConfirm={handleDeleteList}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </>
  );
}
