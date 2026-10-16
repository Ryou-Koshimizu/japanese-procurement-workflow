import type { PGlite } from '@electric-sql/pglite';

export type Row = Record<string, unknown>;
export interface Sql {
  query<T extends Row = Row>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number; rowCount?: number | null }>;
}
export interface Database {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502 | 503,
    message: string,
    readonly code = 'APP_ERROR',
  ) {
    super(message);
  }
}

/** Messages for the business rules the database refuses (see db/schema.sql). */
const RULE_MESSAGES: [RegExp, string][] = [
  [
    /quote has expired/,
    '見積の有効期限が切れています。本社に再見積を依頼してください。',
  ],
  [/needs at least one line/, '商品を1つ以上入れてください。'],
  [
    /no longer in the catalog/,
    '掲載が終わった商品が含まれています。外してから依頼してください。',
  ],
  [/needed-by date is in the past/, '希望納期が過去の日付です。'],
  [/rejection needs a reason/, '却下の理由を入力してください。'],
  [/revision request needs a note/, '修正してほしい内容を入力してください。'],
  [/quote validity/, '見積の有効期限は今日から180日以内で指定してください。'],
  [/quote needs 1 to 200 lines/, '見積に含める商品を1つ以上選んでください。'],
  [/whole unit price and quantity/, '単価と数量は整数で入力してください。'],
  [/does not match the request/, '見積の明細が依頼の内容と一致しません。'],
  [
    /item from another supplier/,
    '別の仕入先の商品は、別の依頼にしてください。',
  ],
  [/item is not orderable/, 'この商品は現在発注できません。'],
];

/** Map database errors raised by RLS, triggers and constraints to HTTP errors. */
export function mapDbError(e: unknown): unknown {
  const err = e as { code?: string; message?: string };
  const message = String(err?.message ?? '');
  switch (err?.code) {
    case '42501':
      return new AppError(
        403,
        '権限がないか、この状態では実行できない操作です。',
        'FORBIDDEN',
      );
    case '23514': {
      const known = RULE_MESSAGES.find(([re]) => re.test(message));
      return new AppError(
        409,
        known?.[1] ?? '入力が業務ルールを満たしていません。',
        'RULE_VIOLATION',
      );
    }
    case '23505':
      return new AppError(409, '既に登録されています。', 'DUPLICATE');
    case '22P02':
      return new AppError(404, '見つかりません。', 'NOT_FOUND');
    case '22007':
    case '22008':
      return new AppError(400, '日付が正しくありません。', 'BAD_DATE');
    case '40P01':
    case '40001':
      return new AppError(
        409,
        'ほかの操作と重なりました。画面を更新してもう一度お試しください。',
        'CONFLICT',
      );
    default:
      return e;
  }
}

export type RequestContext = { userId: string; orgId: string } | null;

async function asRole<T>(
  db: Database,
  role: 'procurement_user' | 'procurement_mailer' | 'procurement_auth',
  ctx: RequestContext,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      await tx.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`,
        [ctx?.userId ?? '', ctx?.orgId ?? ''],
      );
      await tx.query(`SET LOCAL statement_timeout = '15s'`);
      return fn(tx);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Run fn as the restricted procurement_user role with the request's user and
 * org set for row-level security. Everything the application reads or writes
 * on behalf of a person goes through here.
 */
export function asUser<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return asRole(db, 'procurement_user', ctx, fn);
}

/** The notification sender: it can read and mark the outbox, nothing else. */
export function asMailer<T>(db: Database, fn: (tx: Sql) => Promise<T>) {
  return asRole(db, 'procurement_mailer', null, fn);
}

/** Login and session lookup: the auth_* functions and nothing else. */
export function asAuth<T>(db: Database, fn: (tx: Sql) => Promise<T>) {
  return asRole(db, 'procurement_auth', null, fn);
}

/**
 * Values as plain JSON-friendly types, the same from PGlite and node-postgres:
 * timestamps as ISO strings, dates as YYYY-MM-DD, bigint amounts as numbers
 * (every amount here stays far below 2^53).
 */
const iso = (v: string) =>
  new Date(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString();
export const PARSERS: Record<number, (value: string) => unknown> = {
  20: (v) => Number(v),
  1082: (v) => v,
  1114: (v) => new Date(`${v.replace(' ', 'T')}Z`).toISOString(),
  1184: iso,
};

export function pgliteDatabase(pg: PGlite): Database {
  return {
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({ query: (text, params) => tx.query(text, params) as never }),
      ),
    close: () => pg.close(),
  };
}

export async function pgDatabase(connectionString: string): Promise<Database> {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    types: {
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        PARSERS[oid] ?? pg.types.getTypeParser(oid, format)) as never,
    },
  });
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params) =>
            client.query(text, params as unknown[]) as never,
        });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
