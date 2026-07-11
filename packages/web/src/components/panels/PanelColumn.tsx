import { For, Match, Switch } from 'solid-js';
import type { Item, Member, PanelView } from '@plainspace/shared';
import PollCard from './PollCard';
import TimeSlotCard from './TimeSlotCard';
import ChecklistCard from './ChecklistCard';
import AddPanelButton from './AddPanelButton';
import styles from './PanelColumn.module.css';

interface PanelColumnProps {
  panels: PanelView[];
  // All project items; checklist cards filter to their own list. Other panel
  // types ignore it.
  items: Item[];
  members: Member[];
  slug: string;
  myId: string;
}

export default function PanelColumn(props: PanelColumnProps) {
  return (
    <div class={styles.column} data-testid="panel-column">
      <For each={props.panels}>
        {(panel) => (
          // Runtime extension seam: dispatch on panel.type to the per-type card.
          <Switch>
            <Match when={panel.type === 'poll' ? panel : null}>
              {(pollPanel) => (
                <PollCard
                  panel={pollPanel()}
                  members={props.members}
                  slug={props.slug}
                  myId={props.myId}
                />
              )}
            </Match>
            <Match when={panel.type === 'timeslot' ? panel : null}>
              {(timeslotPanel) => (
                <TimeSlotCard
                  panel={timeslotPanel()}
                  members={props.members}
                  slug={props.slug}
                  myId={props.myId}
                />
              )}
            </Match>
            <Match when={panel.type === 'checklist' ? panel : null}>
              {(checklistPanel) => (
                <ChecklistCard
                  panel={checklistPanel()}
                  items={props.items}
                  members={props.members}
                  slug={props.slug}
                  myId={props.myId}
                />
              )}
            </Match>
          </Switch>
        )}
      </For>
      <AddPanelButton slug={props.slug} />
    </div>
  );
}
