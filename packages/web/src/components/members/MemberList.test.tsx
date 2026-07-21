import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import type { Member, Project } from '@plainspace/shared';

const { api } = vi.hoisted(() => ({
  api: {
    mySpaces: vi.fn().mockResolvedValue({ spaces: [] }),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    exportSelf: vi.fn(),
    logoutSession: vi.fn(),
    deleteSelf: vi.fn(),
    deleteSpace: vi.fn(),
  },
}));

vi.mock('@solidjs/router', () => ({
  useNavigate: () => vi.fn(),
  A: (props: { href: string; children?: JSX.Element; class?: string; 'data-testid'?: string }) => (
    <a href={props.href} class={props.class} data-testid={props['data-testid']}>
      {props.children}
    </a>
  ),
}));
vi.mock('../../lib/api', () => ({ api }));
vi.mock('../../lib/identity', () => ({
  clearIdentity: vi.fn(),
  clearPlainspaceEmail: vi.fn(),
  getPlainspaceEmail: () => '',
  hasIdentity: () => false,
  listKnownSpaces: () => [],
}));
vi.mock('../../lib/push', () => ({ clearPushSubscription: vi.fn() }));
vi.mock('../../lib/store', () => ({ updateMember: vi.fn() }));
vi.mock('../../lib/toast', () => ({ addToast: vi.fn() }));
vi.mock('./MemberChip', () => ({
  default: (props: { member: Member }) => <span>{props.member.displayName}</span>,
}));
vi.mock('./ApiTokens', () => ({ default: () => <button type="button">API tokens</button> }));
vi.mock('./DeviceLink', () => ({ default: () => <button type="button">Device link</button> }));
vi.mock('./EmailVerify', () => ({
  default: () => <input aria-label="Email address" />,
}));
vi.mock('./SharingModeControl', () => ({
  default: () => <button type="button">Sharing control</button>,
}));
vi.mock('./SpaceDetailsControl', () => ({
  default: () => <button type="button">Space details</button>,
}));

import MemberList from './MemberList';

const project = {
  id: 'project-1',
  slug: 'weekend',
  name: 'Weekend',
  purpose: '',
  sharingMode: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Project;

const member = {
  id: 'member-1',
  projectId: 'project-1',
  displayName: 'Maya',
  color: '#123456',
  avatarIndex: 0,
  email: null,
  emailVerified: false,
  isCreator: true,
  role: 'admin',
  tosVersion: null,
  tosAcceptedAt: null,
  joinedAt: '2026-01-01T00:00:00.000Z',
} as Member;

function renderPanel(focusEmailVerification = false, currentMember = member) {
  return render(() => (
    <MemberList
      project={project}
      members={[currentMember]}
      presence={[currentMember.id]}
      myId={currentMember.id}
      myRole="admin"
      isCreator
      slug="weekend"
      focusEmailVerification={focusEmailVerification}
      onClose={vi.fn()}
    />
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('MemberList progressive disclosure', () => {
  it('shows People first and keeps account, Space settings, and Advanced collapsed initially', () => {
    renderPanel();

    const panel = screen.getByTestId('member-list-panel');
    // One "People" heading for the whole panel — the roster needs no second one.
    const peopleHeadings = screen.getAllByRole('heading', { name: /people/i });
    expect(peopleHeadings).toHaveLength(1);
    expect(peopleHeadings[0].tagName).toBe('H2');
    expect(peopleHeadings[0].textContent).toContain('· 1 online');
    // ...and the roster is still what the panel opens on.
    const firstSection = panel.querySelector('section');
    expect(within(firstSection as HTMLElement).getByTestId('member-row')).toBeTruthy();

    const accountToggle = screen.getByTestId('account-toggle-button');
    const settingsToggle = screen.getByTestId('space-settings-toggle-button');
    const advancedToggle = screen.getByTestId('advanced-toggle-button');
    expect(accountToggle.getAttribute('aria-expanded')).toBe('false');
    expect(settingsToggle.getAttribute('aria-expanded')).toBe('false');
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByTestId('account-body') as HTMLElement).hidden).toBe(true);
    expect((screen.getByTestId('space-settings-body') as HTMLElement).hidden).toBe(true);

    fireEvent.click(accountToggle);
    fireEvent.click(settingsToggle);
    expect((screen.getByTestId('account-body') as HTMLElement).hidden).toBe(false);
    expect((screen.getByTestId('space-settings-body') as HTMLElement).hidden).toBe(false);
  });

  it('opens the account disclosure when email verification requested it', () => {
    renderPanel(true);

    expect(screen.getByTestId('account-toggle-button').getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByTestId('account-body') as HTMLElement).hidden).toBe(false);
  });

  it('does not load verified account Spaces while the account disclosure is closed', () => {
    renderPanel(false, { ...member, emailVerified: true });

    expect(api.mySpaces).not.toHaveBeenCalled();
  });

  it('loads verified account Spaces on the first disclosure expansion', () => {
    renderPanel(false, { ...member, emailVerified: true });

    fireEvent.click(screen.getByTestId('account-toggle-button'));

    expect(api.mySpaces).toHaveBeenCalledOnce();
    expect(api.mySpaces).toHaveBeenCalledWith('weekend');
  });

  it('does not reload account Spaces after closing and reopening the disclosure', () => {
    renderPanel(false, { ...member, emailVerified: true });
    const accountToggle = screen.getByTestId('account-toggle-button');

    fireEvent.click(accountToggle);
    fireEvent.click(accountToggle);
    fireEvent.click(accountToggle);

    expect(api.mySpaces).toHaveBeenCalledOnce();
  });

  it('loads account Spaces when an open disclosure becomes email-verified', async () => {
    const [currentMember, setCurrentMember] = createSignal(member);
    render(() => (
      <MemberList
        project={project}
        members={[currentMember()]}
        presence={[member.id]}
        myId={member.id}
        myRole="admin"
        isCreator
        slug="weekend"
        focusEmailVerification
        onClose={vi.fn()}
      />
    ));

    expect(screen.getByTestId('account-toggle-button').getAttribute('aria-expanded')).toBe('true');
    expect(api.mySpaces).not.toHaveBeenCalled();

    setCurrentMember({ ...member, emailVerified: true });

    await waitFor(() => expect(api.mySpaces).toHaveBeenCalledOnce());
  });
});
