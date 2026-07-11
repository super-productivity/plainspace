import type { JSX } from 'solid-js';
import styles from './Avatar.module.css';

type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps {
  name: string;
  color?: string;
  size?: AvatarSize;
  letters?: 1 | 2;
  online?: boolean;
  title?: string;
  class?: string;
  children?: JSX.Element;
  'data-testid'?: string;
}

function deriveInitials(name: string, letters: 1 | 2): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (letters === 1) return parts[0]![0]!.toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export default function Avatar(props: AvatarProps) {
  const size = () => props.size ?? 'md';
  const letters = () => props.letters ?? 2;
  const content = () => props.children ?? deriveInitials(props.name, letters());
  const muted = () => !props.color;
  const className = () =>
    [
      styles.avatar,
      styles[size()],
      muted() ? styles.muted : '',
      props.online ? styles.online : '',
      props.class ?? '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <span
      class={className()}
      style={props.color ? { '--avatar-color': props.color } : undefined}
      title={props.title ?? props.name}
      aria-hidden="true"
      data-testid={props['data-testid']}
      data-online={props.online ? 'true' : undefined}
    >
      {content()}
    </span>
  );
}
