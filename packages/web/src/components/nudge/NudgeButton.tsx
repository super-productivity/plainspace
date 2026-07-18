import { createSignal, Show, onCleanup } from 'solid-js';
import { api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { Dialog } from '../ui';
import styles from './NudgeButton.module.css';

interface NudgeButtonProps {
  slug: string;
}

export default function NudgeButton(props: NudgeButtonProps) {
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  const [showPreview, setShowPreview] = createSignal(false);
  const [nudgeText, setNudgeText] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);

  const nativeShareAvailable = () =>
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function handleClick() {
    setLoading(true);
    try {
      const result = await api.getNudge(props.slug);
      setNudgeText(result.text);
      setShowPreview(true);
    } catch {
      /* button just resets; user can retry */
    }
    setLoading(false);
  }

  async function handleCopy() {
    // On failure the text stays visible in the preview for manual copying.
    if (await copyText(nudgeText())) {
      setCopied(true);
      copyTimer = setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleNativeShare() {
    if (!nativeShareAvailable()) {
      await handleCopy();
      return;
    }

    setSharing(true);
    try {
      await navigator.share({
        title: 'Plainspace update',
        text: nudgeText(),
      });
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      if (!cancelled) await handleCopy();
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        class={styles.nudgeButton}
        onClick={handleClick}
        disabled={loading()}
        title="Share update"
        aria-label="Share update"
        data-testid="nudge-button"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
        <span>Share update</span>
      </button>

      <Show when={showPreview()}>
        <Dialog
          onClose={() => setShowPreview(false)}
          ariaLabel="Share this update"
          data-testid="nudge-modal"
        >
          <h3 class={styles.modalTitle}>Share this update</h3>
          <pre class={styles.preview} data-testid="nudge-text">
            {nudgeText()}
          </pre>
          <div class={styles.modalActions}>
            <Show when={nativeShareAvailable()}>
              <button
                class={styles.primaryButton}
                onClick={handleNativeShare}
                disabled={sharing()}
                data-testid="nudge-native-share-button"
              >
                {sharing() ? 'Sharing...' : 'Share'}
              </button>
            </Show>
            <button
              class={nativeShareAvailable() ? styles.secondaryButton : styles.primaryButton}
              onClick={handleCopy}
              data-testid="nudge-copy-button"
            >
              {copied() ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button class={styles.closeButton} onClick={() => setShowPreview(false)}>
              Close
            </button>
          </div>
        </Dialog>
      </Show>
    </>
  );
}
