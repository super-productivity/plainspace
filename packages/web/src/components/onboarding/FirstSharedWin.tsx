import { copyJoinLink } from '../../lib/join-link';
import { Banner, Button } from '../ui';
import { focusAddTask } from '../layout/MobileQuickActions';
import styles from './FirstSharedWin.module.css';

interface FirstSharedWinProps {
  slug: string;
  memberCount: number;
  taskCount: number;
}

export default function FirstSharedWin(props: FirstSharedWinProps) {
  const visible = () => props.memberCount === 1 && props.taskCount === 0;

  return (
    <div
      class={styles.transition}
      data-visible={visible() ? 'true' : 'false'}
      aria-hidden={visible() ? undefined : true}
      inert={!visible()}
      data-testid="first-shared-win-transition"
    >
      <div class={styles.clip}>
        <Banner
          title="Start this Space together"
          action={
            <div class={styles.actions}>
              <Button size="sm" onClick={focusAddTask} data-testid="first-shared-win-add-task">
                Add first task
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copyJoinLink(props.slug)}
                data-testid="first-shared-win-invite"
              >
                Invite someone
              </Button>
            </div>
          }
          data-testid="first-shared-win"
        >
          Add one concrete task, then invite the person you’re planning with.
        </Banner>
      </div>
    </div>
  );
}
