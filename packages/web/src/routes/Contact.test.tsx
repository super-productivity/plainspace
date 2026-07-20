import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

const { api } = vi.hoisted(() => ({
  api: { contact: vi.fn() },
}));

vi.mock('@solidjs/router', () => ({
  A: (props: { href: string; children?: JSX.Element }) => <a href={props.href}>{props.children}</a>,
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ApiError: actual.ApiError, api };
});

import Contact from './Contact';

beforeEach(() => {
  api.contact.mockReset();
  document.title = 'Previous page';
});

function fillRequiredFields() {
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'jo@example.com' } });
  fireEvent.input(screen.getByLabelText('Message'), { target: { value: 'Hello Plainspace' } });
}

describe('Contact', () => {
  it('sets page semantics and appropriate autofill tokens', () => {
    render(() => <Contact />);

    expect(document.title).toBe('Contact — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Contact' })).toBeTruthy();
    expect(screen.getByLabelText('Name (optional)').getAttribute('autocomplete')).toBe('name');
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email');
  });

  it('marks the form busy and announces a successful send', async () => {
    let resolveRequest!: () => void;
    api.contact.mockReturnValue(new Promise<void>((resolve) => (resolveRequest = resolve)));
    const { container } = render(() => <Contact />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    resolveRequest();

    expect((await screen.findByRole('status')).textContent).toBe('Message sent.');
  });

  it('announces an asynchronous submission error', async () => {
    api.contact.mockRejectedValue(new Error('offline'));
    render(() => <Contact />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('Could not send your message');
  });
});
