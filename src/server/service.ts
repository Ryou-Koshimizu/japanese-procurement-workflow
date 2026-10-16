import { createHash } from 'node:crypto';
// Application operations. Every query runs through asUser(), so row-level
// security and the workflow triggers in db/schema.sql decide what each person
// may see and do; the checks here only turn input into clear messages.
import { z } from 'zod';
import { asUser, AppError, type Database, type Sql } from './db';
import type { Session } from './auth';
import type { Fetcher } from './net';
import type { MailTransport } from './mailer';
import { render } from './mailer';
import {
  crawlCatalog,
  fetchProductImages,
  DEFAULT_LIMITS,
  type FetchedImage,
} from './importer';
import { isDemoSupplierUrl } from './demo-supplier';
import { parseCatalogCsv, MAX_CSV_BYTES } from '../core/catalog/csv';
import type { ParsedProduct, Skipped } from '../core/catalog/product';
import { DEMO_SUPPLIER } from '../demo/supplier-data';
import type { QuoteStatus, Role, Status } from '../core/workflow';
import { isHq, MAX_QUOTE_DAYS } from '../core/workflow';
import type {
  Audience,
  NotificationEvent,
  Payload,
} from '../core/notification';
import type { TaxRate } from '../core/money';
import { addDays, todayInJapan } from './config';

export type Deps = {
  db: Database;
  /** The guarded network fetcher, or the demo supplier on disk. */
  fetcher: Fetcher;
  mail: MailTransport;
  /** Public origin for links in emails (live mode). */
  origin: string | null;
  demo: boolean;
};

const ctx = (s: Session) => ({ userId: s.userId, orgId: s.orgId });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function id(value: unknown, what = '対象'): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AppError(404, `${what}が見つかりません。`, 'NOT_FOUND');
  return value;
}

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    throw new AppError(400, `${label}の形式が正しくありません。`);
  const t = value.replace(/\r\n?/g, '\n').trim();
  if ([...t].length > max)
    throw new AppError(400, `${label}は${max}文字以内で入力してください。`);
  return t || null;
}

function requireRole(s: Session, roles: Role[], message: string) {
  if (!roles.includes(s.role)) throw new AppError(403, message, 'FORBIDDEN');
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not). */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Catalog ---------------------------------------------------------------------

export type Source = {
  id: string;
  name: string;
  kind: 'site' | 'csv';
  urls: string[];
  prices_include_tax: boolean;
  default_tax_rate: TaxRate;
  order_email: string | null;
  last_import: ImportSummary | null;
  imported_at: string | null;
  items: number;
  listed: number;
  orderable: number;
};

export type CatalogItem = {
  id: string;
  source_id: string;
  source_name: string;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  unit: string;
  listed_price: number;
  price_includes_tax: boolean;
  tax_rate: TaxRate;
  unit_price: number;
  product_url: string | null;
  image_id: string | null;
  available: boolean;
  active: boolean;
  updated_at: string;
};

export async function listSources(deps: Deps, s: Session): Promise<Source[]> {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<Source>(
      `SELECT c.id, c.name, c.kind, c.urls, c.prices_include_tax, c.default_tax_rate,
              CASE WHEN app.is_hq() THEN c.order_email END AS order_email,
              c.last_import, c.imported_at,
              count(i.id)::int AS items,
              count(i.id) FILTER (WHERE i.active)::int AS listed,
              count(i.id) FILTER (WHERE i.active AND i.available)::int AS orderable
         FROM app.catalog_sources c
         LEFT JOIN app.catalog_items i ON i.source_id = c.id
        GROUP BY c.id ORDER BY c.created_at`,
    );
    return r.rows;
  });
}

