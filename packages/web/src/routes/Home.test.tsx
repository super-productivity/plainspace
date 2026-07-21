import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'solid-js';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

// --- Boundary mocks -------------------------------------------------------
// vi.mock is hoisted above the module body, so the spies it closes over must be
// created via vi.hoisted to exist by the time the factories run.
const { navigate, api } = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: {
    getProjectSummary: vi.fn(),
    createProject: vi.fn(),
    requestCreationCode: vi.fn(),
    findSpaces: vi.fn(),
  },
}));

// Router: a real navigate spy + a stub <A>; pathname '/' with no known Space
// means onMount won't redirect.
vi.mock('@solidjs/router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/' }),
  A: (props: { href: string; children?: JSX.Element; [k: string]: unknown }) => <a {...props} />,
}));

// API: stub the handful of calls Home makes; keep the real ApiError so the
// component's `instanceof ApiError` branches still work.
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ApiError: actual.ApiError, api };
});

import Home from './Home';
import { ApiError } from '../lib/api';
import { saveIdentity, savePlainspaceEmail, saveVerifiedWitnessSlug } from '../lib/identity';

beforeEach(() => {
  document.title = 'Previous page';
  navigate.mockReset();
  api.getProjectSummary.mockReset();
  api.createProject.mockReset();
  api.requestCreationCode.mockReset();
  api.findSpaces.mockReset();
});

function fill(testid: string, value: string) {
  const el = screen.getByTestId(testid) as HTMLInputElement;
  fireEvent.input(el, { target: { value } });
}

