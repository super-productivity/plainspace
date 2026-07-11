import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';

// --- Boundary mocks -------------------------------------------------------
const { api, navigate } = vi.hoisted(() => ({
  api: {
    getProjectInfo: vi.fn(),
    joinProject: vi.fn(),
    requestLoginCode: vi.fn(),
    verifyLoginCode: vi.fn(),
  },
  navigate: vi.fn(),
}));

vi.mock('@solidjs/router', () => ({
  useParams: () => ({ slug: 'ghost-slug' }),
  useNavigate: () => navigate,
  useSearchParams: () => [{}, vi.fn()],
  A: (props: { href: string; children?: JSX.Element }) => <a href={props.href}>{props.children}</a>,
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ApiError: actual.ApiError, api };
});

import Join from './Join';
import { ApiError } from '../lib/api';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Join', () => {
  it('shows the not-found page (no join form) when the Space does not exist', async () => {
    api.getProjectInfo.mockRejectedValue(new ApiError(404, { error: 'Not found' }));

    render(() => <Join />);

    await waitFor(() => {
      expect(screen.getByText(/this space doesn't exist/i)).toBeTruthy();
    });
    expect(screen.queryByTestId('join-form')).toBeNull();
    expect(screen.queryByTestId('join-button')).toBeNull();
    expect(screen.getByRole('link', { name: /create a new space/i })).toBeTruthy();
  });

  it('keeps the join form with an error on a non-404 failure', async () => {
    api.getProjectInfo.mockRejectedValue(new ApiError(500, { error: 'boom' }));

    render(() => <Join />);

    await waitFor(() => {
      expect(screen.getByText(/could not load this space/i)).toBeTruthy();
    });
    expect(screen.getByTestId('join-form')).toBeTruthy();
  });

  it('renders the join form for an existing open Space', async () => {
    api.getProjectInfo.mockResolvedValue({ name: 'Weekend', sharingMode: 'open' });

    render(() => <Join />);

    await waitFor(() => {
      expect(screen.getByText(/join weekend/i)).toBeTruthy();
    });
    expect(screen.getByTestId('join-form')).toBeTruthy();
  });
});
