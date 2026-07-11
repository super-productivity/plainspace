import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { dsaNotices } from '../db/schema.js';
import { DsaNoticeSchema } from '@plainspace/shared';
import { readJson } from '../lib/json.js';
import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';
import { encryptedEmailFields } from '../lib/email-crypto.js';
import { sendDsaNoticeAck, sendDsaNoticeToOperator } from '../services/email.js';

// Per-IP rate limit for the unauthenticated notice form. 5 notices/hour is
// generous for a real reporter and tight enough to discourage spamming.
const NOTICE_RATE_LIMIT = 5;
const NOTICE_WINDOW_MS = 60 * 60 * 1000;

export const dsaRoutes = new Hono();

// POST /api/dsa/notice -- DSA Art. 16 notice intake
dsaRoutes.post('/notice', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`dsa-notice:${ip}`, NOTICE_RATE_LIMIT, NOTICE_WINDOW_MS)) {
    return c.json({ error: 'Too many notices submitted from this address. Try again later.' }, 429);
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = DsaNoticeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }
  const data = parsed.data;

  // Encrypt submitter email if provided. CSAM-category notices may legitimately
  // omit name + email under Art. 16(2)(c); we store NULL for all three columns
  // in that case.
  const encryptedEmail = data.submitterEmail
    ? encryptedEmailFields(data.submitterEmail.toLowerCase())
    : null;

  const [row] = await db
    .insert(dsaNotices)
    .values({
      contentLocation: data.contentLocation,
      projectSlug: data.projectSlug ?? null,
      itemId: data.itemId ?? null,
      attachmentId: data.attachmentId ?? null,
      category: data.category,
      reason: data.reason,
      submitterName: data.submitterName ?? null,
      submitterEmailCiphertext: encryptedEmail?.emailCiphertext ?? null,
      submitterEmailIv: encryptedEmail?.emailIv ?? null,
      submitterEmailLookup: encryptedEmail?.emailLookup ?? null,
      goodFaithConfirmed: data.goodFaithConfirmed,
    })
    .returning({ id: dsaNotices.id });

  // Operator alert (always) + submitter acknowledgement (when email provided).
  // Errors are logged; the row is already persisted so the legal record stands
  // even if SMTP is temporarily down.
  await sendDsaNoticeToOperator({
    noticeId: row.id,
    category: data.category,
    contentLocation: data.contentLocation,
    projectSlug: data.projectSlug ?? null,
    itemId: data.itemId ?? null,
    attachmentId: data.attachmentId ?? null,
    submitterName: data.submitterName ?? null,
    submitterEmail: data.submitterEmail ?? null,
    reason: data.reason,
  }).catch((err) => {
    console.error('Failed to forward DSA notice to operator', { noticeId: row.id, err });
  });

  if (data.submitterEmail) {
    await sendDsaNoticeAck({
      submitterEmail: data.submitterEmail,
      noticeId: row.id,
    }).catch((err) => {
      console.error('Failed to send DSA notice ack', { noticeId: row.id, err });
    });
  }

  return c.json({ noticeId: row.id }, 201);
});
