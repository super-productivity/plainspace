import { createSignal, createUniqueId, For, Show } from 'solid-js';
import type {
  ActivityEntry,
  Attachment,
  TimeSlotPanel,
  ChecklistPanel,
  Item,
  Member,
  PollPanel,
  Project,
  Scratchpad,
} from '@plainspace/shared';
import { MEMBER_COLORS } from '@plainspace/shared';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Chip,
  CollapseBody,
  CollapseToggle,
  ConfirmDialog,
  Dialog,
  FormCard,
  IconDeleteButton,
  InlineRename,
  LegalNotice,
  Menu,
  SegmentedControl,
  TextField,
} from '../components/ui';
import AddItem from '../components/lists/AddItem';
import ListItem from '../components/lists/ListItem';
import ScratchpadCard from '../components/scratchpads/ScratchpadCard';
import PollCard from '../components/panels/PollCard';
import TimeSlotCard from '../components/panels/TimeSlotCard';
import ChecklistCard from '../components/panels/ChecklistCard';
import AddPanelButton from '../components/panels/AddPanelButton';
import ActivityFeed from '../components/activity/ActivityFeed';
import Header from '../components/layout/Header';
import MobileQuickActions from '../components/layout/MobileQuickActions';
import MemberChip from '../components/members/MemberChip';
import AttachmentList from '../components/attachments/AttachmentList';
import AttachmentUpload from '../components/attachments/AttachmentUpload';
import Toast from '../components/shared/Toast';
import { useDocumentTitle } from '../lib/document-title';
import styles from './Styleguide.module.css';

const NOW = new Date().toISOString();
const SLUG = 'styleguide';

const demoMembers: Member[] = [
  {
    id: 'm1',
    projectId: 'p1',
    displayName: 'Avery',
    color: MEMBER_COLORS[0],
    avatarIndex: 0,
    email: null,
    emailVerified: false,
    isCreator: true,
    role: 'admin',
    tosVersion: null,
    tosAcceptedAt: null,
    joinedAt: NOW,
  },
  {
    id: 'm2',
    projectId: 'p1',
    displayName: 'Blair',
    color: MEMBER_COLORS[3],
    avatarIndex: 1,
    email: null,
    emailVerified: false,
    isCreator: false,
    role: 'member',
    tosVersion: null,
    tosAcceptedAt: null,
    joinedAt: NOW,
  },
];

