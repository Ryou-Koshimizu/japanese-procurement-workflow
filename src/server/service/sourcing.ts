// B社's work between the request and the quote: the product outline (商品概要)
// and the makers' quotes (相見積). B社 only; the database refuses A社.
import { z } from 'zod';
import { asUser, AppError, type Sql } from '../db';
import type { Session } from '../auth';
import {
  ctx,
  dateInput,
  expectStatus,
  id,
  lockOrder,
  requireAgent,
  text,
  UUID,
  wrongState,
  yenInt,
  type Deps,
} from './common';

const lineInput = z.object({
  name: z.string().trim().min(1).max(200),
  spec: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v ?? ''),
  qty: z.number().int().min(1).max(9999),
  unit: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => v || '個'),
  tax_rate: z.union([z.literal(8), z.literal(10)]).default(10),
  item_id: z
    .union([z.string().regex(UUID), z.null()])
    .optional()
    .transform((v) => v ?? null),
});

/** Replace the whole outline while B社 checks the request. */
export async function setOutline(
  deps: Deps,
  s: Session,
  orderId: string,
  raw: unknown,
) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  const parsed = z.array(lineInput).min(1).max(50).safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      '商品概要は1〜50行で、各行に品名（200文字以内）と数量（1〜9999）を入れてください。仕様は500文字、単位は20文字までです。',
    );
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['requested']);
    await tx.query('DELETE FROM app.order_lines WHERE order_id = $1', [oid]);
    for (const [i, l] of parsed.data.entries())
      await tx.query(
        `INSERT INTO app.order_lines (org_id, order_id, position, name, spec, qty, unit, tax_rate, item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          s.orgId,
          oid,
          (i + 1) * 10,
          l.name,
          l.spec,
          l.qty,
          l.unit,
          l.tax_rate,
          l.item_id,
        ],
      );
  });
}

/** Fix the outline: the request moves to asking makers. */
export async function confirmOutline(deps: Deps, s: Session, orderId: string) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['requested']);
    await tx.query(`UPDATE app.orders SET status = 'sourcing' WHERE id = $1`, [
      oid,
    ]);
  });
}

/** Back to editing the outline; open maker quotes are withdrawn by the database. */
export async function reopenOutline(deps: Deps, s: Session, orderId: string) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['sourcing']);
    await tx.query(`UPDATE app.orders SET status = 'requested' WHERE id = $1`, [
      oid,
    ]);
  });
}

/** Ask one or more makers for a quote; each gets the outline by mail. */
export async function requestMakerQuotes(
  deps: Deps,
  s: Session,
  orderId: string,
  makerIds: unknown,
) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  const parsed = z
    .array(z.string().regex(UUID))
    .min(1)
    .max(10)
    .safeParse(makerIds);
  if (!parsed.success)
    throw new AppError(400, '見積を頼むメーカーを1〜10社選んでください。');
  const ids = [...new Set(parsed.data)];
  return asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['sourcing']);
    const open = await tx.query<{ maker_id: string }>(
      `SELECT maker_id FROM app.maker_quotes WHERE order_id = $1 AND status IN ('requested', 'received')`,
      [oid],
    );
    if (open.rows.some((r) => ids.includes(r.maker_id)))
      throw new AppError(
        409,
        '選んだメーカーには、もう見積を頼んでいます。',
        'DUPLICATE',
      );
    const out: string[] = [];
    for (const m of ids) {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO app.maker_quotes (org_id, order_id, maker_id) VALUES ($1, $2, $3) RETURNING id`,
        [s.orgId, oid, m],
      );
      out.push(r.rows[0].id);
    }
    return out;
  });
}

/** The order a maker quote belongs to, locked before the maker quote changes. */
async function lockForMakerQuote(tx: Sql, makerQuoteId: string) {
  const r = await tx.query<{ order_id: string }>(
    'SELECT order_id FROM app.maker_quotes WHERE id = $1',
    [makerQuoteId],
  );
  if (!r.rows[0])
    throw new AppError(404, 'メーカーの見積が見つかりません。', 'NOT_FOUND');
  const order = await lockOrder(tx, r.rows[0].order_id);
  expectStatus(order.status, ['sourcing', 'quoted']);
}

const recordInput = z.object({
  lines: z
    .array(
      z.object({
        order_line_id: z.string().regex(UUID),
        unit_cost: yenInt(100_000_000),
        stock: z.enum(['in_stock', 'backorder', 'out_of_stock']),
      }),
    )
    .min(1)
    .max(50),
  shipping_cost: yenInt(10_000_000),
  lead_time: z.string().max(100).nullish(),
  valid_until: z.string(),
  note: z.string().max(1000).nullish(),
});

/** Record what the maker answered: unit cost and stock per line, shipping, lead time. */
export async function recordMakerQuote(
  deps: Deps,
  s: Session,
  makerQuoteId: string,
  raw: unknown,
) {
  requireAgent(s);
  const mid = id(makerQuoteId, 'メーカーの見積');
  const parsed = recordInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      '原価（税抜）はすべての行に整数の円で、送料は0〜10,000,000円で入力し、在庫を選んでください。',
    );
  const input = parsed.data;
  const validUntil = dateInput(input.valid_until, 'メーカーの見積の有効期限', {
    from: 0,
    to: 180,
  });
  await asUser(deps.db, ctx(s), async (tx) => {
    await lockForMakerQuote(tx, mid);
    const r = await tx.query(
      `UPDATE app.maker_quotes
          SET status = 'received', lines = $2, shipping_cost = $3, lead_time = $4, valid_until = $5, note = $6
        WHERE id = $1 AND status = 'requested' RETURNING id`,
      [
        mid,
        JSON.stringify(input.lines),
        input.shipping_cost,
        text(input.lead_time, 100, '納期の目安'),
        validUntil,
        text(input.note, 1000, 'メモ'),
      ],
    );
    if (!r.rows[0]) throw wrongState();
  });
}

/** The maker cannot supply (or B社 stops waiting): closed with a note. */
export async function declineMakerQuote(
  deps: Deps,
  s: Session,
  makerQuoteId: string,
  note: unknown,
) {
  requireAgent(s);
  const mid = id(makerQuoteId, 'メーカーの見積');
  const why = text(note, 1000, '辞退の理由');
  if (!why) throw new AppError(400, '辞退の理由を入力してください。');
  await asUser(deps.db, ctx(s), async (tx) => {
    await lockForMakerQuote(tx, mid);
    const r = await tx.query(
      `UPDATE app.maker_quotes SET status = 'declined', note = $2
        WHERE id = $1 AND status IN ('requested', 'received') RETURNING id`,
      [mid, why],
    );
    if (!r.rows[0]) throw wrongState();
  });
}
