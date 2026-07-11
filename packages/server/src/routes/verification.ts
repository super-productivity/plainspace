import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, gt, desc, gte, lt, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { members, emailVerifications } from '../db/schema.js';
import { emailIndex, encryptedEmailFields } from '../lib/email-crypto.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { issueMemberToken } from '../lib/member-tokens.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeMember } from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { sendVerificationCode } from '../services/email.js';
import { mergeMemberInto } from '../services/member-merge.js';
import { resolveProofEmail } from '../lib/proof-token.js';
import { readJson } from '../lib/json.js';
import { checkRateLimit, getClientIp, rateLimitEmailKey } from '../lib/rate-limit.js';
import {
  CODE_EXPIRY_MS,
  CODE_REQUEST_WINDOW_MS,
  isValidCode,
  isValidEmail,
  generateCode,
} from '../lib/email-codes.js';

const VERIFY_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const VERIFY_ATTEMPT_MEMBER_LIMIT = 6;
const VERIFY_ATTEMPT_EMAIL_LIMIT = 6;
// Fail-closed: only relax rate limits and surface devCode when NODE_ENV is
// explicitly 'development'. Anything else (unset, 'staging', 'test', typos)
// runs as production so a misconfigured deploy can't leak codes.
const isDev = process.env.NODE_ENV === 'development';

export const verificationRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

function verificationAttemptEmailKey(projectId: string, lookup: Buffer): string {
  return `verify-code-email:${projectId}:${lookup.toString('hex')}`;
}

async function cleanupExpiredVerificationRows(): Promise<void> {
  await db
    .delete(emailVerifications)
    .where(or(lt(emailVerifications.expiresAt, new Date()), isNotNull(emailVerifications.usedAt)));
}

