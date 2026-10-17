// Quotes to A社 (見積書): issued only through app.issue_quote, which prices
// every line and keeps the costs where A社 cannot read them; answered by the
// requesting branch.
import { z } from 'zod';
import { asUser, AppError, type Sql } from '../db';
import type { Session } from '../auth';
import { MAX_MARKUP_BP } from '../../core/money';
import {
  MAX_QUOTE_DAYS,
  type QuoteStatus,
  type Status,
} from '../../core/workflow';
import {
  ctx,
  dateInput,
  id,
  lockOrder,
  requireAgent,
  requireClient,
  text,
  UUID,
  yenInt,
  type Deps,
} from './common';

const issueInput = z
  .object({
    maker_quote_id: z.string().regex(UUID),
    mode: z.enum(['markup', 'price']),
    markup_bp: z.number().int().min(0).max(MAX_MARKUP_BP).nullish(),
    prices: z
      .array(
        z.object({
          order_line_id: z.string().regex(UUID),
          unit_price: yenInt(100_000_000),
        }),
      )
      .max(50)
      .nullish(),
    shipping_fee: yenInt(10_000_000),
    expenses: yenInt(10_000_000),
    valid_until: z.string(),
    note: z.string().max(1000).nullish(),
  })
  .refine((v) =>
    v.mode === 'markup' ? v.markup_bp != null : !!v.prices?.length,
  );

export async function issueQuote(
  deps: Deps,
  s: Session,
  orderId: string,
  raw: unknown,
) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  const parsed = issueInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      'もとにするメーカーの見積を選び、利益率（0〜300%）か各行の売値を整数の円で入れてください。送料・諸経費は0〜10,000,000円です。',
    );
  const a = parsed.data;
  const validUntil = dateInput(a.valid_until, '見積書の有効期限', {
    from: 0,
    to: MAX_QUOTE_DAYS,
  });
  return asUser(deps.db, ctx(s), async (tx) => {
    // app.issue_quote checks the caller and locks the order itself.
    const r = await tx.query<{ id: string }>(
      'SELECT app.issue_quote($1, $2, $3, $4, $5, $6, $7, $8, $9) AS id',
      [
        oid,
        a.maker_quote_id,
        a.mode,
        a.mode === 'markup' ? a.markup_bp : null,
        a.mode === 'price' ? JSON.stringify(a.prices) : null,
        a.shipping_fee,
        a.expenses,
        validUntil,
        text(a.note, 1000, 'メモ'),
      ],
    );
    const q = await tx.query<{ version: number; total: number }>(
      'SELECT version, total FROM app.quotes WHERE id = $1',
      [r.rows[0].id],
    );
    return {
      id: r.rows[0].id,
      version: q.rows[0].version,
      total: Number(q.rows[0].total),
    };
  });
}

/** Why an answer to a quote did not apply, in words for A社. */
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
  if (!row) throw new AppError(404, '見積書が見つかりません。', 'NOT_FOUND');
  if (row.status === 'superseded')
    throw new AppError(
      409,
      'B社が見積書を新しくしました。最新の見積書を確認してください。',
      'STALE',
    );
  throw new AppError(409, 'この見積書にはもう回答しています。', 'STATE');
}

/** A社 agrees to the current quote: the request waits for B社 to order. */
export async function acceptQuote(
  deps: Deps,
  s: Session,
  orderId: string,
  quoteId: unknown,
) {
  requireClient(s);
  const oid = id(orderId, '依頼');
  const qid = id(quoteId, '見積書');
  return asUser(deps.db, ctx(s), async (tx) => {
    // The order first, as app.issue_quote does, so accepting and re-quoting
    // never deadlock.
    await lockOrder(tx, oid);
    const r = await tx.query(
      `UPDATE app.quotes SET status = 'accepted', responded_by = $3
        WHERE id = $1 AND order_id = $2 AND status = 'sent' RETURNING id`,
      [qid, oid, s.userId],
    );
    if (!r.rows[0]) return staleQuote(tx, oid, qid);
    const o = await tx.query<{ agreed_total: number }>(
      'SELECT agreed_total FROM app.orders WHERE id = $1',
      [oid],
    );
    return { total: Number(o.rows[0].agreed_total) };
  });
}

/** A社 asks for a changed quote: the request goes back to B社 with the note. */
export async function requestRevision(
  deps: Deps,
  s: Session,
  orderId: string,
  quoteId: unknown,
  note: unknown,
) {
  requireClient(s);
  const oid = id(orderId, '依頼');
  const qid = id(quoteId, '見積書');
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
