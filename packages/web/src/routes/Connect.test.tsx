import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { CODE_REQUEST_WINDOW_MS } from '@plainspace/shared';

// --- Boundary mocks -------------------------------------------------------
const { api, addToast, searchParams } = vi.hoisted(() => ({
  api: {
    getApiToken: vi.fn(),
    createApiToken: vi.fn(),
    requestCreationCode: vi.fn(),
    connect: vi.fn(),
    createProject: vi.fn(),
  },
  addToast: vi.fn(),
  // Mutable so a test can inject a ?return deep link.
  searchParams: { value: {} as Record<string, string> },
}));

vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [searchParams.value, vi.fn()],
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ApiError: actual.ApiError, api };
});

vi.mock('../lib/toast', () => ({ addToast }));

import Connect from './Connect';
import { ApiError } from '../lib/api';
import { saveIdentity, savePendingConnect, saveVerifiedWitnessSlug } from '../lib/identity';

function apiTokenMeta() {
  return {
    id: 't1',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 1e9).toISOString(),
  };
}

beforeEach(() => {
  document.title = 'Previous page';
  api.getApiToken.mockReset();
  api.createApiToken.mockReset();
  api.requestCreationCode.mockReset();
  api.connect.mockReset();
  api.createProject.mockReset();
  addToast.mockReset();
  searchParams.value = {};
});

function fill(testid: string, value: string) {
  fireEvent.input(screen.getByTestId(testid), { target: { value } });
}

// Drive the details → verify path and submit the code once on the verify screen.
async function reachVerifyAndSubmit(devCode = '123456') {
  api.requestCreationCode.mockResolvedValue({ message: 'sent', devCode });
  await screen.findByTestId('connect-details-form');
  fill('connect-name-input', 'Jo');
  fill('connect-email-input', 'jo@example.com');
  fireEvent.click(screen.getByTestId('connect-details-submit'));
  await screen.findByTestId('connect-verify-form');
  fireEvent.click(screen.getByTestId('connect-verify-submit'));
}