// POST /api/projects/:slug/auth/request-verification - Send verification code
verificationRoutes.post('/request-verification', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  if (member.emailVerified) {
    return c.json({ error: 'Email already verified' }, 400);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const rawEmail = (body as { email?: string })?.email;
  if (!rawEmail || !isValidEmail(rawEmail)) {
    return c.json({ error: 'Invalid email' }, 422);
  }
  // Canonicalize on write: recovery looks members up by lower(email), so the
  // stored email must already be lower-cased for those lookups to match.
  const email = rawEmail.toLowerCase();

  // Per-IP rate limit: max 5 verification requests per 10 minutes per IP.
  // Skipped in dev so the test suite can fan out without throttling.
  if (!isDev && !checkRateLimit(`verify-req:${getClientIp(c)}`, 5, 10 * 60 * 1000)) {
    return c.json({ error: 'Please wait before requesting another code' }, 429);
  }
  if (
    !isDev &&
    !checkRateLimit(
      `verify-req-email:${project.id}:${rateLimitEmailKey(email)}`,
      1,
      CODE_REQUEST_WINDOW_MS,
    )
  ) {
    return c.json({ error: 'Please wait before requesting another code' }, 429);
  }

  await cleanupExpiredVerificationRows();

  // Rate limit: max 1 code request per 2 minutes per member
  const recentCode = await db.query.emailVerifications.findFirst({
    where: and(
      eq(emailVerifications.memberId, member.id),
      gte(emailVerifications.createdAt, new Date(Date.now() - CODE_REQUEST_WINDOW_MS)),
    ),
    orderBy: [desc(emailVerifications.createdAt)],
  });

  if (recentCode) {
    return c.json({ error: 'Please wait before requesting another code' }, 429);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  await db.delete(emailVerifications).where(eq(emailVerifications.memberId, member.id));

  await db.insert(emailVerifications).values({
    memberId: member.id,
    ...encryptedEmailFields(email),
    code,
    expiresAt,
  });

  await sendVerificationCode(email, code, project.name);

  return c.json({
    message: 'Verification code sent',
    ...(isDev ? { devCode: code } : {}),
  });
});

// POST /api/projects/:slug/auth/verify - Verify code and set email
verificationRoutes.post('/verify', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  if (member.emailVerified) {
    return c.json({ error: 'Email already verified' }, 400);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const code = (body as { code?: string })?.code;
  if (!code || !isValidCode(code)) {
    return c.json({ error: 'Invalid code format' }, 422);
  }

  // Throttle attempts: the 6-digit code is brute-forceable, and a correct
  // guess now lets the caller merge into (take over) the colliding member. The
  // member-keyed and email-keyed buckets are shared with /verify-merge so
  // alternating endpoints or fresh guest members can't multiply the budget.
  if (
    !isDev &&
    (!checkRateLimit(`verify-code-ip:${getClientIp(c)}`, 10, VERIFY_ATTEMPT_WINDOW_MS) ||
      !checkRateLimit(
        `verify-code:${member.id}`,
        VERIFY_ATTEMPT_MEMBER_LIMIT,
        VERIFY_ATTEMPT_WINDOW_MS,
      ))
  ) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }
  const pendingVerification = await db.query.emailVerifications.findFirst({
    where: and(
      eq(emailVerifications.memberId, member.id),
      isNull(emailVerifications.usedAt),
      gt(emailVerifications.expiresAt, new Date()),
    ),
  });
  if (!pendingVerification) return c.json({ error: 'Invalid or expired code' }, 400);
  if (
    !isDev &&
    !checkRateLimit(
      verificationAttemptEmailKey(project.id, pendingVerification.emailLookup),
      VERIFY_ATTEMPT_EMAIL_LIMIT,
      VERIFY_ATTEMPT_WINDOW_MS,
    )
  ) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }

  type VerifyResult =
    | { ok: true; member: typeof members.$inferSelect }
    | { ok: false; reason: 'invalid' }
    | { ok: false; reason: 'merge-available'; canonicalDisplayName: string | null };

  const result = await db.transaction<VerifyResult>(async (tx) => {
    const verification = await tx.query.emailVerifications.findFirst({
      where: and(
        eq(emailVerifications.memberId, member.id),
        eq(emailVerifications.code, code),
        isNull(emailVerifications.usedAt),
        gt(emailVerifications.expiresAt, new Date()),
      ),
    });
    if (!verification) return { ok: false, reason: 'invalid' };

    // Another member in this Space already verified this address — same email,
    // so the same person joined twice. Don't mutate anything: surface the merge
    // so the caller can confirm it via /verify-merge. This keeps the
    // "one verified email per Space" invariant (recovery relies on it).
    const collision = await tx.query.members.findFirst({
      where: and(
        eq(members.projectId, project.id),
        eq(members.emailLookup, verification.emailLookup),
        eq(members.emailVerified, true),
      ),
    });
    if (collision && collision.id !== member.id) {
      return { ok: false, reason: 'merge-available', canonicalDisplayName: collision.displayName };
    }

    let updated: typeof members.$inferSelect;
    try {
      [updated] = await tx
        .update(members)
        .set({
          emailCiphertext: verification.emailCiphertext,
          emailIv: verification.emailIv,
          emailLookup: verification.emailLookup,
          emailVerified: true,
        })
        .where(and(eq(members.id, member.id), eq(members.projectId, project.id)))
        .returning();
    } catch (err) {
      // Concurrent verifier won the race: the app-level collision check passed
      // for both, but idx_members_project_email_verified rejects the second
      // writer. Surface the same merge path. The tx is aborted here, so we
      // can't re-read the winner's name — the client falls back to generic
      // wording when canonicalDisplayName is null.
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        return { ok: false, reason: 'merge-available', canonicalDisplayName: null };
      }
      throw err;
    }

    await tx.delete(emailVerifications).where(eq(emailVerifications.memberId, member.id));
    return { ok: true, member: updated };
  });

  if (!result.ok) {
    if (result.reason === 'merge-available') {
      return c.json(
        {
          error: 'This email already belongs to another member in this Space.',
          code: 'merge-available',
          canonicalDisplayName: result.canonicalDisplayName,
        },
        409,
      );
    }
    return c.json({ error: 'Invalid or expired code' }, 400);
  }
  const updated = result.member;

  const serialized = serializeMember(updated, updated.id);
  void sseManager.broadcast(project.id, 'member.updated', { member: serializeMember(updated) });

  return c.json({ member: serialized });
});

