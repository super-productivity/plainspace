import { createSignal, Show, untrack } from 'solid-js';
import { MAX_PROJECT_NAME_LENGTH, MAX_PURPOSE_LENGTH, type Project } from '@plainspace/shared';
import { api, ApiError } from '../../lib/api';
import { updateProject } from '../../lib/store';
import { Button, TextField } from '../ui';
import styles from './SpaceDetailsControl.module.css';

interface SpaceDetailsControlProps {
  slug: string;
  project: Project;
}

export default function SpaceDetailsControl(props: SpaceDetailsControlProps) {
  // Seeded once, like InlineRename: a concurrent rename by another admin
  // arrives over SSE and updates the header, but must not overwrite what this
  // admin is currently typing.
  const [name, setName] = createSignal(untrack(() => props.project.name));
  const [purpose, setPurpose] = createSignal(untrack(() => props.project.purpose));
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);

  const changed = () =>
    name().trim() !== props.project.name || purpose().trim() !== props.project.purpose;

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const nextName = name().trim();
    if (pending() || !nextName || !changed()) return;

    setPending(true);
    setError('');
    try {
      const result = await api.updateSettings(props.slug, {
        name: nextName,
        purpose: purpose().trim(),
      });
      updateProject(result.project);
      // Re-seed from the server's copy so the fields show what was actually
      // stored and `changed()` settles back to false.
      setName(result.project.name);
      setPurpose(result.project.purpose);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these details');
    } finally {
      setPending(false);
    }
  }

  return (
    <form class={styles.section} onSubmit={handleSubmit} data-testid="space-details-section">
      <h4 class={styles.heading}>Name and purpose</h4>
      <TextField
        id="space-name"
        label="Name"
        size="sm"
        value={name()}
        onInput={(e) => setName(e.currentTarget.value)}
        maxLength={MAX_PROJECT_NAME_LENGTH}
        required
        data-testid="space-name-input"
      />
      <TextField
        id="space-purpose"
        label="One-line purpose"
        optionalText="(optional)"
        size="sm"
        value={purpose()}
        onInput={(e) => setPurpose(e.currentTarget.value)}
        maxLength={MAX_PURPOSE_LENGTH}
        data-testid="space-purpose-input"
      />
      <div class={styles.actions}>
        <Button
          type="submit"
          size="sm"
          disabled={pending() || !changed() || !name().trim()}
          data-testid="save-space-details-button"
        >
          {pending() ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p class={styles.hint}>Everyone here sees this name and purpose at the top of the Space.</p>
      <Show when={error()}>
        <p class={styles.error}>{error()}</p>
      </Show>
    </form>
  );
}
