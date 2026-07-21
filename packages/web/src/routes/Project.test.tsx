import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import type {
  ActivityFeedResponse,
  Item,
  Project as SpaceProject,
  ProjectLoadResponse,
} from '@plainspace/shared';
import type { TermsStatusResponse } from '../lib/api';

type Api = (typeof import('../lib/api'))['api'];

const { api, navigate, deleteResult } = vi.hoisted(() => ({
  api: {
    getTermsStatus: vi.fn<Api['getTermsStatus']>(),
    getProject: vi.fn<Api['getProject']>(),
    getActivity: vi.fn<Api['getActivity']>(),
    verifyLoginCode: vi.fn<Api['verifyLoginCode']>(),
    acceptTerms: vi.fn<Api['acceptTerms']>(),
    deleteItem: vi.fn<Api['deleteItem']>(),
    restoreItem: vi.fn<Api['restoreItem']>(),
  },
  navigate: vi.fn(),
  deleteResult: { current: undefined as boolean | undefined },
}));

vi.mock('@solidjs/router', () => ({
  useParams: () => ({ slug: 'weekend' }),
  useNavigate: () => navigate,
  A: (props: { href: string; children?: JSX.Element; class?: string }) => (
    <a href={props.href} class={props.class}>
      {props.children}
    </a>
  ),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ApiError: actual.ApiError, api };
});
vi.mock('../lib/identity', () => ({
  hasIdentity: () => true,
  savePlainspaceEmail: vi.fn(),
  saveVerifiedWitnessSlug: vi.fn(),
  parseClaim: () => null,
  parseLoginLink: () => null,
  saveIdentity: vi.fn(),
  setLastOpenSpace: vi.fn(),
  updateIdentityName: vi.fn(),
}));
vi.mock('../lib/member-identity', () => ({
  createMemberId: () => ({ myId: () => 'member-1', refresh: vi.fn() }),
}));
vi.mock('../lib/sse', () => ({
  connectSSE: vi.fn(),
  disconnectSSE: vi.fn(),
  handleUnauthorized: vi.fn(),
}));
vi.mock('../lib/toast', () => ({ toasts: () => [], addToast: vi.fn(), dismissToast: vi.fn() }));
vi.mock('../components/layout/Shell', () => ({
  default: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
}));
vi.mock('../components/layout/Header', () => ({
  default: (props: { project: { name: string } }) => (
    <header>
      <h1 tabindex="-1" data-testid="project-name">
        {props.project.name}
      </h1>
    </header>
  ),
}));
vi.mock('../components/layout/MobileQuickActions', () => ({ default: () => null }));
vi.mock('../components/onboarding/FirstShareNudge', () => ({ default: () => null }));
vi.mock('../components/lists/ListCard', () => ({
  default: (props: { onDeleteItem: (itemId: string) => Promise<boolean> }) => (
    <button
      data-testid="list-card"
      onClick={async () => {
        deleteResult.current = await props.onDeleteItem('item-1');
      }}
    >
      list
    </button>
  ),
}));
vi.mock('../components/scratchpads/ScratchpadCard', () => ({
  default: () => <button data-testid="scratchpad-card">scratchpad</button>,
}));
vi.mock('../components/panels/PanelColumn', () => ({
  default: () => <button data-testid="panel-column">panels</button>,
}));
vi.mock('../components/activity/ActivityFeed', () => ({
  default: () => <button data-testid="activity-feed">activity</button>,
}));
vi.mock('../components/shared/Toast', () => ({ default: () => null }));
vi.mock('../components/ui', async () => {
  const { default: Dialog } =
    await vi.importActual<typeof import('../components/ui/Dialog')>('../components/ui/Dialog');
  return {
    Banner: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
    Button: (props: {
      children?: JSX.Element;
      onClick?: () => void;
      disabled?: boolean;
      type?: 'button' | 'submit' | 'reset';
    }) => (
      <button
        type={props.type ?? 'button'}
        disabled={props.disabled}
        onClick={() => props.onClick?.()}
      >
        {props.children}
      </button>
    ),
    Dialog,
  };
});

import Project from './Project';
import { resetState } from '../lib/store';

