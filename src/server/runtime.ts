import { readConfig, publicOrigin, type Config } from './config';
import { pgDatabase, type Database } from './db';
import { createFetcher } from './net';
import { demoSupplierFetcher } from './demo-supplier';
import { deliverOutbox, smtpTransport, type MailTransport } from './mailer';
import type { Deps } from './service';

export type Runtime = {
  config: Config;
  deps: Deps;
  /** Shared demo database only: re-seed if stale, or always with force. */
  refreshDemo?: (force?: boolean) => Promise<void>;
};

/**
 * Refuse to run on a connection that could bypass row-level security: a
 * superuser, a BYPASSRLS role, or the owner of the tables (owners are exempt
 * from their own policies).
 */
export async function assertRestrictedRole(db: Database) {
  const r = await db.transaction((tx) =>
    tx.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      member: boolean;
      mailer: boolean;
      auth: boolean;
      owner: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls,
              pg_has_role(current_user, 'procurement_user', 'MEMBER') AS member,
              pg_has_role(current_user, 'procurement_mailer', 'MEMBER') AS mailer,
              pg_has_role(current_user, 'procurement_auth', 'MEMBER') AS auth,
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'app' AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS owner
         FROM pg_roles WHERE rolname = current_user`,
    ),
  );
  const role = r.rows[0];
  if (
    !role ||
    role.rolsuper ||
    role.rolbypassrls ||
    !role.member ||
    !role.mailer ||
    !role.auth ||
    role.owner
  )
    throw new Error(
      'DATABASE_URL must use a non-superuser role without BYPASSRLS that is a member of procurement_user, procurement_mailer and procurement_auth and owns no tables.',
    );
}

async function init(): Promise<Runtime> {
  const config = readConfig();
  if (config.mode === 'demo') {
    const base = {
      fetcher: demoSupplierFetcher(),
      mail: { kind: 'demo' } as MailTransport,
      origin: null,
      demo: true,
    };
    if (config.sharedDatabase) {
      // One database for every server instance (serverless hosts).
      const { openSharedDemo } = await import('./demo-postgres');
      const shared = await openSharedDemo(
        config.sharedDatabase.url,
        config.sharedDatabase.adminUrl,
        base,
      );
      return {
        config,
        deps: { ...base, db: shared.db },
        refreshDemo: shared.refresh,
      };
    }
    // In-process PostgreSQL seeded on start; resets when the server restarts.
    const { createPgliteDatabase } = await import('./schema');
    const { seedDemo } = await import('./demo-seed');
    const { db, pg } = await createPgliteDatabase();
    const deps = { ...base, db };
    await seedDemo(pg, deps);
    return { config, deps };
  }
  const db = await pgDatabase(config.DATABASE_URL);
  await assertRestrictedRole(db);
  const mail: MailTransport =
    config.SMTP_URL && config.MAIL_FROM
      ? await smtpTransport(config.SMTP_URL, config.MAIL_FROM)
      : { kind: 'none' };
  return {
    config,
    deps: {
      db,
      fetcher: createFetcher(),
      mail,
      origin: publicOrigin(),
      demo: false,
    },
  };
}

const g = globalThis as unknown as { __procurementRuntime?: Promise<Runtime> };
export function runtime(): Promise<Runtime> {
  g.__procurementRuntime ??= init().catch((e) => {
    g.__procurementRuntime = undefined;
    throw e;
  });
  return g.__procurementRuntime;
}

/** Demo only: throw away the in-memory database and seed it again. */
export async function resetDemo() {
  const current = await runtime();
  if (current.config.mode !== 'demo') throw new Error('reset is demo-only');
  if (current.refreshDemo) return current.refreshDemo(true);
  g.__procurementRuntime = undefined;
  await current.deps.db.close().catch(() => {});
  return runtime();
}

/** Send what the last change queued. Errors stay in the outbox for a retry. */
export async function flushOutbox() {
  const { deps } = await runtime();
  await deliverOutbox(deps.db, deps.mail, deps.origin).catch((e) =>
    console.error(
      JSON.stringify({
        event: 'outbox_error',
        message: String((e as Error)?.message).slice(0, 200),
      }),
    ),
  );
}
