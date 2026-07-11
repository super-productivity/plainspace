import { describe, expect, it, vi } from 'vitest';

// Stub only the SMTP send so the magic-link minting runs against the real DB
// without reaching for a mail server. Other email senders keep their real
// implementations (createApp mounts routes that import them).
vi.mock('../services/email.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email.js')>()),
  sendSpacesList: vi.fn().mockResolvedValue(undefined),
  sendVerificationCode: vi.fn().mockResolvedValue(undefined),
}));

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { loginVerifications, members, memberTokens } from '../db/schema.js';
import { emailIndex } from '../lib/email-crypto.js';
import { sendSpacesList, sendVerificationCode } from '../services/email.js';
import { addMember, createProject } from '../../test/helpers.js';

const app = createApp();

// getClientIp() reads the node-server connection info, which app.request()
// doesn't populate; supply a stub so the rate-limit IP lookup resolves.
const connEnv = {
  incoming: { socket: { remoteAddress: '127.0.0.1', remotePort: 1234, remoteFamily: 'IPv4' } },
} as unknown as Parameters<typeof app.request>[2];

async function findSpaces(email: string): Promise<Response> {
  return app.request(
    '/api/auth/find-spaces',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    connEnv,
  );
}

function uniqueEmail(): string {
  return `magic-${randomBytes(5).toString('hex')}@example.com`;
}

async function requestCreationCode(email: string): Promise<Response> {
  return app.request(
    '/api/auth/request-creation-code',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    connEnv,
  );
}

describe('POST /api/auth/request-creation-code — per-inbox code throttle', () => {
  it('throttles +tag aliases of the same inbox so a victim cannot be email-bombed', async () => {
    // Unique base so the module-level in-memory limiter cannot leak across tests.
    const base = uniqueEmail();
    const [local, domain] = base.split('@');
    const plusTagged = `${local}+2@${domain}`;

    const first = await requestCreationCode(base);
    expect(first.status).toBe(200);

    // Same inbox via a +tag alias: distinct exact address, same plus-stripped
    // key — must be throttled, not sent a second code.
    const second = await requestCreationCode(plusTagged);
    expect(second.status).toBe(429);
    expect(sendVerificationCode).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/auth/find-spaces — magic recovery links', () => {
  it('mints one single-use code per verified Space and never rotates a token', async () => {
    const email = uniqueEmail();
    const a = await createProject('Space A');
    const b = await createProject('Space B');
    const memberA = await addMember(a.project.id, { email });
    const memberB = await addMember(b.project.id, { email });
    // A Space this email is NOT a member of must get no code.
    const c = await createProject('Space C');
    await addMember(c.project.id, { email: uniqueEmail() });

    const sessionHashes = async (memberId: string) =>
      (await db.select().from(memberTokens).where(eq(memberTokens.memberId, memberId))).map(
        (s) => s.tokenHash,
      );
    const beforeA = await sessionHashes(memberA.id);
    const beforeB = await sessionHashes(memberB.id);

    const res = await findSpaces(email);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string; devSpaces?: unknown };
    expect(body.message).toMatch(/if that email is connected/i);
    // The generic response must not leak the matches (devSpaces is dev-only).
    expect(body.devSpaces).toBeUndefined();

    const lookup = emailIndex(email);
    // Minting runs off the response path (timing-oracle defense), so wait for it.
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(loginVerifications)
              .where(eq(loginVerifications.emailLookup, lookup))
          ).length,
      )
      .toBe(2);

    const rows = await db
      .select()
      .from(loginVerifications)
      .where(eq(loginVerifications.emailLookup, lookup));
    expect(new Set(rows.map((r) => r.projectId))).toEqual(new Set([a.project.id, b.project.id]));
    for (const row of rows) {
      expect(row.code).toMatch(/^\d{6}$/);
      expect(row.usedAt).toBeNull();
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }

    // The security invariant: minting must not rotate (invalidate) any session,
    // so submitting someone's email can never log them out.
    expect(await sessionHashes(memberA.id)).toEqual(beforeA);
    expect(await sessionHashes(memberB.id)).toEqual(beforeB);

    expect(sendSpacesList).toHaveBeenCalledTimes(1);
  });

  it('mints nothing for an email with no verified membership', async () => {
    const email = uniqueEmail();
    const p = await createProject('Space D');
    const member = await addMember(p.project.id, { email });
    // addMember auto-verifies emailed members; flip it back to unverified.
    await db.update(members).set({ emailVerified: false }).where(eq(members.id, member.id));

    const res = await findSpaces(email);
    expect(res.status).toBe(200);

    // Give any (incorrect) background minting a chance to run, then assert none.
    await new Promise((resolve) => setTimeout(resolve, 75));
    const rows = await db
      .select()
      .from(loginVerifications)
      .where(eq(loginVerifications.emailLookup, emailIndex(email)));
    expect(rows).toHaveLength(0);
  });
});
