import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startRetentionSweeper } from './services/retention.js';
import { startReminderSweeper } from './services/reminder-sweep.js';

const app = createApp();
const port = parseInt(process.env.PORT || '3000', 10);

// Each sweep tick takes a Postgres advisory lock, so it is safe even if two
// processes briefly overlap (e.g. during a deploy). They run by default; a
// replica can still set RUN_SWEEPERS=0 to skip the redundant lock attempt so
// exactly one node owns the background work.
if (process.env.RUN_SWEEPERS !== '0') {
  startRetentionSweeper();
  startReminderSweeper();
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Plainspace server running on http://localhost:${port}`);
});
