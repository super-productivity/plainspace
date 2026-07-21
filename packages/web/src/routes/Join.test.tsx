import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';

// --- Boundary mocks -------------------------------------------------------
const { api, navigate, searchParams } = vi.hoisted(() => ({
  api: {
    getProjectInfo: vi.fn(),
    joinProject: vi.fn(),
    requestLoginCode: vi.fn(),
    verifyLoginCode: vi.fn(),
  },
  navigate: vi.fn(),
  searchParams: { value: {} as Record<string, string> },
}));

vi.mock('@solidjs/router', () => ({
  useParams: () => ({ slug: 'ghost-slug' }),
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams.value, vi.fn()],
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
  document.title = 'Previous page';
  searchParams.value = {};
});

describe('Join', () => {
  it('announces loading inside the main landmark', () => {
    api.getProjectInfo.mockReturnValue(new Promise(() => {}));

    render(() => <Join />);

    expect(document.title).toBe('Join a Space — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: /opening space/i })).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/loading space details/i);
    // aria-busy would tell AT to withhold exactly this message.
    expect(status.getAttribute('aria-busy')).toBeNull();
  });

  it('shows the not-found page (no join form) when the Space does not exist', async () => {
    api.getProjectInfo.mockRejectedValue(new ApiError(404, { error: 'Not found' }));

    render(() => <Join />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeTruthy();
    });
    expect(screen.queryByTestId('join-form')).toBeNull();
    expect(screen.queryByTestId('join-button')).toBeNull();
    expect(screen.getByRole('link', { name: /browse spaces/i }).getAttribute('href')).toBe(
      '/spaces',
    );
  });

  it('keeps the join form with an error on a non-404 failure', async () => {
    api.getProjectInfo.mockRejectedValue(new ApiError(500, { error: 'boom' }));

    render(() => <Join />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not load this space/i);
    expect(screen.getByTestId('join-form')).toBeTruthy();
  });

  it('renders the join form for an existing open Space', async () => {
    api.getProjectInfo.mockResolvedValue({ name: 'Weekend', sharingMode: 'open' });

    render(() => <Join />);

    await waitFor(() => {
      expect(screen.getByText(/join weekend/i)).toBeTruthy();
    });
    expect(document.title).toBe('Join Weekend — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('join-form')).toBeTruthy();
    const name = screen.getByTestId('join-display-name-input');
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.getAttribute('autocomplete')).toBe('name');
  });

  it('does not overwrite the next route title when loading finishes after unmount', async () => {
    let resolveProject!: (project: { name: string; sharingMode: 'open' }) => void;
    const request = new Promise<{ name: string; sharingMode: 'open' }>((resolve) => {
      resolveProject = resolve;
    });
    api.getProjectInfo.mockReturnValue(request);

    const { unmount } = render(() => <Join />);
    unmount();
    document.title = 'Next route — Plainspace';

    resolveProject({ name: 'Weekend', sharingMode: 'open' });
    await request;
    await Promise.resolve();

    expect(document.title).toBe('Next route — Plainspace');
  });

  it('focuses and announces each open-by-email step', async () => {
    api.getProjectInfo.mockResolvedValue({ name: 'Weekend', sharingMode: 'open' });
    api.requestLoginCode.mockResolvedValue({ message: 'sent' });
    render(() => <Join />);
    await screen.findByTestId('join-form');

    fireEvent.click(screen.getByTestId('recover-link'));
    const email = screen.getByTestId('recover-email-input');
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(email.getAttribute('autocomplete')).toBe('email');
    fireEvent.input(email, { target: { value: 'jo@example.com' } });
    fireEvent.click(screen.getByTestId('recover-email-button'));

    const code = await screen.findByTestId('recover-code-input');
    expect(document.activeElement).toBe(code);
    expect(screen.getByRole('status').textContent).toMatch(/check jo@example.com/i);
  });

  it('focuses recovery email after a query-driven recovery finishes loading', async () => {
    searchParams.value = { recover: '1' };
    api.getProjectInfo.mockResolvedValue({ name: 'Weekend', sharingMode: 'open' });

    render(() => <Join />);

    await screen.findByTestId('recover-email-form');
    expect(document.activeElement).toBe(screen.getByTestId('recover-email-input'));
  });

  it('associates a verification error with the recovery code field', async () => {
    api.getProjectInfo.mockResolvedValue({ name: 'Weekend', sharingMode: 'open' });
    api.requestLoginCode.mockResolvedValue({ message: 'sent' });
    api.verifyLoginCode.mockRejectedValue(new ApiError(400, { error: 'That code has expired.' }));

    render(() => <Join />);
    await screen.findByTestId('join-form');
    fireEvent.click(screen.getByTestId('recover-link'));
    fireEvent.input(screen.getByTestId('recover-email-input'), {
      target: { value: 'jo@example.com' },
    });
    fireEvent.click(screen.getByTestId('recover-email-button'));

    const input = await screen.findByTestId('recover-code-input');
    fireEvent.input(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('recover-verify-button'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That code has expired.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('announces a recovery failure without marking the code invalid', async () => {
    api.getProjectInfo.mockResolvedValue({ name: 'Weekend', sharingMode: 'open' });
    api.requestLoginCode.mockResolvedValue({ message: 'sent' });
    api.verifyLoginCode.mockRejectedValue(new ApiError(500, { error: 'Please try again later.' }));

    render(() => <Join />);
    await screen.findByTestId('join-form');
    fireEvent.click(screen.getByTestId('recover-link'));
    fireEvent.input(screen.getByTestId('recover-email-input'), {
      target: { value: 'jo@example.com' },
    });
    fireEvent.click(screen.getByTestId('recover-email-button'));

    const input = await screen.findByTestId('recover-code-input');
    fireEvent.input(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('recover-verify-button'));

    expect((await screen.findByRole('alert')).textContent).toBe('Please try again later.');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});
