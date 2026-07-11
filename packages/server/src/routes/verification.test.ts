import { describe, expect, it, vi } from 'vitest';

// Stub only the SMTP send: /request-verification awaits it, and under
// NODE_ENV=test the real transporter would try to reach a mail server.
vi.mock('../services/email.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email.js')>()),
  sendVerificationCode: vi.fn().mockResolvedValue(undefined),
}));

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { emailVerifications, items, members } from '../db/schema.js';
import { addItem, authedMember, createProject } from '../../test/helpers.js';

const app = createApp();

type ConnEnv = Parameters<typeof app.request>[2];

// Rate limits are ACTIVE under NODE_ENV=test (only 'development' relaxes
// them) and the limiter is in-memory per process, so give every test its own
// client IP to keep the per-IP buckets from bleeding between tests.
let ipCounter = 1;
function freshConnEnv(): ConnEnv {
  const remoteAddress = `10.77.0.${ipCounter++}`;
  return {
    incoming: { socket: { remoteAddress, remotePort: 1234, remoteFamily: 'IPv4' } },
  } as unknown as ConnEnv;
}

function uniqueEmail(): string {
  return `verify-${randomBytes(5).toString('hex')}@example.com`;
}

async function post(
  slug: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
  env: ConnEnv,
): Promise<Response> {
  return app.request(
    `/api/projects/${slug}/auth/${path}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

// terms-status is the cheapest authenticated GET; a 200 means the token is live.
async function authed(slug: string, token: string, env: ConnEnv): Promise<Response> {
  return app.request(
    `/api/projects/${slug}/auth/terms-status`,
    { headers: { Authorization: `Bearer ${token}` } },
    env,
  );
}

// devCode is dev-only (test mode doesn't echo it), so read the emailed code
// straight from the DB like auth.test.ts does for login codes.
async function requestCode(
  slug: string,
  token: string,
  email: string,
  memberId: string,
  env: ConnEnv,
): Promise<string> {
  const res = await post(slug, 'request-verification', token, { email }, env);
  expect(res.status).toBe(200);
  const [pending] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.memberId, memberId));
  expect(pending.code).toMatch(/^\d{6}$/);
  return pending.code;
}

async function memberRows(memberId: string) {
  return db.select().from(members).where(eq(members.id, memberId));
}

describe('POST /api/projects/:slug/auth/verify', () => {
  it('verifies the emailed code and marks the member emailVerified', async () => {
    const env = freshConnEnv();
    const { project } = await createProject();
    const { member: guest, token } = await authedMember(project.id);
    const email = uniqueEmail();

    const code = await requestCode(project.slug, token, email, guest.id, env);
    const res = await post(project.slug, 'verify', token, { code }, env);
    expect(res.status).toBe(200);

    // The caller gets its own (unmasked) email back in the current-user shape.
    const body = (await res.json()) as {
      member: { id: string; emailVerified: boolean; email: string | null };
    };
    expect(body.member.id).toBe(guest.id);
    expect(body.member.emailVerified).toBe(true);
    expect(body.member.email).toBe(email);

    const [row] = await memberRows(guest.id);
    expect(row.emailVerified).toBe(true);
    // The code is single-use: nothing left to redeem.
    const remaining = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.memberId, guest.id));
    expect(remaining).toHaveLength(0);
  });

  it("returns 409 'merge-available' when another member of the Space owns the verified email", async () => {
    const env = freshConnEnv();
    const { project } = await createProject();
    const email = uniqueEmail();
    const { member: canonical } = await authedMember(project.id, {
      displayName: 'Canonical',
      email,
    });
    const { member: guest, token } = await authedMember(project.id);

    const code = await requestCode(project.slug, token, email, guest.id, env);
    const res = await post(project.slug, 'verify', token, { code }, env);
    expect(res.status).toBe(409);

    // The web client (EmailVerify.tsx) gates its merge dialog on the literal
    // string 'merge-available' — this pins that contract.
    const body = (await res.json()) as { code: string; canonicalDisplayName: string | null };
    expect(body.code).toBe('merge-available');
    expect(body.canonicalDisplayName).toBe(canonical.displayName);

    // Nothing was mutated: the guest stays unverified and the code stays
    // redeemable so the caller can confirm via /verify-merge.
    const [guestRow] = await memberRows(guest.id);
    expect(guestRow.emailVerified).toBe(false);
    const [pending] = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.memberId, guest.id));
    expect(pending.usedAt).toBeNull();
  });
});

describe('POST /api/projects/:slug/auth/verify-merge', () => {
  it('absorbs the guest into the canonical member and rotates the token', async () => {
    const env = freshConnEnv();
    const { project, listId } = await createProject();
    const email = uniqueEmail();
    const { member: canonical, token: canonicalToken } = await authedMember(project.id, {
      displayName: 'Owner',
      email,
    });
    const { member: guest, token: guestToken } = await authedMember(project.id);
    const item = await addItem(listId, project.id, {
      assignedTo: guest.id,
      checked: true,
      checkedBy: guest.id,
    });

    const code = await requestCode(project.slug, guestToken, email, guest.id, env);
    // The flow the client drives: /verify surfaces the collision first.
    expect((await post(project.slug, 'verify', guestToken, { code }, env)).status).toBe(409);

    const res = await post(project.slug, 'verify-merge', guestToken, { code }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      member: { id: string; emailVerified: boolean };
      token: string;
    };
    expect(body.member.id).toBe(canonical.id);
    expect(body.member.emailVerified).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.token).not.toBe(guestToken);

    // The guest member row is gone; its item references moved to the canonical.
    expect(await memberRows(guest.id)).toHaveLength(0);
    const [itemRow] = await db.select().from(items).where(eq(items.id, item.id));
    expect(itemRow.assignedTo).toBe(canonical.id);
    expect(itemRow.checkedBy).toBe(canonical.id);

    // Fresh token authenticates as the canonical member; the guest's old token
    // died with the cascade; the canonical's other session stays live (additive).
    expect((await authed(project.slug, body.token, env)).status).toBe(200);
    expect((await authed(project.slug, guestToken, env)).status).toBe(401);
    expect((await authed(project.slug, canonicalToken, env)).status).toBe(200);
  });

  it('rejects missing, wrong, and expired codes with 400 without touching the member', async () => {
    const env = freshConnEnv();
    const { project } = await createProject();
    const email = uniqueEmail();
    await authedMember(project.id, { email });
    const { member: guest, token } = await authedMember(project.id);

    // No code requested yet.
    expect((await post(project.slug, 'verify-merge', token, { code: '123456' }, env)).status).toBe(
      400,
    );

    const code = await requestCode(project.slug, token, email, guest.id, env);
    const wrong = code === '999999' ? '999998' : '999999';
    expect((await post(project.slug, 'verify-merge', token, { code: wrong }, env)).status).toBe(
      400,
    );

    // Correct code, but expired.
    await db
      .update(emailVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailVerifications.memberId, guest.id));
    expect((await post(project.slug, 'verify-merge', token, { code }, env)).status).toBe(400);

    const [guestRow] = await memberRows(guest.id);
    expect(guestRow.emailVerified).toBe(false);
  });

  it("returns 409 'no-merge' when no verified member owns the email (code is consumed)", async () => {
    const env = freshConnEnv();
    const { project } = await createProject();
    const { member: guest, token } = await authedMember(project.id);
    const email = uniqueEmail(); // nobody in the Space owns this address

    const code = await requestCode(project.slug, token, email, guest.id, env);
    const res = await post(project.slug, 'verify-merge', token, { code }, env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no matching membership/i);

    // Pinned behavior: the single-use claim commits even on the no-merge exit,
    // so the same code can no longer be redeemed via plain /verify — the
    // caller has to request a fresh one.
    const [pending] = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.memberId, guest.id));
    expect(pending.usedAt).not.toBeNull();
    expect((await post(project.slug, 'verify', token, { code }, env)).status).toBe(400);
  });
});

describe('POST /api/projects/:slug/auth/connect-verified', () => {
  it("verifies via a proof token from another Space's verified member", async () => {
    const env = freshConnEnv();
    const email = uniqueEmail();
    const other = await createProject('Other Space');
    const { token: proofToken } = await authedMember(other.project.id, { email });
    const { project } = await createProject();
    const { member: guest, token } = await authedMember(project.id);

    const res = await post(project.slug, 'connect-verified', token, { proofToken }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      member: { id: string; emailVerified: boolean; email: string | null };
      token?: string;
    };
    expect(body.member.id).toBe(guest.id);
    expect(body.member.emailVerified).toBe(true);
    expect(body.member.email).toBe(email);
    expect(body.token).toBeUndefined(); // plain verify: no session rotation

    const [row] = await memberRows(guest.id);
    expect(row.emailVerified).toBe(true);
  });

  it('merges into the canonical member when the email is already verified here', async () => {
    const env = freshConnEnv();
    const email = uniqueEmail();
    const other = await createProject('Other Space');
    const { token: proofToken } = await authedMember(other.project.id, { email });
    const { project } = await createProject();
    const { member: canonical } = await authedMember(project.id, { email });
    const { member: guest, token: guestToken } = await authedMember(project.id);

    const res = await post(project.slug, 'connect-verified', guestToken, { proofToken }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { id: string }; token: string };
    expect(body.member.id).toBe(canonical.id);
    expect(body.token).toBeTruthy();

    expect(await memberRows(guest.id)).toHaveLength(0);
    expect((await authed(project.slug, body.token, env)).status).toBe(200);
    expect((await authed(project.slug, guestToken, env)).status).toBe(401);
  });

  it("rejects a proof token whose member has no verified email (401 'proof-invalid')", async () => {
    const env = freshConnEnv();
    const other = await createProject('Other Space');
    // Unverified member: a valid token, but not proof of any email.
    const { token: proofToken } = await authedMember(other.project.id);
    const { project } = await createProject();
    const { member: guest, token } = await authedMember(project.id);

    const res = await post(project.slug, 'connect-verified', token, { proofToken }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('proof-invalid');

    const [row] = await memberRows(guest.id);
    expect(row.emailVerified).toBe(false);
  });
});