// POST /api/projects/:slug/auth/verify-merge - Confirm a merge that /verify
// surfaced: the caller proved control of an email already verified by another
// member in this Space. Absorb the caller's (guest) member into that canonical
// member, issue the canonical member a new session token, and return it so the
// browser becomes the canonical member. Possessing the email is the same trust
// basis as recovery.
verificationRoutes.post('/verify-merge', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  if (member.emailVerified) {
    return c.json({ error: 'Email already verified' }, 400);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const code = (body as { code?: string })?.code;
  if (!code || !isValidCode(code)) {
    return c.json({ error: 'Invalid code format' }, 422);
  }

  // Same brute-force throttle as /verify, sharing the member-keyed and
  // email-keyed buckets so the merge confirm can't be hammered to guess the
  // code either.
  if (
    !isDev &&
    (!checkRateLimit(`verify-code-ip:${getClientIp(c)}`, 10, VERIFY_ATTEMPT_WINDOW_MS) ||
      !checkRateLimit(
        `verify-code:${member.id}`,
        VERIFY_ATTEMPT_MEMBER_LIMIT,
        VERIFY_ATTEMPT_WINDOW_MS,
      ))
  ) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }
  const pendingVerification = await db.query.emailVerifications.findFirst({
    where: and(
      eq(emailVerifications.memberId, member.id),
      isNull(emailVerifications.usedAt),
      gt(emailVerifications.expiresAt, new Date()),
    ),
  });
  if (!pendingVerification) return c.json({ error: 'Invalid or expired code' }, 400);
  if (
    !isDev &&
    !checkRateLimit(
      verificationAttemptEmailKey(project.id, pendingVerification.emailLookup),
      VERIFY_ATTEMPT_EMAIL_LIMIT,
      VERIFY_ATTEMPT_WINDOW_MS,
    )
  ) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }

  type MergeResult =
    | { ok: true; member: typeof members.$inferSelect; token: string }
    | { ok: false; reason: 'invalid' | 'no-merge' };

  const result = await db.transaction<MergeResult>(async (tx) => {
    const verification = await tx.query.emailVerifications.findFirst({
      where: and(
        eq(emailVerifications.memberId, member.id),
        eq(emailVerifications.code, code),
        isNull(emailVerifications.usedAt),
        gt(emailVerifications.expiresAt, new Date()),
      ),
    });
    if (!verification) return { ok: false, reason: 'invalid' };

    const claimed = await tx
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(and(eq(emailVerifications.id, verification.id), isNull(emailVerifications.usedAt)))
      .returning({ id: emailVerifications.id });
    if (claimed.length === 0) return { ok: false, reason: 'invalid' };

    const canonical = await tx.query.members.findFirst({
      where: and(
        eq(members.projectId, project.id),
        eq(members.emailLookup, verification.emailLookup),
        eq(members.emailVerified, true),
      ),
    });
    // Nothing to merge into (the other member is gone, or the address is now
    // free): tell the caller to retry the plain verify path.
    if (!canonical || canonical.id === member.id) return { ok: false, reason: 'no-merge' };

    // The merge removed the guest member and its tokens via cascade and returns
    // the up-to-date canonical row; issue the caller an additive session as it.
    const updated = await mergeMemberInto(tx, project.id, member, canonical);
    const plaintext = await issueMemberToken(tx, updated.id);

    return { ok: true, member: updated, token: plaintext };
  });

  if (!result.ok) {
    if (result.reason === 'no-merge') {
      return c.json({ error: 'No matching membership to merge. Please verify again.' }, 409);
    }
    return c.json({ error: 'Invalid or expired code' }, 400);
  }

  // The guest member is gone; close its stream. The canonical member keeps its
  // existing sessions (additive), so leave its other devices connected and just
  // re-broadcast the merged state.
  sseManager.disconnectMember(project.id, member.id);
  void sseManager.broadcast(project.id, 'member.removed', { memberId: member.id });
  void sseManager.broadcast(project.id, 'member.updated', {
    member: serializeMember(result.member),
  });
  void sseManager.broadcast(project.id, 'presence', {
    online: sseManager.getOnlineMemberIds(project.id),
  });

  return c.json({
    member: serializeMember(result.member, result.member.id),
    token: result.token,
  });
});

