import { defineConfig } from 'vitest/config';

// Set test env vars at config-eval time so they're visible to both vitest's
// global setup (which runs in the main vitest process) and the worker
// processes (which inherit env from the parent).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://spaces:spaces@localhost:5434/spaces_test';
// email.ts fails closed: any NODE_ENV other than 'development' requires SMTP_HOST,
// so tests that import the full app (e.g. routes) need a dummy host to load.
process.env.SMTP_HOST ??= 'smtp.test.local';
// email-crypto.ts fails closed the same way: any non-development NODE_ENV needs
// the at-rest email keys. Provide fixed distinct dummy keys so the suite loads.
process.env.PLAINSPACE_EMAIL_ENC_KEY ??= '/jZuXs2waC9+CHImg28h1nd4MgWKVMF/I+7oqVL1rOY=';
process.env.PLAINSPACE_EMAIL_INDEX_KEY ??= 'Oxwdadg6fW/Wdk9mn7M6qMuUR203Yo6zsyDTeLKB9yg=';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-each.ts'],
    // Tests share a single Postgres test DB and truncate between each test;
    // running files in parallel would corrupt that shared state.
    fileParallelism: false,
    pool: 'forks',
  },
});
