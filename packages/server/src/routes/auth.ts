import { Hono } from 'hono';
import { eq, ne, and, isNull, isNotNull, gt, lt, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { members, loginVerifications, projects } from '../db/schema.js';
import { TOS_VERSION } from '@plainspace/shared';
import { emailIndex, encryptedEmailFields } from '../lib/email-crypto.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { issueMemberToken, revokeMemberToken } from '../lib/member-tokens.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeMember, serializeProject } from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { sendVerificationCode } from '../services/email.js';
import { readJson } from '../lib/json.js';
import { checkRateLimit, getClientIp, rateLimitEmailKey } from '../lib/rate-limit.js';
import {
  CODE_EXPIRY_MS,
  CODE_REQUEST_WINDOW_MS,
  isValidCode,
  isValidEmail,
  generateCode,
} from '../lib/email-codes.js';

// Fail-closed: only relax rate limits and surface devCode when NODE_ENV is
// explicitly 'development'. Anything else (unset, 'staging', 'test', typos)
// runs as production so a misconfigured deploy can't leak codes.
const isDev = process.env.NODE_ENV === 'development';

export const authRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// DELETE /api/projects/:slug/auth/session - Revoke only the bearer session
// used for this request. Other devices keep their additive sessions.
authRoutes.delete('/session', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const tokenHash = c.get('memberTokenHash');

  // Order matters: revoke the token BEFORE disconnecting streams. The SSE
  // handler re-checks isSessionLive after registering (see sse.ts); that
  // re-check only closes the logout/connect race if the token is already gone
  // when a racing connect reaches it. Reordering these would reopen the race.
  await revokeMemberToken(tokenHash, member.id);
  sseManager.disconnectSession(project.id, tokenHash);
  return c.body(null, 204);
});

