import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TOS_VERSION } from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { apiTokens, items, members, memberTokens, projects } from '../db/schema.js';
import { hashToken } from '../lib/crypto.js';
import { encryptedEmailFields } from '../lib/email-crypto.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

const app = createApp();

// A member with a known bearer token and accepted TOS, so requests pass the
// auth + terms gate. `isCreator`/`role` default to a plain member; passing an
// email makes the member verified (so it owns cross-Space apiTokens).
async function authedMember(
  projectId: string,
  opts: { isCreator?: boolean; role?: string; tosVersion?: string; email?: string } = {},
): Promise<{ id: string; token: string }> {
  const token = randomBytes(16).toString('hex');
  const emailFields = opts.email
    ? encryptedEmailFields(opts.email)
    : { emailCiphertext: null, emailIv: null, emailLookup: null };
  const [row] = await db
    .insert(members)
    .values({
      projectId,
      displayName: opts.isCreator ? 'Creator' : 'Member',
      color: '#000000',
      avatarIndex: 0,
      ...emailFields,
      emailVerified: opts.email != null,
      isCreator: opts.isCreator ?? false,
      role: opts.role ?? 'member',
      tosVersion: opts.tosVersion ?? TOS_VERSION,
      tosAcceptedAt: new Date(),
    })
    .returning();
  await db.insert(memberTokens).values({ tokenHash: hashToken(token), memberId: row.id });
  return { id: row.id, token };
}

