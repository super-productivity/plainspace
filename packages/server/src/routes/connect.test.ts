import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { API_TOKEN_PREFIX, TOS_VERSION } from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { apiTokens, creationVerifications, members } from '../db/schema.js';
import { emailIndex, encryptedEmailFields } from '../lib/email-crypto.js';
import { hashToken } from '../lib/crypto.js';
import { CODE_EXPIRY_MS } from '../lib/email-codes.js';
import { addMember, createProject } from '../../test/helpers.js';

// Exercises POST /api/auth/connect and its §10 security must-dos: no-account
// discriminator, unverified-only upgrade, never-silent reconnect, transactional
// revoke+mint, per-email brute-force cap, verify-first enumeration ordering, and
// the 0-row-consume abort under concurrent force.

const app = createApp();

// getClientIp() reads node-server connection info that app.request() doesn't
// populate. A UNIQUE IP per call keeps the per-IP limiter (10/15min) from
// bleeding across the many connect calls in this file — the per-email cap under
// test is IP-independent, so this doesn't weaken it.
let ipCounter = 0;
function connEnv(): Parameters<typeof app.request>[2] {
  ipCounter++;
  const ip = `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  return {
    incoming: { socket: { remoteAddress: ip, remotePort: 1234, remoteFamily: 'IPv4' } },
  } as unknown as Parameters<typeof app.request>[2];
}

async function connect(body: { email: string; code: string; force?: boolean }): Promise<Response> {
  return app.request(
    '/api/auth/connect',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    connEnv(),
  );
}

function uniqueEmail(): string {
  return `connect-${randomBytes(5).toString('hex')}@example.com`;
}

async function plantCode(email: string, code = '123456'): Promise<string> {
  await db.insert(creationVerifications).values({
    ...encryptedEmailFields(email),
    code,
    expiresAt: new Date(Date.now() + CODE_EXPIRY_MS),
  });
  return code;
}

// Insert a pre-existing active token for an email (as if SP were already
// connected on another device). Returns its hash so a test can prove rotation.
async function seedActiveToken(email: string): Promise<string> {
  const tokenHash = hashToken(`existing-${randomBytes(8).toString('hex')}`);
  await db.insert(apiTokens).values({
    ...encryptedEmailFields(email),
    tokenHash,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
  return tokenHash;
}

function activeTokens(email: string) {
  return db.query.apiTokens.findMany({
    where: and(eq(apiTokens.emailLookup, emailIndex(email)), isNull(apiTokens.revokedAt)),
  });
}

async function codeConsumed(email: string): Promise<boolean> {
  const row = await db.query.creationVerifications.findFirst({
    where: eq(creationVerifications.emailLookup, emailIndex(email)),
  });
  return row?.usedAt != null;
}

describe('POST /api/auth/connect', () => {
  it('404s with a no-account discriminator and leaves the code unused', async () => {
    const email = uniqueEmail();
    const code = await plantCode(email);

    const res = await connect({ email, code });
    expect(res.status).toBe(404);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'no-account' });
    // Code stays unused so the web can fall through to createProject with it.
    expect(await codeConsumed(email)).toBe(false);
  });

  it('mints a key for a verified member, consumes the code, and returns a witness', async () => {
    const email = uniqueEmail();
    const { project } = await createProject('Returning Space');
    const member = await addMember(project.id, { email });
    // Returning user on a prior ToS (the population §10.2 protects): their PAT
    // resolves to 0 Spaces via loadIntegrationScope unless connect refreshes ToS.
    await db.update(members).set({ tosVersion: null }).where(eq(members.id, member.id));
    const code = await plantCode(email);

    const res = await connect({ email, code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      token: string;
      email: string;
      witness: { slug: string; projectName: string; memberId: string; memberToken: string };
    };
    expect(body.status).toBe('connected');
    expect(body.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(body.witness.slug).toBe(project.slug);
    expect(body.witness.projectName).toBe('Returning Space');
    expect(body.witness.memberToken).toBeTruthy();

    expect(await codeConsumed(email)).toBe(true);
    const active = await activeTokens(email);
    expect(active).toHaveLength(1);
    expect(active[0].tokenHash).toBe(hashToken(body.token));

    // B1: connect refreshes the member's ToS so the account-wide PAT actually
    // resolves via loadIntegrationScope instead of being inert.
    const refreshed = await db.query.members.findFirst({ where: eq(members.id, member.id) });
    expect(refreshed?.tosVersion).toBe(TOS_VERSION);
  });

  it('upgrades an unverified-only membership instead of 404-ing', async () => {
    const email = uniqueEmail();
    const { project } = await createProject();
    const member = await addMember(project.id, { email });
    // addMember auto-verifies emailed members; flip back to the unverified state.
    await db
      .update(members)
      .set({ emailVerified: false, tosVersion: null, tosAcceptedAt: null })
      .where(eq(members.id, member.id));
    const code = await plantCode(email);

    const res = await connect({ email, code });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('connected');

    const upgraded = await db.query.members.findFirst({ where: eq(members.id, member.id) });
    expect(upgraded?.emailVerified).toBe(true);
    expect(upgraded?.tosVersion).toBe(TOS_VERSION);
    expect(await activeTokens(email)).toHaveLength(1);
  });

  it('returns already-connected (no mint, code unused) when a key is active and no force', async () => {
    const email = uniqueEmail();
    const { project } = await createProject();
    await addMember(project.id, { email });
    const existingHash = await seedActiveToken(email);
    const code = await plantCode(email);

    const res = await connect({ email, code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      apiToken: { id: string };
      email: string;
      witness: { slug: string; projectName: string; memberId: string; memberToken: string };
    };
    expect(body.status).toBe('already-connected');
    expect(body.apiToken.id).toBeTruthy();
    // The verified code proves email ownership, so sign this device in too: a
    // witness session lets the reconnect screen open the Space instead of
    // dropping the user on the join/username form.
    expect(body.witness.slug).toBe(project.slug);
    expect(body.witness.projectName).toBe(project.name);
    expect(body.witness.memberToken).toBeTruthy();
    // Never silently rotate: the existing token stays, the code stays unused.
    const active = await activeTokens(email);
    expect(active).toHaveLength(1);
    expect(active[0].tokenHash).toBe(existingHash);
    expect(await codeConsumed(email)).toBe(false);
  });

  it('force replaces the active token, leaving exactly one and revoking the old', async () => {
    const email = uniqueEmail();
    const { project } = await createProject();
    await addMember(project.id, { email });
    const oldHash = await seedActiveToken(email);
    const code = await plantCode(email);

    const res = await connect({ email, code, force: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; token: string };
    expect(body.status).toBe('connected');

    const active = await activeTokens(email);
    expect(active).toHaveLength(1);
    expect(active[0].tokenHash).toBe(hashToken(body.token));
    expect(active[0].tokenHash).not.toBe(oldHash);
    // Old token is now revoked, not deleted.
    const old = await db.query.apiTokens.findFirst({
      where: eq(apiTokens.tokenHash, oldHash),
    });
    expect(old?.revokedAt).not.toBeNull();
  });

  it('returns an identical 401 for a wrong code whether or not the email has an account', async () => {
    const withAccount = uniqueEmail();
    const { project } = await createProject();
    await addMember(project.id, { email: withAccount });
    await plantCode(withAccount, '111111');

    const noAccount = uniqueEmail();
    await plantCode(noAccount, '222222');

    const a = await connect({ email: withAccount, code: '000000' });
    const b = await connect({ email: noAccount, code: '000000' });
    // Verify-first ordering: neither reveals whether the email owns an account.
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    // A wrong code must not consume the planted code or mint anything.
    expect(await codeConsumed(withAccount)).toBe(false);
    expect(await activeTokens(withAccount)).toHaveLength(0);
  });

  it('locks the code after 5 wrong tries via the per-email cap (correct code then 429s)', async () => {
    const email = uniqueEmail();
    const { project } = await createProject();
    await addMember(project.id, { email });
    const code = await plantCode(email, '424242');

    // Five wrong tries all fail on the code (401), each counting toward the cap.
    for (let i = 0; i < 5; i++) {
      const res = await connect({ email, code: '000000' });
      expect(res.status).toBe(401);
    }
    // The sixth try — even with the CORRECT code — is refused by the cap.
    const locked = await connect({ email, code });
    expect(locked.status).toBe(429);
    // The cap protected the code: it was never consumed, no token was minted.
    expect(await codeConsumed(email)).toBe(false);
    expect(await activeTokens(email)).toHaveLength(0);
  });

  it('lets only one of two concurrent force mints win (0-row-consume abort)', async () => {
    const email = uniqueEmail();
    const { project } = await createProject();
    await addMember(project.id, { email });
    await seedActiveToken(email);
    const code = await plantCode(email);

    const [r1, r2] = await Promise.all([
      connect({ email, code, force: true }),
      connect({ email, code, force: true }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // One wins (200), the other loses the code-claim race (401) — never a 500
    // from a double revoke+mint violating idx_api_tokens_active_email.
    expect(statuses).toEqual([200, 401]);
    expect(await activeTokens(email)).toHaveLength(1);
  });
});