export async function listCatalog(
  deps: Deps,
  s: Session,
  filter: { sourceId?: string; q?: string; category?: string } = {},
): Promise<{ items: CatalogItem[]; categories: string[] }> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.sourceId && UUID.test(filter.sourceId)) {
    params.push(filter.sourceId);
    where.push(`i.source_id = $${params.length}`);
  }
  const q = filter.q?.normalize('NFKC').trim().slice(0, 100);
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(i.name ILIKE $${params.length} OR i.brand ILIKE $${params.length} OR i.sku ILIKE $${params.length})`,
    );
  }
  const base = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const withCategory =
    filter.category && filter.category.length <= 100
      ? (params.push(filter.category),
        `${base ? `${base} AND` : 'WHERE'} i.category = $${params.length}`)
      : base;
  return asUser(deps.db, ctx(s), async (tx) => {
    const items = await tx.query<CatalogItem>(
      `SELECT i.id, i.source_id, c.name AS source_name, i.sku, i.name, i.brand, i.category,
              i.description, i.unit, i.listed_price, i.price_includes_tax, i.tax_rate,
              i.unit_price, i.product_url, i.image_id, i.available, i.active, i.updated_at
         FROM app.catalog_items i JOIN app.catalog_sources c ON c.id = i.source_id
         ${withCategory}
        ORDER BY i.category NULLS LAST, i.sku NULLS LAST, i.name LIMIT 1000`,
      params,
    );
    const categories = await tx.query<{ category: string }>(
      `SELECT DISTINCT i.category FROM app.catalog_items i
        ${base ? `${base} AND` : 'WHERE'} i.category IS NOT NULL ORDER BY 1`,
      params.slice(0, where.length),
    );
    return {
      items: items.rows,
      categories: categories.rows.map((r) => r.category),
    };
  });
}

export async function catalogImage(deps: Deps, s: Session, imageId: string) {
  const imgId = id(imageId, '画像');
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ mime: string; content: Uint8Array }>(
      'SELECT mime, content FROM app.catalog_images WHERE id = $1',
      [imgId],
    );
    if (!r.rows[0]) throw new AppError(404, '画像が見つかりません。');
    return r.rows[0];
  });
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

const sourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['site', 'csv']),
  urls: z.array(z.string().trim().max(2000)).max(20).default([]),
  pricesIncludeTax: z.boolean(),
  defaultTaxRate: z.union([z.literal(8), z.literal(10)]),
  orderEmail: z.union([emailSchema, z.literal(''), z.null()]).optional(),
});

function checkSourceInput(deps: Deps, raw: unknown) {
  const parsed = sourceInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      '仕入先の名前・取り込み方法・価格の表示・標準税率を確認してください。発注書の送り先は正しいメールアドレスで入力してください。',
    );
  const input = parsed.data;
  const urls = [...new Set(input.urls.filter(Boolean))];
  if (input.kind === 'site') {
    if (!urls.length)
      throw new AppError(
        400,
        '商品一覧または商品ページのURLを1つ以上入力してください。',
      );
    for (const u of urls) {
      let url: URL;
      try {
        url = new URL(u);
      } catch {
        throw new AppError(
          400,
          `URLの形式が正しくありません：${u.slice(0, 80)}`,
        );
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:')
        throw new AppError(400, 'http または https のURLを入力してください。');
      if (deps.demo && !isDemoSupplierUrl(u))
        throw new AppError(
          400,
          `公開デモでは、同梱の架空の仕入先サイト（${DEMO_SUPPLIER.origin}）のURLだけを取り込めます。`,
        );
    }
  }
  return {
    ...input,
    urls: input.kind === 'site' ? urls : [],
    orderEmail: input.orderEmail || null,
  };
}

export async function createSource(deps: Deps, s: Session, raw: unknown) {
  requireRole(s, ['admin'], '仕入先の登録は本社の管理者の操作です。');
  const input = checkSourceInput(deps, raw);
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.catalog_sources (org_id, name, kind, urls, prices_include_tax,
                                        default_tax_rate, order_email, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        s.orgId,
        input.name,
        input.kind,
        input.urls,
        input.pricesIncludeTax,
        input.defaultTaxRate,
        input.orderEmail,
        s.userId,
      ],
    );
    return r.rows[0].id;
  });
}

export async function updateSource(
  deps: Deps,
  s: Session,
  sourceId: string,
  raw: unknown,
) {
  requireRole(s, ['admin'], '仕入先の編集は本社の管理者の操作です。');
  const sid = id(sourceId, '仕入先');
  const input = checkSourceInput(deps, raw);
  await asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query(
      `UPDATE app.catalog_sources
          SET name = $2, urls = $3, prices_include_tax = $4, default_tax_rate = $5, order_email = $6
        WHERE id = $1 AND kind = $7 RETURNING id`,
      [
        sid,
        input.name,
        input.urls,
        input.pricesIncludeTax,
        input.defaultTaxRate,
        input.orderEmail,
        input.kind,
      ],
    );
    if (!r.rows[0]) throw new AppError(404, '仕入先が見つかりません。');
  });
}

export type ImportSummary = {
  at: string;
  pages?: number;
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  /** False when part of the site was not read, so nothing was marked missing. */
  complete: boolean;
  images: number;
  skipped: Skipped[];
  errors: { url: string; message: string }[];
  stoppedEarly?: string;
};

/** Keys longer than the column hold are hashed instead of cut short. */
export const storageKey = (key: string) =>
  key.length <= 500
    ? key
    : `${key.slice(0, 400)}#${createHash('sha256').update(key).digest('hex')}`;

async function loadSource(tx: Sql, sourceId: string) {
  const r = await tx.query<Source>(
    `SELECT id, name, kind, urls, prices_include_tax, default_tax_rate
       FROM app.catalog_sources WHERE id = $1`,
    [sourceId],
  );
  if (!r.rows[0]) throw new AppError(404, '仕入先が見つかりません。');
  return r.rows[0];
}