describe('Connect — resolver', () => {
  it('announces resolution progress inside the main landmark', () => {
    saveIdentity('abc', 'tok', 'm1', 'Space');
    api.getApiToken.mockReturnValue(new Promise(() => {}));

    render(() => <Connect />);

    expect(document.title).toBe('Connect Super Productivity — Plainspace');
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(
      screen.getByRole('heading', { level: 1, name: /connect super productivity/i }),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('resolves an empty device to the details form', async () => {
    render(() => <Connect />);
    expect(await screen.findByTestId('connect-details-form')).toBeTruthy();
    expect(document.title).toBe('Connect Super Productivity — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const name = screen.getByTestId('connect-name-input');
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.getAttribute('autocomplete')).toBe('name');
    expect(screen.getByTestId('connect-email-input').getAttribute('autocomplete')).toBe('email');
    expect(api.getApiToken).not.toHaveBeenCalled();
  });

  it('links each explainer toggle to its controlled region', async () => {
    render(() => <Connect />);
    await screen.findByTestId('connect-details-form');

    for (const testId of ['how-toggle', 'safe-toggle']) {
      const toggle = screen.getByTestId(testId);
      const controls = toggle.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls!)).toBeTruthy();
    }
  });

  it('focuses the code field when the verification step opens', async () => {
    api.requestCreationCode.mockResolvedValue({ message: 'sent' });
    render(() => <Connect />);
    await screen.findByTestId('connect-details-form');
    fill('connect-name-input', 'Jo');
    fill('connect-email-input', 'jo@example.com');
    fireEvent.click(screen.getByTestId('connect-details-submit'));

    const code = await screen.findByTestId('connect-code-input');
    expect(document.activeElement).toBe(code);
  });

  it('resumes a pending-connect straight to the verify step', async () => {
    savePendingConnect({ email: 'jo@example.com', step: 'verify', requestedAt: Date.now() });
    render(() => <Connect />);
    expect(await screen.findByTestId('connect-verify-form')).toBeTruthy();
    expect(screen.getByText(/jo@example.com/)).toBeTruthy();
  });

  it('shows the reconnect screen when a known Space already holds a key', async () => {
    saveIdentity('abc', 'tok', 'm1', 'Space');
    api.getApiToken.mockResolvedValue({ token: apiTokenMeta() });
    render(() => <Connect />);
    expect(await screen.findByTestId('connect-reconnect')).toBeTruthy();
    expect(screen.getByTestId('connect-regenerate')).toBeTruthy();
  });

  it('offers one-tap connect for a verified witness with no key yet', async () => {
    saveIdentity('w', 'tok', 'm', 'Witness');
    saveVerifiedWitnessSlug('w');
    api.getApiToken.mockResolvedValue({ token: null });
    render(() => <Connect />);
    expect(await screen.findByTestId('connect-onetap')).toBeTruthy();
    expect(api.getApiToken).toHaveBeenCalledWith('w');
  });

  it('recovers via known Spaces when the witness slug is stale (not brand-new)', async () => {
    // §10.8: a witness pointer with no local token must not block the warm path.
    saveVerifiedWitnessSlug('ghost'); // no identity saved for 'ghost'
    saveIdentity('real', 'tok', 'm1', 'Real');
    api.getApiToken.mockResolvedValue({ token: null });
    render(() => <Connect />);
    expect(await screen.findByTestId('connect-onetap')).toBeTruthy();
    expect(api.getApiToken).toHaveBeenCalledWith('real');
    expect(api.getApiToken).not.toHaveBeenCalledWith('ghost');
  });
});

describe('Connect — connect-or-create tail', () => {
  it('creates the first Space only when connect returns the no-account discriminator', async () => {
    api.connect.mockRejectedValue(new ApiError(404, { error: 'no account', code: 'no-account' }));
    api.createProject.mockResolvedValue({
      project: { slug: 'new1', name: "Jo's Plainspace" },
      member: { id: 'm1' },
      token: 'mtok',
    });
    api.createApiToken.mockResolvedValue({ token: 'pat_created', apiToken: apiTokenMeta() });

    render(() => <Connect />);
    await reachVerifyAndSubmit();

    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.connect).toHaveBeenCalledWith({ email: 'jo@example.com', code: '123456' });
    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Jo', email: 'jo@example.com', code: '123456' }),
    );
    expect((await screen.findByTestId('connect-key')).textContent).toBe('pat_created');
  });

  it('resumes a brand-new user with restored details so createProject has a valid displayName', async () => {
    // §Screen B regression: a mid-verify reload lands on the field-less verify
    // screen. Without the name/spaceName carried in the pending record, the
    // post-verify createProject would 422-loop on its required displayName.
    savePendingConnect({
      email: 'jo@example.com',
      step: 'verify',
      requestedAt: Date.now(),
      name: 'Jo',
      spaceName: 'Jo Space',
    });
    api.connect.mockRejectedValue(new ApiError(404, { error: 'no account', code: 'no-account' }));
    api.createProject.mockResolvedValue({
      project: { slug: 'new1', name: 'Jo Space' },
      member: { id: 'm1' },
      token: 'mtok',
    });
    api.createApiToken.mockResolvedValue({ token: 'pat_created', apiToken: apiTokenMeta() });

    render(() => <Connect />);
    // Resumes straight to verify (no details form); enter the code and submit.
    fill('connect-code-input', '123456');
    fireEvent.click(screen.getByTestId('connect-verify-submit'));

    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jo Space',
        displayName: 'Jo',
        email: 'jo@example.com',
        code: '123456',
      }),
    );
    expect((await screen.findByTestId('connect-key')).textContent).toBe('pat_created');
  });

  it('reveals a returning-user key without creating a Space', async () => {
    api.connect.mockResolvedValue({
      status: 'connected',
      token: 'pat_returning',
      email: 'jo@example.com',
      witness: { slug: 'w1', memberToken: 'mt', memberId: 'wm', projectName: 'W' },
    });

    render(() => <Connect />);
    await reachVerifyAndSubmit();

    expect((await screen.findByTestId('connect-key')).textContent).toBe('pat_returning');
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('does NOT create a Space on a bare 404 (only on code:no-account)', async () => {
    api.connect.mockRejectedValue(new ApiError(404, { error: 'gateway down' }));

    render(() => <Connect />);
    await reachVerifyAndSubmit();

    // Falls back to the verify screen with an error, never spawns a junk Space.
    await waitFor(() => expect(screen.getByTestId('connect-verify-form')).toBeTruthy());
    const input = screen.getByTestId('connect-code-input');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/could not connect/i);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('connect-code-helper');
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('associates a rejected verification code with the code field', async () => {
    api.connect.mockRejectedValue(
      new ApiError(401, { error: 'Invalid or expired verification code' }),
    );

    render(() => <Connect />);
    await reachVerifyAndSubmit();

    const input = await screen.findByTestId('connect-code-input');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/invalid or expired verification code/i);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('announces a resend failure without marking the code invalid', async () => {
    savePendingConnect({
      email: 'jo@example.com',
      step: 'verify',
      requestedAt: Date.now() - CODE_REQUEST_WINDOW_MS,
    });
    api.requestCreationCode.mockRejectedValue(new ApiError(429, { error: 'Too many requests' }));

    render(() => <Connect />);
    const input = await screen.findByTestId('connect-code-input');
    fireEvent.click(screen.getByTestId('connect-resend'));

    expect((await screen.findByRole('alert')).textContent).toMatch(/wait a moment/i);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('Connect — reveal gate', () => {
  async function reachReveal() {
    api.connect.mockResolvedValue({
      status: 'connected',
      token: 'pat_reveal',
      email: 'jo@example.com',
      witness: { slug: 'w1', memberToken: 'mt', memberId: 'wm', projectName: 'W' },
    });
    render(() => <Connect />);
    await reachVerifyAndSubmit();
    await screen.findByTestId('connect-key');
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: /connected this to your existing spaces/i }),
    );
  }

  it('keeps the finish gate closed on a failed copy, and tap-to-select opens it', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
      configurable: true,
    });
    await reachReveal();

    const finish = () => screen.getByTestId('connect-finish') as HTMLButtonElement;
    expect(finish().disabled).toBe(true);

    fireEvent.click(screen.getByTestId('connect-copy'));
    // §10.3: a rejected writeText must not open the gate.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/tap the key above to select it/);
    expect(finish().disabled).toBe(true);

    // Tap-to-select is an equal path that satisfies the gate.
    fireEvent.click(screen.getByTestId('connect-key'));
    await waitFor(() => expect(finish().disabled).toBe(false));
  });
});

