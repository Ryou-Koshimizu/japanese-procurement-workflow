import type { PGlite } from '@electric-sql/pglite';
import { createPgliteDatabase } from '../src/server/schema';
import { demoUsers, seedDemo } from '../src/server/demo-seed';
import { demoSupplierFetcher } from '../src/server/demo-supplier';
import type { Session } from '../src/server/auth';
import type { Deps } from '../src/server/service';
import { asUser } from '../src/server/db';

export type World = {
  pg: PGlite;
  deps: Deps;
  as: Record<string, Session>;
  /** Run SQL as one demo person, through the restricted role. */
  sql: <T extends Record<string, unknown> = Record<string, unknown>>(
    who: string,
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
};

/** A fresh demo database: the fictional company, catalog and sample orders. */
export async function demoWorld(): Promise<World> {
  const { db, pg } = await createPgliteDatabase();
  const deps: Deps = {
    db,
    fetcher: demoSupplierFetcher(),
    mail: { kind: 'demo' },
    origin: null,
    demo: true,
  };
  await seedDemo(pg, deps);
  const as: Record<string, Session> = {};
  for (const u of demoUsers) {
    const r = await pg.query<{
      id: string;
      org_id: string;
      store_id: string | null;
      store_name: string | null;
    }>(
      `SELECT u.id, m.org_id, m.store_id, s.name AS store_name
         FROM app.users u JOIN app.memberships m ON m.user_id = u.id
         LEFT JOIN app.stores s ON s.id = m.store_id WHERE u.email = $1`,
      [u.email],
    );
    const row = r.rows[0];
    as[u.key] = {
      userId: row.id,
      orgId: row.org_id,
      role: u.role,
      storeId: row.store_id,
      storeName: row.store_name,
      userName: u.name,
      email: u.email,
      orgName: 'demo',
    };
  }
  const sql: World['sql'] = (who, text, params) =>
    asUser(db, { userId: as[who].userId, orgId: as[who].orgId }, async (tx) => {
      const r = await tx.query(text, params);
      return r.rows as never;
    });
  return { pg, deps, as, sql };
}

export async function orderBy(w: World, requestNumber: string) {
  const r = await w.pg.query<{ id: string; current_quote_id: string | null }>(
    'SELECT id, current_quote_id FROM app.orders WHERE request_number = $1',
    [requestNumber],
  );
  return r.rows[0];
}

export async function itemId(w: World, sku: string) {
  const r = await w.pg.query<{ id: string }>(
    'SELECT id FROM app.catalog_items WHERE sku = $1',
    [sku],
  );
  return r.rows[0].id;
}