/** Store what an import read: new items, changed prices, items gone missing. */
async function saveImport(
  deps: Deps,
  s: Session,
  sourceId: string,
  products: ParsedProduct[],
  images: Map<string, FetchedImage>,
  extra: {
    pages?: number;
    skipped: Skipped[];
    errors: ImportSummary['errors'];
    stoppedEarly?: string;
  },
): Promise<ImportSummary> {
  return asUser(deps.db, ctx(s), async (tx) => {
    const source = await loadSource(tx, sourceId);
    const started = (
      await tx.query<{ now: string }>('SELECT now()::text AS now')
    ).rows[0].now;
    const imageIds = new Map<string, string>();
    for (const [url, img] of images) {
      await tx.query(
        `INSERT INTO app.catalog_images (org_id, mime, sha256, content)
         VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, sha256) DO NOTHING`,
        [s.orgId, img.mime, img.sha256, img.content],
      );
      const r = await tx.query<{ id: string }>(
        'SELECT id FROM app.catalog_images WHERE sha256 = $1',
        [img.sha256],
      );
      if (r.rows[0]) imageIds.set(url, r.rows[0].id);
    }
    const existing = new Map(
      (
        await tx.query<{
          external_key: string;
          listed_price: number;
          name: string;
          available: boolean;
        }>(
          'SELECT external_key, listed_price, name, available FROM app.catalog_items WHERE source_id = $1',
          [sourceId],
        )
      ).rows.map((r) => [r.external_key, r]),
    );
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const p of products) {
      const before = existing.get(p.key);
      await tx.query(
        `INSERT INTO app.catalog_items (org_id, source_id, external_key, sku, name, brand, category,
                                        description, unit, listed_price, price_includes_tax, tax_rate,
                                        product_url, image_id, available, seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (source_id, external_key) DO UPDATE
            SET sku = EXCLUDED.sku, name = EXCLUDED.name, brand = EXCLUDED.brand,
                category = EXCLUDED.category, description = EXCLUDED.description,
                listed_price = EXCLUDED.listed_price, price_includes_tax = EXCLUDED.price_includes_tax,
                product_url = EXCLUDED.product_url,
                image_id = coalesce(EXCLUDED.image_id, app.catalog_items.image_id),
                available = EXCLUDED.available, seen_at = EXCLUDED.seen_at`,
        [
          s.orgId,
          sourceId,
          storageKey(p.key),
          p.sku ?? null,
          p.name,
          p.brand ?? null,
          p.category ?? null,
          p.description ?? null,
          p.unit ?? '個',
          p.price,
          p.includesTax ?? source.prices_include_tax,
          p.taxRate ?? source.default_tax_rate,
          p.url ?? null,
          (p.image && imageIds.get(p.image)) || null,
          p.available,
          started,
        ],
      );
      if (!before) created++;
      else if (
        before.listed_price !== p.price ||
        before.name !== p.name ||
        before.available !== p.available
      )
        updated++;
      else unchanged++;
    }
    // Items the supplier no longer lists stay for past orders but cannot be
    // ordered. Only after a complete read: a page that failed or a limit that
    // stopped the crawl would otherwise take unread items off the catalog.
    const complete =
      products.length > 0 && !extra.errors.length && !extra.stoppedEarly;
    const missing = complete
      ? (
          await tx.query(
            `UPDATE app.catalog_items SET available = false
              WHERE source_id = $1 AND seen_at < $2 AND available RETURNING id`,
            [sourceId, started],
          )
        ).rows.length
      : 0;
    const summary: ImportSummary = {
      at: started,
      pages: extra.pages,
      found: products.length,
      created,
      updated,
      unchanged,
      missing,
      complete,
      images: imageIds.size,
      skipped: extra.skipped.slice(0, 50),
      errors: extra.errors.slice(0, 50),
      stoppedEarly: extra.stoppedEarly,
    };
    await tx.query(
      'UPDATE app.catalog_sources SET last_import = $2, imported_at = now() WHERE id = $1',
      [sourceId, JSON.stringify(summary)],
    );
    return summary;
  });
}

// The demo reads files from disk, so there is no server to be polite to.
const limits = (deps: Deps) =>
  deps.demo ? { ...DEFAULT_LIMITS, delayMs: 0 } : DEFAULT_LIMITS;

export async function importFromSite(deps: Deps, s: Session, sourceId: string) {
  requireRole(s, ['admin'], 'カタログの取り込みは本社の管理者の操作です。');
  const sid = id(sourceId, '仕入先');
  const source = await asUser(deps.db, ctx(s), (tx) => loadSource(tx, sid));
  if (source.kind !== 'site')
    throw new AppError(400, 'この仕入先はCSVで取り込みます。');
  const report = await crawlCatalog(source.urls, deps.fetcher, limits(deps));
  return saveImport(deps, s, sid, report.products, report.images, report);
}

export async function importFromCsv(
  deps: Deps,
  s: Session,
  sourceId: string,
  bytes: Uint8Array,
) {
  requireRole(s, ['admin'], 'カタログの取り込みは本社の管理者の操作です。');
  const sid = id(sourceId, '仕入先');
  const source = await asUser(deps.db, ctx(s), (tx) => loadSource(tx, sid));
  if (source.kind !== 'csv')
    throw new AppError(400, 'この仕入先はサイトのURLから取り込みます。');
  if (bytes.byteLength > MAX_CSV_BYTES)
    throw new AppError(413, 'CSVは2MBまでです。', 'TOO_LARGE');
  const parsed = parseCatalogCsv(bytes);
  if (parsed.error) throw new AppError(400, parsed.error);
  const { images } = await fetchProductImages(
    parsed.products,
    deps.fetcher,
    limits(deps),
  );
  return saveImport(deps, s, sid, parsed.products, images, {
    skipped: parsed.skipped,
    errors: [],
  });
}

const itemPatch = z
  .object({
    active: z.boolean().optional(),
    taxRate: z.union([z.literal(8), z.literal(10)]).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

export async function updateItem(
  deps: Deps,
  s: Session,
  itemId: string,
  raw: unknown,
) {
  requireRole(s, ['admin'], 'カタログの編集は本社の管理者の操作です。');
  const iid = id(itemId, '商品');
  const parsed = itemPatch.safeParse(raw);
  if (!parsed.success) throw new AppError(400, '変更内容が正しくありません。');
  const p = parsed.data;
  await asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query(
      `UPDATE app.catalog_items
          SET active = coalesce($2, active), tax_rate = coalesce($3, tax_rate), unit = coalesce($4, unit)
        WHERE id = $1 RETURNING id`,
      [iid, p.active ?? null, p.taxRate ?? null, p.unit ?? null],
    );
    if (!r.rows[0]) throw new AppError(404, '商品が見つかりません。');
  });
}

