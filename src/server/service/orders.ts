// After the agreement: B社 orders from the maker, then fixes the delivery
// date, which sends A社 the delivery notice. Also refusing and withdrawing.
import { asUser, AppError } from '../db';
import type { Session } from '../auth';
import {
  ctx,
  dateInput,
  expectStatus,
  id,
  lockOrder,
  requireAgent,
  requireClient,
  text,
  type Deps,
} from './common';

/** Order from the adopted maker; the database numbers it and mails the maker. */
export async function placeOrder(
  deps: Deps,
  s: Session,
  orderId: string,
  body: { delivery_mode?: unknown; delivery_note?: unknown },
) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  const mode = body.delivery_mode;
  if (mode !== 'direct' && mode !== 'via_agent')
    throw new AppError(400, '届き方を選んでください。');
  const note = text(body.delivery_note, 500, '発注メモ');
  return asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['agreed']);
    const r = await tx.query<{ po_number: string }>(
      `UPDATE app.orders SET status = 'ordered', delivery_mode = $2, delivery_note = $3
        WHERE id = $1 RETURNING po_number`,
      [oid, mode, note],
    );
    return { poNumber: r.rows[0].po_number };
  });
}

/** Fix the delivery date; the database sends A社 the delivery notice. */
export async function scheduleDelivery(
  deps: Deps,
  s: Session,
  orderId: string,
  body: { delivery_date?: unknown },
) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  const date = dateInput(body.delivery_date, '納期', { from: 0, to: 366 });
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['ordered']);
    await tx.query(
      `UPDATE app.orders SET status = 'scheduled', delivery_date = $2 WHERE id = $1`,
      [oid, date],
    );
  });
}

export async function rejectOrder(
  deps: Deps,
  s: Session,
  orderId: string,
  reason: unknown,
) {
  requireAgent(s);
  const oid = id(orderId, '依頼');
  const why = text(reason, 1000, 'お断りの理由');
  if (!why) throw new AppError(400, 'お断りの理由を入力してください。');
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['requested', 'hearing', 'sourcing']);
    await tx.query(
      `UPDATE app.orders SET status = 'rejected', reject_reason = $2 WHERE id = $1`,
      [oid, why],
    );
  });
}

export async function cancelOrder(
  deps: Deps,
  s: Session,
  orderId: string,
  reason: unknown,
) {
  requireClient(s);
  const oid = id(orderId, '依頼');
  const why = text(reason, 1000, '取り下げの理由');
  await asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, ['requested', 'hearing', 'sourcing', 'quoted']);
    await tx.query(
      `UPDATE app.orders SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`,
      [oid, why],
    );
  });
}
