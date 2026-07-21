import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import type { Member, Project } from '@plainspace/shared';

vi.mock('@solidjs/router', () => ({
  A: (props: {
    href: string;
    children?: JSX.Element;
    class?: string;
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <a
      href={props.href}
      class={props.class}
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
    >
      {props.children}
    </a>
  ),
}));

vi.mock('../members/MemberList', () => ({ default: () => null }));

import Header from './Header';

const project = {
  id: 'project-1',
  slug: 'weekend',
  name: 'Weekend away',
  purpose: 'Plan the trip',
  sharingMode: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Project;

const member = {
  id: 'member-1',
  projectId: 'project-1',
  displayName: 'Maya',
  color: '#123456',
  avatarIndex: 0,
  email: null,
  emailVerified: false,
  isCreator: true,
  role: 'admin',
  tosVersion: null,
  tosAcceptedAt: null,
  joinedAt: '2026-01-01T00:00:00.000Z',
} as Member;

function renderHeader() {
  render(() => (
    <Header
      project={project}
      members={[member]}
      presence={[]}
      slug="weekend"
      myId={member.id}
      myRole="admin"
      isCreator
    />
  ));
}

describe('Header', () => {
  beforeEach(() => {
    // Only `.matches` is read (the scroll handler's mobile check).
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers a dedicated route back to the Spaces overview', () => {
    renderHeader();

    const overview = screen.getByRole('link', { name: /spaces overview/i });
    expect(overview.getAttribute('href')).toBe('/spaces');
  });

  // Project's retry flow moves focus here once a reload succeeds, which only
  // works while the name stays a programmatically focusable page heading.
  it('exposes the Space name as a focusable page heading', () => {
    renderHeader();

    const heading = screen.getByRole('heading', { level: 1, name: 'Weekend away' });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(heading.getAttribute('data-testid')).toBe('project-name');
  });
});