// Cart ----------------------------------------------------------------------------

export type CartLine = {
  id: string;
  item_id: string;
  name: string;
  sku: string | null;
  unit: string;
  unit_price: number;
  tax_rate: TaxRate;
  qty: number;
  image_id: string | null;
  orderable: boolean;
};

export type Cart = {
  order_id: string;
  source_id: string;
  source_name: string;
  needed_by: string | null;
  note: string | null;
  lines: CartLine[];
};

export async function getCarts(deps: Deps, s: Session): Promise<Cart[]> {
  if (s.role !== 'store') return [];
  return asUser(deps.db, ctx(s), async (tx) => {
    const orders = await tx.query<Omit<Cart, 'lines'>>(
      `SELECT o.id AS order_id, o.source_id, c.name AS source_name, o.needed_by::text, o.note
         FROM app.orders o JOIN app.catalog_sources c ON c.id = o.source_id
        WHERE o.status = 'draft' AND o.created_by = $1 ORDER BY o.created_at`,
      [s.userId],
    );
    if (!orders.rows.length) return [];
    const lines = await tx.query<CartLine & { order_id: string }>(
      `SELECT l.id, l.order_id, l.item_id, l.name, l.sku, l.unit, l.unit_price, l.tax_rate, l.qty,
              i.image_id, coalesce(i.active AND i.available, false) AS orderable
         FROM app.order_lines l LEFT JOIN app.catalog_items i ON i.id = l.item_id
        WHERE l.order_id = ANY($1::uuid[]) ORDER BY l.created_at, l.id`,
      [orders.rows.map((o) => o.order_id)],
    );
    return orders.rows.map((o) => ({
      ...o,
      lines: lines.rows.filter((l) => l.order_id === o.order_id),
    }));
  });
}

function qty(value: unknown): number {
  // Number(null), Number('') and Number(false) are 0, which deletes a line.
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,4}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 9999)
    throw new AppError(400, '数量は0〜9999の整数で入力してください。');
  return n;
}

/** Add an item to the cart for its supplier (one cart per supplier). */
export async function addToCart(
  deps: Deps,
  s: Session,
  itemId: string,
  amount: unknown,
) {
  requireRole(s, ['store'], '発注依頼は店舗スタッフの操作です。');
  const iid = id(itemId, '商品');
  const n = qty(amount);
  if (n < 1) throw new AppError(400, '数量は1以上で入力してください。');
  return asUser(deps.db, ctx(s), async (tx) => {
    const item = await tx.query<{ source_id: string }>(
      'SELECT source_id FROM app.catalog_items WHERE id = $1',
      [iid],
    );
    if (!item.rows[0]) throw new AppError(404, '商品が見つかりません。');
    const sourceId = item.rows[0].source_id;
    await tx.query(
      `INSERT INTO app.orders (org_id, store_id, source_id, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (created_by, source_id) WHERE status = 'draft' DO NOTHING`,
      [s.orgId, s.storeId, sourceId, s.userId],
    );
    const order = await tx.query<{ id: string }>(
      `SELECT id FROM app.orders WHERE created_by = $1 AND source_id = $2 AND status = 'draft'`,
      [s.userId, sourceId],
    );
    await tx.query(
      `INSERT INTO app.order_lines (org_id, order_id, item_id, name, unit, unit_price, tax_rate, qty)
       VALUES ($1, $2, $3, '', '', 0, 10, $4)
       ON CONFLICT (order_id, item_id) DO UPDATE
          SET qty = least(app.order_lines.qty + EXCLUDED.qty, 9999)`,
      [s.orgId, order.rows[0].id, iid, n],
    );
    const count = await tx.query<{ n: number }>(
      `SELECT coalesce(sum(qty), 0)::int AS n FROM app.order_lines WHERE order_id = $1`,
      [order.rows[0].id],
    );
    return { orderId: order.rows[0].id, units: count.rows[0].n };
  });
}

export async function setCartLine(
  deps: Deps,
  s: Session,
  lineId: string,
  amount: unknown,
) {
  requireRole(s, ['store'], '発注依頼は店舗スタッフの操作です。');
  const lid = id(lineId, '明細');
  const n = qty(amount);
  await asUser(deps.db, ctx(s), async (tx) => {
    const r =
      n === 0
        ? await tx.query(
            'DELETE FROM app.order_lines WHERE id = $1 RETURNING id',
            [lid],
          )
        : await tx.query(
            'UPDATE app.order_lines SET qty = $2 WHERE id = $1 RETURNING id',
            [lid, n],
          );
    if (!r.rows[0]) throw new AppError(404, 'カートの明細が見つかりません。');
  });
}

