// The database is the authority for who may do what (db/schema.sql). These
// tests talk to it as each demo person, through the restricted role, and
// check that the rules hold even when the application code is bypassed.
import { beforeEach, describe, expect, it } from 'vitest';
import { demoWorld, itemId, orderBy, type World } from './helpers';
import {
  acceptQuote,
  addToCart,
  getOrder,
  issueQuote,
  listOrders,
  requestRevision,
  submitCart,
} from '../src/server/service';
import { AppError } from '../src/server/db';
import { addDays, todayInJapan } from '../src/server/config';

let w: World;
beforeEach(async () => {
  w = await demoWorld();
});

const refused = async (p: Promise<unknown>, status?: number) => {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e, 'expected a refusal').toBeTruthy();
  if (status !== undefined) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(status);
  }
  return e as AppError;
};

const quoteLines = async (orderId: string) =>
  (await getOrder(w.deps, w.as.buyer, orderId)).lines.map((l) => ({
    orderLineId: l.id,
    unitPrice: l.unit_price,
    qty: l.qty,
  }));

describe('who sees what', () => {
  it('store staff see only their own store', async () => {
    const shibuya = await listOrders(w.deps, w.as.shibuya, 'all');
    expect(new Set(shibuya.map((o) => o.store_name))).toEqual(
      new Set(['渋谷店']),
    );
    const yokohama = await w.sql('yokohama', 'SELECT store_id FROM app.orders');
    expect(yokohama.every((o) => o.store_id === w.as.yokohama.storeId)).toBe(
      true,
    );
    const stores = await w.sql('yokohama', 'SELECT name FROM app.stores');
    expect(stores.map((s) => s.name)).toEqual(['横浜店']);
  });

  it('headquarters sees every store but nobody’s cart', async () => {
    await addToCart(w.deps, w.as.omiya, await itemId(w, 'SK-1002'), 1);
    const all = await w.sql('buyer', 'SELECT status FROM app.orders');
    expect(all).toHaveLength(4);
    expect(all.some((o) => o.status === 'draft')).toBe(false);
    // Another store's staff cannot see the cart either.
    expect(
      await w.sql(
        'shibuya',
        `SELECT id FROM app.orders WHERE status = 'draft'`,
      ),
    ).toHaveLength(0);
  });

  it('store staff do not see items headquarters stopped listing', async () => {
    const hidden = await w.sql(
      'shibuya',
      `SELECT id FROM app.catalog_items WHERE sku = 'SK-4004'`,
    );
    expect(hidden).toHaveLength(0);
    expect(
      await w.sql(
        'admin',
        `SELECT id FROM app.catalog_items WHERE sku = 'SK-4004'`,
      ),
    ).toHaveLength(1);
  });

  it('people read only their own notifications; supplier mail only at headquarters', async () => {
    const mine = await w.sql(
      'shibuya',
      'SELECT to_user_id, audience FROM app.outbox',
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.to_user_id === w.as.shibuya.userId)).toBe(true);
    const hq = await w.sql(
      'buyer',
      `SELECT audience FROM app.outbox WHERE audience = 'supplier'`,
    );
    expect(hq).toHaveLength(1);
  });

  it('nobody reads password hashes or sessions', async () => {
    await refused(w.sql('admin', 'SELECT password_hash FROM app.users'), 403);
    await refused(w.sql('admin', 'SELECT * FROM app.sessions'), 403);
    await refused(w.sql('admin', 'SELECT * FROM app.counters'), 403);
  });
});

