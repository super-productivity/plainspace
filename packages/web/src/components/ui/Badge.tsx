import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import styles from './Badge.module.css';

type BadgeVariant = 'neutral' | 'online' | 'role' | 'warning';

interface BadgeProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'class'> {
  variant?: BadgeVariant;
  class?: string;
}

export default function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ['variant', 'class']);
  const variant = () => local.variant ?? 'neutral';
  const className = () =>
    [styles.badge, styles[variant()], local.class ?? ''].filter(Boolean).join(' ');

  return <span {...rest} class={className()} />;
}