const project: SpaceProject = {
  id: 'project-1',
  slug: 'weekend',
  name: 'Weekend',
  purpose: '',
  sharingMode: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const acceptedTermsStatus: TermsStatusResponse = {
  project,
  terms: {
    currentVersion: '2026-01-01',
    acceptedVersion: '2026-01-01',
    acceptedAt: '2026-01-01T00:00:00.000Z',
    acceptanceRequired: false,
  },
};

const requiredTermsStatus: TermsStatusResponse = {
  project,
  terms: {
    currentVersion: '2026-01-01',
    acceptedVersion: '2025-01-01',
    acceptedAt: '2025-01-01T00:00:00.000Z',
    acceptanceRequired: true,
  },
};

function projectData(items: Item[] = []): ProjectLoadResponse {
  return {
    project,
    list: {
      id: 'list-1',
      projectId: project.id,
      columns: null,
      createdBy: 'member-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    items,
    members: [
      {
        id: 'member-1',
        projectId: project.id,
        displayName: 'Maya',
        color: '#123456',
        avatarIndex: 0,
        email: 'maya@example.com',
        emailVerified: true,
        role: 'admin',
        isCreator: true,
        tosVersion: '2026-01-01',
        tosAcceptedAt: '2026-01-01T00:00:00.000Z',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    scratchpad: {
      id: 'scratchpad-1',
      projectId: project.id,
      content: '',
      updatedBy: null,
      createdBy: 'member-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    attachments: [],
    panels: [],
    terms: acceptedTermsStatus.terms,
  };
}

const activityData: ActivityFeedResponse = {
  entries: [
    {
      id: 'activity-1',
      projectId: project.id,
      memberId: 'member-1',
      action: 'item.created',
      targetType: 'item',
      targetId: 'item-1',
      meta: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  hasMore: false,
};

const task: Item = {
  id: 'item-1',
  listId: 'list-1',
  projectId: project.id,
  text: 'Buy milk',
  checked: false,
  checkedBy: null,
  assignedTo: null,
  columnId: 'c1',
  position: 1000,
  createdBy: 'member-1',
  remindAt: null,
  repeat: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockLoadedProject(items: Item[] = []) {
  api.getTermsStatus.mockResolvedValue(acceptedTermsStatus);
  api.getProject.mockResolvedValue(projectData(items));
  api.getActivity.mockResolvedValue(activityData);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(api)) mock.mockReset();
  resetState();
  document.title = 'Previous page';
  deleteResult.current = undefined;
  api.getTermsStatus.mockReturnValue(new Promise(() => {}));
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
});

describe('Project page structure', () => {
  it('announces the loading state and gives it a useful document title', () => {
    render(() => <Project />);

    expect(screen.getByRole('status', { name: /loading space/i }).getAttribute('tabindex')).toBe(
      '-1',
    );
    expect(document.title).toBe('Opening Space — Plainspace');
  });

  it('renders a meaningful error with a route back to Spaces', async () => {
    api.getTermsStatus.mockRejectedValueOnce(new Error('network'));

    render(() => <Project />);

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to load Space');
    expect(document.title).toBe('Couldn’t open Space — Plainspace');
    expect(screen.getByRole('link', { name: /back to spaces/i }).getAttribute('href')).toBe(
      '/spaces',
    );
  });

  it('retries the project load from the error state', async () => {
    let resolveProject!: (value: ReturnType<typeof projectData>) => void;
    api.getTermsStatus
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(acceptedTermsStatus);
    api.getProject.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProject = resolve;
      }),
    );
    api.getActivity.mockResolvedValue(activityData);

    render(() => <Project />);

    await screen.findByRole('heading', { name: /couldn’t open this space/i });
    const retry = screen.getByRole('button', { name: /try again/i });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(api.getTermsStatus).toHaveBeenCalledTimes(2));
    const loading = screen.getByRole('status', { name: /loading space/i });
    await waitFor(() => expect(document.activeElement).toBe(loading));

    resolveProject(projectData());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Weekend' })),
    );
  });

  it('leaves retry focus ownership with the terms dialog', async () => {
    let resolveTerms!: (value: typeof requiredTermsStatus) => void;
    api.getTermsStatus.mockRejectedValueOnce(new Error('network')).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTerms = resolve;
      }),
    );

    render(() => <Project />);

    await screen.findByRole('heading', { name: /couldn’t open this space/i });
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('status', { name: /loading space/i })),
    );
    resolveTerms(requiredTermsStatus);

    const dialog = await screen.findByRole('dialog', { name: 'Accept updated legal terms' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Terms' })),
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
    const heading = screen.getByTestId('terms-heading');
    expect(focusSpy.mock.contexts).not.toContain(heading);
    focusSpy.mockRestore();
  });

  it('gives the terms gate a page heading, title, and announced submission error', async () => {
    api.getTermsStatus.mockResolvedValue(requiredTermsStatus);
    api.acceptTerms.mockRejectedValue(new Error('network'));

    render(() => <Project />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Updated Legal Terms' }),
    ).toBeTruthy();
    expect(document.title).toBe('Accept updated legal terms — Plainspace');
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not accept the current legal terms',
    );
  });

  it('reports a confirmed item deletion back to the focused row', async () => {
    mockLoadedProject([task]);
    api.deleteItem.mockResolvedValue(undefined);
    render(() => <Project />);

    fireEvent.click(await screen.findByTestId('list-card'));

    await waitFor(() => expect(deleteResult.current).toBe(true));
    expect(api.deleteItem).toHaveBeenCalledWith('weekend', 'item-1');
  });

  it('reports a failed item deletion back to the focused row', async () => {
    mockLoadedProject([task]);
    api.deleteItem.mockRejectedValue(new Error('network'));
    render(() => <Project />);

    fireEvent.click(await screen.findByTestId('list-card'));

    await waitFor(() => expect(deleteResult.current).toBe(false));
  });

  it('keeps list, scratchpad and panels, then activity in DOM order inside the main landmark', async () => {
    mockLoadedProject();

    render(() => <Project />);

    await screen.findByTestId('list-card');
    const main = screen.getByRole('main');
    const ordered = Array.from(
      main.querySelectorAll(
        '[data-testid="list-card"], [data-testid="scratchpad-card"], [data-testid="panel-column"], [data-testid="activity-feed"]',
      ),
    ).map((element) => element.getAttribute('data-testid'));
    expect(ordered).toEqual(['list-card', 'scratchpad-card', 'panel-column', 'activity-feed']);
    expect(document.title).toBe('Weekend — Plainspace');
  });
});
