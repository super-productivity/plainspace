import { describe, expect, it } from 'vitest';
import { db } from '../db/connection.js';
import { members, memberTokens } from '../db/schema.js';
import { hashToken } from './crypto.js';
import { encryptedEmailFields } from './email-crypto.js';
import { resolveProofEmail } from './proof-token.js';
import { createProject } from '../../test/helpers.js';

async function addMemberWithToken(
  projectId: string,
  token: string,
  opts: { email?: string; emailVerified?: boolean } = {},
): Promise<void> {
  const emailFields = opts.email
    ? encryptedEmailFields(opts.email)
    : { emailCiphertext: null, emailIv: null, emailLookup: null };
  const [row] = await db
    .insert(members)
    .values({
      projectId,
      displayName: 'M',
      color: '#000000',
      avatarIndex: 0,
      ...emailFields,
      emailVerified: opts.emailVerified ?? false,
    })
    .returning();
  await db.insert(memberTokens).values({ tokenHash: hashToken(token), memberId: row.id });
}

describe('resolveProofEmail', () => {
  it('returns null for empty / unknown tokens', async () => {
    expect(await resolveProofEmail(undefined)).toBeNull();
    expect(await resolveProofEmail('')).toBeNull();
    expect(await resolveProofEmail('nope-not-a-real-token')).toBeNull();
  });

  it('returns the normalized email for a verified member', async () => {
    const { project } = await createProject();
    await addMemberWithToken(project.id, 'tok-verified', {
      email: 'Owner@Example.com',
      emailVerified: true,
    });
    expect(await resolveProofEmail('tok-verified')).toBe('owner@example.com');
  });

  it('returns null when the member has an email but is not verified', async () => {
    const { project } = await createProject();
    await addMemberWithToken(project.id, 'tok-unverified', {
      email: 'pending@example.com',
      emailVerified: false,
    });
    expect(await resolveProofEmail('tok-unverified')).toBeNull();
  });

  it('returns null for a display-name-only member (no email)', async () => {
    const { project } = await createProject();
    await addMemberWithToken(project.id, 'tok-anon');
    expect(await resolveProofEmail('tok-anon')).toBeNull();
  });
});
