import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

vi.mock('@solidjs/router', () => ({
  A: (props: { href: string; children?: JSX.Element }) => <a href={props.href}>{props.children}</a>,
}));

import Styleguide from './Styleguide';

describe('Styleguide', () => {
  it('sets its document title and exposes a main page heading', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    document.title = 'Previous page';
    render(() => <Styleguide />);

    expect(document.title).toBe('Styleguide — Plainspace');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Plainspace Styleguide' })).toBeTruthy();
    const collapseToggle = screen.getByRole('button', { name: /demo panel/i });
    const controls = collapseToggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeTruthy();
  });
});
