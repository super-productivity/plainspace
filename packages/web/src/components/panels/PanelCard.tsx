import { Show, createSignal, createUniqueId, untrack, type JSX } from 'solid-js';
import { api } from '../../lib/api';
import { addToast } from '../../lib/toast';
import {
  CollapseBody,
  CollapseToggle,
  ConfirmDialog,
  InlineRename,
  Menu,
  createCollapsed,
  type MenuItem,
} from '../ui';
import styles from './PanelCard.module.css';
import underline from '../ui/headingUnderline.module.css';

interface PanelCardProps {
  title: string;
  slug: string;
  panelId: string;
  /** Display word for the menu actions + error toasts, e.g. "poll" / "time slot". */
  label: string;
  /** What else the delete destroys, e.g. "all its votes" -- named in the confirm
   * so members know the consequence. Omitted: only the panel itself is warned about. */
  deleteConsequence?: string;
  cardTestId: string;
  deleteTestId: string;
  children: JSX.Element;
}

// Shared shell for every panel card: the paper sheet, the heading, and the
// actions menu (Rename / Delete). Panels are shared content, so any member sees
// the controls. Per-type cards (PollCard, TimeSlotCard) supply only their body
// -- the options / slots list -- as children.
export default function PanelCard(props: PanelCardProps) {
  const { collapsed, toggle } = createCollapsed(untrack(() => props.panelId));
  const bodyId = createUniqueId();
  const [confirming, setConfirming] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);

  const deleteMessage = () =>
    props.deleteConsequence
      ? `This ${props.label} and ${props.deleteConsequence} will be permanently deleted. This can't be undone.`
      : `This ${props.label} will be permanently deleted. This can't be undone.`;

  async function handleDelete() {
    if (deleting()) return;
    setConfirming(false);
    setDeleting(true);
    try {
      await api.deletePanel(props.slug, props.panelId);
    } catch {
      // SSE will resync if the delete actually went through.
      addToast(`Could not delete the ${props.label}. Please try again.`);
    } finally {
      setDeleting(false);
    }
  }

  // Non-optimistic like every panel mutation: the heading updates when the
  // panel.updated SSE echo lands.
  async function commitRename(value: string) {
    setRenaming(false);
    if (!value || value === props.title) return;
    try {
      await api.updatePanel(props.slug, props.panelId, { title: value });
    } catch {
      addToast(`Could not rename the ${props.label}. Please try again.`);
    }
  }

  const menuItems = (): MenuItem[] => [
    { label: 'Rename', onSelect: () => setRenaming(true), testId: 'panel-rename' },
    {
      label: 'Delete',
      onSelect: () => setConfirming(true),
      danger: true,
      testId: props.deleteTestId,
    },
  ];

  return (
    <section class={styles.card} data-testid={props.cardTestId}>
      <header class={styles.header}>
        <h2 class={styles.heading}>
          <Show
            when={renaming()}
            fallback={
              <CollapseToggle collapsed={collapsed()} onToggle={toggle} controls={bodyId}>
                <span class={`${styles.title} ${underline.line}`}>{props.title}</span>
              </CollapseToggle>
            }
          >
            <InlineRename
              class={styles.titleInput}
              value={props.title}
              ariaLabel={`Rename ${props.label}`}
              testId="panel-rename-input"
              onCommit={commitRename}
              onCancel={() => setRenaming(false)}
            />
          </Show>
        </h2>
        <Menu label={`${props.label} actions`} items={menuItems()} triggerTestId="panel-menu" />
      </header>
      <CollapseBody collapsed={collapsed()} id={bodyId}>
        {props.children}
      </CollapseBody>
      <Show when={confirming()}>
        <ConfirmDialog
          title={`Delete ${props.label}?`}
          message={deleteMessage()}
          confirmLabel={`Delete ${props.label}`}
          danger
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </section>
  );
}
