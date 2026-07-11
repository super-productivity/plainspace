import { createEffect, onCleanup, untrack } from 'solid-js';
import { shareJoinLink } from '../../lib/join-link';
import { addToast, dismissToast } from '../../lib/toast';

interface FirstShareNudgeProps {
  slug: string;
  projectName: string;
  sharingMode: 'open' | 'private';
  isCreator: boolean;
  memberCount: number;
  taskCount: number;
}

export default function FirstShareNudge(props: FirstShareNudgeProps) {
  let previousTaskCount = untrack(() => props.taskCount);
  let offered = previousTaskCount > 0;
  let toastId: string | undefined;
  let canShare = false;

  createEffect(() => {
    const taskCount = props.taskCount;
    const eligible = props.sharingMode === 'open' && props.isCreator && props.memberCount === 1;
    canShare = eligible;
    if (toastId && !eligible) {
      dismissToast(toastId);
      toastId = undefined;
    }
    if (!offered && previousTaskCount === 0 && taskCount > 0) {
      offered = true;
      if (eligible) {
        const slug = props.slug;
        const projectName = props.projectName;
        toastId = addToast(
          'Task added. Share this Space to plan together.',
          () => {
            if (canShare) void shareJoinLink(slug, projectName);
          },
          'Share',
        );
      }
    }
    previousTaskCount = taskCount;
  });

  onCleanup(() => {
    canShare = false;
    if (toastId) dismissToast(toastId);
  });

  return null;
}
