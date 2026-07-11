import { For, Show, createMemo } from 'solid-js';
import type { Member } from '@plainspace/shared';
import { Avatar } from '../ui';
import styles from './ScratchpadEditingIndicator.module.css';

interface ScratchpadEditingIndicatorProps {
  members: Member[];
  myId: string;
}

export default function ScratchpadEditingIndicator(props: ScratchpadEditingIndicatorProps) {
  const visibleMembers = createMemo(() => props.members.slice(0, 3));
  const overflow = createMemo(() => Math.max(props.members.length - visibleMembers().length, 0));
  const label = createMemo(() => {
    const names = props.members.map((member) =>
      member.id === props.myId ? 'You' : member.displayName,
    );
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} editing now`;
    if (names.length === 2) return `${names[0]} and ${names[1]} editing now`;
    return `${names[0]} and ${names.length - 1} others editing now`;
  });

  return (
    <Show when={props.members.length > 0}>
      <div
        class={styles.indicator}
        role="status"
        aria-live="polite"
        aria-label={label()}
        data-testid="scratchpad-editing-indicator"
      >
        <div class={styles.avatars} aria-hidden="true">
          <For each={visibleMembers()}>
            {(member) => (
              <Avatar
                name={member.displayName}
                color={member.color}
                size="sm"
                class={styles.stackAvatar}
                data-testid="scratchpad-editor-initial"
              />
            )}
          </For>
          <Show when={overflow() > 0}>
            <Avatar
              name={`+${overflow()}`}
              size="sm"
              class={styles.stackAvatar}
            >{`+${overflow()}`}</Avatar>
          </Show>
        </div>
        <span class={styles.text}>editing now</span>
      </div>
    </Show>
  );
}
