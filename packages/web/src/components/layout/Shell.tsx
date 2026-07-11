import type { JSX } from 'solid-js';
import styles from './Shell.module.css';

export default function Shell(props: { children: JSX.Element }) {
  return <div class={styles.shell}>{props.children}</div>;
}