export async function discardCart(deps: Deps, s: Session, orderId: string) {
  requireRole(s, ['store'], '発注依頼は店舗スタッフの操作です。');
  const oid = id(orderId, 'カート');
  await asUser(deps.db, ctx(s), async (tx) => {
    await tx.query('DELETE FROM app.order_lines WHERE order_id = $1', [oid]);
    const r = await tx.query(
      `DELETE FROM app.orders WHERE id = $1 AND status = 'draft' RETURNING id`,
      [oid],
    );
    if (!r.rows[0]) throw new AppError(404, 'カートが見つかりません。');
  });
}

export async function submitCart(
  deps: Deps,
  s: Session,
  orderId: string,
  body: { neededBy?: unknown; note?: unknown },
) {
  requireRole(s, ['store'], '発注依頼は店舗スタッフの操作です。');
  const oid = id(orderId, 'カート');
  const neededBy = text(body.neededBy, 10, '希望納期');
  if (neededBy && !isDate(neededBy))
    throw new AppError(400, '希望納期の日付が正しくありません。');
  const note = text(body.note, 1000, 'メモ');
  await asUser(deps.db, ctx(s), async (tx) => {
    // Touching the lines re-copies the current catalog price and name
    // (app.order_line_snapshot), so the request shows today's reference.
    await tx.query('UPDATE app.order_lines SET qty = qty WHERE order_id = $1', [
      oid,
    ]);
    const r = await tx.query(
      `UPDATE app.orders SET needed_by = $2::date, note = $3, status = 'requested'
        WHERE id = $1 AND status = 'draft' RETURNING id`,
      [oid, neededBy, note],
    );
    if (!r.rows[0]) throw new AppError(404, 'カートが見つかりません。');
  });
  return oid;
}

// Orders ------------------------------------------------------------------------

export type OrderSummary = {
  id: string;
  status: Status;
  request_number: string | null;
  po_number: string | null;
  store_id: string;
  store_name: string;
  supplier_name: string;
  requested_by_name: string;
  requested_at: string | null;
  updated_at: string;
  line_count: number;
  amount: number;
  amount_kind: 'ordered' | 'quote' | 'estimate';
  quote_version: number | null;
  valid_until: string | null;
};

export type OrderFilter = 'todo' | 'open' | 'ordered' | 'all';

