import { pgClient } from '../db/connection.js';

// Postgres advisory-lock keys, one per background job. Distinct keys so the
// sweepers never block each other — a lock only excludes another copy of the
// same job (e.g. a second app process during a deploy-overlap window).
export const ADVISORY_LOCK = {
  reminderSweep: 1,
  retentionSweep: 2,
} as const;

// Runs `fn` only if this process can take `key`; otherwise the tick is skipped
// because another instance holds it. The lock is transaction-scoped
// (pg_try_advisory_xact_lock), so it auto-releases on commit OR crash — there
// is no leaked-lock failure mode. This makes the sweepers correct even if more
// than one process runs them; RUN_SWEEPERS=0 on replicas just avoids the
// wasted lock attempt.
export async function withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<void> {
  await pgClient.begin(async (tx) => {
    const [row] = await tx<
      { locked: boolean }[]
    >`select pg_try_advisory_xact_lock(${key}) as locked`;
    if (!row?.locked) return;
    await fn();
  });
}