// POST /api/projects/:slug/auth/request-login-code - Email a recovery code if
// a verified member with this email exists in the Space. Returns the same
// generic message either way to avoid membership enumeration.
authRoutes.post('/request-login-code', async (c) => {
  const project = c.get('project');

  // Skip per-IP rate limiting in dev so the test suite can run multiple
  // recoveries in parallel from localhost.
  if (!isDev) {
    const ip = getClientIp(c);
    if (!checkRateLimit(`login-code-ip:${ip}`, 5, 10 * 60 * 1000)) {
      return c.json({ error: 'Too many requests, please try again later' }, 429);
    }
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const rawEmail = (body as { email?: string })?.email;
  if (!rawEmail || !isValidEmail(rawEmail)) {
    return c.json({ error: 'Invalid email' }, 422);
  }
  const email = rawEmail.toLowerCase();

  // Per-email rate limit, independent of IP, so a single email can't be spammed
  // even from a fresh IP per request.
  if (
    !checkRateLimit(
      `login-code-email:${project.id}:${rateLimitEmailKey(email)}`,
      1,
      CODE_REQUEST_WINDOW_MS,
    )
  ) {
    // Still return the generic message — the rate limit shouldn't leak
    // whether the email is known.
    return c.json({ message: 'If that email is connected to this Space, a code is on the way.' });
  }

  // Opportunistic cleanup keeps this table small.
  await db
    .delete(loginVerifications)
    .where(or(lt(loginVerifications.expiresAt, new Date()), isNotNull(loginVerifications.usedAt)));

  const lookup = emailIndex(email);
  const member = await db.query.members.findFirst({
    where: and(
      eq(members.projectId, project.id),
      eq(members.emailLookup, lookup),
      eq(members.emailVerified, true),
    ),
  });

  let issuedCode: string | null = null;
  if (member) {
    issuedCode = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

    // One active code per (project, email): drop any prior unused row so a
    // re-request always supersedes the previous attempt.
    await db
      .delete(loginVerifications)
      .where(
        and(
          eq(loginVerifications.projectId, project.id),
          eq(loginVerifications.emailLookup, lookup),
        ),
      );

    await db.insert(loginVerifications).values({
      projectId: project.id,
      ...encryptedEmailFields(email),
      code: issuedCode,
      expiresAt,
    });

    // Fire SMTP without awaiting so response time is independent of whether
    // the email matched a member. Awaiting is a timing oracle: in prod, the
    // network round-trip would be paid only on the known-email branch,
    // letting an attacker enumerate membership. In dev, sendVerificationCode
    // is a console.log so this is effectively synchronous either way.
    const codeForSend = issuedCode;
    void sendVerificationCode(email, codeForSend, project.name).catch(async (err) => {
      console.error('Failed to send login code', { projectId: project.id, err });
      // Drop the row so the user isn't locked out for the rate-limit window
      // with a code they never received. Best-effort.
      await db
        .delete(loginVerifications)
        .where(
          and(
            eq(loginVerifications.projectId, project.id),
            eq(loginVerifications.emailLookup, lookup),
          ),
        )
        .catch(() => {});
    });
  }

  return c.json({
    message: 'If that email is connected to this Space, a code is on the way.',
    ...(isDev && issuedCode ? { devCode: issuedCode } : {}),
  });
});

// POST /api/projects/:slug/auth/verify-login-code - Exchange the emailed code
// for a per-Space member token. Issues a NEW session (token) for this device
// without disturbing the member's existing sessions, so signing in here leaves
// the member's other devices logged in.
authRoutes.post('/verify-login-code', async (c) => {
  const project = c.get('project');

  if (!isDev) {
    const ip = getClientIp(c);
    if (!checkRateLimit(`login-verify-ip:${ip}`, 10, 10 * 60 * 1000)) {
      return c.json({ error: 'Too many attempts, please try again later' }, 429);
    }
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const rawEmail = (body as { email?: string })?.email;
  const code = (body as { code?: string })?.code;
  if (!rawEmail || !isValidEmail(rawEmail)) {
    return c.json({ error: 'Invalid email' }, 422);
  }
  if (!code || !isValidCode(code)) {
    return c.json({ error: 'Invalid code format' }, 422);
  }
  const email = rawEmail.toLowerCase();

  // Per-(project,email) attempt limiter so distributed guessing can't outscale
  // the IP limit. 5 attempts / 10 min leaves room for a legitimate user who
  // mistyped, while the 6-digit code (1M space) is unreachable.
  if (
    !isDev &&
    !checkRateLimit(
      `login-verify-email:${project.id}:${rateLimitEmailKey(email)}`,
      5,
      10 * 60 * 1000,
    )
  ) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }

  const lookup = emailIndex(email);
  const result = await db.transaction(async (tx) => {
    const verification = await tx.query.loginVerifications.findFirst({
      where: and(
        eq(loginVerifications.projectId, project.id),
        eq(loginVerifications.emailLookup, lookup),
        eq(loginVerifications.code, code),
        isNull(loginVerifications.usedAt),
        gt(loginVerifications.expiresAt, new Date()),
      ),
    });
    if (!verification) return null;

    const claimed = await tx
      .update(loginVerifications)
      .set({ usedAt: new Date() })
      .where(and(eq(loginVerifications.id, verification.id), isNull(loginVerifications.usedAt)))
      .returning({ id: loginVerifications.id });
    if (claimed.length === 0) return null;

    const member = await tx.query.members.findFirst({
      where: and(
        eq(members.projectId, project.id),
        eq(members.emailLookup, lookup),
        eq(members.emailVerified, true),
      ),
    });
    if (!member) return null;

    // Issue a NEW session for this device rather than rotating a single token —
    // this is why recovering on the phone no longer logs the laptop out.
    const plaintext = await issueMemberToken(tx, member.id);

    // One verification signs the person in everywhere on this device: issue a
    // session for every OTHER Space sharing this verified email too. Additive,
    // like the line above — it provisions this device without disturbing those
    // Spaces' existing sessions on other devices.
    const others = await tx
      .select({
        id: members.id,
        projectId: members.projectId,
        slug: projects.slug,
        name: projects.name,
      })
      .from(members)
      .innerJoin(projects, eq(members.projectId, projects.id))
      .where(
        and(
          eq(members.emailLookup, lookup),
          eq(members.emailVerified, true),
          ne(members.id, member.id),
        ),
      );

    const otherSpaces: {
      projectId: string;
      memberId: string;
      slug: string;
      name: string;
      token: string;
    }[] = [];
    for (const row of others) {
      const otherToken = await issueMemberToken(tx, row.id);
      otherSpaces.push({
        projectId: row.projectId,
        memberId: row.id,
        slug: row.slug,
        name: row.name,
        token: otherToken,
      });
    }

    return { member, token: plaintext, otherSpaces };
  });

  if (!result) {
    return c.json({ error: 'Invalid or expired code' }, 400);
  }

  // Sessions are additive: recovery issued NEW tokens (here and for every other
  // Space sharing the email) without touching existing ones, so there are no
  // stale sessions to disconnect and no presence change to broadcast — the
  // recovering device announces itself when it opens its own SSE stream.

  return c.json({
    member: serializeMember(result.member, result.member.id),
    token: result.token,
    otherSpaces: result.otherSpaces.map(({ slug, name, token, memberId }) => ({
      slug,
      name,
      token,
      memberId,
    })),
  });
});

// GET /api/projects/:slug/auth/my-spaces - Every Space the caller's verified
// email belongs to, so the people panel can list them on a device that only
// holds a local token for this one Space. Self-scoped: it only ever reveals
// Spaces for the authenticated member's own verified email, so it adds no
// enumeration surface.
authRoutes.get('/my-spaces', authMiddleware, async (c) => {
  const member = c.get('member');
  if (!member.emailVerified || !member.emailLookup) {
    return c.json({ spaces: [] });
  }
  const spaces = await db
    .select({ slug: projects.slug, name: projects.name })
    .from(members)
    .innerJoin(projects, eq(members.projectId, projects.id))
    .where(and(eq(members.emailLookup, member.emailLookup), eq(members.emailVerified, true)));
  return c.json({ spaces });
});

// GET /api/projects/:slug/auth/terms-status - Check whether current Terms/Privacy require acceptance
authRoutes.get('/terms-status', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  return c.json({
    project: serializeProject(project),
    terms: {
      currentVersion: TOS_VERSION,
      acceptedVersion: member.tosVersion,
      acceptedAt: member.tosAcceptedAt?.toISOString() ?? null,
      acceptanceRequired: member.tosVersion !== TOS_VERSION,
    },
  });
});

// POST /api/projects/:slug/auth/accept-terms - Accept current Terms/Privacy version
authRoutes.post('/accept-terms', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  const [updated] = await db
    .update(members)
    .set({ tosVersion: TOS_VERSION, tosAcceptedAt: new Date() })
    .where(and(eq(members.id, member.id), eq(members.projectId, project.id)))
    .returning();

  const serialized = serializeMember(updated, updated.id);
  void sseManager.broadcast(project.id, 'member.updated', { member: serializeMember(updated) });

  return c.json({ member: serialized });
});
