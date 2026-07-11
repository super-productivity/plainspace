import { randomInt } from 'node:crypto';

// Shared pieces of the emailed 6-digit code flows (login recovery, email
// verification, Space creation). The timing constants live in @plainspace/shared
// so the web countdowns/expiry checks can't drift from the server; re-exported
// here so existing importers of email-codes.js are unaffected.
export { CODE_EXPIRY_MS, CODE_REQUEST_WINDOW_MS } from '@plainspace/shared';

export function isValidEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) && str.length <= 255;
}

export function isValidCode(str: string): boolean {
  return /^\d{6}$/.test(str);
}

export function generateCode(): string {
  // randomInt's upper bound is exclusive, so use 1_000_000 to include 999999.
  return randomInt(100000, 1000000).toString();
}
