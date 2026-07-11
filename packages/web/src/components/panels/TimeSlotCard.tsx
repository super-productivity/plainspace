import { For, createMemo, createSignal } from 'solid-js';
import type { TimeSlotPanel, Member } from '@plainspace/shared';
import { api, ApiError } from '../../lib/api';
import { addToast } from '../../lib/toast';
import { Avatar } from '../ui';
import PanelCard from './PanelCard';
import panelStyles from './PanelCard.module.css';
import styles from './TimeSlotCard.module.css';

interface TimeSlotCardProps {
  panel: TimeSlotPanel;
  members: Member[];
  slug: string;
  myId: string;
}

export default function TimeSlotCard(props: TimeSlotCardProps) {
  // Slots with a respond request in flight (a visual cue on each clicked slot
  // while we wait for the SSE echo). A Set, not a single id, so toggling slot B
  // while slot A is still in flight doesn't clear A's cue.
  const [inFlight, setInFlight] = createSignal<ReadonlySet<string>>(new Set());

  // Resolve responder avatars for every slot in one pass: join responses
  // against the live members list (dropping ghosts whose member left), bucketed
  // by slot. bestCount and each row read from this instead of re-scanning.
  const avatarsBySlot = createMemo(() => {
    const byId = new Map(props.members.map((m) => [m.id, m] as const));
    const bySlot = new Map<string, Member[]>(props.panel.slots.map((s) => [s.id, []]));
    for (const r of props.panel.responses) {
      const member = byId.get(r.memberId);
      if (member) bySlot.get(r.slotId)?.push(member);
    }
    return bySlot;
  });

  function isMine(slotId: string): boolean {
    return props.panel.responses.some((r) => r.slotId === slotId && r.memberId === props.myId);
  }

  // Best slot(s) = the max available count, but only once someone has
  // responded (skip the highlight when all counts are 0).
  const bestCount = createMemo(() =>
    Math.max(0, ...props.panel.slots.map((s) => avatarsBySlot().get(s.id)?.length ?? 0)),
  );

  async function handleToggle(slotId: string) {
    // Disable only the in-flight slot -- toggles are independent per slot.
    if (inFlight().has(slotId)) return;
    setInFlight((prev) => new Set(prev).add(slotId));
    const next = !isMine(slotId);
    try {
      await api.respondTimeSlot(props.slug, props.panel.id, slotId, next);
    } catch (err) {
      // 404 means the panel was deleted -- panel.deleted SSE will remove the card.
      if (!(err instanceof ApiError && err.status === 404)) {
        addToast('Could not save your availability. Please try again.');
      }
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(slotId);
        return next;
      });
    }
  }

  return (
    <PanelCard
      title={props.panel.title}
      slug={props.slug}
      panelId={props.panel.id}
      label="time slot"
      deleteConsequence="all its responses"
      cardTestId="timeslot-card"
      deleteTestId="timeslot-delete"
    >
      <ul class={panelStyles.list}>
        <For each={props.panel.slots}>
          {(slot) => {
            const avatars = () => avatarsBySlot().get(slot.id) ?? [];
            const count = () => avatars().length;
            const mine = () => isMine(slot.id);
            const isResponding = () => inFlight().has(slot.id);
            const isBest = () => bestCount() > 0 && count() === bestCount();

            return (
              <li class={panelStyles.row}>
                <button
                  type="button"
                  class={`${panelStyles.item} ${mine() ? panelStyles.itemActive : ''} ${isBest() ? styles.itemBest : ''} ${isResponding() ? panelStyles.itemBusy : ''}`}
                  onClick={() => handleToggle(slot.id)}
                  disabled={isResponding()}
                  aria-pressed={mine()}
                  aria-busy={isResponding() ? 'true' : undefined}
                  data-testid="timeslot-slot"
                >
                  <span class={panelStyles.itemContent}>
                    <span class={panelStyles.itemText}>{slot.label}</span>
                    <span class={panelStyles.itemMeta}>
                      <span class={panelStyles.itemCount} data-testid="timeslot-slot-count">
                        {count()}
                      </span>
                      <span class={panelStyles.itemAvatars}>
                        <For each={avatars()}>
                          {(member) => (
                            <Avatar
                              name={member.displayName}
                              color={member.color}
                              size="sm"
                              letters={1}
                              data-testid="timeslot-responder-avatar"
                            />
                          )}
                        </For>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </PanelCard>
  );
}