const ESTIMATE = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS line_count,
           coalesce(sum(l.unit_price::bigint * l.qty) FILTER (WHERE l.tax_rate = 10), 0)::bigint AS s10,
           coalesce(sum(l.unit_price::bigint * l.qty) FILTER (WHERE l.tax_rate = 8), 0)::bigint AS s8
      FROM app.order_lines l WHERE l.order_id = o.id) e ON true`;

export async function listOrders(
  deps: Deps,
  s: Session,
  filter: OrderFilter = 'all',
): Promise<OrderSummary[]> {
  const conditions: Record<OrderFilter, string> = {
    todo: isHq(s.role) ? `o.status = 'requested'` : `o.status = 'quoted'`,
    open: `o.status IN ('requested', 'quoted')`,
    ordered: `o.status = 'ordered'`,
    all: `o.status <> 'draft'`,
  };
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<OrderSummary>(
      `SELECT o.id, o.status, o.request_number, o.po_number, o.store_id, st.name AS store_name,
              c.name AS supplier_name, u.name AS requested_by_name, o.requested_at, o.updated_at,
              e.line_count,
              coalesce(o.ordered_total, q.total,
                       e.s10 + app.tax_amount(e.s10, 10) + e.s8 + app.tax_amount(e.s8, 8))::bigint AS amount,
              CASE WHEN o.ordered_total IS NOT NULL THEN 'ordered'
                   WHEN q.total IS NOT NULL AND o.status = 'quoted' THEN 'quote'
                   ELSE 'estimate' END AS amount_kind,
              q.version AS quote_version, q.valid_until::text
         FROM app.orders o
         JOIN app.stores st ON st.id = o.store_id
         JOIN app.catalog_sources c ON c.id = o.source_id
         JOIN app.users u ON u.id = o.created_by
         LEFT JOIN app.quotes q ON q.id = o.current_quote_id
         ${ESTIMATE}
        WHERE ${conditions[filter]}
        ORDER BY o.updated_at DESC LIMIT ${LIST_LIMIT}`,
    );
    return r.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  });
}

export type OrderStats = {
  todo: number;
  waiting: number;
  open: number;
  ordered: number;
  all: number;
  orderedThisMonth: number;
  orderedThisMonthTotal: number;
};

/** Counts for the list's tabs and tiles, over every order (not a page of them). */
export async function orderStats(deps: Deps, s: Session): Promise<OrderStats> {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<OrderStats>(
      `SELECT count(*) FILTER (WHERE status = CASE WHEN app.is_hq() THEN 'requested' ELSE 'quoted' END)::int AS todo,
              count(*) FILTER (WHERE status = CASE WHEN app.is_hq() THEN 'quoted' ELSE 'requested' END)::int AS waiting,
              count(*) FILTER (WHERE status IN ('requested', 'quoted'))::int AS open,
              count(*) FILTER (WHERE status = 'ordered')::int AS ordered,
              count(*) FILTER (WHERE status <> 'draft')::int AS "all",
              count(*) FILTER (WHERE status = 'ordered' AND date_trunc('month', ordered_at AT TIME ZONE 'Asia/Tokyo')
                                 = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))::int AS "orderedThisMonth",
              coalesce(sum(ordered_total) FILTER (WHERE status = 'ordered' AND date_trunc('month', ordered_at AT TIME ZONE 'Asia/Tokyo')
                                 = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo')), 0)::bigint AS "orderedThisMonthTotal"
         FROM app.orders`,
    );
    return r.rows[0];
  });
}

export const LIST_LIMIT = 300;

export type QuoteLine = {
  line_no: number;
  order_line_id: string;
  name: string;
  sku: string | null;
  unit: string;
  tax_rate: TaxRate;
  unit_price: number;
  qty: number;
  amount: number;
  requested_qty: number;
  reference_price: number;
};

export type Quote = {
  id: string;
  version: number;
  status: QuoteStatus;
  lines: QuoteLine[];
  shipping_fee: number;
  subtotal_10: number;
  tax_10: number;
  subtotal_8: number;
  tax_8: number;
  total: number;
  valid_until: string;
  note: string | null;
  issued_by_name: string;
  issued_at: string;
  responded_by_name: string | null;
  responded_at: string | null;
  response_note: string | null;
};

export type OrderLine = {
  id: string;
  item_id: string;
  name: string;
  sku: string | null;
  unit: string;
  unit_price: number;
  tax_rate: TaxRate;
  qty: number;
  product_url: string | null;
  image_id: string | null;
};

export type AuditEntry = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  actor_name: string | null;
  at: string;
  request_number?: string | null;
  order_id?: string | null;
};

export type Delivery = {
  event: NotificationEvent;
  audience: Audience;
  recipients: number;
  delivered: number;
  latest: string;
};

export type OrderDetail = OrderSummary & {
  created_by: string;
  needed_by: string | null;
  note: string | null;
  revision_note: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  ordered_at: string | null;
  ordered_total: number | null;
  current_quote_id: string | null;
  supplier_order_email: string | null;
  lines: OrderLine[];
  quotes: Quote[];
  audit: AuditEntry[];
  deliveries: Delivery[];
};

const toNumber = <T extends Record<string, unknown>>(
  row: T,
  keys: (keyof T)[],
) => {
  for (const k of keys)
    if (row[k] !== null && row[k] !== undefined)
      (row as Record<string, unknown>)[k as string] = Number(row[k]);
  return row;
};

export async function getOrder(
  deps: Deps,
  s: Session,
  orderId: string,
): Promise<OrderDetail> {
  const oid = id(orderId, '発注依頼');
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<OrderDetail>(
      `SELECT o.id, o.status, o.request_number, o.po_number, o.store_id, st.name AS store_name,
              c.name AS supplier_name,
              CASE WHEN app.is_hq() THEN c.order_email END AS supplier_order_email,
              u.name AS requested_by_name, o.requested_at, o.updated_at, o.created_by,
              o.needed_by::text, o.note, o.revision_note, o.reject_reason, o.cancel_reason,
              o.ordered_at, o.ordered_total, o.current_quote_id, e.line_count,
              coalesce(o.ordered_total, q.total,
                       e.s10 + app.tax_amount(e.s10, 10) + e.s8 + app.tax_amount(e.s8, 8))::bigint AS amount,
              CASE WHEN o.ordered_total IS NOT NULL THEN 'ordered'
                   WHEN q.total IS NOT NULL AND o.status = 'quoted' THEN 'quote'
                   ELSE 'estimate' END AS amount_kind,
              q.version AS quote_version, q.valid_until::text
         FROM app.orders o
         JOIN app.stores st ON st.id = o.store_id
         JOIN app.catalog_sources c ON c.id = o.source_id
         JOIN app.users u ON u.id = o.created_by
         LEFT JOIN app.quotes q ON q.id = o.current_quote_id
         ${ESTIMATE}
        WHERE o.id = $1 AND o.status <> 'draft'`,
      [oid],
    );
    const order = r.rows[0];
    if (!order) throw new AppError(404, '発注依頼が見つかりません。');
    toNumber(order, ['amount', 'ordered_total']);
    const lines = await tx.query<OrderLine>(
      `SELECT l.id, l.item_id, l.name, l.sku, l.unit, l.unit_price, l.tax_rate, l.qty, l.product_url,
              i.image_id
         FROM app.order_lines l LEFT JOIN app.catalog_items i ON i.id = l.item_id
        WHERE l.order_id = $1 ORDER BY l.created_at, l.id`,
      [oid],
    );
    const quotes = await tx.query<Quote>(
      `SELECT q.id, q.version, q.status, q.lines, q.shipping_fee, q.subtotal_10, q.tax_10,
              q.subtotal_8, q.tax_8, q.total, q.valid_until::text, q.note,
              i.name AS issued_by_name, q.issued_at, r.name AS responded_by_name, q.responded_at,
              q.response_note
         FROM app.quotes q JOIN app.users i ON i.id = q.issued_by
         LEFT JOIN app.users r ON r.id = q.responded_by
        WHERE q.order_id = $1 ORDER BY q.version DESC`,
      [oid],
    );
    const audit = await tx.query<AuditEntry>(
      `SELECT a.id::text, a.action, a.detail, u.name AS actor_name, a.at
         FROM app.audit_log a LEFT JOIN app.users u ON u.id = a.actor_id
        WHERE a.order_id = $1 ORDER BY a.id`,
      [oid],
    );
    const deliveries = await tx.query<Delivery>(
      'SELECT * FROM app.order_deliveries($1)',
      [oid],
    );
    return {
      ...order,
      lines: lines.rows,
      quotes: quotes.rows.map((q) =>
        toNumber(q, ['subtotal_10', 'tax_10', 'subtotal_8', 'tax_8', 'total']),
      ),
      audit: audit.rows,
      deliveries: deliveries.rows.map((d) => ({
        ...d,
        recipients: Number(d.recipients),
        delivered: Number(d.delivered),
      })),
    };
  });
}

/** Lock the order first so quoting and answering a quote never deadlock. */
async function lockOrder(tx: Sql, orderId: string) {
  const r = await tx.query<{ status: Status; current_quote_id: string | null }>(
    'SELECT status, current_quote_id FROM app.orders WHERE id = $1 FOR UPDATE',
    [orderId],
  );
  if (!r.rows[0]) throw new AppError(404, '発注依頼が見つかりません。');
  return r.rows[0];
}

const quoteInput = z.object({
  lines: z
    .array(
      z.object({
        orderLineId: z.string().regex(UUID),
        unitPrice: z.number().int().min(0).max(100_000_000),
        qty: z.number().int().min(1).max(9999),
      }),
    )
    .min(1)
    .max(200),
  shippingFee: z.number().int().min(0).max(10_000_000),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).nullish(),
  /** The quote version the screen showed (null for the first quote). */
  basedOn: z.number().int().nullable(),
});

export async function issueQuote(
  deps: Deps,
  s: Session,
  orderId: string,
  raw: unknown,
) {
  requireRole(s, ['buyer', 'admin'], '見積の送付は本社の操作です。');
  const oid = id(orderId, '発注依頼');
  const parsed = quoteInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      '見積に含める商品を1つ以上選び、単価・数量・送料を整数で入力してください。',
    );
  const input = parsed.data;
  const today = todayInJapan();
  if (!isDate(input.validUntil))
    throw new AppError(400, '見積の有効期限の日付が正しくありません。');
  if (
    input.validUntil < today ||
    input.validUntil > addDays(today, MAX_QUOTE_DAYS)
  )
    throw new AppError(
      400,
      `見積の有効期限は今日から${MAX_QUOTE_DAYS}日以内で指定してください。`,
    );
  return asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    const latest = await tx.query<{ v: number | null }>(
      'SELECT max(version) AS v FROM app.quotes WHERE order_id = $1',
      [oid],
    );
    if ((latest.rows[0].v ?? null) !== input.basedOn)
      throw new AppError(
        409,
        'ほかの担当者が先に見積を送りました。画面を更新して最新の見積を確認してください。',
        'STALE',
      );
    if (order.status !== 'requested' && order.status !== 'quoted')
      throw new AppError(
        409,
        'この依頼は見積を送れる状態ではありません。',
        'STATE',
      );
    const r = await tx.query<{ id: string; version: number; total: string }>(
      `INSERT INTO app.quotes (org_id, order_id, lines, shipping_fee, valid_until, note, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, version, total`,
      [
        s.orgId,
        oid,
        JSON.stringify(
          input.lines.map((l) => ({
            order_line_id: l.orderLineId,
            unit_price: l.unitPrice,
            qty: l.qty,
          })),
        ),
        input.shippingFee,
        input.validUntil,
        text(input.note, 1000, 'メモ'),
        s.userId,
      ],
    );
    return { ...r.rows[0], total: Number(r.rows[0].total) };
  });
}

export async function rejectOrder(
  deps: Deps,
  s: Session,
  orderId: string,
  reason: unknown,
) {
  requireRole(s, ['buyer', 'admin'], '却下は本社の操作です。');
  const oid = id(orderId, '発注依頼');
  const why = text(reason, 1000, '却下の理由');
  if (!why) throw new AppError(400, '却下の理由を入力してください。');
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    if (order.status !== 'requested')
      throw new AppError(
        409,
        'この依頼は却下できる状態ではありません。',
        'STATE',
      );
    await tx.query(
      `UPDATE app.orders SET status = 'rejected', reject_reason = $2 WHERE id = $1`,
      [oid, why],
    );
  });
}

/** Why an answer to a quote did not apply, in words for the store. */
async function staleQuote(
  tx: Sql,
  orderId: string,
  quoteId: string,
): Promise<never> {
  const r = await tx.query<{ status: QuoteStatus; order_status: Status }>(
    `SELECT q.status, o.status AS order_status FROM app.quotes q JOIN app.orders o ON o.id = q.order_id
      WHERE q.id = $1 AND q.order_id = $2`,
    [quoteId, orderId],
  );
  const row = r.rows[0];
  if (!row) throw new AppError(404, '見積が見つかりません。');
  if (row.order_status === 'ordered')
    throw new AppError(409, 'この依頼は既に発注済みです。', 'STATE');
  if (row.status === 'superseded')
    throw new AppError(
      409,
      '本社が見積を更新しました。最新の見積を確認してから承諾してください。',
      'STALE',
    );
  throw new AppError(409, 'この見積には既に回答しています。', 'STATE');
}

export async function acceptQuote(
  deps: Deps,
  s: Session,
  orderId: string,
  quoteId: unknown,
) {
  requireRole(s, ['store'], '見積の承諾は店舗スタッフの操作です。');
  const oid = id(orderId, '発注依頼');
  const qid = id(quoteId, '見積');
  return asUser(deps.db, ctx(s), async (tx) => {
    await lockOrder(tx, oid);
    const r = await tx.query(
      `UPDATE app.quotes SET status = 'accepted', responded_by = $3
        WHERE id = $1 AND order_id = $2 AND status = 'sent' RETURNING id`,
      [qid, oid, s.userId],
    );
    if (!r.rows[0]) return staleQuote(tx, oid, qid);
    const o = await tx.query<{ po_number: string; ordered_total: string }>(
      'SELECT po_number, ordered_total FROM app.orders WHERE id = $1',
      [oid],
    );
    return {
      poNumber: o.rows[0].po_number,
      total: Number(o.rows[0].ordered_total),
    };
  });
}

export async function requestRevision(
  deps: Deps,
  s: Session,
  orderId: string,
  quoteId: unknown,
  note: unknown,
) {
  requireRole(s, ['store'], '見積の修正依頼は店舗スタッフの操作です。');
  const oid = id(orderId, '発注依頼');
  const qid = id(quoteId, '見積');
  const message = text(note, 1000, '修正してほしい内容');
  if (!message)
    throw new AppError(400, '修正してほしい内容を入力してください。');
  await asUser(deps.db, ctx(s), async (tx) => {
    await lockOrder(tx, oid);
    const r = await tx.query(
      `UPDATE app.quotes SET status = 'declined', responded_by = $3, response_note = $4
        WHERE id = $1 AND order_id = $2 AND status = 'sent' RETURNING id`,
      [qid, oid, s.userId, message],
    );
    if (!r.rows[0]) await staleQuote(tx, oid, qid);
  });
}

export async function cancelOrder(
  deps: Deps,
  s: Session,
  orderId: string,
  reason: unknown,
) {
  requireRole(s, ['store'], '依頼の取り下げは店舗スタッフの操作です。');
  const oid = id(orderId, '発注依頼');
  const why = text(reason, 1000, '取り下げの理由');
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    if (order.status !== 'requested' && order.status !== 'quoted')
      throw new AppError(
        409,
        'この依頼は取り下げられる状態ではありません。',
        'STATE',
      );
    await tx.query(
      `UPDATE app.orders SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`,
      [oid, why],
    );
  });
}

// Notifications, counts, audit ------------------------------------------------------

export type Notification = {
  id: string;
  order_id: string;
  event: NotificationEvent;
  audience: Audience;
  to_email: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'demo';
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  subject: string;
  body: string;
};

export async function listNotifications(
  deps: Deps,
  s: Session,
  limit = 100,
): Promise<Notification[]> {
  const rows = await asUser(deps.db, ctx(s), (tx) =>
    tx.query<Omit<Notification, 'subject' | 'body'> & { payload: Payload }>(
      `SELECT id::text, order_id, event, audience, to_email, status, attempts, last_error,
              created_at, sent_at, payload
         FROM app.outbox ORDER BY id DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 300)],
    ),
  );
  return rows.rows.map(({ payload, ...row }) => {
    const mail = render(
      { event: row.event, audience: row.audience, payload },
      deps.origin,
    );
    return { ...row, subject: mail.subject, body: mail.text };
  });
}