const demoItems: Item[] = [
  {
    id: 'i1',
    listId: 'l1',
    projectId: 'p1',
    text: 'Pick a date that works for everyone',
    checked: false,
    checkedBy: null,
    assignedTo: 'm1',
    columnId: 'todo',
    position: 1000,
    createdBy: 'm1',
    createdAt: NOW,
    remindAt: null,
    repeat: null,
  },
  {
    id: 'i2',
    listId: 'l1',
    projectId: 'p1',
    text: 'Book the venue',
    checked: true,
    checkedBy: 'm2',
    assignedTo: null,
    columnId: 'todo',
    position: 2000,
    createdBy: 'm2',
    createdAt: NOW,
    remindAt: null,
    repeat: null,
  },
  {
    id: 'i3',
    listId: 'l1',
    projectId: 'p1',
    text: 'Take meds (recurring reminder)',
    // Checked + repeat = "resting": done for now, waiting to reopen. The badge
    // shows ↻ and, because it's resting, the › glyph before the next time.
    checked: true,
    checkedBy: 'm1',
    assignedTo: null,
    columnId: 'todo',
    position: 3000,
    createdBy: 'm1',
    createdAt: NOW,
    // Recurring reminder: the badge shows the ↻ glyph next to the time. The
    // sweep re-arms remindAt, so the badge persists on checked rows too.
    remindAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    repeat: {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    id: 'i4',
    listId: 'l1',
    projectId: 'p1',
    text: 'Water the plants (overdue occurrence)',
    // Unchecked + repeat + past remindAt = "overdue": the fire passed while
    // still undone. Badge shows ↻ and the ! marker in amber.
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'todo',
    position: 4000,
    createdBy: 'm1',
    createdAt: NOW,
    remindAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    repeat: {
      freq: 'daily',
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
  },
];

const demoScratchpad: Scratchpad = {
  id: 's1',
  projectId: 'p1',
  content: 'Quick notes about the trip itinerary — feel free to edit collaboratively.',
  updatedBy: 'm1',
  createdBy: 'm1',
  createdAt: NOW,
  updatedAt: NOW,
};

const demoAttachments: Attachment[] = [
  {
    id: 'at1',
    projectId: 'p1',
    itemId: 'i1',
    filename: 'venue-photos.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 524_288,
    uploadedBy: 'm1',
    createdAt: NOW,
    url: '#',
  },
  {
    id: 'at2',
    projectId: 'p1',
    itemId: 'i1',
    filename: 'budget.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 102_400,
    uploadedBy: 'm1',
    createdAt: NOW,
    url: '#',
  },
];

const demoProject: Project = {
  id: 'p1',
  slug: SLUG,
  name: 'Summer Trip',
  purpose: 'Two weeks in Tuscany — planning together',
  sharingMode: 'private',
  createdAt: NOW,
  updatedAt: NOW,
};

const demoPollUnvoted: PollPanel = {
  id: 'pn1',
  projectId: 'p1',
  type: 'poll',
  createdBy: 'm1',
  createdAt: NOW,
  question: 'Where should we eat on Friday?',
  options: [
    { id: 'opt1', text: 'Trattoria del Borgo' },
    { id: 'opt2', text: 'Osteria Vecchia' },
    { id: 'opt3', text: 'Wine bar by the river' },
  ],
  votes: [],
};

const demoPollVoted: PollPanel = {
  id: 'pn2',
  projectId: 'p1',
  type: 'poll',
  createdBy: 'm2',
  createdAt: NOW,
  question: 'Pick a day for the kickoff call',
  options: [
    { id: 'opt1', text: 'Tuesday morning' },
    { id: 'opt2', text: 'Wednesday afternoon' },
    { id: 'opt3', text: 'Thursday morning' },
  ],
  votes: [
    { optionId: 'opt1', memberId: 'm1' },
    { optionId: 'opt2', memberId: 'm2' },
  ],
};

const demoPollEmpty: PollPanel = {
  id: 'pn3',
  projectId: 'p1',
  type: 'poll',
  createdBy: 'm1',
  createdAt: NOW,
  question: 'What name should we give the shared notebook?',
  options: [
    { id: 'opt1', text: 'Field log' },
    { id: 'opt2', text: 'Loose threads' },
  ],
  votes: [],
};

const demoTimeSlot: TimeSlotPanel = {
  id: 'pn4',
  projectId: 'p1',
  type: 'timeslot',
  createdBy: 'm1',
  createdAt: NOW,
  title: 'When can everyone meet?',
  slots: [
    { id: 'slot1', label: 'Mon 9am' },
    { id: 'slot2', label: 'Tue 2pm' },
    { id: 'slot3', label: 'Wed 11am' },
  ],
  responses: [
    { slotId: 'slot1', memberId: 'm1' },
    { slotId: 'slot2', memberId: 'm1' },
    { slotId: 'slot2', memberId: 'm2' },
  ],
};

const demoTimeSlotEmpty: TimeSlotPanel = {
  id: 'pn5',
  projectId: 'p1',
  type: 'timeslot',
  createdBy: 'm1',
  createdAt: NOW,
  title: 'Pick a slot for the retro',
  slots: [
    { id: 'slot1', label: 'Thu 3pm' },
    { id: 'slot2', label: 'Fri 10am' },
  ],
  responses: [],
};

const demoChecklist: ChecklistPanel = {
  id: 'pn6',
  projectId: 'p1',
  type: 'checklist',
  createdBy: 'm1',
  createdAt: NOW,
  listId: 'cl1',
  title: 'Packing list',
};

// Items live in the shared project array keyed by listId; these match
// demoChecklist.listId so the card filters them in.
const demoChecklistItems: Item[] = [
  {
    id: 'ci1',
    listId: 'cl1',
    projectId: 'p1',
    text: 'Passport',
    checked: true,
    checkedBy: 'm1',
    assignedTo: null,
    columnId: 'todo',
    position: 1000,
    createdBy: 'm1',
    createdAt: NOW,
    remindAt: null,
    repeat: null,
  },
  {
    id: 'ci2',
    listId: 'cl1',
    projectId: 'p1',
    text: 'Charger',
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'todo',
    position: 2000,
    createdBy: 'm1',
    createdAt: NOW,
    remindAt: null,
    repeat: null,
  },
  {
    id: 'ci3',
    listId: 'cl1',
    projectId: 'p1',
    text: 'Sunscreen',
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'todo',
    position: 3000,
    createdBy: 'm1',
    createdAt: NOW,
    remindAt: null,
    repeat: null,
  },
];

const demoActivity: ActivityEntry[] = [
  {
    id: 'a1',
    projectId: 'p1',
    memberId: 'm1',
    action: 'item.created',
    targetType: 'item',
    targetId: 'i1',
    meta: { text: 'Pick a date that works for everyone' },
    createdAt: new Date(Date.now() - 30_000).toISOString(),
  },
  {
    id: 'a2',
    projectId: 'p1',
    memberId: 'm1',
    action: 'item.checked',
    targetType: 'item',
    targetId: 'i2',
    meta: { text: 'Book the venue' },
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: 'a3',
    projectId: 'p1',
    memberId: 'm1',
    action: 'scratchpad.updated',
    targetType: 'scratchpad',
    targetId: 's1',
    meta: {},
    createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
  {
    id: 'a4',
    projectId: 'p1',
    memberId: 'm2',
    action: 'item.updated',
    targetType: 'item',
    targetId: 'i3',
    meta: { text: 'Confirm train connections' },
    createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  },
  {
    id: 'a5',
    projectId: 'p1',
    memberId: 'm1',
    action: 'attachment.created',
    targetType: 'attachment',
    targetId: 'att1',
    meta: { filename: 'villa-options.pdf' },
    createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  },
  {
    id: 'a6',
    projectId: 'p1',
    memberId: 'm2',
    action: 'item.assigned',
    targetType: 'item',
    targetId: 'i4',
    meta: { text: 'Check restaurant availability' },
    createdAt: new Date(Date.now() - 35 * 60_000).toISOString(),
  },
  {
    id: 'a7',
    projectId: 'p1',
    memberId: 'm1',
    action: 'item.deleted',
    targetType: 'item',
    targetId: 'i5',
    meta: { text: 'Old packing reminder' },
    createdAt: new Date(Date.now() - 48 * 60_000).toISOString(),
  },
];

const iconProps = {
  width: '20',
  height: '20',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': true,
};

const MailIcon = () => (
  <svg {...iconProps}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const WarningIcon = () => (
  <svg {...iconProps}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

export default function Styleguide() {
  const [viewMode, setViewMode] = createSignal('all');
  const [repeatDemo, setRepeatDemo] = createSignal('Mon–Fri');
  const [toastVisible, setToastVisible] = createSignal(true);
  const [toastWithAction, setToastWithAction] = createSignal(true);
  const [centerDialogOpen, setCenterDialogOpen] = createSignal(false);
  const [sideDialogOpen, setSideDialogOpen] = createSignal(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = createSignal(false);
  const [lastMenuAction, setLastMenuAction] = createSignal('none');
  const [renamingDemo, setRenamingDemo] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal('Packing list');
  const [demoCollapsed, setDemoCollapsed] = createSignal(false);
  const demoCollapseBodyId = createUniqueId();

  useDocumentTitle(() => 'Styleguide — Plainspace');

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <p class={styles.eyebrow}>UI System</p>
        <h1 class={styles.title}>Plainspace Styleguide</h1>
      </header>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Logo</h2>
        <div class={styles.logos}>
          <figure class={styles.logo}>
            <span class={styles.logoFrameBare}>
              <img src="/favicon.svg" alt="Plainspace mark" width="96" height="96" />
            </span>
            <figcaption>
              <strong>Mark</strong>
              <code>favicon.svg</code>
            </figcaption>
          </figure>
          <figure class={styles.logo}>
            <span class={styles.logoFrameRounded}>
              <img src="/icon.svg" alt="Plainspace app icon" width="96" height="96" />
            </span>
            <figcaption>
              <strong>App icon</strong>
              <code>icon.svg</code>
            </figcaption>
          </figure>
          <figure class={styles.logo}>
            <span class={styles.logoFrameMaskable}>
              <img src="/icon-maskable.svg" alt="Plainspace maskable icon" width="96" height="96" />
              <span class={styles.logoSafeZone} aria-hidden="true" />
            </span>
            <figcaption>
              <strong>Maskable</strong>
              <code>icon-maskable.svg</code>
            </figcaption>
          </figure>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Color Tokens</h2>
        <div class={styles.swatches}>
          <div class={styles.swatch}>
            <span class={styles.surfaceSwatch} />
            <strong>Surface</strong>
            <code>--color-surface</code>
          </div>
          <div class={styles.swatch}>
            <span class={styles.primarySwatch} />
            <strong>Primary</strong>
            <code>--color-primary</code>
          </div>
          <div class={styles.swatch}>
            <span class={styles.accentSwatch} />
            <strong>Accent</strong>
            <code>--color-accent</code>
          </div>
          <div class={styles.swatch}>
            <span class={styles.successSwatch} />
            <strong>Success</strong>
            <code>--color-success</code>
          </div>
          <div class={styles.swatch}>
            <span class={styles.warningSwatch} />
            <strong>Warning</strong>
            <code>--color-warning</code>
          </div>
          <div class={styles.swatch}>
            <span class={styles.dangerSwatch} />
            <strong>Danger</strong>
            <code>--color-danger</code>
          </div>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Buttons</h2>
        <div class={styles.row}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
          <IconDeleteButton label="Delete (demo)" onClick={() => undefined} />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Forms</h2>
        <FormCard class={styles.formDemo} onSubmit={(event) => event.preventDefault()}>
          <TextField id="styleguide-name" label="Space name" placeholder="Summer Trip Planning" />
          <TextField
            id="styleguide-purpose"
            label="One-line purpose"
            optionalText="(optional)"
            placeholder="Planning two weeks in Tuscany"
            helperText="Short copy works best in headers and link previews."
          />
          <Button type="submit">Create Space</Button>
        </FormCard>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Badges</h2>
        <div class={styles.row}>
          <Badge>neutral</Badge>
          <Badge variant="online">online</Badge>
          <Badge variant="role">admin</Badge>
          <Badge variant="warning">joining off</Badge>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Chips</h2>
        <p class={styles.helperText}>
          Pill buttons. Standalone they're one-tap actions; with <code>active</code> they form a
          single-select group (sets <code>aria-pressed</code>). Used in the reminder scheduler for
          quick presets, time-of-day, and recurrence.
        </p>
        <div class={styles.row}>
          <Chip>In 1 hour</Chip>
          <Chip>This evening</Chip>
          <Chip>Tomorrow 9 AM</Chip>
        </div>
        <div class={styles.row}>
          <For each={['Once', 'Daily', 'Mon–Fri', 'Weekly', 'Monthly']}>
            {(label) => (
              <Chip active={repeatDemo() === label} onClick={() => setRepeatDemo(label)}>
                {label}
              </Chip>
            )}
          </For>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Banners</h2>
        <p class={styles.helperText}>
          Inline notices that sit above page content. <code>info</code> for contextual prompts,{' '}
          <code>warning</code> for connection or attention states. An optional <code>icon</code>,{' '}
          <code>title</code>, and <code>action</code> stack full-width on mobile.
        </p>
        <div class={styles.bannerStack}>
          <Banner
            icon={<MailIcon />}
            action={
              <Button variant="secondary" size="sm">
                Add your email
              </Button>
            }
          >
            This browser can open this Space. Add an email to reopen it elsewhere.
          </Banner>
          <Banner variant="warning" icon={<WarningIcon />} title="Connection lost">
            Reconnecting… changes will sync once you're back online.
          </Banner>
          <Banner icon={<MailIcon />}>A minimal banner with just an icon and a message.</Banner>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Controls</h2>
        <SegmentedControl
          ariaLabel="Styleguide view mode"
          value={viewMode()}
          onChange={setViewMode}
          options={[
            { value: 'all', label: 'all' },
            { value: 'open', label: 'open' },
            { value: 'done', label: 'done' },
          ]}
        />
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Collapsible</h2>
        <p>
          Every card folds on one tap of its title row. An expanded card shows just the heading; a
          folded card surfaces a small gutter chevron and an optional count as a quiet “tap to
          expand” cue. <code>CollapseToggle</code> renders the heading (plus the chevron and count
          when folded); <code>CollapseBody</code> animates the body’s grid row 1fr→0fr. The state
          (from <code>createCollapsed(id)</code>) is a per-device preference persisted in
          localStorage.
        </p>
        <div class={styles.stack}>
          <CollapseToggle
            collapsed={demoCollapsed()}
            onToggle={() => setDemoCollapsed((v) => !v)}
            controls={demoCollapseBodyId}
            count={3}
          >
            <span style={{ 'font-family': 'var(--font-serif)', 'font-size': 'var(--text-xl)' }}>
              Demo panel
            </span>
          </CollapseToggle>
          <CollapseBody id={demoCollapseBodyId} collapsed={demoCollapsed()}>
            <p class={styles.helperText}>
              This body slides closed when the chevron is tapped. It stays mounted so component
              state is preserved, while the folded content becomes inert and hidden from assistive
              technology until it is expanded again.
            </p>
          </CollapseBody>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Actions Menu</h2>
        <p>
          A “⋯ more” trigger that opens a popover list of actions. Used in panel card headers for
          Rename / Delete (collapse is a separate header chevron, not a menu item). Items support
          optional icons and a <code>danger</code> variant. Opening focuses the first action; arrow
          keys, Home, and End move through the menu. Like every popover, tapping outside closes it
          and the tap is swallowed by a backdrop, so it can’t accidentally trigger the control
          underneath. The backdrop is visible on touch devices.
        </p>
        <div class={styles.row}>
          <Menu
            label="Demo actions"
            items={[
              {
                label: 'Rename',
                onSelect: () => setLastMenuAction('rename'),
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                ),
              },
              { label: 'Delete', onSelect: () => setLastMenuAction('delete'), danger: true },
            ]}
          />
          <span>
            last action: <code>{lastMenuAction()}</code>
          </span>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Inline Rename</h2>
        <p>
          A heading that becomes an editable field: focuses + selects on mount, commits on Enter or
          blur, cancels on Escape. The draft is local, so an external update can’t clobber
          in-progress typing. Used by panel card headers (Rename action).
        </p>
        <div class={styles.row}>
          <Show
            when={renamingDemo()}
            fallback={
              <button type="button" onClick={() => setRenamingDemo(true)}>
                {renameValue()} (click to rename)
              </button>
            }
          >
            <InlineRename
              value={renameValue()}
              ariaLabel="Rename demo"
              onCommit={(v) => {
                if (v) setRenameValue(v);
                setRenamingDemo(false);
              }}
              onCancel={() => setRenamingDemo(false)}
            />
          </Show>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Avatars</h2>
        <div class={styles.row}>
          <Avatar name={demoMembers[0].displayName} color={demoMembers[0].color} size="sm" />
          <Avatar name={demoMembers[0].displayName} color={demoMembers[0].color} size="md" />
          <Avatar name={demoMembers[0].displayName} color={demoMembers[0].color} size="lg" />
          <Avatar name={demoMembers[1].displayName} color={demoMembers[1].color} size="lg" online />
          <Avatar
            name={demoMembers[1].displayName}
            color={demoMembers[1].color}
            size="md"
            letters={1}
          />
          <Avatar name="+3" size="md">
            +3
          </Avatar>
          <Avatar name="Unknown" size="md" />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Member Chip</h2>
        <div class={styles.row}>
          <MemberChip member={demoMembers[0]} />
          <MemberChip member={demoMembers[1]} />
          <MemberChip member={demoMembers[0]} small />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Space Header</h2>
        <div class={styles.headerDemo}>
          <Header
            project={demoProject}
            members={demoMembers}
            presence={['m1']}
            slug={SLUG}
            myId="m1"
            myRole="admin"
            isCreator
          />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Mobile Quick Actions</h2>
        <p class={styles.helperText}>
          Floating pill rendered on mobile (≤ 760 px) over the project page. Tapping{' '}
          <strong>Task</strong> focuses the Add Item input; tapping <strong>Scratchpad</strong>{' '}
          scrolls to the scratchpad and flips it into edit mode in one tap. Shown inline here for
          documentation.
        </p>
        <div class={styles.quickActionsDemo}>
          <MobileQuickActions />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Add Item</h2>
        <AddItem slug={SLUG} listId="l1" />
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Tasks</h2>
        <div class={styles.stack}>
          <ListItem
            item={demoItems[0]}
            members={demoMembers}
            attachments={demoAttachments}
            slug={SLUG}
            myId="m1"
            onDelete={() => Promise.resolve(false)}
          />
          <ListItem
            item={demoItems[1]}
            members={demoMembers}
            attachments={demoAttachments}
            slug={SLUG}
            myId="m1"
            onDelete={() => Promise.resolve(false)}
          />
          <ListItem
            item={demoItems[2]}
            members={demoMembers}
            attachments={demoAttachments}
            slug={SLUG}
            myId="m1"
            onDelete={() => Promise.resolve(false)}
          />
          <ListItem
            item={demoItems[3]}
            members={demoMembers}
            attachments={demoAttachments}
            slug={SLUG}
            myId="m1"
            onDelete={() => Promise.resolve(false)}
          />
        </div>
        <p class={styles.helperText}>
          The checkbox is hand-drawn to match the heading underline: the resting box is a squircle
          ring (<code>--ring-hand</code>) and the checked state is a filled terracotta squircle (
          <code>--disc-hand</code>, <code>--color-primary</code>) with a hand check (
          <code>--check-hand</code>) — all masked so the ink stays themeable. On pointer devices the
          per-row action icons (reminder / assign / delete) stay hidden at rest and appear on row
          hover or keyboard focus; on touch they collapse into a single ⋯ button that opens a
          popover menu (Set reminder / Assign / Delete), while an assignee avatar or active reminder
          badge stays inline because it carries state — so the title keeps the row's width. The
          schedule button carries a glyph per state so it doesn't lean on colour alone: an empty
          button shows a <code>+</code> add affordance on hover, a repeating one the ↻ glyph, a
          resting one (checked, awaiting its next occurrence) a › before the time, and an overdue
          one (recurring fire passed while undone) a bold amber <code>!</code> — the third task is
          resting, the fourth overdue. The repeat <code>&lt;select&gt;</code> (Doesn't repeat /
          Daily / Weekly / Every 2 weeks / Monthly) lives in the reminder picker;
          byWeekday/byMonthDay are derived from the chosen fire time at commit, and the server owns
          the immutable anchor.
        </p>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Attachments</h2>
        <AttachmentList attachments={demoAttachments} slug={SLUG} />
        <div class={styles.row} style={{ 'margin-top': 'var(--space-sm)' }}>
          <AttachmentUpload slug={SLUG} itemId="i1" />
          <span class={styles.helperText}>
            Picker button (click to upload — disabled in styleguide context)
          </span>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Scratchpad</h2>
        <ScratchpadCard
          pad={demoScratchpad}
          members={demoMembers}
          editingMemberIds={[]}
          slug={SLUG}
          myId="m1"
        />
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Polls</h2>
        <div class={styles.stack}>
          <PollCard panel={demoPollUnvoted} members={demoMembers} slug={SLUG} myId="m1" />
          <PollCard panel={demoPollVoted} members={demoMembers} slug={SLUG} myId="m1" />
          <PollCard panel={demoPollEmpty} members={demoMembers} slug={SLUG} myId="m1" />
          <AddPanelButton slug={SLUG} />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>TimeSlots</h2>
        <div class={styles.stack}>
          <TimeSlotCard panel={demoTimeSlot} members={demoMembers} slug={SLUG} myId="m1" />
          <TimeSlotCard panel={demoTimeSlotEmpty} members={demoMembers} slug={SLUG} myId="m1" />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Checklists</h2>
        <div class={styles.stack}>
          <ChecklistCard
            panel={demoChecklist}
            items={demoChecklistItems}
            members={demoMembers}
            slug={SLUG}
            myId="m1"
          />
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Toasts</h2>
        <div class={styles.toastStack}>
          <Show
            when={toastVisible()}
            fallback={
              <Button variant="ghost" onClick={() => setToastVisible(true)}>
                Replay info toast
              </Button>
            }
          >
            <Toast
              message="Join link copied. Anyone with this link can join this Space."
              onDismiss={() => setToastVisible(false)}
              duration={60_000}
            />
          </Show>
          <Show
            when={toastWithAction()}
            fallback={
              <Button variant="ghost" onClick={() => setToastWithAction(true)}>
                Replay action toast
              </Button>
            }
          >
            <Toast
              message='"Book the venue" deleted'
              action={() => setToastWithAction(false)}
              actionLabel="Undo"
              onDismiss={() => setToastWithAction(false)}
              duration={60_000}
            />
          </Show>
        </div>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Recent Activity</h2>
        <ActivityFeed entries={demoActivity} members={demoMembers} slug={SLUG} hasMore={false} />
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Dialog</h2>
        <p class={styles.helperText}>
          Centered modal for confirmations and short flows. Side variant for navigation panels (e.g.{' '}
          <code>MemberList</code>) — side dialogs are flush; the calling component supplies its own
          internal padding.
        </p>
        <div class={styles.row}>
          <Button onClick={() => setCenterDialogOpen(true)}>Open center dialog</Button>
          <Button variant="secondary" onClick={() => setSideDialogOpen(true)}>
            Open side dialog
          </Button>
          <Button variant="danger" onClick={() => setConfirmDialogOpen(true)}>
            Open confirm dialog
          </Button>
        </div>
        <Show when={centerDialogOpen()}>
          <Dialog ariaLabel="Centered dialog example" onClose={() => setCenterDialogOpen(false)}>
            <h2 style={{ 'margin-top': 0 }}>Centered dialog</h2>
            <p>
              Default placement. Inherits <code>var(--space-lg)</code> padding,{' '}
              <code>max-width: 480px</code>, and pop-in animation. On mobile this slides up from the
              bottom as a sheet.
            </p>
            <div class={styles.row}>
              <Button variant="ghost" onClick={() => setCenterDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setCenterDialogOpen(false)}>Confirm</Button>
            </div>
          </Dialog>
        </Show>
        <Show when={sideDialogOpen()}>
          <Dialog
            ariaLabel="Side dialog example"
            placement="side"
            onClose={() => setSideDialogOpen(false)}
          >
            <div style={{ padding: 'var(--space-md)' }}>
              <h3 style={{ margin: 0 }}>Side dialog</h3>
              <p>
                Anchored to the right edge, full height. Padding here is supplied by the child (this{' '}
                <code>&lt;div&gt;</code>) — see the CSS comment on <code>.sideDialog</code>.
              </p>
              <Button onClick={() => setSideDialogOpen(false)}>Close</Button>
            </div>
          </Dialog>
        </Show>
        <Show when={confirmDialogOpen()}>
          <ConfirmDialog
            title="Delete “Reef Cleanup”?"
            message="ConfirmDialog replaces native confirm()/prompt(). The optional input collects free text passed to onConfirm; set input.confirmValue to require an exact typed match (shown here) before the confirm button enables — used for irreversible actions like deleting a Space."
            confirmLabel="Delete Space"
            danger
            input={{
              label: 'Space name',
              placeholder: 'Reef Cleanup',
              confirmValue: 'Reef Cleanup',
            }}
            onConfirm={() => setConfirmDialogOpen(false)}
            onCancel={() => setConfirmDialogOpen(false)}
          />
        </Show>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Legal Notice</h2>
        <div class={styles.stack}>
          <LegalNotice action="creating a Space" />
          <LegalNotice action="joining this Space" />
        </div>
      </section>
    </main>
  );
}
