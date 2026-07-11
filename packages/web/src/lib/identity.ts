import { clearPushToken, storePushToken } from './push-tokens';

interface StoredIdentity {
  token: string;
  memberId: string;
  name?: string;
}

export interface KnownSpace {
  slug: string;
  name: string | null;
}

const STORAGE_PREFIX = 'spaces:projects:';
const LAST_OPEN_SPACE_KEY = 'spaces:lastOpenSpace';
const PLAINSPACE_EMAIL_KEY = 'spaces:plainspaceEmail';
// A connect flow that reached the code step; the resolver restores straight to
// `verify` from this so a reload/app-switch mid-verify resumes instead of
// dead-ending on the 2-min resend cooldown.
const PENDING_CONNECT_KEY = 'spaces:pendingConnect';
// Slug of a Space where the saved email is verified. Its member token doubles
// as a "proof token": the server accepts it as proof of email control so new
// Spaces can be created/joined without a fresh code. Saved/cleared with the
// email it backs.
const VERIFIED_WITNESS_KEY = 'spaces:verifiedWitness';

function read(slug: string): StoredIdentity | null {
  try {
    const data = localStorage.getItem(STORAGE_PREFIX + slug);
    if (!data) return null;
    return JSON.parse(data) as StoredIdentity;
  } catch {
    return null;
  }
}

export function getToken(slug: string): string | null {
  return read(slug)?.token ?? null;
}

export function getMemberId(slug: string): string | null {
  return read(slug)?.memberId ?? null;
}

export function saveIdentity(slug: string, token: string, memberId: string, name?: string): void {
  const existing = read(slug);
  const next: StoredIdentity = {
    token,
    memberId,
    ...((name ?? existing?.name) ? { name: name ?? existing?.name } : {}),
  };
  localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(next));
  // Mirror the token for the SW so notification action buttons can authenticate.
  // Wired here (not only on push subscribe) so a token rotation — merge/connect
  // flows call saveIdentity without re-subscribing — refreshes the mirror too.
  void storePushToken(slug, token);
}

export function updateIdentityName(slug: string, name: string): void {
  const existing = read(slug);
  if (!existing || existing.name === name) return;
  localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify({ ...existing, name }));
}

export function hasIdentity(slug: string): boolean {
  return getToken(slug) !== null;
}

export function clearIdentity(slug: string): void {
  localStorage.removeItem(STORAGE_PREFIX + slug);
  if (localStorage.getItem(LAST_OPEN_SPACE_KEY) === slug) {
    localStorage.removeItem(LAST_OPEN_SPACE_KEY);
  }
  // §10.8 dead-witness self-heal: a cleared witness Space must drop the witness
  // pointer too, else a deleted witness perpetually routes returning users to
  // the cold "set up your first Space" path.
  if (localStorage.getItem(VERIFIED_WITNESS_KEY) === slug) {
    localStorage.removeItem(VERIFIED_WITNESS_KEY);
  }
  // Drop the SW's mirrored copy of this Space's token (best-effort, async).
  void clearPushToken(slug);
}

export function getLastOpenSpace(): KnownSpace | null {
  const slug = localStorage.getItem(LAST_OPEN_SPACE_KEY);
  if (!slug) return null;
  const entry = read(slug);
  if (!entry) return null;
  return { slug, name: entry.name ?? null };
}

export function setLastOpenSpace(slug: string): void {
  if (!read(slug)) return;
  localStorage.setItem(LAST_OPEN_SPACE_KEY, slug);
}

