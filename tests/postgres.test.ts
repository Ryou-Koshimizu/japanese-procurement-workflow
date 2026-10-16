// Real PostgreSQL (16 or 17): run with RUN_POSTGRES_TESTS=1 after `npm run db:up`.
// PGlite runs one statement at a time; these tests check the rules under real
// concurrency and with a real login role.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgDatabase, type Database } from '../src/server/db';
import { assertRestrictedRole } from '../src/server/runtime';
import { demoUsers, seedDemo } from '../src/server/demo-seed';
import { demoSupplierFetcher } from '../src/server/demo-supplier';
import { openSharedDemo } from '../src/server/demo-postgres';
import {
  acceptQuote,
  getOrder,
  issueQuote,
  type Deps,
} from '../src/server/service';
import type { Session } from '../src/server/auth';
import { addDays, todayInJapan } from '../src/server/config';

const run = process.env.RUN_POSTGRES_TESTS === '1';
const APP_URL =
  process.env.DATABASE_URL ??
  'postgresql://procurement_app:procurement_local_only@127.0.0.1:54326/procurement';
const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://postgres:postgres_local_only@127.0.0.1:54326/procurement';
const TABLES =
  'app.audit_log, app.outbox, app.counters, app.quotes, app.order_lines, app.orders, app.catalog_items, app.catalog_images, app.catalog_sources, app.sessions, app.memberships, app.users, app.stores, app.organizations';

describe.skipIf(!run)('real PostgreSQL', () => {
  let admin: pg.Client;
  let db: Database;
  let deps: Deps;
  const as: Record<string, Session> = {};

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    db = await pgDatabase(APP_URL);
    deps = {
      db,
      fetcher: demoSupplierFetcher(),
      mail: { kind: 'demo' },
      origin: null,
      demo: true,
    };
  });
  afterAll(async () => {
    await db?.close();
    await admin?.end();
  });

  /** Wipe, seed the demo company and load its people as sessions. */
  const reseed = async () => {
    await admin.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    await seedDemo(admin, deps);
    for (const u of demoUsers) {
      const r = await admin.query(
        `SELECT u.id, m.org_id, m.store_id FROM app.users u JOIN app.memberships m ON m.user_id = u.id WHERE u.email = $1`,
        [u.email],
      );
      as[u.key] = {
        userId: r.rows[0].id,
        orgId: r.rows[0].org_id,
        role: u.role,
        storeId: r.rows[0].store_id,
        storeName: null,
        userName: u.name,
        email: u.email,
        orgName: 'demo',
      };
    }
  };
  beforeEach(reseed);

  const quoted = async () =>
    (
      await admin.query(
        `SELECT id, current_quote_id FROM app.orders WHERE request_number = 'R-2026-0003'`,
      )
    ).rows[0];

  it('accepts the restricted login role and refuses the owner', async () => {
    await expect(assertRestrictedRole(db)).resolves.toBeUndefined();
    const owner = await pgDatabase(ADMIN_URL);
    await expect(assertRestrictedRole(owner)).rejects.toThrow(
      'procurement_user',
    );
    await owner.close();
  });

  it('two clicks on accept place exactly one order', async () => {
    const o = await quoted();
    const results = await Promise.allSettled([
      acceptQuote(deps, as.yokohama, o.id, o.current_quote_id),
      acceptQuote(deps, as.yokohama, o.id, o.current_quote_id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM app.outbox WHERE order_id = $1 AND event = 'ordered'`,
      [o.id],
    );
    expect(n.rows[0].n).toBe(4);
  });

  it('accepting while headquarters re-quotes ends in one consistent state, never a deadlock', async () => {
    for (let round = 0; round < 5; round++) {
      await reseed();
      const o = await quoted();
      const order = await getOrder(deps, as.buyer, o.id);
      const [accept, requote] = await Promise.allSettled([
        acceptQuote(deps, as.yokohama, o.id, o.current_quote_id),
        issueQuote(deps, as.buyer, o.id, {
          lines: order.lines.map((l) => ({
            orderLineId: l.id,
            unitPrice: l.unit_price + 10,
            qty: l.qty,
          })),
          shippingFee: 0,
          validUntil: addDays(todayInJapan(), 7),
          basedOn: order.quotes[0].version,
        }),
      ]);
      // Exactly one side wins; the loser gets a 409 with a reason, not a 500.
      expect([accept.status, requote.status].sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const loser = (
        accept.status === 'rejected' ? accept : requote
      ) as PromiseRejectedResult;
      expect(loser.reason.status).toBe(409);
      const after = await getOrder(deps, as.buyer, o.id);
      if (accept.status === 'fulfilled') {
        expect(after.status).toBe('ordered');
        expect(after.ordered_total).toBe(
          after.quotes.find((q) => q.status === 'accepted')!.total,
        );
      } else {
        expect(after.status).toBe('quoted');
        expect(after.quotes[0].status).toBe('sent');
      }
    }
  });

  it('two buyers quoting the same request at once: one quote, one reload message', async () => {
    const o = (
      await admin.query(
        `SELECT id FROM app.orders WHERE request_number = 'R-2026-0004'`,
      )
    ).rows[0];
    const order = await getOrder(deps, as.buyer, o.id);
    const body = {
      lines: order.lines.map((l) => ({
        orderLineId: l.id,
        unitPrice: l.unit_price,
        qty: l.qty,
      })),
      shippingFee: 0,
      validUntil: addDays(todayInJapan(), 7),
      basedOn: null,
    };
    const results = await Promise.allSettled([
      issueQuote(deps, as.buyer, o.id, body),
      issueQuote(deps, as.admin, o.id, body),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM app.quotes WHERE order_id = $1`,
      [o.id],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('row-level security holds for the real login role', async () => {
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      // The login role inherits nothing: without SET ROLE it reads nothing.
      await expect(client.query('SELECT * FROM app.orders')).rejects.toThrow();
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE procurement_user');
      expect((await client.query('SELECT * FROM app.orders')).rows).toEqual([]);
      await expect(
        client.query('SELECT password_hash FROM app.users'),
      ).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});

// The shared public demo (one database for every serverless instance). In the
// same file so it never runs at the same time as the tests above.
describe.skipIf(!run)('shared demo database', () => {
  it('seeds once, then re-seeds on demand without duplicating anything', async () => {
    const base = {
      fetcher: demoSupplierFetcher(),
      mail: { kind: 'demo' as const },
      origin: null,
      demo: true,
    };
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    const a = await openSharedDemo(APP_URL, ADMIN_URL, base);
    const b = await openSharedDemo(APP_URL, ADMIN_URL, base);
    try {
      const count = async () =>
        (await admin.query('SELECT count(*)::int AS n FROM app.organizations'))
          .rows[0].n;
      expect(await count()).toBe(1);
      await a.refresh(true);
      expect(await count()).toBe(1);
      const r = await admin.query(
        `SELECT count(*)::int AS n FROM app.catalog_items`,
      );
      expect(r.rows[0].n).toBe(23);
    } finally {
      await admin.end();
      await a.db.close();
      await b.db.close();
    }
  });
});