// A cross-Space personal access token for `email` (keyed by the email blind
// index, not by project). Returns its tokenHash for later lookup.
async function addApiToken(email: string): Promise<string> {
  const tokenHash = randomBytes(32).toString('hex');
  await db.insert(apiTokens).values({
    ...encryptedEmailFields(email),
    tokenHash,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return tokenHash;
}

async function apiTokenExists(tokenHash: string): Promise<boolean> {
  const row = await db.query.apiTokens.findFirst({ where: eq(apiTokens.tokenHash, tokenHash) });
  return row !== undefined;
}

async function deleteSpace(slug: string, token?: string): Promise<Response> {
  return app.request(`/api/projects/${slug}/auth/space`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function patchSettings(slug: string, token: string, body: unknown): Promise<Response> {
  return app.request(`/api/projects/${slug}/auth/settings`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

describe('PATCH /auth/settings — Space name and purpose', () => {
  it('lets an admin rename the Space and set its purpose', async () => {
    const { project } = await createProject();
    const admin = await authedMember(project.id, { role: 'admin' });

    const res = await patchSettings(project.slug, admin.token, {
      name: 'Renamed Space',
      purpose: 'Ship the thing',
    });

    expect(res.status).toBe(200);
    expect((await res.json()).project).toMatchObject({
      name: 'Renamed Space',
      purpose: 'Ship the thing',
    });
    expect(await readProject(project.id)).toMatchObject({
      name: 'Renamed Space',
      purpose: 'Ship the thing',
    });
  });

  it('leaves purpose untouched when only the name is sent', async () => {
    const { project } = await createProject();
    const admin = await authedMember(project.id, { role: 'admin' });
    await patchSettings(project.slug, admin.token, { purpose: 'Original purpose' });

    const res = await patchSettings(project.slug, admin.token, { name: 'Just renamed' });

    expect(res.status).toBe(200);
    expect(await readProject(project.id)).toMatchObject({
      name: 'Just renamed',
      purpose: 'Original purpose',
    });
  });

  it('trims the name and clears the purpose when sent an empty string', async () => {
    const { project } = await createProject();
    const admin = await authedMember(project.id, { role: 'admin' });
    await patchSettings(project.slug, admin.token, { purpose: 'To be cleared' });

    const res = await patchSettings(project.slug, admin.token, {
      name: '  Padded name  ',
      purpose: '',
    });

    expect(res.status).toBe(200);
    expect(await readProject(project.id)).toMatchObject({ name: 'Padded name', purpose: '' });
  });

  it('rejects a blank or over-long name', async () => {
    const { project } = await createProject('Keep me');
    const admin = await authedMember(project.id, { role: 'admin' });

    expect((await patchSettings(project.slug, admin.token, { name: '   ' })).status).toBe(422);
    expect((await patchSettings(project.slug, admin.token, { name: 'x'.repeat(101) })).status).toBe(
      422,
    );
    expect(await readProject(project.id)).toMatchObject({ name: 'Keep me' });
  });

  // The route sets `{ ...parsed.data }` and leans on zod omitting absent keys +
  // drizzle dropping undefined ones. This pins that: a name-only patch must not
  // disturb sharingMode.
  it('leaves sharingMode untouched when only the name is sent', async () => {
    const { project } = await createProject();
    const admin = await authedMember(project.id, { role: 'admin', email: 'a@example.com' });
    await patchSettings(project.slug, admin.token, { sharingMode: 'private' });

    const res = await patchSettings(project.slug, admin.token, { name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(await readProject(project.id)).toMatchObject({
      name: 'Renamed',
      sharingMode: 'private',
    });
  });

  it('rejects unknown keys instead of silently ignoring them', async () => {
    const { project } = await createProject('Keep me');
    const admin = await authedMember(project.id, { role: 'admin' });

    const res = await patchSettings(project.slug, admin.token, { name: 'New', slug: 'hijacked' });

    expect(res.status).toBe(422);
    expect(await readProject(project.id)).toMatchObject({ name: 'Keep me', slug: project.slug });
  });

  it('rejects a rename from a non-admin member', async () => {
    const { project } = await createProject('Keep me');
    const plain = await authedMember(project.id);

    const res = await patchSettings(project.slug, plain.token, { name: 'Nope' });

    expect(res.status).toBe(403);
    expect(await readProject(project.id)).toMatchObject({ name: 'Keep me' });
  });
});

describe('DELETE /auth/space — delete Space', () => {
  it('lets the creator delete the Space and cascades to members and items', async () => {
    const { project, listId } = await createProject();
    const creator = await authedMember(project.id, { isCreator: true, role: 'admin' });
    await addItem(listId, project.id);

    const res = await deleteSpace(project.slug, creator.token);
    expect(res.status).toBe(204);

    expect(
      await db.query.projects.findFirst({ where: eq(projects.id, project.id) }),
    ).toBeUndefined();
    expect(await db.select().from(members).where(eq(members.projectId, project.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(items).where(eq(items.projectId, project.id))).toHaveLength(0);
  });

  it('rejects a non-creator admin with 403 and leaves the Space intact', async () => {
    const { project } = await createProject();
    await authedMember(project.id, { isCreator: true, role: 'admin' });
    const admin = await authedMember(project.id, { isCreator: false, role: 'admin' });

    const res = await deleteSpace(project.slug, admin.token);
    expect(res.status).toBe(403);
    expect(await db.query.projects.findFirst({ where: eq(projects.id, project.id) })).toBeDefined();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const { project } = await createProject();
    const res = await deleteSpace(project.slug);
    expect(res.status).toBe(401);
    expect(await db.query.projects.findFirst({ where: eq(projects.id, project.id) })).toBeDefined();
  });

  it('lets a creator with outdated terms delete (erasure bypasses the TOS gate)', async () => {
    const { project } = await createProject();
    const creator = await authedMember(project.id, {
      isCreator: true,
      role: 'admin',
      tosVersion: 'stale',
    });

    const res = await deleteSpace(project.slug, creator.token);
    expect(res.status).toBe(204);
    expect(
      await db.query.projects.findFirst({ where: eq(projects.id, project.id) }),
    ).toBeUndefined();
  });

  // apiTokens are keyed by email and don't cascade from projects, so the route
  // scrubs them — but only for emails with no other verified Space.
  it("scrubs a deleted member's apiTokens when this was their only verified Space", async () => {
    const { project } = await createProject();
    const creator = await authedMember(project.id, {
      isCreator: true,
      role: 'admin',
      email: 'owner@example.com',
    });
    const tokenHash = await addApiToken('owner@example.com');

    const res = await deleteSpace(project.slug, creator.token);
    expect(res.status).toBe(204);
    expect(await apiTokenExists(tokenHash)).toBe(false);
  });

  it('keeps apiTokens when the owner is still verified in another Space', async () => {
    const { project } = await createProject();
    const creator = await authedMember(project.id, {
      isCreator: true,
      role: 'admin',
      email: 'owner@example.com',
    });
    // Same email, verified in a second Space that survives the deletion.
    const other = await createProject('Other');
    await addMember(other.project.id, { email: 'owner@example.com' });
    const tokenHash = await addApiToken('owner@example.com');

    const res = await deleteSpace(project.slug, creator.token);
    expect(res.status).toBe(204);
    expect(await apiTokenExists(tokenHash)).toBe(true);
  });
});
