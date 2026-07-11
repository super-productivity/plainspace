import { For } from 'solid-js';
import type { Member } from '@plainspace/shared';
import MemberChip from '../members/MemberChip';
import { Popover } from '../ui';
import styles from './MemberPicker.module.css';

interface MemberPickerProps {
  anchor: HTMLElement;
  members: Member[];
  assignedTo: string | null;
  onSelect: (memberId: string | null) => void;
  onClose: () => void;
}

export default function MemberPicker(props: MemberPickerProps) {
  return (
    <Popover
      anchor={props.anchor}
      onClose={props.onClose}
      class={styles.popover}
      data-testid="member-picker"
    >
      <button
        class={`${styles.option} ${props.assignedTo === null ? styles.selected : ''}`}
        onClick={() => {
          props.onSelect(null);
          props.onClose();
        }}
        data-testid="unassign-option"
      >
        <span class={styles.unassignedIcon}>∅</span>
        <span class={styles.name}>Unassigned</span>
        {props.assignedTo === null && <span class={styles.check}>✓</span>}
      </button>
      <For each={props.members}>
        {(member) => (
          <button
            class={`${styles.option} ${props.assignedTo === member.id ? styles.selected : ''}`}
            onClick={() => {
              props.onSelect(member.id);
              props.onClose();
            }}
            data-testid={`assign-option-${member.id}`}
          >
            <MemberChip member={member} small />
            <span class={styles.name}>{member.displayName}</span>
            {props.assignedTo === member.id && <span class={styles.check}>✓</span>}
          </button>
        )}
      </For>
    </Popover>
  );
}
