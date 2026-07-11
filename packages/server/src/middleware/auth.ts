import { createMiddleware } from 'hono/factory';
import { members } from '../db/schema.js';
import { sessionForToken } from '../lib/member-tokens.js';
import { TOS_VERSION } from '@plainspace/shared';
import type { ProjectContext } from './project.js';

export type AuthContext = {
  member: typeof members.$inferSelect;
  memberTokenHash: string;
  memberTokenExpiresAt: Date;
};

// Validates the bearer token, loads the member, and verifies that the member
// belongs to the project in context. Also enforces TOS acceptance, except for
// the routes that exist specifically to handle TOS state and self-deletion.
export const authMiddleware = createMiddleware<{
  Variables: ProjectContext & AuthContext;
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  // RFC 7235 §2.1: auth-scheme is case-insensitive. Accept "Bearer", "bearer",
  // "BEARER", etc. but require the scheme to be present (the old
  // .replace('Bearer ', '') silently accepted bare tokens).
  const token = header?.match(/^[Bb][Ee][Aa][Rr][Ee][Rr]\s+(\S+)$/)?.[1];

  if (!token) {
    return c.json({ error: 'Missing authentication token' }, 401);
  }

  const session = await sessionForToken(token);

  if (!session) {
    return c.json({ error: 'Invalid authentication token' }, 401);
  }
  const { member } = session;

  const project = c.get('project');
  if (!project || member.projectId !== project.id) {
    return c.json({ error: 'Not a member of this Space' }, 401);
  }

  const path = c.req.path;
  const method = c.req.method;
  const isTermsStatus = method === 'GET' && path.endsWith('/auth/terms-status');
  const isAcceptTerms = method === 'POST' && path.endsWith('/auth/accept-terms');
  const isSelfDeletion = method === 'DELETE' && path.endsWith('/members/me');
  // Exercising a data right (export) must not be gated on re-accepting terms.
  const isSelfExport = method === 'GET' && path.endsWith('/members/me/export');
  // Likewise, a creator erasing their whole Space is exercising an erasure
  // right — don't force them to accept new terms just to delete everything.
  const isDeleteSpace = method === 'DELETE' && path.endsWith('/auth/space');
  // Ending a session must remain available even while updated terms wait for
  // acceptance.
  const isSessionLogout = method === 'DELETE' && path.endsWith('/auth/session');

  if (
    member.tosVersion !== TOS_VERSION &&
    !isTermsStatus &&
    !isAcceptTerms &&
    !isSelfDeletion &&
    !isSelfExport &&
    !isDeleteSpace &&
    !isSessionLogout
  ) {
    return c.json(
      {
        error: 'Updated legal terms require acceptance',
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        terms: {
          currentVersion: TOS_VERSION,
          acceptedVersion: member.tosVersion,
          acceptedAt: member.tosAcceptedAt?.toISOString() ?? null,
          acceptanceRequired: true,
        },
      },
      428,
    );
  }

  c.set('member', member);
  c.set('memberTokenHash', session.tokenHash);
  c.set('memberTokenExpiresAt', session.expiresAt);
  await next();
});

// Single source of truth for "counts as admin": an explicit admin role OR the
// Space creator, who is implicitly admin even without the role flag. Used by
// requireAdmin and by resource-scoped checks (e.g. panel deletion) so the
// privilege definition can't drift between call sites.
export function isAdmin(member: typeof members.$inferSelect): boolean {
  return member.role === 'admin' || member.isCreator;
}

// Must run after authMiddleware. Treats creator as admin.
export const requireAdmin = createMiddleware<{
  Variables: AuthContext;
}>(async (c, next) => {
  const member = c.get('member');
  if (!isAdmin(member)) {
    return c.json({ error: 'Admin permission required' }, 403);
  }
  await next();
});

// Must run after authMiddleware. Stricter than requireAdmin: the Space creator
// only (e.g. assigning roles). Keep destructive/ownership-level operations
// behind this rather than re-deriving `member.isCreator` inline at call sites.
export const requireCreator = createMiddleware<{
  Variables: AuthContext;
}>(async (c, next) => {
  const member = c.get('member');
  if (!member.isCreator) {
    return c.json({ error: 'Only the creator can perform this action' }, 403);
  }
  await next();
});