export function getPlainspaceEmail(): string {
  try {
    return localStorage.getItem(PLAINSPACE_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlainspaceEmail(email: string): void {
  const value = email.trim();
  if (!value) return;
  try {
    localStorage.setItem(PLAINSPACE_EMAIL_KEY, value);
  } catch {
    /* storage may be unavailable */
  }
}

export function clearPlainspaceEmail(): void {
  try {
    localStorage.removeItem(PLAINSPACE_EMAIL_KEY);
    // The witness backs the saved email, so forgetting one forgets both.
    localStorage.removeItem(VERIFIED_WITNESS_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

// Remember a Space where the saved email is now verified, so its token can later
// prove email control when creating/joining other Spaces.
export function saveVerifiedWitnessSlug(slug: string): void {
  try {
    localStorage.setItem(VERIFIED_WITNESS_KEY, slug);
  } catch {
    /* storage may be unavailable */
  }
}

// A token proving control of the saved email: the member token of the witness
// Space. Null if there's no witness or its identity is gone on this device.
export function getProofToken(): string | null {
  let slug: string | null;
  try {
    slug = localStorage.getItem(VERIFIED_WITNESS_KEY);
  } catch {
    return null;
  }
  return slug ? getToken(slug) : null;
}

// The witness slug, but only when its member token still exists on this device
// (§10.8): mirrors getProofToken's null-when-token-gone semantics so a witness
// whose Space identity was cleared doesn't route returning users as brand-new.
export function getVerifiedWitnessSlug(): string | null {
  let slug: string | null;
  try {
    slug = localStorage.getItem(VERIFIED_WITNESS_KEY);
  } catch {
    return null;
  }
  if (!slug) return null;
  return getToken(slug) ? slug : null;
}

// A connect flow paused at the code step. `requestedAt` bounds both the resend
// cooldown and how long the resolver will resume it (the code's own expiry).
// `name`/`spaceName` are carried so a brand-new user who resumes here (no name
// field on the verify screen) can still complete createProject, whose
// displayName is required — without them the resumed create would 422-loop.
export interface PendingConnect {
  email: string;
  step: 'verify';
  requestedAt: number;
  name?: string;
  spaceName?: string;
}

export function getPendingConnect(): PendingConnect | null {
  try {
    const raw = localStorage.getItem(PENDING_CONNECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingConnect;
    if (!parsed.email || parsed.step !== 'verify' || typeof parsed.requestedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingConnect(pending: PendingConnect): void {
  try {
    localStorage.setItem(PENDING_CONNECT_KEY, JSON.stringify(pending));
  } catch {
    /* storage may be unavailable */
  }
}

export function clearPendingConnect(): void {
  try {
    localStorage.removeItem(PENDING_CONNECT_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

// Build a "#claim=<token>.<memberId>" hand-off URL (the inverse of parseClaim).
// The secret rides in the fragment, never the query: fragments are not sent to
// the server, so the token stays out of access logs and the Referer header.
// nanoid's URL-safe alphabet has no `.`, so the split is unambiguous. Absolute
// so it works when copied/opened on another device.
export function buildClaimUrl(slug: string, token: string, memberId: string): string {
  return `${window.location.origin}/${slug}#claim=${token}.${memberId}`;
}

// Parse a "#claim=<token>.<memberId>" hand-off fragment (the "use on another
// device" link). Returns null when the fragment isn't a well-formed claim.
export function parseClaim(hash: string): { token: string; memberId: string } | null {
  if (!hash.startsWith('#claim=')) return null;
  const claim = hash.slice('#claim='.length);
  const dot = claim.indexOf('.');
  if (dot <= 0) return null;
  const token = claim.slice(0, dot);
  const memberId = claim.slice(dot + 1);
  if (!token || !memberId) return null;
  return { token, memberId };
}

// Parse a "#login=<code>.<base64url(email)>" magic recovery link (emailed by
// "Find my Spaces"). Returns the email + code to redeem for a fresh token, or
// null when the fragment isn't a well-formed login link. Like the claim link,
// the secret rides in the fragment so it never reaches the server's logs.
export function parseLoginLink(hash: string): { email: string; code: string } | null {
  if (!hash.startsWith('#login=')) return null;
  const value = hash.slice('#login='.length);
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const code = value.slice(0, dot);
  const emailB64 = value.slice(dot + 1);
  if (!code || !emailB64) return null;
  try {
    const b64 = emailB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const email = new TextDecoder().decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0)));
    if (!email) return null;
    return { email, code };
  } catch {
    return null;
  }
}

export function listKnownSpaces(): KnownSpace[] {
  const out: KnownSpace[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const slug = key.slice(STORAGE_PREFIX.length);
    if (!slug) continue;
    const entry = read(slug);
    if (!entry) continue;
    out.push({ slug, name: entry.name ?? null });
  }
  return out.sort((a, b) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug));
}
