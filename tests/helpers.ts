// A small fictional world built with SQL as the database owner (setup only),
// then driven as each person through the restricted role, the way asUser()
// in src/server/db.ts runs every request. Independent of the demo seed.
import type { PGlite } from '@electric-sql/pglite';
import { createPgliteDatabase } from '../src/server/schema';
import type { Database, Sql } from '../src/server/db';
import { DEFAULT_REQUEST_FIELDS } from '../src/core/intake';
import type { Role } from '../src/core/workflow';
import type { Session } from '../src/server/auth';
import type { Deps } from '../src/server/service';
import { demoSupplierFetcher } from '../src/server/demo-supplier';

export type Person = {
  userId: string;
  orgId: string;
  role: Role;
  storeId: string | null;
  name: string;
  email: string;
};

/** sato: A社 渋谷店, suzuki: A社 梅田店, yamada: B社 agent, tanaka: B社 admin, outsider: agent of another B社. */
export type Who = 'sato' | 'suzuki' | 'yamada' | 'tanaka' | 'outsider';

export type Fixture = {
  pg: PGlite;
  db: Database;
  orgId: string;
  people: Record<Who, Person>;
  stores: { shibuya: string; umeda: string };
  makers: { sakura: string; aoba: string };
  /** Run SQL as one person through procurement_user (raw database errors). */
  sql: <T = Record<string, unknown>>(
    who: Who,
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
  /** Several statements as one person in one transaction. */
  as: <T>(who: Who, fn: (tx: Sql) => Promise<T>) => Promise<T>;
  /** Owner-level query (setup and inspection only). */
  owner: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
};

export const ORG = 'みどり購買サポート株式会社';
export const CLIENT = '株式会社サンプルカフェ';

/** The fictional world on a fresh in-process database. */
export async function fixture(): Promise<Fixture> {
  const { db, pg } = await createPgliteDatabase();
  return {
    pg,
    ...(await world(
      async (text, params) => (await pg.query(text, params)).rows as never,
      db,
    )),
  };
}

/** The fictional world on any database: `owner` runs setup SQL, `db` the requests. */
export async function world(
  owner: Fixture['owner'],
  db: Database,
): Promise<Omit<Fixture, 'pg'>> {
  const one = async (text: string, params: unknown[]) =>
    (await owner<{ id: string }>(text, params))[0].id;

  const orgId = await one(
    `INSERT INTO app.organizations (name, client_name, address) VALUES ($1, $2, $3) RETURNING id`,
    [ORG, CLIENT, '東京都千代田区（架空）9-9-9 B社倉庫'],
  );
  const stores = {
    shibuya: await one(
      `INSERT INTO app.stores (org_id, code, name, address) VALUES ($1, 'S01', '渋谷店', '東京都渋谷区（架空）1-2-3') RETURNING id`,
      [orgId],
    ),
    umeda: await one(
      `INSERT INTO app.stores (org_id, code, name, address) VALUES ($1, 'S02', '梅田店', '大阪府大阪市（架空）4-5-6') RETURNING id`,
      [orgId],
    ),
  };
  const otherOrg = await one(
    `INSERT INTO app.organizations (name, client_name) VALUES ('ほかの購買代行', 'ほかの会社') RETURNING id`,
    [],
  );
  const people = {} as Record<Who, Person>;
  const add = async (
    who: Who,
    email: string,
    name: string,
    role: Role,
    storeId: string | null,
    org = orgId,
  ) => {
    const userId = await one(
      `INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [email, name],
    );
    await owner(
      `INSERT INTO app.memberships (org_id, user_id, role, store_id) VALUES ($1, $2, $3, $4)`,
      [org, userId, role, storeId],
    );
    people[who] = { userId, orgId: org, role, storeId, name, email };
  };
  await add(
    'sato',
    'sato@sample-cafe.example',
    '佐藤 美咲',
    'client',
    stores.shibuya,
  );
  await add(
    'suzuki',
    'suzuki@sample-cafe.example',
    '鈴木 健',
    'client',
    stores.umeda,
  );
  await add('yamada', 'yamada@midori.example', '山田 花子', 'agent', null);
  await add('tanaka', 'tanaka@midori.example', '田中 誠', 'admin', null);
  await add(
    'outsider',
    'kato@other.example',
    '加藤 次郎',
    'agent',
    null,
    otherOrg,
  );

  const makers = {
    sakura: await one(
      `INSERT INTO app.makers (org_id, name, email) VALUES ($1, 'さくら備品サプライ', 'orders@sakura-supply.example') RETURNING id`,
      [orgId],
    ),
    aoba: await one(
      `INSERT INTO app.makers (org_id, name, email) VALUES ($1, 'あおば什器製作所', 'sales@aoba-juki.example') RETURNING id`,
      [orgId],
    ),
  };
  for (const f of DEFAULT_REQUEST_FIELDS)
    await owner(
      `INSERT INTO app.request_fields (org_id, key, label, kind, required, options, help, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orgId,
        f.key,
        f.label,
        f.kind,
        f.required,
        f.options,
        f.help,
        f.position,
      ],
    );
  // Setup rows are not part of what the tests look at.
  await owner('DELETE FROM app.audit_log');

  const as: Fixture['as'] = (who, fn) =>
    db.transaction(async (tx) => {
      // Same statement as asRole() in src/server/db.ts.
      await tx.query(
        `SELECT set_config('role', 'procurement_user', true), set_config('app.user_id', $1, true),
                set_config('app.org_id', $2, true)`,
        [people[who].userId, people[who].orgId],
      );
      return fn(tx);
    });
  const sql: Fixture['sql'] = (who, text, params) =>
    as(who, async (tx) => (await tx.query(text, params)).rows as never);
  return { db, orgId, people, stores, makers, sql, as, owner };
}

/** Today in Japan plus n days, as YYYY-MM-DD. */
export function day(n = 0): string {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86400_000);
  return d.toISOString().slice(0, 10);
}

export const validAnswers = [
  { key: 'item', value: '受付カウンター' },
  { key: 'purpose', value: '今のカウンターが壊れた' },
  { key: 'place', value: '1階 入口の右側' },
  { key: 'quantity', value: 1 },
];

/** A client creates and sends a request in one transaction, like the service. */
export async function submit(
  f: Fixture,
  who: Who,
  input: {
    title?: string;
    answers?: unknown;
    needed_by?: string | null;
    note?: string;
  } = {},
): Promise<string> {
  return f.as(who, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.orders (org_id, store_id, created_by, title, answers, needed_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        f.orgId,
        f.people[who].storeId,
        f.people[who].userId,
        input.title ?? '受付カウンターの入れ替え',
        JSON.stringify(input.answers ?? validAnswers),
        input.needed_by ?? null,
        input.note ?? null,
      ],
    );
    await tx.query(`UPDATE app.orders SET status = 'requested' WHERE id = $1`, [
      r.rows[0].id,
    ]);
    return r.rows[0].id;
  });
}

