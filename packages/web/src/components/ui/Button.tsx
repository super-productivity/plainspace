import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  class?: string;
}

export default function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'fullWidth', 'class', 'type']);
  const variant = () => local.variant ?? 'primary';
  const size = () => local.size ?? 'md';
  const className = () =>
    [
      styles.button,
      styles[variant()],
      styles[size()],
      local.fullWidth ? styles.fullWidth : '',
      local.class ?? '',
    ]
      .filter(Boolean)
      .join(' ');

  return <button {...rest} type={local.type ?? 'button'} class={className()} />;
}
