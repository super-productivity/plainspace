import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

// A minimal Solid + jsdom harness. We deliberately don't reuse vite.config.ts
// (PWA/proxy/build config) — tests only need the Solid plugin so JSX compiles
// and reactive primitives behave.
export default defineConfig({
  plugins: [solid()],
  // Solid ships separate dev/prod and server/browser builds; vitest must pick
  // the browser dev build or reactivity/JSX rendering won't work under jsdom.
  resolve: {
    conditions: ['development', 'browser'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
  },
});
