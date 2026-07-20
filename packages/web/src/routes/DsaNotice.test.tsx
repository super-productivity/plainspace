import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

const { api } = vi.hoisted(() => ({
  api: { submitDsaNotice: vi.fn() },
}));

vi.mock('@solidjs/router', () => ({
  A: (props: { href: string; children?: JSX.Element }) => <a href={props.href}>{props.children}</a>,
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ApiError: actual.ApiError, api };
});

import DsaNotice from './DsaNotice';

beforeEach(() => {
  api.submitDsaNotice.mockReset();
  document.title = 'Previous page';
});

function fillRequiredFields() {
  fireEvent.input(screen.getByLabelText('Where is the content?'), {
    target: { value: 'https://plainspace.org/example/item/1' },
  });
  fireEvent.input(screen.getByLabelText('Why is this content illegal?'), {
    target: { value: 'This is a sufficiently detailed legal explanation.' },
  });
  fireEvent.input(screen.getByLabelText('Your email'), { target: { value: 'jo@example.com' } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('DsaNotice', () => {
  it('sets page semantics and appropriate autofill tokens', () => {
    render(() => <DsaNotice />);

    expect(document.title).toBe('Report illegal content (DSA Art. 16) — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Report illegal content (DSA Art. 16)' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Your name (optional)').getAttribute('autocomplete')).toBe('name');
    expect(screen.getByLabelText('Your email').getAttribute('autocomplete')).toBe('email');
  });

  it('announces a successful notice submission', async () => {
    api.submitDsaNotice.mockResolvedValue({ noticeId: 'notice-123' });
    render(() => <DsaNotice />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Submit notice' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/notice received/i);
    expect(status.textContent).toContain('notice-123');
  });

  it('announces an asynchronous submission error', async () => {
    api.submitDsaNotice.mockRejectedValue(new Error('offline'));
    render(() => <DsaNotice />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Submit notice' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('Could not submit your notice');
  });
});
