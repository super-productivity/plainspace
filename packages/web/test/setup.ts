import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

// jsdom gives us localStorage, but state leaks between tests; wipe it so each
// test starts from a clean device.
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});
