import { memberForToken } from './member-tokens.js';
import { decryptStoredEmail } from './email-crypto.js';

// A "proof token" is an ordinary per-Space member bearer token the browser
// already holds for ANOTHER Space. Authentication is global (one credential
// reaches many Spaces), so holding a token for a member whose email is verified
// proves control of that email — the same trust basis as receiving an emailed
// code. We reuse it to let a returning user create or join a new Space without
// a fresh code, building on the existing token + blind-index machinery: no new
// credential type, no new table.
//
// Returns the member's normalized verified email, or null when the token is
// unknown or its member has no verified email.
export async function resolveProofEmail(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const member = await memberForToken(token);
  if (!member || !member.emailVerified) return null;
  // Stored emails are normalized on write (encryptedEmailFields), so this is the
  // canonical lowercase form ready for comparison / re-encryption.
  return decryptStoredEmail(member);
}