describe('Connect — open your Space', () => {
  it('reveals a signed-in Space link (#claim hand-off) once the key is saved', async () => {
    api.connect.mockRejectedValue(new ApiError(404, { error: 'no account', code: 'no-account' }));
    api.createProject.mockResolvedValue({
      project: { slug: 'new1', name: "Jo's Plainspace" },
      member: { id: 'm1' },
      token: 'mtok',
    });
    api.createApiToken.mockResolvedValue({ token: 'pat_created', apiToken: apiTokenMeta() });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    render(() => <Connect />);
    await reachVerifyAndSubmit();
    await screen.findByTestId('connect-key');

    // Gated behind securing the key first, like the finish button.
    expect(screen.queryByTestId('connect-open-space')).toBeNull();
    fireEvent.click(screen.getByTestId('connect-copy'));

    // The link opens the new Space carrying this device's freshly-seeded
    // identity, so a fresh browser lands signed in instead of on the join form.
    const link = await screen.findByTestId('connect-open-space');
    fireEvent.click(link);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/new1#claim=mtok.m1'),
      '_blank',
      'noopener',
    );
    openSpy.mockRestore();
  });

  it('signs the device in on already-connected, so the reconnect screen can open the Space', async () => {
    // The returning-user hole: a valid code proves email ownership, so the server
    // now returns a witness session even when a key is already active. Seeding it
    // lets the reconnect screen offer a signed-in link instead of leaving the
    // user to find the Space and hit the join/username form.
    api.connect.mockResolvedValue({
      status: 'already-connected',
      apiToken: apiTokenMeta(),
      email: 'jo@example.com',
      witness: { slug: 'w9', memberToken: 'mt9', memberId: 'wm9', projectName: 'W9' },
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    render(() => <Connect />);
    await reachVerifyAndSubmit();
    await screen.findByTestId('connect-reconnect');

    const link = await screen.findByTestId('connect-open-space');
    fireEvent.click(link);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/w9#claim=mt9.wm9'),
      '_blank',
      'noopener',
    );
    openSpy.mockRestore();
  });
});

describe('Connect — reconnect + force', () => {
  it('never auto-mints on already-connected, then force-regenerates on confirm', async () => {
    api.connect
      .mockResolvedValueOnce({
        status: 'already-connected',
        apiToken: apiTokenMeta(),
        email: 'jo@example.com',
      })
      .mockResolvedValueOnce({
        status: 'connected',
        token: 'pat_forced',
        email: 'jo@example.com',
        witness: { slug: 'w1', memberToken: 'mt', memberId: 'wm', projectName: 'W' },
      });

    render(() => <Connect />);
    await reachVerifyAndSubmit();

    // Arrival shows the reconnect screen — no key minted yet.
    expect(await screen.findByTestId('connect-reconnect')).toBeTruthy();
    expect(screen.queryByTestId('connect-key')).toBeNull();

    fireEvent.click(screen.getByTestId('connect-regenerate'));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect((await screen.findByTestId('connect-key')).textContent).toBe('pat_forced');
    expect(api.connect).toHaveBeenLastCalledWith({
      email: 'jo@example.com',
      code: '123456',
      force: true,
    });
  });

  it('regenerates an already-connected+witness reconnect via force-connect, not createApiToken', async () => {
    // Regression: the witness slug set on already-connected must NOT route
    // regenerate through createApiToken (which skips the ToS refresh and hands a
    // stale-ToS user an inert key). With a held code present, regenerate must use
    // the account-level force mint.
    api.connect
      .mockResolvedValueOnce({
        status: 'already-connected',
        apiToken: apiTokenMeta(),
        email: 'jo@example.com',
        witness: { slug: 'w1', memberToken: 'mt', memberId: 'wm', projectName: 'W' },
      })
      .mockResolvedValueOnce({
        status: 'connected',
        token: 'pat_forced',
        email: 'jo@example.com',
        witness: { slug: 'w1', memberToken: 'mt2', memberId: 'wm', projectName: 'W' },
      });

    render(() => <Connect />);
    await reachVerifyAndSubmit();
    await screen.findByTestId('connect-reconnect');

    fireEvent.click(screen.getByTestId('connect-regenerate'));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect((await screen.findByTestId('connect-key')).textContent).toBe('pat_forced');
    expect(api.connect).toHaveBeenLastCalledWith({
      email: 'jo@example.com',
      code: '123456',
      force: true,
    });
    expect(api.createApiToken).not.toHaveBeenCalled();
  });
});
