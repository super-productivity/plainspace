import { createSignal, Show } from 'solid-js';
import type { Project } from '@plainspace/shared';
import { api, ApiError } from '../../lib/api';
import { updateProject } from '../../lib/store';
import { SegmentedControl } from '../ui';
import styles from './SharingModeControl.module.css';

interface SharingModeControlProps {
  slug: string;
  project: Project;
  emailVerified: boolean;
}

export default function SharingModeControl(props: SharingModeControlProps) {
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);

  async function handleChange(value: string) {
    // Narrow the SegmentedControl's string to the union updateSettings accepts.
    if (value !== 'open' && value !== 'private') return;
    // Ignore clicks while a previous PATCH is in flight: props.project.sharingMode
    // hasn't been updated yet, so a quick toggle could either no-op against the
    // stale value (silently losing the user's last intent) or fire a parallel
    // PATCH whose response order isn't guaranteed.
    if (pending()) return;
    if (value === props.project.sharingMode) return;
    if (value === 'private' && !props.emailVerified) {
      setError('Add an email to this Space before turning link joining off.');
      return;
    }

    setPending(true);
    setError('');
    try {
      const result = await api.updateSettings(props.slug, { sharingMode: value });
      updateProject(result.project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update sharing mode');
    } finally {
      setPending(false);
    }
  }

  return (
    <div class={styles.section} data-testid="sharing-mode-section">
      <h4 class={styles.heading}>Link joining</h4>
      <SegmentedControl
        ariaLabel="Link joining"
        value={props.project.sharingMode}
        onChange={handleChange}
        options={[
          { value: 'open', label: 'On', testId: 'sharing-mode-open' },
          { value: 'private', label: 'Off', testId: 'sharing-mode-private' },
        ]}
      />
      <p class={styles.hint}>
        <Show
          when={props.project.sharingMode === 'private'}
          fallback="Anyone with the join link can join with a name."
        >
          New people cannot join from the link. Existing people can still open it by email.
        </Show>
      </p>
      <Show when={pending()}>
        <p class={styles.hint}>Updating…</p>
      </Show>
      <Show when={error()}>
        <p class={styles.error}>{error()}</p>
      </Show>
    </div>
  );
}
