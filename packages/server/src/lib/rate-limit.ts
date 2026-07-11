// Tiny in-memory IP rate limiter. Single-instance only; if we ever scale
// horizontally this must move to Redis or the DB.
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

// Refund one consumed slot — for when the side effect the limit guards (e.g.
// an email send) failed, so the user's retry shouldn't be 429'd.
export function releaseRateLimit(key: string): void {
  const bucket = buckets.get(key);
  if (bucket && bucket.count > 0) bucket.count--;
}

const sweepInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  },
  5 * 60 * 1000,
);
sweepInterval.unref();

// X-Forwarded-For is honored only when we sit behind a trusted reverse proxy,
// otherwise clients can spoof it freely and bypass every IP-keyed limit.
const trustProxy = process.env.TRUST_PROXY === '1';

export function getClientIp(c: Context): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      // Read the *last* hop. The recommended nginx config (docs/self-hosting.md
      // §5) overwrites XFF with $remote_addr, so there is only one value here;
      // if that config ever drifts back to appending, the trusted proxy
      // still puts the real client address at the end. Reading the leftmost
      // would hand control of the rate-limit key to whatever the client put
      // in the header. Assumes exactly one trusted reverse-proxy hop in
      // front; add more hops only if you can verify each one.
      const hops = xff
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      if (hops.length > 0) return hops[hops.length - 1];
    }
    const real = c.req.header('x-real-ip');
    if (real) return real;
  }
  return getConnInfo(c).remote.address ?? 'unknown';
}

// Canonicalise an email for rate-limit aggregation: lowercase, then strip
// `+suffix` from the local part. Gmail/Outlook/Proton/Fastmail all deliver
// `addr+tag@…` to the `addr@…` inbox, so without this an attacker generates
// N plus-tag variants and bypasses the per-email limit while every message
// still lands in the target's single mailbox.
//
// Rate-limit-only canonicalisation. DB lookups continue to use the
// un-stripped email (and its blind index) because the application
// legitimately treats `a+x@example.com` and `a+y@example.com` as distinct
// member identities.
export function rateLimitEmailKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at < 0) return normalized;
  const local = normalized.slice(0, at).split('+')[0];
  return `${local}${normalized.slice(at)}`;
}
