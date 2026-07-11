import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import styles from './FormCard.module.css';

interface FormCardProps extends Omit<JSX.FormHTMLAttributes<HTMLFormElement>, 'class'> {
  class?: string;
}

export default function FormCard(props: FormCardProps) {
  const [local, rest] = splitProps(props, ['class']);
  const className = () => [styles.form, local.class ?? ''].filter(Boolean).join(' ');

  return <form {...rest} class={className()} />;
}
