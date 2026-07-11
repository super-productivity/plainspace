import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import styles from './Banner.module.css';

type BannerVariant = 'info' | 'warning';

interface BannerProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'title'> {
  variant?: BannerVariant;
  /** Optional leading icon (an inline SVG); colored to match the variant. */
  icon?: JSX.Element;
  /** Optional emphasized heading shown above the message. */
  title?: string;
  /** Optional trailing action, e.g. a Button. Stacks full-width on mobile. */
  action?: JSX.Element;
  class?: string;
}

export default function Banner(props: BannerProps) {
  const [local, rest] = splitProps(props, [
    'variant',
    'icon',
    'title',
    'action',
    'class',
    'children',
  ]);
  const variant = () => local.variant ?? 'info';
  const className = () =>
    [styles.banner, styles[variant()], local.class ?? ''].filter(Boolean).join(' ');

  return (
    <div {...rest} class={className()}>
      <div class={styles.main}>
        <Show when={local.icon}>
          <span class={styles.icon} aria-hidden="true">
            {local.icon}
          </span>
        </Show>
        <div class={styles.body}>
          <Show when={local.title}>
            <p class={styles.title}>{local.title}</p>
          </Show>
          <Show when={local.children}>
            <p class={styles.message}>{local.children}</p>
          </Show>
        </div>
      </div>
      <Show when={local.action}>
        <div class={styles.action}>{local.action}</div>
      </Show>
    </div>
  );
}