export type OutlineLine = {
  name: string;
  spec?: string;
  qty: number;
  unit?: string;
  tax_rate?: 8 | 10;
};

/** B社 writes the outline and confirms it (requested → sourcing). */
export async function outline(
  f: Fixture,
  orderId: string,
  lines: OutlineLine[],
) {
  return f.as('yamada', async (tx) => {
    const ids: string[] = [];
    for (const [i, l] of lines.entries()) {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO app.order_lines (org_id, order_id, position, name, spec, qty, unit, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          f.orgId,
          orderId,
          i,
          l.name,
          l.spec ?? '',
          l.qty,
          l.unit ?? null,
          l.tax_rate ?? null,
        ],
      );
      ids.push(r.rows[0].id);
    }
    await tx.query(`UPDATE app.orders SET status = 'sourcing' WHERE id = $1`, [
      orderId,
    ]);
    return ids;
  });
}

export async function askMaker(f: Fixture, orderId: string, makerId: string) {
  const [r] = await f.sql<{ id: string }>(
    'yamada',
    `INSERT INTO app.maker_quotes (org_id, order_id, maker_id) VALUES ($1, $2, $3) RETURNING id`,
    [f.orgId, orderId, makerId],
  );
  return r.id;
}

export async function recordMaker(
  f: Fixture,
  makerQuoteId: string,
  lines: { order_line_id: string; unit_cost: number; stock?: string }[],
  shippingCost = 0,
  validUntil = day(30),
) {
  await f.sql(
    'yamada',
    `UPDATE app.maker_quotes SET status = 'received', lines = $2, shipping_cost = $3,
            valid_until = $4, lead_time = '受注後10日' WHERE id = $1`,
    [
      makerQuoteId,
      JSON.stringify(lines.map((l) => ({ stock: 'in_stock', ...l }))),
      shippingCost,
      validUntil,
    ],
  );
}

