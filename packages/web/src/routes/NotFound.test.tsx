import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

vi.mock('@solidjs/router', () => ({
  A: (props: { href: string; children?: JSX.Element }) => <a href={props.href}>{props.children}</a>,
}));

import NotFound from './NotFound';

describe('NotFound', () => {
  it('sets the page title and exposes the error as the main heading', () => {
    document.title = 'Previous page';

    render(() => <NotFound />);

    expect(document.title).toBe('Page not found — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse Spaces' }).getAttribute('href')).toBe(
      '/spaces',
    );
  });
});