describe('the order workflow', () => {
  it('copies name and price from the catalog, not from the caller', async () => {
    const { orderId } = await addToCart(
      w.deps,
      w.as.omiya,
      await itemId(w, 'SK-3001'),
      1,
    );
    await w.sql(
      'omiya',
      `INSERT INTO app.order_lines (org_id, order_id, item_id, name, unit, unit_price, tax_rate, qty)
       VALUES ($1, $2, $3, '偽の名前', '個', 1, 8, 1)`,
      [w.as.omiya.orgId, orderId, await itemId(w, 'SK-3002')],
    );
    const lines = await w.sql<{
      name: string;
      unit_price: number;
      tax_rate: number;
    }>(
      'omiya',
      `SELECT l.name, l.unit_price, l.tax_rate FROM app.order_lines l JOIN app.catalog_items i ON i.id = l.item_id
        WHERE i.sku = 'SK-3002'`,
    );
    expect(lines[0]).toEqual({
      name: '油性ボールペン 0.7mm 黒 10本',
      unit_price: 600,
      tax_rate: 10,
    });
  });

  it('refuses out-of-stock and hidden items', async () => {
    await refused(
      addToCart(w.deps, w.as.omiya, await itemId(w, 'SK-2004'), 1),
      409,
    );
    await refused(
      addToCart(w.deps, w.as.omiya, await itemId(w, 'SK-4004'), 1),
      404,
    );
  });

  it('only headquarters quotes, and the database computes every amount', async () => {
    const o = await orderBy(w, 'R-2026-0004');
    await refused(
      issueQuote(w.deps, w.as.shibuya, o.id, {
        lines: await quoteLines(o.id),
        shippingFee: 0,
        validUntil: addDays(todayInJapan(), 7),
        basedOn: null,
      }),
      403,
    );
    // A forged insert with its own totals and version: the database replaces them.
    const lines = await quoteLines(o.id);
    await w.sql(
      'buyer',
      `INSERT INTO app.quotes (org_id, order_id, lines, shipping_fee, valid_until, issued_by,
                               total, subtotal_10, tax_10, version, status)
       VALUES ($1, $2, $3, 500, $4, $5, 1, 1, 0, 9, 'accepted')`,
      [
        w.as.buyer.orgId,
        o.id,
        JSON.stringify(
          lines.map((l) => ({
            order_line_id: l.orderLineId,
            unit_price: l.unitPrice,
            qty: l.qty,
          })),
        ),
        addDays(todayInJapan(), 7),
        w.as.shibuya.userId,
      ],
    );
    const [q] = await w.sql<{
      version: number;
      status: string;
      total: number;
      issued_by: string;
    }>(
      'buyer',
      'SELECT version, status, total, issued_by FROM app.quotes WHERE order_id = $1',
      [o.id],
    );
    // 2 × ¥980 + 2 × ¥1,500 + ¥500 shipping at 10%, 1 × ¥3,000 at 8%.
    expect(q).toEqual({
      version: 1,
      status: 'sent',
      total: 5460 + 546 + 3000 + 240,
      issued_by: w.as.buyer.userId,
    });
    const [order] = await w.sql(
      'buyer',
      'SELECT status FROM app.orders WHERE id = $1',
      [o.id],
    );
    expect(order.status).toBe('quoted');
  });

  it('refuses quote lines that are not in the request, duplicated or fractional', async () => {
    const o = await orderBy(w, 'R-2026-0004');
    const lines = await quoteLines(o.id);
    const insert = (l: unknown[]) =>
      w.sql(
        'buyer',
        `INSERT INTO app.quotes (org_id, order_id, lines, valid_until, issued_by) VALUES ($1, $2, $3, $4, $5)`,
        [
          w.as.buyer.orgId,
          o.id,
          JSON.stringify(l),
          addDays(todayInJapan(), 7),
          w.as.buyer.userId,
        ],
      );
    const other = await orderBy(w, 'R-2026-0001');
    const foreign = (await getOrder(w.deps, w.as.buyer, other.id)).lines[0].id;
    await refused(
      insert([{ order_line_id: foreign, unit_price: 1, qty: 1 }]),
      409,
    );
    const first = {
      order_line_id: lines[0].orderLineId,
      unit_price: 100,
      qty: 1,
    };
    await refused(insert([first, first]), 409);
    await refused(insert([{ ...first, unit_price: 100.5 }]), 409);
    await refused(insert([{ ...first, qty: 0 }]), 409);
    await refused(insert([]), 409);
  });

  it('only the requesting store accepts, and acceptance places the order', async () => {
    const o = await orderBy(w, 'R-2026-0003');
    await refused(
      acceptQuote(w.deps, w.as.buyer, o.id, o.current_quote_id),
      403,
    );
    // Another store does not even see the order.
    await refused(
      acceptQuote(w.deps, w.as.shibuya, o.id, o.current_quote_id),
      404,
    );
    // Even bypassing the service, another store cannot answer: it sees no row.
    const forged = await w.sql(
      'shibuya',
      `UPDATE app.quotes SET status = 'accepted', responded_by = $2 WHERE id = $1 RETURNING id`,
      [o.current_quote_id, w.as.shibuya.userId],
    );
    expect(forged).toEqual([]);
    const placed = await acceptQuote(
      w.deps,
      w.as.yokohama,
      o.id,
      o.current_quote_id,
    );
    expect(placed.poNumber).toBe('PO-2026-0002');
    const order = await getOrder(w.deps, w.as.yokohama, o.id);
    expect(order.status).toBe('ordered');
    expect(order.ordered_total).toBe(order.quotes[0].total);
  });

  it('queues the agreed amount to both parties and the supplier in the same transaction', async () => {
    const o = await orderBy(w, 'R-2026-0003');
    await acceptQuote(w.deps, w.as.yokohama, o.id, o.current_quote_id);
    const rows = await w.pg.query<{
      audience: string;
      to_email: string;
      total: number;
      po: string;
    }>(
      `SELECT audience, to_email, (payload->>'total')::int AS total, payload->>'po_number' AS po
         FROM app.outbox WHERE order_id = $1 AND event = 'ordered' ORDER BY audience, to_email`,
      [o.id],
    );
    const total = (await getOrder(w.deps, w.as.buyer, o.id)).ordered_total;
    expect(rows.rows.map((r) => [r.audience, r.to_email])).toEqual([
      ['hq', 'tanaka@sample-cafe.example'],
      ['hq', 'yamada@sample-cafe.example'],
      ['store', 'suzuki@sample-cafe.example'],
      ['supplier', 'orders@sakura-supply.example'],
    ]);
    expect(
      rows.rows.every((r) => r.total === total && r.po === 'PO-2026-0002'),
    ).toBe(true);
  });

  it('a revised quote replaces the open one, which can no longer be accepted', async () => {
    const o = await orderBy(w, 'R-2026-0004');
    const lines = await quoteLines(o.id);
    const valid = addDays(todayInJapan(), 7);
    await issueQuote(w.deps, w.as.buyer, o.id, {
      lines,
      shippingFee: 0,
      validUntil: valid,
      basedOn: null,
    });
    const first = (await orderBy(w, 'R-2026-0004')).current_quote_id;
    // A colleague working from the old screen is told to reload.
    await refused(
      issueQuote(w.deps, w.as.admin, o.id, {
        lines,
        shippingFee: 0,
        validUntil: valid,
        basedOn: null,
      }),
      409,
    );
    await issueQuote(w.deps, w.as.buyer, o.id, {
      lines: lines.slice(0, 1),
      shippingFee: 0,
      validUntil: valid,
      basedOn: 1,
    });
    const e = await refused(
      acceptQuote(w.deps, w.as.shibuya, o.id, first),
      409,
    );
    expect(e.message).toContain('更新');
    const quotes = await w.sql(
      'shibuya',
      'SELECT version, status FROM app.quotes WHERE order_id = $1 ORDER BY version',
      [o.id],
    );
    expect(quotes).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'sent' },
    ]);
  });

  it('refuses an expired quote', async () => {
    const o = await orderBy(w, 'R-2026-0003');
    // Age the quote as the owner, bypassing the triggers that forbid it.
    await w.pg.exec(`SET session_replication_role = replica`);
    await w.pg.query(
      `UPDATE app.quotes SET valid_until = current_date - 1 WHERE id = $1`,
      [o.current_quote_id],
    );
    await w.pg.exec(`SET session_replication_role = origin`);
    const e = await refused(
      acceptQuote(w.deps, w.as.yokohama, o.id, o.current_quote_id),
      409,
    );
    expect(e.message).toContain('有効期限');
  });

  it('a revision request needs a note and sends the order back', async () => {
    const o = await orderBy(w, 'R-2026-0003');
    await refused(
      requestRevision(w.deps, w.as.yokohama, o.id, o.current_quote_id, ' '),
      400,
    );
    await refused(
      w.sql(
        'yokohama',
        `UPDATE app.quotes SET status = 'declined', responded_by = $2 WHERE id = $1`,
        [o.current_quote_id, w.as.yokohama.userId],
      ),
      409,
    );
    await requestRevision(
      w.deps,
      w.as.yokohama,
      o.id,
      o.current_quote_id,
      '数量を減らしてください',
    );
    const [order] = await w.sql(
      'buyer',
      'SELECT status, revision_note FROM app.orders WHERE id = $1',
      [o.id],
    );
    expect(order).toEqual({
      status: 'requested',
      revision_note: '数量を減らしてください',
    });
  });

  it('closed orders and answered quotes cannot change', async () => {
    const done = await orderBy(w, 'R-2026-0001');
    await refused(
      w.sql(
        'shibuya',
        `UPDATE app.orders SET status = 'cancelled' WHERE id = $1`,
        [done.id],
      ),
      403,
    );
    await refused(
      w.sql('buyer', `UPDATE app.orders SET status = 'quoted' WHERE id = $1`, [
        done.id,
      ]),
      403,
    );
    await refused(
      w.sql(
        'buyer',
        `UPDATE app.quotes SET status = 'superseded' WHERE id = $1`,
        [done.current_quote_id],
      ),
      403,
    );
    // Amounts, lines and numbers are not even updatable columns.
    await refused(
      w.sql('buyer', `UPDATE app.quotes SET total = 1 WHERE id = $1`, [
        done.current_quote_id,
      ]),
      403,
    );
    await refused(
      w.sql('buyer', `UPDATE app.orders SET po_number = 'PO-X' WHERE id = $1`, [
        done.id,
      ]),
      403,
    );
    await refused(
      w
        .sql(
          'shibuya',
          `UPDATE app.order_lines SET qty = 99 WHERE order_id = $1`,
          [done.id],
        )
        .then((r) => {
          if (r.length === 0) throw new Error('no rows');
        }),
    );
    const [line] = await w.sql<{ qty: number }>(
      'shibuya',
      'SELECT qty FROM app.order_lines WHERE order_id = $1 LIMIT 1',
      [done.id],
    );
    expect(line.qty).toBeLessThan(99);
  });

  it('numbers requests and purchase orders without gaps', async () => {
    const before = await w.pg.query<{ kind: string; value: number }>(
      'SELECT kind, value FROM app.counters ORDER BY kind',
    );
    expect(before.rows).toEqual([
      { kind: 'po', value: 1 },
      { kind: 'request', value: 4 },
    ]);
    // A refused submission does not use a number.
    const { orderId } = await addToCart(
      w.deps,
      w.as.omiya,
      await itemId(w, 'SK-1002'),
      1,
    );
    await refused(
      submitCart(w.deps, w.as.omiya, orderId, { neededBy: '2000-01-01' }),
      409,
    );
    await submitCart(w.deps, w.as.omiya, orderId, {});
    const [o] = await w.sql(
      'omiya',
      'SELECT request_number FROM app.orders WHERE id = $1',
      [orderId],
    );
    expect(o.request_number).toBe('R-2026-0005');
  });

  it('the audit trail is append-only and the outbox is written only by the database', async () => {
    await refused(w.sql('admin', `UPDATE app.audit_log SET action = 'x'`), 403);
    await refused(w.sql('admin', `DELETE FROM app.audit_log`), 403);
    await refused(
      w.sql(
        'admin',
        `INSERT INTO app.audit_log (org_id, action) VALUES ($1, 'x')`,
        [w.as.admin.orgId],
      ),
      403,
    );
    const o = await orderBy(w, 'R-2026-0001');
    await refused(
      w.sql(
        'admin',
        `INSERT INTO app.outbox (org_id, order_id, event, audience, to_email, payload)
         VALUES ($1, $2, 'ordered', 'supplier', 'attacker@example.com', '{}')`,
        [w.as.admin.orgId, o.id],
      ),
      403,
    );
    const entries = await w.sql(
      'admin',
      `SELECT action FROM app.audit_log WHERE order_id = $1 ORDER BY id`,
      [o.id],
    );
    expect(entries.map((e) => e.action)).toEqual([
      'status:requested',
      'quote:issued',
      'status:quoted',
      'quote:accepted',
      'status:ordered',
    ]);
  });

  it('only admins change the catalog', async () => {
    await refused(
      w
        .sql('buyer', `UPDATE app.catalog_items SET active = false`)
        .then((r) => {
          if (!r.length) throw new Error('no rows');
        }),
    );
    await refused(
      w.sql(
        'shibuya',
        `INSERT INTO app.catalog_sources (org_id, name, kind, created_by) VALUES ($1, 'x', 'csv', $2)`,
        [w.as.shibuya.orgId, w.as.shibuya.userId],
      ),
      403,
    );
  });
});
