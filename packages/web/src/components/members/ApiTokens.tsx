import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import type { ApiToken } from '@plainspace/shared';
import { api } from '../../lib/api';
import { addToast } from '../../lib/toast';
import { copyText } from '../../lib/clipboard';
import { Button, ConfirmDialog } from '../ui';
import styles from './ApiTokens.module.css';

interface ApiTokensProps {
  slug: string;
  emailVerified: boolean;
}

export default function ApiTokens(props: ApiTokensProps) {
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  const [token, setToken] = createSignal<ApiToken | null>(null);
  const [newToken, setNewToken] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [confirm, setConfirm] = createSignal<'regenerate' | 'revoke' | null>(null);

  onMount(async () => {
    if (props.emailVerified) {
      try {
        const result = await api.getApiToken(props.slug);
        setToken(result.token);
      } catch {
        /* tokens panel stays empty on failure */
      }
    }
    setLoading(false);
  });

  // Creating a token revokes any previous one, so this serves both the initial
  // "Generate" and the "Regenerate" action.
  async function handleCreate() {
    setConfirm(null);
    try {
      const result = await api.createApiToken(props.slug);
      setNewToken(result.token);
      setToken(result.apiToken);
    } catch {
      addToast('Could not create the token. Please try again.');
    }
  }

  async function handleRevoke() {
    setConfirm(null);
    try {
      await api.revokeApiToken(props.slug);
      setToken(null);
    } catch {
      addToast('Could not revoke the token. Please try again.');
    }
  }

  async function handleCopy() {
    const value = newToken();
    if (!value) return;
    if (await copyText(value)) {
      setCopied(true);
      copyTimer = setTimeout(() => setCopied(false), 2000);
    } else {
      addToast('Could not copy the token. Select it and copy manually.');
    }
  }

  return (
    <Show
      when={props.emailVerified}
      fallback={
        <div class={styles.section}>
          <h4 class={styles.heading}>API token</h4>
          <p class={styles.hint}>Add an email to this Space to generate an integration token.</p>
        </div>
      }
    >
      <div class={styles.section} data-testid="api-tokens-section">
        <h4 class={styles.heading}>API token</h4>

        <Show when={newToken()}>
          <div class={styles.newTokenBanner} data-testid="new-token-banner">
            <p class={styles.newTokenWarning}>Copy this token now. You won't see it again.</p>
            <code class={styles.tokenValue} data-testid="token-value">
              {newToken()}
            </code>
            <Button size="sm" onClick={handleCopy}>
              {copied() ? 'Copied!' : 'Copy'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewToken(null)}>
              Done
            </Button>
          </div>
        </Show>

        <Show when={!loading()}>
          <Show
            when={token()}
            fallback={
              <Button
                variant="secondary"
                fullWidth
                onClick={handleCreate}
                data-testid="generate-token-button"
              >
                Generate API Token
              </Button>
            }
          >
            {(active) => (
              <div class={styles.tokenRow} data-testid="api-token-row">
                <span class={styles.tokenMeta}>
                  Created {new Date(active().createdAt).toLocaleDateString()}
                  {active().lastUsedAt
                    ? ` · Last used ${new Date(active().lastUsedAt!).toLocaleDateString()}`
                    : ' · Never used'}
                </span>
                <div class={styles.tokenActions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirm('regenerate')}
                    data-testid="regenerate-token-button"
                  >
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirm('revoke')}
                    data-testid="revoke-token-button"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            )}
          </Show>
        </Show>

        <Show when={confirm() === 'regenerate'}>
          <ConfirmDialog
            title="Regenerate API token?"
            message="Your current token stops working immediately. Update any integration using it."
            confirmLabel="Regenerate"
            danger
            onConfirm={handleCreate}
            onCancel={() => setConfirm(null)}
          />
        </Show>

        <Show when={confirm() === 'revoke'}>
          <ConfirmDialog
            title="Revoke API token?"
            message="Integrations using this token will stop working."
            confirmLabel="Revoke"
            danger
            onConfirm={handleRevoke}
            onCancel={() => setConfirm(null)}
          />
        </Show>
      </div>
    </Show>
  );
}
