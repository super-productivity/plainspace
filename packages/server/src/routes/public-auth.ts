import { Hono } from 'hono';
import { and, eq, gt, gte, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { creationVerifications, loginVerifications, members, projects } from '../db/schema.js';
import {
  ConnectRequestSchema,
  type ConnectWitness,
  RequestCreationCodeSchema,
  TOS_VERSION,
} from '@plainspace/shared';
import { sendSpacesList, sendVerificationCode } from '../services/email.js';
import {
  checkRateLimit,
  getClientIp,
  rateLimitEmailKey,
  releaseRateLimit,
} from '../lib/rate-limit.js';
import { emailIndex, encryptedEmailFields } from '../lib/email-crypto.js';
import { serializeApiToken } from '../lib/serialize.js';
import { issueMemberToken } from '../lib/member-tokens.js';
import { findActiveToken, mintApiToken, revokeActiveTokens } from '../lib/api-token.js';
import {
  CODE_EXPIRY_MS,
  CODE_REQUEST_WINDOW_MS,
  isValidEmail,
  generateCode,
} from '../lib/email-codes.js';

const PER_IP_WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5; // 5 code requests per 15 min per IP
// Fail-closed: only surface devCode when NODE_ENV is explicitly 'development'.
const devBypass = process.env.NODE_ENV === 'development';

export const publicAuthRoutes = new Hono();

// POST /api/auth/find-spaces - Email the address owner the list of Spaces they
// added this email to. Always returns the same generic message so an
// attacker can't enumerate Spaces; the list itself only ever reaches the
// real address. This is the email path when a device has no local identity
// and no URL bar to type a Space link — notably an iOS home-screen PWA.
publicAuthRoutes.post('/find-spaces', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`find-spaces-ip:${ip}`, 5, PER_IP_WINDOW_MS)) {
    return c.json({ error: 'Too many requests, please try again later' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const rawEmail = (body as { email?: string } | null)?.email;
  if (!rawEmail || !isValidEmail(rawEmail)) {
    return c.json({ error: 'Invalid email' }, 422);
  }
  const email = rawEmail.toLowerCase();

  const generic = {
    message: 'If that email is connected to any Spaces, the list is on its way.',
  };

  // Per-email limit, independent of IP, so a victim's inbox can't be spammed
  // from rotating IPs. Still returns the generic message either way.
  if (!checkRateLimit(`find-spaces-email:${rateLimitEmailKey(email)}`, 1, CODE_REQUEST_WINDOW_MS)) {
    return c.json(generic);
  }

  const lookup = emailIndex(email);
  const spaces = await db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(members)
    .innerJoin(projects, eq(members.projectId, projects.id))
    .where(and(eq(members.emailLookup, lookup), eq(members.emailVerified, true)));

  // Mint one single-use login code per Space and email the sign-in links. Run
  // OFF the response path so find-spaces takes the same time whether or not the
  // email matched: doing the per-Space DB writes + SMTP inline (only on the
  // matched branch) would be a timing oracle for Space membership, which the
  // generic message exists to prevent. Minting can't log anyone out — nothing is
  // rotated until a code is redeemed (verify-login-code).
  const issueLoginLinks = async (): Promise<{ slug: string; name: string; code: string }[]> => {
    if (spaces.length === 0) return [];
    // Opportunistic cleanup keeps the table small.
    await db
      .delete(loginVerifications)
      .where(
        or(lt(loginVerifications.expiresAt, new Date()), isNotNull(loginVerifications.usedAt)),
      );

    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);
    const withCodes: { slug: string; name: string; code: string }[] = [];
    for (const space of spaces) {
      const code = generateCode();
      // One active code per (project, email): drop any prior unused row.
      await db
        .delete(loginVerifications)
        .where(
          and(
            eq(loginVerifications.projectId, space.id),
            eq(loginVerifications.emailLookup, lookup),
          ),
        );
      await db
        .insert(loginVerifications)
        .values({ projectId: space.id, ...encryptedEmailFields(email), code, expiresAt });
      withCodes.push({ slug: space.slug, name: space.name, code });
    }
    await sendSpacesList(email, withCodes);
    return withCodes;
  };

  // In dev the test/UI needs the codes echoed, so await; in prod return the
  // generic message immediately and let minting + email run in the background.
  if (devBypass) {
    const withCodes = await issueLoginLinks();
    return c.json({ ...generic, devSpaces: withCodes });
  }
  void issueLoginLinks().catch((err) => console.error('Failed to issue spaces list', err));
  return c.json(generic);
});

