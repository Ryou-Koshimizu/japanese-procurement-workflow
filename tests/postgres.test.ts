// Real PostgreSQL (16 or 17): run with RUN_POSTGRES_TESTS=1 after `npm run db:up`.
// PGlite runs one statement at a time; these tests check the rules under real
// concurrency and with a real login role.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgDatabase, type Database } from '../src/server/db';
import { assertRestrictedRole } from '../src/server/runtime';
import {
  answerQuote,
  askMaker,
  day,
  issueQuote,
  outline,
  recordMaker,
  submit,
  world,
  type Fixture,
} from './helpers';

const run = process.env.RUN_POSTGRES_TESTS === '1';
const APP_URL =
  process.env.DATABASE_URL ??
  'postgresql://procurement_app:procurement_local_only@127.0.0.1:54326/procurement';
const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://postgres:postgres_local_only@127.0.0.1:54326/procurement';
const TABLES =
  'app.audit_log, app.outbox, app.counters, app.quote_costs, app.quotes, app.maker_quotes, app.order_lines, app.order_messages, app.orders, app.makers, app.request_fields, app.catalog_items, app.catalog_images, app.catalog_sources, app.sessions, app.memberships, app.users, app.stores, app.organizations';

describe.skipIf(!run)('real PostgreSQL', () => {
  let admin: pg.Client;
  let db: Database;
  let f: Omit<Fixture, 'pg'>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    db = await pgDatabase(APP_URL);
  });
  afterAll(async () => {
    await db?.close();
    await admin?.end();
  });
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    f = await world(
      async (text, params) => (await admin.query(text, params)).rows,
      db,
    );
  });

  /** A request up to the given point, through the real workflow. */
  const prepare = async (until: 'quoted' | 'agreed') => {
    const orderId = await submit(f as Fixture, 'sato');
    const [line] = await outline(f as Fixture, orderId, [
      { name: '収納棚', qty: 2, unit: '台' },
    ]);
    const mq = await askMaker(f as Fixture, orderId, f.makers.sakura);
    await recordMaker(f as Fixture, mq, [
      { order_line_id: line, unit_cost: 10000 },
    ]);
    const quoteId = await issueQuote(f as Fixture, 'yamada', orderId, {
      makerQuoteId: mq,
      mode: 'markup',
      markupBp: 2000,
    });
    if (until === 'agreed')
      await answerQuote(f as Fixture, 'sato', orderId, quoteId, {
        accept: true,
      });
    return { orderId, quoteId, mq };
  };
  const count = async (sql: string, params: unknown[]) =>
    (await admin.query<{ n: number }>(sql, params)).rows[0].n;
  const code = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? (r.reason as { code?: string }).code : 'ok';

  it('accepts the restricted login role and refuses the owner', async () => {
    await expect(assertRestrictedRole(db)).resolves.toBeUndefined();
    const owner = await pgDatabase(ADMIN_URL);
    await expect(assertRestrictedRole(owner)).rejects.toThrow(
      'procurement_user',
    );
    await owner.close();
  });

  it('two clicks on accept make exactly one agreement', async () => {
    const { orderId, quoteId } = await prepare('quoted');
    const results = await Promise.all([
      answerQuote(f as Fixture, 'sato', orderId, quoteId, { accept: true }),
      answerQuote(f as Fixture, 'sato', orderId, quoteId, { accept: true }),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM app.outbox WHERE order_id = $1 AND event = 'agreed'`,
        [orderId],
      ),
    ).toBe(2); // one mail to each of the two B社 people
  });

  it('accepting while B社 re-quotes ends in one consistent state, never a deadlock', async () => {
    for (let round = 0; round < 5; round++) {
      await admin.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
      f = await world(
        async (text, params) => (await admin.query(text, params)).rows,
        db,
      );
      const { orderId, quoteId, mq } = await prepare('quoted');
      const [accept, requote] = await Promise.allSettled([
        answerQuote(f as Fixture, 'sato', orderId, quoteId, { accept: true }),
        issueQuote(f as Fixture, 'yamada', orderId, {
          makerQuoteId: mq,
          mode: 'markup',
          markupBp: 3000,
        }),
      ]);
      expect([code(accept), code(requote)]).not.toContain('40P01');
      const accepted = accept.status === 'fulfilled' && accept.value === true;
      const requoted = requote.status === 'fulfilled';
      expect(accepted !== requoted, `round ${round}`).toBe(true);
      const [o] = (
        await admin.query(
          `SELECT o.status, o.agreed_total, q.total FROM app.orders o
             JOIN app.quotes q ON q.id = o.current_quote_id WHERE o.id = $1`,
          [orderId],
        )
      ).rows;
      if (accepted)
        expect([o.status, Number(o.agreed_total)]).toEqual([
          'agreed',
          Number(o.total),
        ]);
      else expect(o.status).toBe('quoted');
    }
  });

  it('placing the order twice at once gives one purchase order number', async () => {
    const { orderId } = await prepare('agreed');
    const place = () =>
      f.sql(
        'yamada',
        `UPDATE app.orders SET status = 'ordered', delivery_mode = 'direct' WHERE id = $1 AND status = 'agreed' RETURNING po_number`,
        [orderId],
      );
    const results = await Promise.all([place(), place()]);
    expect(results.map((r) => r.length).sort()).toEqual([0, 1]);
    expect(
      await count(`SELECT value AS n FROM app.counters WHERE kind = 'po'`, []),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM app.outbox WHERE order_id = $1 AND event = 'ordered'`,
        [orderId],
      ),
    ).toBe(1);
  });

  it('the real login role reads nothing without SET ROLE, and A社 no costs with it', async () => {
    await prepare('quoted');
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      // The login role inherits nothing: without SET ROLE it reads nothing.
      await expect(client.query('SELECT * FROM app.orders')).rejects.toThrow();
      await expect(
        client.query('SELECT * FROM app.quote_costs'),
      ).rejects.toThrow('permission denied');
      const as = async (who: 'sato' | 'yamada', sql: string) => {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('role', 'procurement_user', true), set_config('app.user_id', $1, true),
                  set_config('app.org_id', $2, true)`,
          [f.people[who].userId, f.orgId],
        );
        try {
          return (await client.query(sql)).rows;
        } finally {
          await client.query('ROLLBACK');
        }
      };
      expect(await as('sato', 'SELECT * FROM app.quote_costs')).toEqual([]);
      expect(await as('sato', 'SELECT * FROM app.maker_quotes')).toEqual([]);
      expect(await as('sato', 'SELECT * FROM app.quotes')).toHaveLength(1);
      expect(await as('yamada', 'SELECT * FROM app.quote_costs')).toHaveLength(
        1,
      );
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

// The shared public demo database: needs the demo seed, which is rebuilt for
// schema version 2 in a later step (src/server/demo-seed.ts still uses v1).
describe.skip('shared demo database (waits for the v2 demo seed)', () => {
  it('seeds once, then re-seeds on demand without duplicating anything', () => {});
});