describe('Home — first visit', () => {
  it('sets a route-specific title and exposes one main page heading', () => {
    render(() => <Home />);

    expect(document.title).toBe('Plainspace — Simple shared spaces');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Plainspace' })).toBeTruthy();
  });

  it('leaves focus at the document start on first paint', async () => {
    render(() => <Home />);

    // Focus only follows a view *change*; stealing it on load would scroll the
    // heading into view and undo the browser's scroll restoration.
    await waitFor(() => expect(screen.getByTestId('onboarding-choice')).toBeTruthy());
    expect(document.activeElement).toBe(document.body);
  });

  it('offers the onboarding choice when no Spaces are known', () => {
    const { container } = render(() => <Home />);
    expect(screen.getByTestId('onboarding-choice')).toBeTruthy();
    expect(screen.queryByTestId('known-spaces')).toBeNull();
    expect(container.querySelector('main')).toBeTruthy();
  });

  it('returns focus to the page heading when leaving a form', async () => {
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-login-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    const heading = screen.getByRole('heading', { level: 1, name: 'Plainspace' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});

describe('Home — create flow', () => {
  it('focuses and identifies the first fields when a form step opens', async () => {
    let resolveCodeRequest!: (result: { message: string }) => void;
    api.requestCreationCode.mockReturnValue(
      new Promise((resolve) => {
        resolveCodeRequest = resolve;
      }),
    );
    render(() => <Home />);

    fireEvent.click(screen.getByTestId('show-create-button'));
    const projectName = screen.getByTestId('project-name-input');
    await waitFor(() => expect(document.activeElement).toBe(projectName));
    expect(screen.getByTestId('display-name-input').getAttribute('autocomplete')).toBe('name');
    expect(screen.getByTestId('email-input').getAttribute('autocomplete')).toBe('email');

    fill('project-name-input', 'Summer Trip');
    fill('display-name-input', 'Jo');
    fill('email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('create-project-button'));
    resolveCodeRequest({ message: 'sent' });

    const code = await screen.findByTestId('verify-code-input');
    expect(document.activeElement).toBe(code);
  });

  it('gates the Continue button until name, display name, and email are present', () => {
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));

    const submit = screen.getByTestId('create-project-button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fill('project-name-input', 'Summer Trip');
    fill('display-name-input', 'Jo');
    expect(submit.disabled).toBe(true); // email still missing
    fill('email-input', 'jo@example.com');
    expect(submit.disabled).toBe(false);
  });

  it('requests a code and advances to the verify step when no proof token exists', async () => {
    api.requestCreationCode.mockResolvedValue({ message: 'sent', devCode: '123456' });
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));

    fill('project-name-input', 'Summer Trip');
    fill('display-name-input', 'Jo');
    fill('email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('create-project-button'));

    await waitFor(() => expect(screen.getByTestId('verify-code-form')).toBeTruthy());
    expect(api.requestCreationCode).toHaveBeenCalledWith({ email: 'jo@example.com' });
    expect(api.createProject).not.toHaveBeenCalled();
    // Dev code is echoed into the field so the e2e/dev flow can submit at once.
    expect((screen.getByTestId('verify-code-input') as HTMLInputElement).value).toBe('123456');
  });

  it('creates the Space and navigates once the 6-digit code is entered', async () => {
    api.requestCreationCode.mockResolvedValue({ message: 'sent' });
    api.createProject.mockResolvedValue({
      project: { slug: 'abc123', name: 'Summer Trip' },
      member: { id: 'm1' },
      token: 'tok',
    });
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));
    fill('project-name-input', 'Summer Trip');
    fill('display-name-input', 'Jo');
    fill('email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('create-project-button'));

    await waitFor(() => expect(screen.getByTestId('verify-code-form')).toBeTruthy());
    fill('verify-code-input', '654321');
    fireEvent.click(screen.getByTestId('verify-code-button'));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Summer Trip', email: 'jo@example.com', code: '654321' }),
      ),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/abc123'));
  });

  it('skips the code step when this browser already holds a proof token for the email', async () => {
    // A prior verified Space backs the saved email — its token proves control.
    saveIdentity('witness', 'witness-token', 'wm1', 'Witness');
    saveVerifiedWitnessSlug('witness');
    savePlainspaceEmail('jo@example.com');
    // onMount fetches a summary for the witness Space. Reject with a plain Error
    // (NOT an ApiError 404/401) so the catch in Home.tsx leaves the identity in
    // place — a cleared witness would drop the proof token under test.
    api.getProjectSummary.mockRejectedValue(new Error('offline'));
    api.createProject.mockResolvedValue({
      project: { slug: 'new1', name: 'Trip' },
      member: { id: 'm2' },
      token: 'tok2',
    });

    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));
    fill('project-name-input', 'Trip');
    fill('display-name-input', 'Jo');
    // email is prefilled from the saved address; submit straight away.
    fireEvent.click(screen.getByTestId('create-project-button'));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ proofToken: 'witness-token' }),
      ),
    );
    expect(api.requestCreationCode).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/new1'));
  });

  it('falls back to the emailed code when the proof token is rejected (rotated)', async () => {
    saveIdentity('witness', 'stale-token', 'wm1', 'Witness');
    saveVerifiedWitnessSlug('witness');
    savePlainspaceEmail('jo@example.com');
    api.getProjectSummary.mockRejectedValue(new Error('offline'));
    // Proof token no longer accepted -> server answers 401; the flow must not
    // surface an error, it should drop through to the code request instead.
    api.createProject.mockRejectedValue(new ApiError(401, { error: 'proof rejected' }));
    api.requestCreationCode.mockResolvedValue({ message: 'sent', devCode: '111111' });

    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));
    fill('project-name-input', 'Trip');
    fill('display-name-input', 'Jo');
    fireEvent.click(screen.getByTestId('create-project-button'));

    await waitFor(() => expect(screen.getByTestId('verify-code-form')).toBeTruthy());
    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ proofToken: 'stale-token' }),
    );
    expect(api.requestCreationCode).toHaveBeenCalledWith({ email: 'jo@example.com' });
  });

  it('associates a rejected verification code with the code field', async () => {
    api.requestCreationCode.mockResolvedValue({ message: 'sent' });
    api.createProject.mockRejectedValue(
      new ApiError(401, { error: 'Invalid or expired verification code' }),
    );
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));
    fill('project-name-input', 'Summer Trip');
    fill('display-name-input', 'Jo');
    fill('email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('create-project-button'));

    const input = await screen.findByTestId('verify-code-input');
    fill('verify-code-input', '654321');
    fireEvent.click(screen.getByTestId('verify-code-button'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Invalid or expired verification code');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('announces a creation failure without marking the code invalid', async () => {
    api.requestCreationCode.mockResolvedValue({ message: 'sent' });
    api.createProject.mockRejectedValue(new ApiError(500, { error: 'Please try again later.' }));
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-create-button'));
    fill('project-name-input', 'Summer Trip');
    fill('display-name-input', 'Jo');
    fill('email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('create-project-button'));

    const input = await screen.findByTestId('verify-code-input');
    fill('verify-code-input', '654321');
    fireEvent.click(screen.getByTestId('verify-code-button'));

    expect((await screen.findByRole('alert')).textContent).toBe('Please try again later.');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('Home — find my Spaces', () => {
  it('sends the recovery email and drops the button into a cooldown', async () => {
    api.findSpaces.mockResolvedValue({ message: 'Check your inbox.' });
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-login-button'));

    fill('find-email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('find-email-button'));

    await waitFor(() => expect(api.findSpaces).toHaveBeenCalledWith({ email: 'jo@example.com' }));
    await waitFor(() => expect(screen.getByText('Check your inbox.')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Check your inbox.');
    const button = screen.getByTestId('find-email-button') as HTMLButtonElement;
    await waitFor(() => expect(button.textContent).toMatch(/Send again in/));
    expect(button.disabled).toBe(true);
  });

  it('announces a lookup failure without marking the email invalid', async () => {
    api.findSpaces.mockRejectedValue(new ApiError(429, { error: 'Please wait and try again.' }));
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-login-button'));

    const input = screen.getByTestId('find-email-input');
    fill('find-email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('find-email-button'));

    expect((await screen.findByRole('alert')).textContent).toBe('Please wait and try again.');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('Home — open a Space link', () => {
  it('navigates to the slug parsed from a pasted link', () => {
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-open-button'));

    expect(screen.getByTestId('space-link-input').getAttribute('autocomplete')).toBe('off');
    fill('space-link-input', 'https://plainspace.org/abc123');
    fireEvent.submit(screen.getByTestId('open-space-form'));

    expect(navigate).toHaveBeenCalledWith('/abc123');
  });

  it('shows an error and does not navigate when the link has no slug', () => {
    render(() => <Home />);
    fireEvent.click(screen.getByTestId('show-open-button'));

    fill('space-link-input', 'https://plainspace.org/');
    fireEvent.submit(screen.getByTestId('open-space-form'));

    expect(navigate).not.toHaveBeenCalled();
    const input = screen.getByTestId('space-link-input');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Enter a Space link/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });
});

describe('Home — known Spaces', () => {
  it('lists a saved Space and hydrates its members from the summary', async () => {
    saveIdentity('abc123', 'tok', 'm1', 'Summer Trip');
    api.getProjectSummary.mockResolvedValue({
      name: 'Summer Trip',
      purpose: '',
      members: [
        { id: 'm1', displayName: 'Jo', color: '#111' },
        { id: 'm2', displayName: 'Sam', color: '#222' },
      ],
    });

    render(() => <Home />);
    expect(await screen.findByTestId('known-spaces')).toBeTruthy();
    expect(screen.getByText('Summer Trip')).toBeTruthy();
    await waitFor(() => expect(api.getProjectSummary).toHaveBeenCalledWith('abc123'));
  });
});
