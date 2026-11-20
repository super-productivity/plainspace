import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

// Regression for GHSA-h7mg-cq63-vhpq: hono < 4.13.16's RegExpRouter skipped
// wildcard middleware (where our auth lives) for paths containing an encoded
// line terminator. Every variant must still be rejected by the auth middleware.
describe('auth middleware on encoded paths', () => {
  const terminators = ['%0A', '%0D', '%E2%80%A8', '%E2%80%A9'];
  const paths = terminators.flatMap((t) => [
    `/api/integration/tasks${t}`,
    `/api/integration/tasks/abc${t}`,
    `/api/integration/${t}`,
  ]);

  it.each(paths)('GET %s without a token is 401', async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(401);
  });
});
