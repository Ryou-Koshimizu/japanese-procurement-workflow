// Public demo on a shared PostgreSQL (APP_MODE=demo with DEMO_DATABASE_URL).
// Serverless hosts run several instances, each with its own memory, so the
// in-process demo database would differ from request to request. With a
// shared database every instance sees the same fictional data. The database
// must be dedicated to the demo: it is created, seeded and wiped here.
import pg from 'pg';
import { pgDatabase, type Database } from './db';
import { schemaSql } from './schema';
import { DEMO_ORG, seedDemo } from './demo-seed';
import type { Deps } from './service';

const LOCK_KEY = 72_410_161;
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const TABLES =
  'app.audit_log, app.outbox, app.counters, app.quote_costs, app.quotes, app.maker_quotes, app.order_lines, app.order_messages, app.orders, app.makers, app.request_fields, app.catalog_items, app.catalog_images, app.catalog_sources, app.sessions, app.memberships, app.users, app.stores, app.organizations';
/** The schema version this code expects (app.schema_version() in db/schema.sql). */
const SCHEMA_VERSION = 2;

export type SharedDemo = {
  db: Database;
  /** Re-seed when the data is older than a day, or always with force. */
  refresh(force?: boolean): Promise<void>;
};

/**
 * Setup and resets run as the connection's own role (the owner of the demo
 * database) under an advisory lock, so parallel instances never seed twice.
 * Requests still run as the restricted procurement_user role through asUser().
 */
export async function openSharedDemo(
  url: string,
  adminUrl: string,
  base: Omit<Deps, 'db'>,
): Promise<SharedDemo> {
  const withLock = async (fn: (admin: pg.Client) => Promise<void>) => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
      await fn(admin);
    } finally {
      await admin
        .query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
        .catch(() => {});
      await admin.end();
    }
  };

  await withLock(async (admin) => {
    // The demo database is dedicated to the demo: an older (or missing)
    // schema is dropped and created again from db/schema.sql.
    const has = await admin.query<{ f: string | null }>(
      `SELECT to_regprocedure('app.schema_version()')::text AS f`,
    );
    const version = has.rows[0].f
      ? (await admin.query<{ v: number }>('SELECT app.schema_version() AS v'))
          .rows[0].v
      : null;
    if (version !== SCHEMA_VERSION) {
      await admin.query('DROP SCHEMA IF EXISTS app CASCADE');
      await admin.query(schemaSql());
    }
    // On managed PostgreSQL the owner is not a superuser and needs membership
    // to switch to the restricted roles for each request.
    await admin.query('GRANT procurement_user TO CURRENT_USER');
    await admin.query('GRANT procurement_mailer TO CURRENT_USER');
    await admin.query('GRANT procurement_auth TO CURRENT_USER');
  });

  const db = await pgDatabase(url);
  let checkedAt = 0;
  const refresh = async (force = false) => {
    if (!force && Date.now() - checkedAt < CHECK_EVERY_MS) return;
    checkedAt = Date.now();
    await withLock(async (admin) => {
      const r = await admin.query<{ created_at: Date }>(
        'SELECT created_at FROM app.organizations WHERE name = $1',
        [DEMO_ORG],
      );
      const seededAt = r.rows[0]?.created_at?.getTime();
      if (!force && seededAt && Date.now() - seededAt < RESET_AFTER_MS) return;
      await admin.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
      await seedDemo(admin, { ...base, db });
    });
  };
  await refresh();
  return { db, refresh };
}