// POST /api/auth/request-creation-code - Email a 6-digit code to gate project creation
publicAuthRoutes.post('/request-creation-code', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`create-code:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW_MS)) {
    return c.json({ error: 'Too many requests, please try again later' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = RequestCreationCodeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid email' }, 422);
  }
  const email = parsed.data.email.toLowerCase();

  // Per-email throttle keyed on the plus-stripped address, independent of IP,
  // so a victim's inbox can't be flooded with codes via bob+1@, bob+2@, ...
  // aliases sent from rotating IPs. Mirrors the guard on find-spaces / login-code.
  const emailThrottleKey = `create-code-email:${rateLimitEmailKey(email)}`;
  if (!checkRateLimit(emailThrottleKey, 1, CODE_REQUEST_WINDOW_MS)) {
    return c.json({ error: 'Please wait before requesting another code' }, 429);
  }

  const lookup = emailIndex(email);

  // Sweep expired/used rows opportunistically so this table stays small.
  await db
    .delete(creationVerifications)
    .where(
      or(lt(creationVerifications.expiresAt, new Date()), isNotNull(creationVerifications.usedAt)),
    );

  // Durable backstop for the in-memory throttle above: same window but keyed
  // on the exact email, and it survives a restart. Normally shadowed by the
  // in-memory check (same two-layer pattern as integration.ts POST /spaces).
  const recent = await db.query.creationVerifications.findFirst({
    where: and(
      eq(creationVerifications.emailLookup, lookup),
      gte(creationVerifications.createdAt, new Date(Date.now() - CODE_REQUEST_WINDOW_MS)),
    ),
  });
  if (recent) {
    return c.json({ error: 'Please wait before requesting another code' }, 429);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  await db.delete(creationVerifications).where(eq(creationVerifications.emailLookup, lookup));
  await db
    .insert(creationVerifications)
    .values({ ...encryptedEmailFields(email), code, expiresAt });

  try {
    await sendVerificationCode(email, code, 'your new Space');
  } catch (err) {
    // Don't leave a row the user can never receive; that would also lock them
    // out for the full per-email window with no working code. Refund the
    // in-memory slot too, or the retry still 429s despite no code sent.
    releaseRateLimit(emailThrottleKey);
    await db.delete(creationVerifications).where(eq(creationVerifications.emailLookup, lookup));
    throw err;
  }

  return c.json({
    message: 'Verification code sent',
    ...(devBypass ? { devCode: code } : {}),
  });
});

// Per-email attempt cap for /connect (§10.1). This endpoint mints an
// account-wide PAT and revokes the victim's active token on a hit, so a plain
// per-IP limit lets N proxied IPs = N× guesses at a 6-digit code. Counting every
// attempt per email (blind index) — mirroring verification.ts's email-keyed cap —
// bounds total guesses regardless of IP; the 2-min re-plant cooldown does the rest.
const CONNECT_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const CONNECT_ATTEMPT_EMAIL_LIMIT = 5;

// Issue a member session token for a verified membership of this email so a
// device that just proved email ownership (a valid code) resolves warm — signed
// into one of its Spaces — instead of landing on the join form and being asked
// for a name. Additive: inserts one member_tokens row, never touches the
// account-wide PAT and never logs other devices out. Takes the memberRows the
// caller already loaded (no re-query). Null if no verified member exists — can't
// happen when a key is active, but degrade gracefully rather than throw.
async function seedWitnessSession(
  memberRows: (typeof members.$inferSelect)[],
): Promise<ConnectWitness | null> {
  const member = memberRows.find((m) => m.emailVerified);
  if (!member) return null;
  // The member.projectId FK is NOT NULL and valid, so this can't miss (mirrors
  // the `connected` branch's project! below).
  const project = await db.query.projects.findFirst({ where: eq(projects.id, member.projectId) });
  const memberToken = await issueMemberToken(db, member.id);
  return { slug: project!.slug, memberToken, memberId: member.id, projectName: project!.name };
}

// POST /api/auth/connect - Mint an integration key for a RETURNING user
// (existing membership) from email + code, so they never create a duplicate
// Space. Password-equivalent, so it carries the full §10 guard set. Body:
// { email, code, force? }.
publicAuthRoutes.post('/connect', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`connect-ip:${ip}`, 10, PER_IP_WINDOW_MS)) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ConnectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request' }, 422);
  }
  const email = parsed.data.email.toLowerCase();
  const { code, force } = parsed.data;
  const lookup = emailIndex(email);

  // §10.1: per-email cap counted BEFORE the code check, so wrong guesses count
  // toward it and a valid guess after the cap is still refused.
  if (
    !checkRateLimit(
      `connect-code-email:${lookup.toString('hex')}`,
      CONNECT_ATTEMPT_EMAIL_LIMIT,
      CONNECT_ATTEMPT_WINDOW_MS,
    )
  ) {
    return c.json({ error: 'Too many attempts, please try again later' }, 429);
  }

  // §10.6: verify the code BEFORE any account/membership/token query, and do NOT
  // consume it yet. Only the email owner holds a valid code, so a wrong/absent
  // code is an identical 401 for every email — that ordering is the enumeration
  // defense and must not be reordered.
  const verification = await db.query.creationVerifications.findFirst({
    where: and(
      eq(creationVerifications.emailLookup, lookup),
      eq(creationVerifications.code, code),
      isNull(creationVerifications.usedAt),
      gt(creationVerifications.expiresAt, new Date()),
    ),
  });
  if (!verification) {
    return c.json({ error: 'Invalid or expired verification code' }, 401);
  }

  // §10.2: detect membership by emailLookup ONLY — NOT loadIntegrationScope,
  // which also filters tosVersion === TOS_VERSION, so every user on a prior ToS
  // would read as no-account → duplicate Space + a silent token revoke.
  const memberRows = await db.query.members.findMany({
    where: eq(members.emailLookup, lookup),
  });
  if (memberRows.length === 0) {
    // §10.5: machine-readable discriminator; the code is left UNUSED so the web
    // falls through to createProject with the SAME code (no duplicate mint).
    return c.json({ code: 'no-account', error: 'No account for this email' }, 404);
  }

  // §4: a key is already active elsewhere and the caller didn't opt into
  // replacing it → surface the never-silent reconnect screen. Code left UNUSED.
  if (!force) {
    const active = await findActiveToken(db, lookup);
    if (active) {
      // The code above already proved email ownership, so sign this device in
      // too (a member session token) — otherwise a later Space visit hits the
      // join form. NOTE: this makes the branch no longer read-only (one
      // member_tokens insert). The code is left UNUSED so a follow-up
      // force-regenerate reuses it; issuing a session doesn't consume it or the PAT.
      const witness = await seedWitnessSession(memberRows);
      return c.json({
        status: 'already-connected',
        apiToken: serializeApiToken(active),
        email,
        ...(witness ? { witness } : {}),
      });
    }
  }

  // Consume + (optional) upgrade + refresh-ToS + revoke + mint, all in one transaction.
  const emailColumns = {
    emailCiphertext: verification.emailCiphertext,
    emailIv: verification.emailIv,
    emailLookup: verification.emailLookup,
  };
  const result = await db.transaction(async (tx) => {
    // §10.7: claim the code with usedAt IS NULL in the predicate; 0 rows means a
    // concurrent request already consumed it — bail so two force taps can't both
    // revoke-and-mint (which would violate idx_api_tokens_active_email → 500).
    const claimed = await tx
      .update(creationVerifications)
      .set({ usedAt: new Date() })
      .where(
        and(eq(creationVerifications.id, verification.id), isNull(creationVerifications.usedAt)),
      )
      .returning({ id: creationVerifications.id });
    if (claimed.length === 0) return null;

    // §10.3: mint against a verified member. If only unverified members exist,
    // the just-verified code proves email control, so upgrade one to verified
    // (don't 404 into a duplicate Space). Upgrading a single row is enough — the
    // PAT is account-wide by emailLookup — and avoids the per-Space verified
    // unique index that upgrading siblings in one Space could trip.
    let witnessMember = memberRows.find((m) => m.emailVerified);
    if (!witnessMember) {
      const [upgraded] = await tx
        .update(members)
        .set({ emailVerified: true, tosVersion: TOS_VERSION, tosAcceptedAt: new Date() })
        .where(eq(members.id, memberRows[0].id))
        .returning();
      witnessMember = upgraded;
    }

    // The connect page collects consent (<LegalNotice action="connecting">), and the
    // account-wide PAT is resolved by loadIntegrationScope, which gates on
    // tosVersion === TOS_VERSION. Refresh every verified membership so a returning
    // user on a prior ToS gets a functional key, not one that resolves to 0 Spaces.
    await tx
      .update(members)
      .set({ tosVersion: TOS_VERSION, tosAcceptedAt: new Date() })
      .where(and(eq(members.emailLookup, lookup), eq(members.emailVerified, true)));

    await revokeActiveTokens(tx, lookup);
    const { token } = await mintApiToken(tx, emailColumns);
    // Seed the new device as a witness: a member session token it can store so a
    // later visit resolves warm (verified-ready) instead of cold. The witness
    // project FK is valid, so this findFirst can't miss.
    const memberToken = await issueMemberToken(tx, witnessMember.id);
    const project = await tx.query.projects.findFirst({
      where: eq(projects.id, witnessMember.projectId),
    });
    return { token, memberToken, memberId: witnessMember.id, project: project! };
  });
  if (!result) {
    return c.json({ error: 'Invalid or expired verification code' }, 401);
  }

  return c.json({
    status: 'connected',
    token: result.token,
    email,
    witness: {
      slug: result.project.slug,
      memberToken: result.memberToken,
      memberId: result.memberId,
      projectName: result.project.name,
    },
  });
});
