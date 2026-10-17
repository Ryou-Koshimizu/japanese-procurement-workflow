// Catalogs of makers (B社 only): imported from a maker's site or a CSV file,
// read by agents to write the product outline, managed by admins.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { asUser, AppError, type Sql } from '../db';
import type { Session } from '../auth';
import {
  crawlCatalog,
  fetchProductImages,
  DEFAULT_LIMITS,
  type FetchedImage,
} from '../importer';
import { isDemoSupplierUrl } from '../demo-supplier';
import { parseCatalogCsv, MAX_CSV_BYTES } from '../../core/catalog/csv';
import type { ParsedProduct, Skipped } from '../../core/catalog/product';
import { DEMO_SUPPLIER } from '../../demo/supplier-data';
import type { TaxRate } from '../../core/money';
import { ctx, escapeLike, id, requireAdmin, UUID, type Deps } from './common';

// Catalog ---------------------------------------------------------------------

export type Source = {
  id: string;
  name: string;
  kind: 'site' | 'csv';
  urls: string[];
  prices_include_tax: boolean;
  default_tax_rate: TaxRate;
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

const sourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['site', 'csv']),
  urls: z.array(z.string().trim().max(2000)).max(20).default([]),
  pricesIncludeTax: z.boolean(),
  defaultTaxRate: z.union([z.literal(8), z.literal(10)]),
});

function checkSourceInput(deps: Deps, raw: unknown) {
  const parsed = sourceInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      'カタログの名前・取り込み方法・価格の表示・標準税率を確認してください。',
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
          `公開デモでは、同梱の架空のメーカーのサイト（${DEMO_SUPPLIER.origin}）のURLだけを取り込めます。`,
        );
    }
  }
  return {
    ...input,
    urls: input.kind === 'site' ? urls : [],
  };
}

export async function createSource(deps: Deps, s: Session, raw: unknown) {
  requireAdmin(s);
  const input = checkSourceInput(deps, raw);
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.catalog_sources (org_id, name, kind, urls, prices_include_tax,
                                        default_tax_rate, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        s.orgId,
        input.name,
        input.kind,
        input.urls,
        input.pricesIncludeTax,
        input.defaultTaxRate,
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
  requireAdmin(s);
  const sid = id(sourceId, 'カタログ');
  const input = checkSourceInput(deps, raw);
  await asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query(
      `UPDATE app.catalog_sources
          SET name = $2, urls = $3, prices_include_tax = $4, default_tax_rate = $5
        WHERE id = $1 AND kind = $6 RETURNING id`,
      [
        sid,
        input.name,
        input.urls,
        input.pricesIncludeTax,
        input.defaultTaxRate,
        input.kind,
      ],
    );
    if (!r.rows[0]) throw new AppError(404, 'カタログが見つかりません。');
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
  if (!r.rows[0]) throw new AppError(404, 'カタログが見つかりません。');
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
  requireAdmin(s);
  const sid = id(sourceId, 'カタログ');
  const source = await asUser(deps.db, ctx(s), (tx) => loadSource(tx, sid));
  if (source.kind !== 'site')
    throw new AppError(400, 'このカタログはCSVで取り込みます。');
  const report = await crawlCatalog(source.urls, deps.fetcher, limits(deps));
  return saveImport(deps, s, sid, report.products, report.images, report);
}

export async function importFromCsv(
  deps: Deps,
  s: Session,
  sourceId: string,
  bytes: Uint8Array,
) {
  requireAdmin(s);
  const sid = id(sourceId, 'カタログ');
  const source = await asUser(deps.db, ctx(s), (tx) => loadSource(tx, sid));
  if (source.kind !== 'csv')
    throw new AppError(400, 'このカタログはサイトのURLから取り込みます。');
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
  requireAdmin(s);
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
