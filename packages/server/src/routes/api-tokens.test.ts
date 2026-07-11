import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { API_TOKEN_PREFIX, TOS_VERSION } from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { apiTokens, members, memberTokens } from '../db/schema.js';
import { hashToken } from '../lib/crypto.js';
import { encryptedEmailFields } from '../lib/email-crypto.js';
import { createProject } from '../../test/helpers.js';

const app = createApp();

// getClientIp() reads node-server connection info that app.request() doesn't
// populate; supply a stub so the rate-limit IP lookup resolves.
const connEnv = {
  incoming: { socket: { remoteAddress: '127.0.0.1', remotePort: 1234, remoteFamily: 'IPv4' } },
} as unknown as Parameters<typeof app.request>[2];

async function verifiedMemberWithToken(
  projectId: string,
  email: string,
): Promise<{ token: string }> {
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
  return { token };
}

async function post(slug: string, token: string): Promise<Response> {
  return app.request(
    `/api/projects/${slug}/auth/api-tokens`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    connEnv,
  );
}

function activeTokens() {
  return db.query.apiTokens.findMany({ where: isNull(apiTokens.revokedAt) });
}

describe('API token routes (one active token per email)', () => {
  it('creates a token and returns it once, without a name field', async () => {
    const { project } = await createProject();
    const { token } = await verifiedMemberWithToken(project.id, 'pat@example.com');

    const res = await post(project.slug, token);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; apiToken: Record<string, unknown> };
    expect(body.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(Object.keys(body.apiToken).sort()).toEqual(
      ['createdAt', 'expiresAt', 'id', 'lastUsedAt'].sort(),
    );

    const get = await app.request(
      `/api/projects/${project.slug}/auth/api-tokens`,
      { headers: { Authorization: `Bearer ${token}` } },
      connEnv,
    );
    const list = (await get.json()) as { token: { id: string } | null };
    expect(list.token?.id).toBe(body.apiToken.id);
  });

  it('replaces the previous token on regenerate, leaving exactly one active', async () => {
    const { project } = await createProject();
    const { token } = await verifiedMemberWithToken(project.id, 'pat@example.com');

    const first = (await (await post(project.slug, token)).json()) as { token: string };
    const second = (await (await post(project.slug, token)).json()) as { token: string };

    const active = await activeTokens();
    expect(active).toHaveLength(1);
    expect(active[0].tokenHash).toBe(hashToken(second.token));

    // The first token's row is now revoked, so it can no longer authenticate.
    const firstRow = await db.query.apiTokens.findFirst({
      where: eq(apiTokens.tokenHash, hashToken(first.token)),
    });
    expect(firstRow?.revokedAt).not.toBeNull();
  });

  it('revokes the active token on DELETE', async () => {
    const { project } = await createProject();
    const { token } = await verifiedMemberWithToken(project.id, 'pat@example.com');
    await post(project.slug, token);

    const del = await app.request(
      `/api/projects/${project.slug}/auth/api-tokens`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      connEnv,
    );
    expect(del.status).toBe(204);
    expect(await activeTokens()).toHaveLength(0);
  });
});