// POST /api/projects/:slug/auth/connect-verified - Connect (verify) the caller's
// email to this Space using a "proof token" (a member token they already hold
// for another Space whose email is verified) instead of a fresh emailed code.
// Holding that token proves email control — the same trust basis as a code — so
// this skips the email round-trip for a returning user adding their email to a
// newly joined Space. Mirrors /verify's collision handling, but because the
// token proves ownership it merges directly (like /verify-merge) rather than
// asking for a code to confirm.
verificationRoutes.post('/connect-verified', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  if (member.emailVerified) {
    return c.json({ error: 'Email already verified' }, 400);
  }

  // No code to brute-force here (the proof token is the caller's own bearer
  // secret), but this can trigger a destructive merge, so cap attempts per IP
  // for parity with /verify-merge. Skipped in dev so the suite can fan out.
  if (!isDev && !checkRateLimit(`connect-verified-ip:${getClientIp(c)}`, 10, 10 * 60 * 1000)) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const proofToken = (body as { proofToken?: string })?.proofToken;
  const email = await resolveProofEmail(proofToken);
  if (!email) {
    return c.json(
      { error: 'Could not verify your email automatically', code: 'proof-invalid' },
      401,
    );
  }

  const lookup = emailIndex(email);

  type ConnectResult =
    | { kind: 'verified'; member: typeof members.$inferSelect }
    | { kind: 'merged'; member: typeof members.$inferSelect; token: string }
    | { kind: 'conflict' };

  const result = await db.transaction<ConnectResult>(async (tx) => {
    const collision = await tx.query.members.findFirst({
      where: and(
        eq(members.projectId, project.id),
        eq(members.emailLookup, lookup),
        eq(members.emailVerified, true),
      ),
    });

    // The caller already verified this email here under another member record
    // (joined twice). Absorb the current guest member into that canonical one
    // and issue the caller a new session as it, exactly like /verify-merge.
    if (collision && collision.id !== member.id) {
      const updated = await mergeMemberInto(tx, project.id, member, collision);
      const plaintext = await issueMemberToken(tx, updated.id);
      return { kind: 'merged', member: updated, token: plaintext };
    }

    try {
      const [updated] = await tx
        .update(members)
        .set({ ...encryptedEmailFields(email), emailVerified: true })
        .where(and(eq(members.id, member.id), eq(members.projectId, project.id)))
        .returning();
      return { kind: 'verified', member: updated };
    } catch (err) {
      // A concurrent verifier won the unique index in the gap above. Vanishingly
      // rare (caller just joined); ask them to reopen rather than racing a merge.
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        return { kind: 'conflict' };
      }
      throw err;
    }
  });

  if (result.kind === 'conflict') {
    return c.json({ error: 'This email was just connected here. Please reopen the Space.' }, 409);
  }

  if (result.kind === 'merged') {
    // Guest member gone; close its stream. Canonical keeps its sessions.
    sseManager.disconnectMember(project.id, member.id);
    void sseManager.broadcast(project.id, 'member.removed', { memberId: member.id });
    void sseManager.broadcast(project.id, 'member.updated', {
      member: serializeMember(result.member),
    });
    void sseManager.broadcast(project.id, 'presence', {
      online: sseManager.getOnlineMemberIds(project.id),
    });
    return c.json({
      member: serializeMember(result.member, result.member.id),
      token: result.token,
    });
  }

  void sseManager.broadcast(project.id, 'member.updated', {
    member: serializeMember(result.member),
  });
  return c.json({ member: serializeMember(result.member, result.member.id) });
});
