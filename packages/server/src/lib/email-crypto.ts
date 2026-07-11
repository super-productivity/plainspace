import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// AES-256-GCM at-rest encryption for member email addresses, plus a separate
// HMAC-SHA256 blind index for equality lookups (recovery flow, /verify
// collision check, duplicate-token guard).
//
// Two distinct keys: a host-disk image must yield only ciphertext + index
// without enabling either offline decryption of stored emails or offline
// dictionary attacks against the index. Mirrors the CipherSweet / Ankane
// blind_index pattern.
//
// Keys live in env (Docker secret in production). 32 bytes each, base64.
//
// shortcut: single static key pair, no key-version column on the ciphertext —
// rotating either key requires a one-off decrypt-and-re-encrypt migration
// across every email/emailLookup column (members, verifications, api_tokens,
// dsa_notices). Add a version byte alongside the IV if rotation ever needs to
// be routine.

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits is the AES-GCM standard
const GCM_TAG_BYTES = 16;

function decodeKey(name: string, raw: string): Buffer {
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(`${name} is not valid base64`);
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to exactly ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

let encKey: Buffer | null = null;
let indexKey: Buffer | null = null;

function loadKeys(): { enc: Buffer; index: Buffer } {
  if (encKey && indexKey) return { enc: encKey, index: indexKey };

  const rawEnc = process.env.PLAINSPACE_EMAIL_ENC_KEY;
  const rawIndex = process.env.PLAINSPACE_EMAIL_INDEX_KEY;

  if (rawEnc && rawIndex) {
    encKey = decodeKey('PLAINSPACE_EMAIL_ENC_KEY', rawEnc);
    indexKey = decodeKey('PLAINSPACE_EMAIL_INDEX_KEY', rawIndex);
    if (encKey.equals(indexKey)) {
      throw new Error('PLAINSPACE_EMAIL_ENC_KEY and PLAINSPACE_EMAIL_INDEX_KEY must be distinct');
    }
    return { enc: encKey, index: indexKey };
  }

  // Fail-closed: only an explicit 'development' NODE_ENV gets ephemeral keys.
  // Any other value (production, staging, test, or a mistyped/unset one) must
  // supply real keys, so a deploy typo can't silently encrypt data with
  // throwaway keys that vanish on the next restart. Mirrors services/email.ts.
  if (process.env.NODE_ENV !== 'development') {
    throw new Error(
      'PLAINSPACE_EMAIL_ENC_KEY and PLAINSPACE_EMAIL_INDEX_KEY must be set ' +
        '(32 random bytes each, base64-encoded) outside development. Generate with: ' +
        '`openssl rand -base64 32`. For local dev, set NODE_ENV=development instead.',
    );
  }

  encKey = randomBytes(KEY_BYTES);
  indexKey = randomBytes(KEY_BYTES);
  console.warn(
    'PLAINSPACE_EMAIL_ENC_KEY / PLAINSPACE_EMAIL_INDEX_KEY not set; generated ' +
      'ephemeral keys. Encrypted emails written before this restart are unreadable now.',
  );
  return { enc: encKey, index: indexKey };
}

if (process.env.NODE_ENV !== 'development') {
  loadKeys();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface EncryptedEmail {
  ciphertext: Buffer;
  iv: Buffer;
  lookup: Buffer;
}

export function encryptEmail(email: string): EncryptedEmail {
  const { enc, index } = loadKeys();
  const normalized = normalizeEmail(email);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', enc, iv);
  const ct = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store ciphertext || tag so decrypt is single-buffer; tag is the last 16 bytes.
  return {
    ciphertext: Buffer.concat([ct, tag]),
    iv,
    lookup: createHmac('sha256', index).update(normalized, 'utf8').digest(),
  };
}

export function decryptEmail(ciphertext: Buffer, iv: Buffer): string {
  const { enc } = loadKeys();
  if (ciphertext.length < GCM_TAG_BYTES) {
    throw new Error('ciphertext too short for AES-GCM');
  }
  const ct = ciphertext.subarray(0, ciphertext.length - GCM_TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', enc, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function emailIndex(email: string): Buffer {
  const { index } = loadKeys();
  return createHmac('sha256', index).update(normalizeEmail(email), 'utf8').digest();
}

// Shape callers spread into Drizzle `.values({ ...encryptedEmailFields(x) })`
// and `.set({ ...encryptedEmailFields(x) })` instead of repeating three keys.
export function encryptedEmailFields(plain: string): {
  emailCiphertext: Buffer;
  emailIv: Buffer;
  emailLookup: Buffer;
} {
  const { ciphertext, iv, lookup } = encryptEmail(plain);
  return { emailCiphertext: ciphertext, emailIv: iv, emailLookup: lookup };
}

// Decrypts a stored row's email. Members can have NULL email (display-name
// only), in which case the three columns are NULL together. Verification
// tables have NOT NULL columns; pass through without nullable handling.
export function decryptStoredEmail(row: {
  emailCiphertext: Buffer | null;
  emailIv: Buffer | null;
}): string | null {
  if (row.emailCiphertext === null && row.emailIv === null) return null;
  if (row.emailCiphertext === null || row.emailIv === null) {
    throw new Error('emailCiphertext and emailIv must be NULL together or both set');
  }
  return decryptEmail(row.emailCiphertext, row.emailIv);
}
