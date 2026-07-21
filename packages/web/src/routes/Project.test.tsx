import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { api, navigate, addToast, hasIdentity } = vi.hoisted(() => ({
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
  addToast: vi.fn(),
  hasIdentity: vi.fn(() => true),
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
  hasIdentity,
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
vi.mock('../lib/toast', () => ({ toasts: () => [], addToast, dismissToast: vi.fn() }));
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
  default: (props: { onDeleteItem: (itemId: string) => void }) => (
    <button data-testid="list-card" onClick={() => props.onDeleteItem('item-1')}>
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
import { resetState, setError } from '../lib/store';

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
  hasIdentity.mockReturnValue(true);
  document.title = 'Previous page';
  api.getTermsStatus.mockReturnValue(new Promise(() => {}));
  // Dialog's focus trap skips elements with no client rects, which jsdom always
  // reports as empty. Defined as an own property so afterEach can delete it and
  // fall back to Element.prototype's real (stubbed) implementation.
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as { getClientRects?: unknown }).getClientRects;
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

  // The project lands before the activity fetch, so `loading` drops while the
  // load is still running. Focus must not commit to the Space title until the
  // whole load settles, or a late activity failure strands it on a removed node.
  it('moves retry focus to the error when the load fails after the project arrives', async () => {
    api.getTermsStatus
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(acceptedTermsStatus);
    api.getProject.mockResolvedValueOnce(projectData());
    api.getActivity.mockRejectedValueOnce(new Error('activity down'));

    render(() => <Project />);

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('project-error-heading')),
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

  it('deletes an item through the API and offers an undo', async () => {
    mockLoadedProject([task]);
    api.deleteItem.mockResolvedValue(undefined);
    render(() => <Project />);

    fireEvent.click(await screen.findByTestId('list-card'));

    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith('weekend', 'item-1'));
    expect(addToast).toHaveBeenCalledWith('"Buy milk" deleted', expect.any(Function), 'Undo');
  });

  it('keeps the item and explains a failed deletion', async () => {
    mockLoadedProject([task]);
    api.deleteItem.mockRejectedValue(new Error('network'));
    render(() => <Project />);

    fireEvent.click(await screen.findByTestId('list-card'));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith('Could not delete the item. Please try again.'),
    );
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

  // The no-identity branch returns before any `await`, so the load's `finally`
  // runs synchronously inside the effect body. Reading `state.error` tracked
  // there would subscribe the *load* effect to it, and the next failure would
  // re-run the whole teardown -- aborting, disconnecting and navigating twice.
  it('does not subscribe the load effect to the store while settling retry focus', async () => {
    api.getTermsStatus.mockRejectedValueOnce(new Error('network'));
    render(() => <Project />);

    const retry = await screen.findByRole('button', { name: /try again/i });
    hasIdentity.mockReturnValue(false);
    fireEvent.click(retry);
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

    setError('boom');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
