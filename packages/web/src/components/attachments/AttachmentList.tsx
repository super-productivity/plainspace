import { For, Show, createSignal } from 'solid-js';
import type { Attachment } from '@plainspace/shared';
import { api, ApiError } from '../../lib/api';
import styles from './AttachmentList.module.css';

interface AttachmentListProps {
  attachments: Attachment[];
  slug: string;
  onError?: (message: string) => void;
}

function isImage(mimeType: string) {
  return mimeType.startsWith('image/');
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function AttachmentList(props: AttachmentListProps) {
  const [deleting, setDeleting] = createSignal<string | null>(null);

  async function handleDelete(att: Attachment, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (deleting()) return;
    setDeleting(att.id);
    try {
      await api.deleteAttachment(props.slug, att.id);
      // The 'attachment.deleted' SSE event will remove this item from the store.
    } catch (err) {
      props.onError?.(err instanceof ApiError ? err.message : `Couldn't delete "${att.filename}"`);
      setDeleting(null);
    }
  }

  return (
    <Show when={props.attachments.length > 0}>
      <div class={styles.list} data-testid="attachment-list">
        <For each={props.attachments}>
          {(att) => (
            <div class={styles.item} data-testid="attachment-item">
              <a
                class={styles.preview}
                href={att.url}
                target="_blank"
                rel="noopener"
                title={att.filename}
              >
                <Show
                  when={isImage(att.mimeType)}
                  fallback={
                    <div class={styles.fileIcon}>
                      <span class={styles.fileExt}>
                        {att.filename.split('.').pop()?.toUpperCase() || 'FILE'}
                      </span>
                    </div>
                  }
                >
                  <img class={styles.thumbnail} src={att.url} alt={att.filename} loading="lazy" />
                </Show>
                <span class={styles.filename}>{att.filename}</span>
                <span class={styles.size}>{formatSize(att.sizeBytes)}</span>
              </a>
              <button
                type="button"
                class={styles.deleteButton}
                onClick={(e) => handleDelete(att, e)}
                disabled={deleting() === att.id}
                title={`Delete ${att.filename}`}
                aria-label={`Delete ${att.filename}`}
                data-testid="attachment-delete-button"
              >
                {deleting() === att.id ? '…' : '✕'}
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
