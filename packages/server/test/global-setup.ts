import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs once before any test file. Creates the test DB if missing and applies
// all drizzle migrations so each test starts from the production schema.
export async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const targetDb = url.pathname.replace(/^\//, '');

  // Connect to the default `postgres` DB to bootstrap the test DB. Postgres
  // doesn't support `CREATE DATABASE IF NOT EXISTS`, so catch the 42P04
  // ("database already exists") code and ignore.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${targetDb}"`);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== '42P04') throw err;
  } finally {
    await admin.end();
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') });
  await sql.end();
}
