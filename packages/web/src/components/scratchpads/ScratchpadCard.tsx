import { createMemo, createSignal, createUniqueId, Show, onCleanup, untrack } from 'solid-js';
import type { Scratchpad, Member } from '@plainspace/shared';
import { api } from '../../lib/api';
import { addToast } from '../../lib/toast';
import { CollapseBody, CollapseToggle, createCollapsed } from '../ui';
import ScratchpadEditingIndicator from './ScratchpadEditingIndicator';
import styles from './ScratchpadCard.module.css';
import underline from '../ui/headingUnderline.module.css';

const EDITING_PING_MS = 2_000;

interface ScratchpadCardProps {
  pad: Scratchpad;
  members: Member[];
  editingMemberIds: string[];
  slug: string;
  myId: string;
}

export default function ScratchpadCard(props: ScratchpadCardProps) {
  const { collapsed, toggle } = createCollapsed(untrack(() => props.pad.id));
  const bodyId = createUniqueId();
  const [editing, setEditing] = createSignal(false);
  // Snapshot initial content; live updates flow in through props and are read in JSX/startEdit.
  // eslint-disable-next-line solid/reactivity
  const [content, setContent] = createSignal(props.pad.content);
  const [saving, setSaving] = createSignal(false);
  const [savedFlash, setSavedFlash] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  let savedFlashTimeout: ReturnType<typeof setTimeout> | undefined;
  let editingPing: ReturnType<typeof setInterval> | undefined;
  let dirtyContent: string | undefined;
  let pendingSave = Promise.resolve();
  let isMounted = true;

  const editingMembers = createMemo(() =>
    props.editingMemberIds
      .map((id) => props.members.find((member) => member.id === id))
      .filter((member): member is Member => Boolean(member)),
  );

  onCleanup(() => {
    isMounted = false;
    const contentToFlush = editing() ? dirtyContent : undefined;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = undefined;
    }
    if (savedFlashTimeout) {
      clearTimeout(savedFlashTimeout);
      savedFlashTimeout = undefined;
    }
    if (contentToFlush !== undefined) {
      void persistContent(contentToFlush);
    }
    stopEditingSignal();
  });

  function startEdit() {
    setContent(props.pad.content);
    setEditing(true);
    startEditingSignal();
    requestAnimationFrame(() => {
      textareaRef?.focus();
      if (textareaRef) {
        textareaRef.selectionStart = textareaRef.value.length;
      }
    });
  }

  function startEditingSignal() {
    if (editingPing) return;
    void api.setScratchpadEditing(props.slug, props.pad.id, true).catch(() => {});
    editingPing = setInterval(() => {
      void api.setScratchpadEditing(props.slug, props.pad.id, true).catch(() => {});
    }, EDITING_PING_MS);
  }

  function stopEditingSignal() {
    if (editingPing) {
      clearInterval(editingPing);
      editingPing = undefined;
      void api.setScratchpadEditing(props.slug, props.pad.id, false).catch(() => {});
    }
  }

  function handleInput(value: string) {
    setContent(value);
    dirtyContent = value;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveTimeout = undefined;
      void saveContent(value);
    }, 500);
  }

  async function persistContent(text: string): Promise<boolean> {
    const slug = props.slug;
    const padId = props.pad.id;
    const request = pendingSave.then(() =>
      api
        .updateScratchpad(slug, padId, { content: text })
        .then(() => true)
        .catch(() => {
          addToast('Could not save the scratchpad. Please try again.');
          return false;
        }),
    );
    pendingSave = request.then(
      () => undefined,
      () => undefined,
    );
    const saved = await request;
    if (saved && dirtyContent === text) {
      dirtyContent = undefined;
    }
    return saved;
  }

  async function saveContent(text: string) {
    if (!isMounted) {
      await persistContent(text);
      return;
    }
    setSaving(true);
    setSavedFlash(false);
    if (savedFlashTimeout) clearTimeout(savedFlashTimeout);
    const saved = await persistContent(text);
    if (!isMounted) return;
    setSaving(false);
    if (!saved || dirtyContent !== undefined) return;
    setSavedFlash(true);
    savedFlashTimeout = setTimeout(() => {
      savedFlashTimeout = undefined;
      setSavedFlash(false);
    }, 2500);
  }

  function handleBlur() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = undefined;
    }
    const currentContent = content();
    if (currentContent !== props.pad.content) {
      dirtyContent = currentContent;
      void saveContent(currentContent);
    } else {
      dirtyContent = undefined;
    }
    stopEditingSignal();
    setEditing(false);
  }

  return (
    <section class={styles.card} data-testid="scratchpad-card">
      <header class={styles.header}>
        <h2 class={styles.heading}>
          <CollapseToggle collapsed={collapsed()} onToggle={toggle} controls={bodyId}>
            <span class={`${styles.title} ${underline.line}`} data-testid="scratchpad-title">
              Scratchpad
            </span>
          </CollapseToggle>
        </h2>
        <div class={styles.headerActions}>
          <ScratchpadEditingIndicator members={editingMembers()} myId={props.myId} />
          <Show when={saving()}>
            <span class={styles.savingBadge}>Saving…</span>
          </Show>
          <Show when={!saving() && savedFlash()}>
            <span class={styles.savedBadge} data-testid="scratchpad-saved-badge">
              Saved
            </span>
          </Show>
        </div>
      </header>

      <CollapseBody collapsed={collapsed()} id={bodyId}>
        <div class={styles.content}>
          <Show
            when={editing()}
            fallback={
              <button
                type="button"
                class={`${styles.display} ${!props.pad.content ? styles.placeholder : ''}`}
                onClick={startEdit}
                data-testid="scratchpad-content"
              >
                {props.pad.content || 'Click to add notes...'}
              </button>
            }
          >
            <textarea
              ref={textareaRef}
              aria-label="Scratchpad notes"
              class={styles.textarea}
              value={content()}
              onInput={(e) => handleInput(e.currentTarget.value)}
              onBlur={handleBlur}
              placeholder="Type your notes here..."
              data-testid="scratchpad-textarea"
            />
          </Show>
        </div>
      </CollapseBody>
    </section>
  );
}
