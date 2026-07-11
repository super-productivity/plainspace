import type { Member } from '@plainspace/shared';
import { Avatar } from '../ui';
import styles from './MemberChip.module.css';

interface MemberChipProps {
  member: Member;
  small?: boolean;
  online?: boolean;
}

export default function MemberChip(props: MemberChipProps) {
  return (
    <span
      class={`${styles.chip} ${props.small ? styles.small : ''}`}
      title={props.member.displayName}
      data-testid="member-chip"
    >
      <Avatar
        name={props.member.displayName}
        color={props.member.color}
        size={props.small ? 'sm' : 'md'}
        online={props.online}
      />
      {!props.small && <span class={styles.name}>{props.member.displayName}</span>}
    </span>
  );
}
