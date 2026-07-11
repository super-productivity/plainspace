import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { createMemberId } from './member-identity';
import { parseClaim, parseLoginLink, saveIdentity } from './identity';

// Pins the `#claim=` device hand-off fix used by Project.tsx: the hand-off
// writes identity for the slug already on screen, so the member id must be a
// signal the caller refreshes (not a memo keyed on the unchanged slug). This
// exercises the real createMemberId the component uses, so the two can't drift.
const SLUG = 'team-trip';

describe('createMemberId', () => {
  it('starts from the saved identity for the slug', () => {
    createRoot((dispose) => {
      saveIdentity(SLUG, 'tok_existing', 'm-saved');
      const { myId } = createMemberId(SLUG);
      expect(myId()).toBe('m-saved');
      dispose();
    });
  });

  it('resolves a same-slug claim write after refresh — no reload needed', () => {
    createRoot((dispose) => {
      // Arrive with no identity yet; the claim rides in the URL fragment.
      const { myId, refresh } = createMemberId(SLUG);
      expect(myId()).toBeNull();

      // What Project.tsx's effect does: persist the parsed claim, then refresh.
      const claim = parseClaim('#claim=tok_abc.m-claimed');
      expect(claim).toEqual({ token: 'tok_abc', memberId: 'm-claimed' });
      saveIdentity(SLUG, claim!.token, claim!.memberId);
      refresh(SLUG);

      expect(myId()).toBe('m-claimed');
      dispose();
    });
  });
});

// base64url, UTF-8 safe — mirrors the server's `Buffer.from(email).toString('base64url')`.
function base64urlEmail(email: string): string {
  const bytes = new TextEncoder().encode(email);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('parseLoginLink', () => {
  it('parses a "#login=<code>.<base64url(email)>" magic recovery link', () => {
    const email = 'finder@example.com';
    expect(parseLoginLink(`#login=123456.${base64urlEmail(email)}`)).toEqual({
      email,
      code: '123456',
    });
  });

  it('round-trips a unicode email (the server encodes UTF-8, not Latin-1)', () => {
    const email = 'tëst@exämple.com';
    expect(parseLoginLink(`#login=123456.${base64urlEmail(email)}`)).toEqual({
      email,
      code: '123456',
    });
  });

  it('returns null for non-login fragments and malformed values', () => {
    expect(parseLoginLink('#claim=tok.m1')).toBeNull();
    expect(parseLoginLink('')).toBeNull();
    expect(parseLoginLink('#login=123456')).toBeNull(); // no email part
    expect(parseLoginLink('#login=.abc')).toBeNull(); // empty code
  });
});
