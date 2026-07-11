import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TOS_VERSION } from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { loginVerifications, members, memberTokens } from '../db/schema.js';
import { hashToken } from '../lib/crypto.js';
import { isSessionLive } from '../lib/member-tokens.js';
import { encryptedEmailFields } from '../lib/email-crypto.js';
import { createProject } from '../../test/helpers.js';

const app = createApp();

// getClientIp() reads node-server connection info that app.request() doesn't
// populate; supply a stub so the rate-limit IP lookup resolves.
const connEnv = {
  incoming: { socket: { remoteAddress: '127.0.0.1', remotePort: 1234, remoteFamily: 'IPv4' } },
} as unknown as Parameters<typeof app.request>[2];

// A verified member with a KNOWN bearer token, so the test can both recover its
// email and check whether that pre-existing token still authenticates.
async function verifiedMemberWithToken(
  projectId: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const token = randomBytes(16).toString('hex');
  const [row] = await db
    .insert(members)
    .values({
      projectId,
      displayName: 'Owner',
      color: '#000000',
      avatarIndex: 0,
      ...encryptedEmailFields(email),
      emailVerified: true,
      tosVersion: TOS_VERSION,
      tosAcceptedAt: new Date(),
    })
    .returning();
  await db.insert(memberTokens).values({ tokenHash: hashToken(token), memberId: row.id });
  return { id: row.id, token };
}

// terms-status is the cheapest authenticated GET; a 200 means the token is live.
async function authed(slug: string, token: string): Promise<Response> {
  return app.request(
    `/api/projects/${slug}/auth/terms-status`,
    { headers: { Authorization: `Bearer ${token}` } },
    connEnv,
  );
}

describe('POST /api/projects/:slug/auth/verify-login-code — additive sessions', () => {
  it('issues a new session without invalidating the existing one (no cross-device logout)', async () => {
    const email = `additive-${randomBytes(4).toString('hex')}@example.com`;
    const { project } = await createProject('Recover Space');
    const { id: memberId, token: existing } = await verifiedMemberWithToken(project.id, email);

    // Device A's session works before any recovery happens.
    expect((await authed(project.slug, existing)).status).toBe(200);

    // Device B recovers by email: request a code (test mode doesn't echo it, so
    // read it from the DB) and redeem it.
    const reqRes = await app.request(
      `/api/projects/${project.slug}/auth/request-login-code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      },
      connEnv,
    );
    expect(reqRes.status).toBe(200);
    const [pending] = await db
      .select()
      .from(loginVerifications)
      .where(eq(loginVerifications.projectId, project.id));
    expect(pending.code).toMatch(/^\d{6}$/);

    const verifyRes = await app.request(
      `/api/projects/${project.slug}/auth/verify-login-code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: pending.code }),
      },
      connEnv,
    );
    expect(verifyRes.status).toBe(200);
    const fresh = (await verifyRes.json()) as { token: string };
    expect(fresh.token).toBeTruthy();
    expect(fresh.token).not.toBe(existing);

    // The fix: device B's new session works AND device A's pre-existing session
    // is still valid. Both members.member_tokens rows authenticate.
    expect((await authed(project.slug, fresh.token)).status).toBe(200);
    expect((await authed(project.slug, existing)).status).toBe(200);

    // Two live sessions for the one member, not a single rotated slot.
    const sessions = await db
      .select()
      .from(memberTokens)
      .where(eq(memberTokens.memberId, memberId));
    expect(sessions).toHaveLength(2);
  });
});

describe('member session lifecycle', () => {
  it('rejects a bearer token after its fixed expiry', async () => {
    const { project } = await createProject('Expired session');
    const { token } = await verifiedMemberWithToken(project.id, 'expired@example.com');
    await db
      .update(memberTokens)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(memberTokens.tokenHash, hashToken(token)));

    expect((await authed(project.slug, token)).status).toBe(401);
  });

  it('logs out only the current device session', async () => {
    const { project } = await createProject('Two devices');
    const { id: memberId, token: current } = await verifiedMemberWithToken(
      project.id,
      'devices@example.com',
    );
    const other = randomBytes(16).toString('hex');
    await db.insert(memberTokens).values({ tokenHash: hashToken(other), memberId });

    const logout = await app.request(
      `/api/projects/${project.slug}/auth/session`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${current}` },
      },
      connEnv,
    );

    expect(logout.status).toBe(204);
    expect((await authed(project.slug, current)).status).toBe(401);
    expect((await authed(project.slug, other)).status).toBe(200);
  });

  it('allows logout without forcing acceptance of updated terms', async () => {
    const { project } = await createProject('Terms changed');
    const { id: memberId, token } = await verifiedMemberWithToken(
      project.id,
      'stale-terms@example.com',
    );
    await db.update(members).set({ tosVersion: 'stale' }).where(eq(members.id, memberId));

    const logout = await app.request(
      `/api/projects/${project.slug}/auth/session`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      connEnv,
    );

    expect(logout.status).toBe(204);
  });
});

// isSessionLive backs the SSE post-registration re-check that closes the
// logout/connect race: a stream registered under a token that was revoked or
// expired in the race window must read as not-live so it can be dropped.
describe('isSessionLive', () => {
  it('is true for a live token, false once revoked', async () => {
    const { project } = await createProject('Live session');
    const { token } = await verifiedMemberWithToken(project.id, 'live@example.com');
    const tokenHash = hashToken(token);

    expect(await isSessionLive(tokenHash)).toBe(true);

    await db.delete(memberTokens).where(eq(memberTokens.tokenHash, tokenHash));
    expect(await isSessionLive(tokenHash)).toBe(false);
  });

  it('is false for an expired token', async () => {
    const { project } = await createProject('Expired live-check');
    const { token } = await verifiedMemberWithToken(project.id, 'expired-live@example.com');
    const tokenHash = hashToken(token);
    await db
      .update(memberTokens)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(memberTokens.tokenHash, tokenHash));

    expect(await isSessionLive(tokenHash)).toBe(false);
  });
});
