import { createSignal } from 'solid-js';
import { api } from '../../lib/api';
import styles from './AttachmentUpload.module.css';

interface AttachmentUploadProps {
  slug: string;
  itemId: string;
  onError?: (message: string) => void;
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Upload failed';
}

export default function AttachmentUpload(props: AttachmentUploadProps) {
  const [uploading, setUploading] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await api.uploadAttachment(props.slug, props.itemId, file);
    } catch (err) {
      props.onError?.(`Couldn't upload "${file.name}" — ${describeError(err)}`);
    }
    setUploading(false);
    input.value = '';
  }

  return (
    <>
      <button
        type="button"
        class={styles.uploadButton}
        onClick={() => inputRef?.click()}
        disabled={uploading()}
        title="Attach file. Do not upload sensitive or regulated data."
        aria-label="Attach file. Do not upload sensitive or regulated data."
        data-testid="attachment-upload-button"
      >
        {uploading() ? '...' : '\u{1F4CE}'}
      </button>
      <input
        ref={inputRef}
        type="file"
        class={styles.hiddenInput}
        disabled={uploading()}
        onChange={handleFile}
        accept="image/*,.pdf,.txt,.csv"
      />
    </>
  );
}