export type IssueArgs = {
  makerQuoteId: string;
  mode: 'markup' | 'price';
  markupBp?: number | null;
  prices?: { order_line_id: string; unit_price: number }[] | null;
  shippingFee?: number;
  expenses?: number;
  validUntil?: string;
  note?: string | null;
};

export async function issueQuote(
  f: Fixture,
  who: Who,
  orderId: string,
  a: IssueArgs,
) {
  const [r] = await f.sql<{ id: string }>(
    who,
    `SELECT app.issue_quote($1, $2, $3, $4, $5, $6, $7, $8, $9) AS id`,
    [
      orderId,
      a.makerQuoteId,
      a.mode,
      a.markupBp ?? null,
      a.prices ? JSON.stringify(a.prices) : null,
      a.shippingFee ?? 0,
      a.expenses ?? 0,
      a.validUntil ?? day(14),
      a.note ?? null,
    ],
  );
  return r.id;
}

/** A client answers the current quote, locking the order first like the service. */
export async function answerQuote(
  f: Fixture,
  who: Who,
  orderId: string,
  quoteId: string,
  answer: { accept: true } | { accept: false; note: string },
) {
  return f.as(who, async (tx) => {
    await tx.query('SELECT id FROM app.orders WHERE id = $1 FOR UPDATE', [
      orderId,
    ]);
    const r = await tx.query(
      answer.accept
        ? `UPDATE app.quotes SET status = 'accepted', responded_by = $2 WHERE id = $1 AND status = 'sent' RETURNING id`
        : `UPDATE app.quotes SET status = 'declined', responded_by = $2, response_note = $3 WHERE id = $1 AND status = 'sent' RETURNING id`,
      answer.accept
        ? [quoteId, f.people[who].userId]
        : [quoteId, f.people[who].userId, answer.note],
    );
    return r.rows.length === 1;
  });
}

/** Expect a database refusal with this SQLSTATE (and message, if given). */
export async function refused(
  p: Promise<unknown>,
  code: string,
  message?: RegExp,
) {
  const e = (await p.then(
    () => null,
    (err) => err,
  )) as { code?: string; message?: string } | null;
  if (!e) throw new Error(`expected a refusal with ${code}`);
  if (e.code !== code || (message && !message.test(e.message ?? '')))
    throw new Error(
      `expected ${code} ${message ?? ''}, got ${e.code}: ${e.message}`,
    );
}

/** A person's session, as the app builds it at login, for calling the services. */
export function session(f: Pick<Fixture, 'people'>, who: Who): Session {
  const p = f.people[who];
  return {
    userId: p.userId,
    orgId: p.orgId,
    role: p.role,
    storeId: p.storeId,
    storeName: null,
    userName: p.name,
    email: p.email,
    orgName: ORG,
  };
}

/** Service dependencies on the fixture's database (demo mail: nothing is sent). */
export function deps(f: Pick<Fixture, 'db'>): Deps {
  return {
    db: f.db,
    fetcher: demoSupplierFetcher(),
    mail: { kind: 'demo' },
    origin: null,
    demo: true,
  };
}
