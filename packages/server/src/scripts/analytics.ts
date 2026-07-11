// Server analytics snapshot. On the box, the db publishes no host port and
// the prod checkout has no node_modules (deploys are image-only), so run it
// inside the app container (same access path scripts/stats.sh uses):
//   docker compose exec app node_modules/.bin/tsx packages/server/src/scripts/analytics.ts
//   ... analytics.ts --json     (machine-readable, e.g. for cron → a log)
// In dev: npm run analytics (from packages/server, or `-w @plainspace/server`).
//
// Read-only: every query is a SELECT, so it's safe to run in production.
// "Active" is derived from the activity log (distinct member_id / project_id
// in a trailing window) — there's no last_seen column, and the activity feed
// is the closest thing to a heartbeat we keep.
import { pgClient as sql } from '../db/connection.js';

const json = process.argv.includes('--json');

// Trailing-window day counts share one shape: a scalar count over rows whose
// `col` falls within the last `days`. Kept as a helper so the report below
// reads as a list of metrics rather than a wall of near-identical SQL.
async function countSince(table: string, col: string, days: number): Promise<number> {
  const [row] = await sql.unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${col} >= now() - interval '${days} days'`,
  );
  return row.n;
}

async function distinctActive(col: 'member_id' | 'project_id', days: number): Promise<number> {
  const [row] = await sql.unsafe(
    `SELECT count(DISTINCT ${col})::int AS n FROM activity
     WHERE ${col} IS NOT NULL AND created_at >= now() - interval '${days} days'`,
  );
  return row.n;
}

type PanelCount = { type: string; n: number };

async function collect() {
  const [
    [projTotals],
    spacesNew7,
    spacesNew30,
    activeSpaces7,
    activeSpaces30,
    [memberTotals],
    membersNew7,
    membersNew30,
    activeUsers7,
    activeUsers30,
    [sessions],
    [itemTotals],
    itemsNew7,
    [lists],
    [scratchpads],
    panelsByType,
  ] = await Promise.all([
    sql`SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE sharing_mode = 'open')::int AS open,
          count(*) FILTER (WHERE sharing_mode = 'private')::int AS private
        FROM projects`,
    countSince('projects', 'created_at', 7),
    countSince('projects', 'created_at', 30),
    distinctActive('project_id', 7),
    distinctActive('project_id', 30),
    sql`SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE email_verified)::int AS verified,
          count(*) FILTER (WHERE email_lookup IS NOT NULL)::int AS with_email
        FROM members`,
    countSince('members', 'joined_at', 7),
    countSince('members', 'joined_at', 30),
    distinctActive('member_id', 7),
    distinctActive('member_id', 30),
    sql`SELECT count(*)::int AS sessions, count(DISTINCT member_id)::int AS members
        FROM member_tokens
        WHERE expires_at > now()`,
    sql`SELECT
          count(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
          count(*) FILTER (WHERE deleted_at IS NULL AND checked)::int AS checked,
          count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted
        FROM items`,
    countSince('items', 'created_at', 7),
    sql`SELECT count(*)::int AS n FROM lists`,
    sql`SELECT count(*)::int AS n FROM scratchpads WHERE content <> ''`,
    sql<PanelCount[]>`SELECT type, count(*)::int AS n FROM panels GROUP BY type ORDER BY type`,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    spaces: {
      total: projTotals.total,
      open: projTotals.open,
      private: projTotals.private,
      new7d: spacesNew7,
      new30d: spacesNew30,
      active7d: activeSpaces7,
      active30d: activeSpaces30,
    },
    users: {
      total: memberTotals.total,
      withEmail: memberTotals.with_email,
      emailVerified: memberTotals.verified,
      new7d: membersNew7,
      new30d: membersNew30,
      active7d: activeUsers7,
      active30d: activeUsers30,
      openSessions: sessions.sessions,
      signedInMembers: sessions.members,
    },
    content: {
      itemsLive: itemTotals.live,
      itemsChecked: itemTotals.checked,
      itemsDeleted: itemTotals.deleted,
      itemsNew7d: itemsNew7,
      lists: lists.n,
      scratchpadsWithContent: scratchpads.n,
      panels: Object.fromEntries(panelsByType.map((r) => [r.type, r.n])),
    },
  };
}

function printReport(s: Awaited<ReturnType<typeof collect>>) {
  const row = (label: string, value: number | string) =>
    console.log(`  ${label.padEnd(24)} ${value}`);

  console.log(`\nPlainspace analytics — ${s.generatedAt}`);

  console.log('\nSpaces');
  row('total', s.spaces.total);
  row('open / private', `${s.spaces.open} / ${s.spaces.private}`);
  row('new (7d / 30d)', `${s.spaces.new7d} / ${s.spaces.new30d}`);
  row('active (7d / 30d)', `${s.spaces.active7d} / ${s.spaces.active30d}`);

  console.log('\nUsers');
  row('total members', s.users.total);
  row('with email', s.users.withEmail);
  row('email verified', s.users.emailVerified);
  row('new (7d / 30d)', `${s.users.new7d} / ${s.users.new30d}`);
  row('active (7d / 30d)', `${s.users.active7d} / ${s.users.active30d}`);
  row('open sessions', s.users.openSessions);
  row('signed-in members', s.users.signedInMembers);

  console.log('\nContent');
  row('items live', s.content.itemsLive);
  row('items checked', s.content.itemsChecked);
  row('items deleted', s.content.itemsDeleted);
  row('items new (7d)', s.content.itemsNew7d);
  row('lists', s.content.lists);
  row('scratchpads', s.content.scratchpadsWithContent);
  for (const [type, n] of Object.entries(s.content.panels)) row(`panels: ${type}`, n);
  console.log();
}

async function main() {
  const snapshot = await collect();
  if (json) console.log(JSON.stringify(snapshot, null, 2));
  else printReport(snapshot);
  await sql.end();
}

main().catch((err) => {
  console.error('Analytics failed:', err);
  process.exit(1);
});
