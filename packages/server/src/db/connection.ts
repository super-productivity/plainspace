import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail at boot with a clear message — the postgres client would otherwise
  // fall back to localhost defaults and fail confusingly at the first query.
  throw new Error('DATABASE_URL must be set (see .env.example)');
}

// Bounded pool: at thousands of concurrent requests an unbounded pool would
// race past Postgres's max_connections (default 100) and fail every new query.
// statement_timeout is the backstop — a stuck query fails instead of pinning a
// pooled connection indefinitely. Both are env-tunable for a bigger box.
const sql = postgres(connectionString, {
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idle_timeout: 30,
  connect_timeout: 10,
  connection: {
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000),
  },
});
export const db = drizzle(sql, { schema });
export { sql as pgClient };