export async function counts(deps: Deps, s: Session) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ todo: number; cart: number; recent: number }>(
      `SELECT
         (SELECT count(*)::int FROM app.orders
           WHERE status = CASE WHEN app.is_hq() THEN 'requested' ELSE 'quoted' END) AS todo,
         (SELECT coalesce(sum(l.qty), 0)::int FROM app.order_lines l JOIN app.orders o ON o.id = l.order_id
           WHERE o.status = 'draft' AND o.created_by = $1) AS cart,
         (SELECT count(*)::int FROM app.outbox
           WHERE to_user_id = $1 AND created_at > now() - interval '1 day') AS recent`,
      [s.userId],
    );
    return r.rows[0];
  });
}

export async function listAudit(deps: Deps, s: Session): Promise<AuditEntry[]> {
  requireRole(s, ['admin'], '監査ログは本社の管理者だけが見られます。');
  const r = await asUser(deps.db, ctx(s), (tx) =>
    tx.query<AuditEntry>(
      `SELECT a.id::text, a.action, a.detail, u.name AS actor_name, a.at, a.order_id,
              o.request_number
         FROM app.audit_log a
         LEFT JOIN app.users u ON u.id = a.actor_id
         LEFT JOIN app.orders o ON o.id = a.order_id
        ORDER BY a.id DESC LIMIT 300`,
    ),
  );
  return r.rows;
}

export async function listStores(deps: Deps, s: Session) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{
      id: string;
      code: string;
      name: string;
      members: { name: string; email: string; role: Role }[];
    }>(
      `SELECT st.id, st.code, st.name,
              coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email, 'role', m.role)
                       ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
         FROM app.stores st
         LEFT JOIN app.memberships m ON m.store_id = st.id
         LEFT JOIN app.users u ON u.id = m.user_id
        GROUP BY st.id ORDER BY st.code`,
    );
    const hq = await tx.query<{ name: string; email: string; role: Role }>(
      `SELECT u.name, u.email, m.role FROM app.memberships m JOIN app.users u ON u.id = m.user_id
        WHERE m.role IN ('buyer', 'admin') ORDER BY m.role DESC, u.name`,
    );
    return { stores: r.rows, hq: hq.rows };
  });
}
