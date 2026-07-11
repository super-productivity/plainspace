import { beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pgClient } from '../src/db/connection.js';

// Wipe every user table in the public schema before each test. Catalog-driven
// so new tables added by future migrations are picked up automatically — a
// hand-maintained list silently rotted whenever drizzle added a table. The
// drizzle migrations table lives in its own `drizzle` schema and is skipped.
beforeEach(async () => {
  await db.execute(sql`
    DO $$
    DECLARE names text;
    BEGIN
      SELECT string_agg(quote_ident(tablename), ', ') INTO names
      FROM pg_tables
      WHERE schemaname = 'public';
      IF names IS NOT NULL THEN
        EXECUTE 'TRUNCATE ' || names || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `);
});

afterAll(async () => {
  await pgClient.end({ timeout: 5 });
});
