// The database is the authority for who may do what and who sees which price
// (db/schema.sql). These tests talk to it as each person, through the
// restricted role, so the rules hold even when the application is bypassed.
import { describe, expect, it } from 'vitest';
import {
  CLIENT,
  answerQuote,
  askMaker,
  day,
  fixture,
  issueQuote,
  outline,
  recordMaker,
  refused,
  submit,
  validAnswers,
  type Fixture,
} from './helpers';
import { costSubtotal, quoteProfit, quoteTotals } from '../src/core/money';
import { DEFAULT_REQUEST_FIELDS, validateAnswers } from '../src/core/intake';
import { subjectOf, type Payload } from '../src/core/notification';

const year = day().slice(0, 4);

// Costs chosen so that none of them equals a selling figure.
const COST = { counter: 123457, tea: 2311, shipping: 1739 };
const AOBA = { counter: 131313, tea: 2477 };
const COST_SUBTOTAL = COST.counter + COST.tea * 3 + COST.shipping; // 132129
const MARKUP_BP = 2500;
const PRICES = { counter: 160000, tea: 3000 };

const OUTLINE = [
  {
    name: '受付カウンター',
    spec: 'W1800×D600×H1000 白',
    qty: 1,
    unit: '台',
    tax_rate: 10 as const,
  },
  {
    name: 'ペットボトル緑茶 24本',
    qty: 3,
    unit: 'ケース',
    tax_rate: 8 as const,
  },
];

/** Every cost-side figure of the flow below. */
const costValues = () => [
  COST.counter,
  COST.tea * 3,
  COST.shipping,
  COST_SUBTOTAL,
  AOBA.counter,
  AOBA.counter + AOBA.tea * 3,
  quoteProfit(COST_SUBTOTAL, 169989),
  quoteProfit(COST_SUBTOTAL, 176000),
];

/** JSON without ids and timestamps, so only real figures can match. */
const scrub = (v: unknown) =>
  JSON.stringify(v)
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      'ID',
    )
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}(:\d{2})?)?/g, 'TS');
const leaks = (v: unknown) =>
  costValues().filter((n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(scrub(v)));

/** The whole flow up to the delivery notice, without assertions. */
async function toScheduled(f: Fixture) {
  const orderId = await submit(f, 'sato', { needed_by: day(30) });
  const [lineCounter, lineTea] = await outline(f, orderId, OUTLINE);
  await f.sql(
    'tanaka',
    `INSERT INTO app.order_messages (org_id, order_id, kind, body) VALUES ($1, $2, 'note', $3)`,
    [f.orgId, orderId, `さくらの仕入値は${COST.counter}円`],
  );
  const mqSakura = await askMaker(f, orderId, f.makers.sakura);
  const mqAoba = await askMaker(f, orderId, f.makers.aoba);
  await recordMaker(
    f,
    mqSakura,
    [
      { order_line_id: lineCounter, unit_cost: COST.counter },
      { order_line_id: lineTea, unit_cost: COST.tea },
    ],
    COST.shipping,
  );
  await recordMaker(f, mqAoba, [
    { order_line_id: lineCounter, unit_cost: AOBA.counter },
    { order_line_id: lineTea, unit_cost: AOBA.tea },
  ]);
  await issueQuote(f, 'yamada', orderId, {
    makerQuoteId: mqSakura,
    mode: 'markup',
    markupBp: MARKUP_BP,
    shippingFee: 2000,
    expenses: 5000,
  });
  const quoteId = await issueQuote(f, 'yamada', orderId, {
    makerQuoteId: mqSakura,
    mode: 'price',
    prices: [
      { order_line_id: lineCounter, unit_price: PRICES.counter },
      { order_line_id: lineTea, unit_price: PRICES.tea },
    ],
    shippingFee: 2000,
    expenses: 5000,
  });
  await answerQuote(f, 'sato', orderId, quoteId, { accept: true });
  await f.sql(
    'yamada',
    `UPDATE app.orders SET status = 'ordered', delivery_mode = 'direct' WHERE id = $1`,
    [orderId],
  );
  await f.sql(
    'yamada',
    `UPDATE app.orders SET status = 'scheduled', delivery_date = $2 WHERE id = $1`,
    [orderId, day(20)],
  );
  return { orderId, quoteId, mqSakura, mqAoba };
}

const outbox = (f: Fixture, orderId: string, event: string) =>
  f.owner<{ audience: string; to_email: string; payload: Payload }>(
    `SELECT audience, to_email, payload FROM app.outbox WHERE order_id = $1 AND event = $2 ORDER BY to_email`,
    [orderId, event],
  );

describe('the agency workflow', () => {
  it('runs from the intake form to the delivery notice', async () => {
    const f = await fixture();
    const status = async (id: string) =>
      (
        await f.owner<{ status: string }>(
          'SELECT status FROM app.orders WHERE id = $1',
          [id],
        )
      )[0].status;

    // A社 sends a request through the intake form.
    const orderId = await submit(f, 'sato', {
      answers: [
        ...validAnswers,
        { key: 'item', label: '偽', kind: 'number', value: '受付カウンター' },
      ].slice(1),
      needed_by: day(30),
      note: '開店前に入れ替えたい',
    });
    const [sent] = await f.sql<{
      status: string;
      request_number: string;
      answers: unknown[];
    }>(
      'sato',
      'SELECT status, request_number, answers FROM app.orders WHERE id = $1',
      [orderId],
    );
    expect(sent.status).toBe('requested');
    expect(sent.request_number).toBe(`R-${year}-0001`);
    expect(sent.answers[0]).toEqual({
      key: 'item',
      label: 'ほしい物',
      kind: 'text',
      value: '受付カウンター',
    });
    expect(
      (await outbox(f, orderId, 'requested')).map((r) => [
        r.audience,
        r.to_email,
      ]),
    ).toEqual([
      ['agent', 'tanaka@midori.example'],
      ['agent', 'yamada@midori.example'],
    ]);

    // Hearing: B社 asks, another branch cannot answer, the branch answers.
    await f.sql(
      'yamada',
      `INSERT INTO app.order_messages (org_id, order_id, kind, body) VALUES ($1, $2, 'question', '幅は何cmまで置けますか？')`,
      [f.orgId, orderId],
    );
    expect(await status(orderId)).toBe('hearing');
    const [question] = await outbox(f, orderId, 'question');
    expect([question.to_email, question.payload.question]).toEqual([
      'sato@sample-cafe.example',
      '幅は何cmまで置けますか？',
    ]);
    await refused(
      f.sql(
        'suzuki',
        `INSERT INTO app.order_messages (org_id, order_id, kind, body) VALUES ($1, $2, 'answer', '2m')`,
        [f.orgId, orderId],
      ),
      '42501',
    );
    await f.sql(
      'yamada',
      `INSERT INTO app.order_messages (org_id, order_id, kind, body) VALUES ($1, $2, 'note', '電話で確認済み')`,
      [f.orgId, orderId],
    );
    expect(await status(orderId)).toBe('hearing');
    await f.sql(
      'sato',
      `INSERT INTO app.order_messages (org_id, order_id, kind, body) VALUES ($1, $2, 'answer', '幅180cmまでです')`,
      [f.orgId, orderId],
    );
    expect(await status(orderId)).toBe('requested');
    expect(
      (await outbox(f, orderId, 'answered')).map((r) => r.payload.answer),
    ).toEqual(['幅180cmまでです', '幅180cmまでです']);
    expect(
      (
        await f.sql<{ kind: string }>(
          'sato',
          'SELECT kind FROM app.order_messages ORDER BY created_at',
        )
      ).map((m) => m.kind),
    ).toEqual(['question', 'answer']);

    // The outline: B社 only; A社 sees it once fixed.
    await refused(
      f.sql(
        'sato',
        `INSERT INTO app.order_lines (org_id, order_id, name, qty) VALUES ($1, $2, '棚', 1)`,
        [f.orgId, orderId],
      ),
      '42501',
    );
    const [lineCounter, lineTea] = await outline(f, orderId, OUTLINE);
    expect(await status(orderId)).toBe('sourcing');
    expect(
      await f.sql('sato', 'SELECT name FROM app.order_lines'),
    ).toHaveLength(2);

    // 相見積: two makers are asked; the request for a quote names no A社 details.
    const mqSakura = await askMaker(f, orderId, f.makers.sakura);
    const mqAoba = await askMaker(f, orderId, f.makers.aoba);
    const rfq = await outbox(f, orderId, 'rfq');
    expect(rfq.map((r) => [r.audience, r.to_email])).toEqual([
      ['maker', 'orders@sakura-supply.example'],
      ['maker', 'sales@aoba-juki.example'],
    ]);
    for (const r of rfq) {
      expect(JSON.stringify(r.payload)).not.toMatch(/サンプルカフェ|渋谷|架空/);
      expect(r.payload.lines).toEqual([
        {
          name: '受付カウンター',
          spec: 'W1800×D600×H1000 白',
          qty: 1,
          unit: '台',
        },
        { name: 'ペットボトル緑茶 24本', spec: '', qty: 3, unit: 'ケース' },
      ]);
    }
    await refused(askMaker(f, orderId, f.makers.sakura), '23505');

    // The makers reply; the database computes the cost subtotal.
    await refused(
      recordMaker(f, mqSakura, [
        { order_line_id: lineCounter, unit_cost: COST.counter },
      ]),
      '23514',
      /must match the outline/,
    );
    await recordMaker(
      f,
      mqSakura,
      [
        { order_line_id: lineCounter, unit_cost: COST.counter },
        { order_line_id: lineTea, unit_cost: COST.tea },
      ],
      COST.shipping,
    );
    await recordMaker(f, mqAoba, [
      { order_line_id: lineCounter, unit_cost: AOBA.counter },
      { order_line_id: lineTea, unit_cost: AOBA.tea },
    ]);
    const [mq] = await f.sql<{ cost_subtotal: number }>(
      'yamada',
      'SELECT cost_subtotal FROM app.maker_quotes WHERE id = $1',
      [mqSakura],
    );
    expect(mq.cost_subtotal).toBe(COST_SUBTOTAL);
    expect(
      costSubtotal(
        [
          { unitCost: COST.counter, qty: 1 },
          { unitCost: COST.tea, qty: 3 },
        ],
        COST.shipping,
      ),
    ).toBe(COST_SUBTOTAL);

    // A quote to A社 with a markup on cost: prices rounded up, shipping and
    // expenses at 10%, profit kept for B社.
    const q1 = await issueQuote(f, 'yamada', orderId, {
      makerQuoteId: mqSakura,
      mode: 'markup',
      markupBp: MARKUP_BP,
      shippingFee: 2000,
      expenses: 5000,
    });
    const quoteRow = async (id: string) =>
      (
        await f.sql<
          Record<string, number> & { lines: { unit_price: number }[] }
        >(
          'yamada',
          `SELECT q.version, q.status, q.lines, q.subtotal_10, q.tax_10, q.subtotal_8, q.tax_8, q.total,
                  c.cost_subtotal, c.sales_subtotal, c.profit
             FROM app.quotes q JOIN app.quote_costs c ON c.quote_id = q.id WHERE q.id = $1`,
          [id],
        )
      )[0];
    const markup = await quoteRow(q1);
    expect(markup.lines.map((l) => l.unit_price)).toEqual([154322, 2889]);
    const markupTotals = quoteTotals(
      [
        { unitPrice: 154322, qty: 1, taxRate: 10 },
        { unitPrice: 2889, qty: 3, taxRate: 8 },
      ],
      2000,
      5000,
    );
    expect([
      markup.subtotal_10,
      markup.tax_10,
      markup.subtotal_8,
      markup.tax_8,
      markup.total,
    ]).toEqual([
      markupTotals.subtotal10,
      markupTotals.tax10,
      markupTotals.subtotal8,
      markupTotals.tax8,
      186814,
    ]);
    expect(markupTotals.total).toBe(186814);
    expect([
      markup.cost_subtotal,
      markup.sales_subtotal,
      markup.profit,
    ]).toEqual([COST_SUBTOTAL, 169989, quoteProfit(COST_SUBTOTAL, 169989)]);

    // A revised quote with prices set by hand replaces the first one.
    const q2 = await issueQuote(f, 'yamada', orderId, {
      makerQuoteId: mqSakura,
      mode: 'price',
      prices: [
        { order_line_id: lineCounter, unit_price: PRICES.counter },
        { order_line_id: lineTea, unit_price: PRICES.tea },
      ],
      shippingFee: 2000,
      expenses: 5000,
    });
    const priced = await quoteRow(q2);
    expect([
      priced.version,
      priced.total,
      priced.sales_subtotal,
      priced.profit,
    ]).toEqual([2, 193420, 176000, 176000 - COST_SUBTOTAL]);
    expect((await quoteRow(q1)).status).toBe('superseded');
    expect(await answerQuote(f, 'sato', orderId, q1, { accept: true })).toBe(
      false,
    );

    // A社 agrees to the current quote.
    expect(await answerQuote(f, 'sato', orderId, q2, { accept: true })).toBe(
      true,
    );
    const [agreed] = await f.owner<{ status: string; agreed_total: number }>(
      'SELECT status, agreed_total FROM app.orders WHERE id = $1',
      [orderId],
    );
    expect(agreed).toEqual({ status: 'agreed', agreed_total: 193420 });
    expect((await outbox(f, orderId, 'agreed')).map((r) => r.audience)).toEqual(
      ['agent', 'agent'],
    );

    // B社 orders from the adopted maker, delivered straight to the branch.
    await refused(
      f.sql(
        'sato',
        `UPDATE app.orders SET status = 'ordered', delivery_mode = 'direct' WHERE id = $1`,
        [orderId],
      ),
      '42501',
    );
    await f.sql(
      'yamada',
      `UPDATE app.orders SET status = 'ordered', delivery_mode = 'direct', delivery_note = '午前中に搬入' WHERE id = $1`,
      [orderId],
    );
    const [ordered] = await f.owner<{ po_number: string; assigned_to: string }>(
      'SELECT po_number, assigned_to FROM app.orders WHERE id = $1',
      [orderId],
    );
    expect(ordered).toEqual({
      po_number: `PO-${year}-0001`,
      assigned_to: f.people.yamada.userId,
    });
    const [po] = await outbox(f, orderId, 'ordered');
    expect([po.audience, po.to_email]).toEqual([
      'maker',
      'orders@sakura-supply.example',
    ]);
    expect(po.payload.lines?.map((l) => [l.unit_cost, l.cost_amount])).toEqual([
      [COST.counter, COST.counter],
      [COST.tea, COST.tea * 3],
    ]);
    expect(po.payload.cost_subtotal).toBe(COST_SUBTOTAL);
    expect(po.payload.destination).toBe(
      `${CLIENT} 渋谷店 東京都渋谷区（架空）1-2-3`,
    );

    // The delivery date sends A社 the notice, with selling prices only.
    await refused(
      f.sql(
        'yamada',
        `UPDATE app.orders SET status = 'scheduled', delivery_date = $2 WHERE id = $1`,
        [orderId, day(-1)],
      ),
      '23514',
    );
    await f.sql(
      'yamada',
      `UPDATE app.orders SET status = 'scheduled', delivery_date = $2 WHERE id = $1`,
      [orderId, day(20)],
    );
    const notices = await outbox(f, orderId, 'scheduled');
    expect(notices.map((r) => [r.audience, r.to_email])).toEqual([
      ['client', 'sato@sample-cafe.example'],
    ]);
    const notice = notices[0].payload;
    expect(Object.keys(notice).sort()).toEqual(
      [
        'order_id',
        'request_number',
        'title',
        'client_name',
        'store_name',
        'lines',
        'shipping_fee',
        'expenses',
        'subtotal_10',
        'tax_10',
        'subtotal_8',
        'tax_8',
        'total',
        'delivery_date',
        'delivery_mode',
        'destination',
        'delivery_note',
        'org_name',
        'agent_name',
        'agent_email',
      ].sort(),
    );
    expect(Object.keys(notice.lines![0]).sort()).toEqual(
      [
        'amount',
        'name',
        'qty',
        'spec',
        'tax_rate',
        'unit',
        'unit_price',
      ].sort(),
    );
    expect(notice).toMatchObject({
      total: 193420,
      delivery_date: day(20),
      delivery_mode: 'direct',
      delivery_note: '午前中に搬入',
      agent_email: 'yamada@midori.example',
    });
    expect(leaks(notice)).toEqual([]);
    expect(subjectOf('scheduled', 'client', notice)).toBe(
      `【納期のお知らせ】受付カウンターの入れ替え（R-${year}-0001）`,
    );

    // Closed for good.
    await refused(
      f.sql(
        'sato',
        `UPDATE app.orders SET status = 'cancelled' WHERE id = $1`,
        [orderId],
      ),
      '42501',
      /closed/,
    );
  });

  it('A社 cannot see costs, makers, maker quotes or B社 notes by any SQL path', async () => {
    const f = await fixture();
    const { orderId } = await toScheduled(f);

    for (const who of ['sato', 'suzuki'] as const) {
      for (const table of [
        'quote_costs',
        'maker_quotes',
        'makers',
        'catalog_items',
        'catalog_sources',
      ])
        expect(
          await f.sql(who, `SELECT * FROM app.${table}`),
          `${who} ${table}`,
        ).toEqual([]);
      expect(
        await f.sql(
          who,
          `SELECT * FROM app.order_messages WHERE kind = 'note'`,
        ),
      ).toEqual([]);
      await refused(
        f.sql(
          who,
          `INSERT INTO app.makers (org_id, name, email) VALUES ($1, 'x', 'x@example.com')`,
          [f.orgId],
        ),
        '42501',
      );
    }
    // B社 does see them.
    expect(await f.sql('yamada', 'SELECT * FROM app.quote_costs')).toHaveLength(
      2,
    );
    expect(
      await f.sql('yamada', 'SELECT * FROM app.maker_quotes'),
    ).toHaveLength(2);
    expect(
      await f.sql(
        'yamada',
        `SELECT * FROM app.order_messages WHERE kind = 'note'`,
      ),
    ).toHaveLength(1);

    // What A社 can read carries selling figures only.
    const quotes = await f.sql<
      Record<string, unknown> & { lines: Record<string, unknown>[] }
    >('sato', 'SELECT * FROM app.quotes');
    expect(quotes).toHaveLength(2);
    for (const q of quotes) {
      expect(
        Object.keys(q).filter((k) => /cost|profit|markup|maker/.test(k)),
      ).toEqual([]);
      for (const l of q.lines)
        expect(Object.keys(l).sort()).toEqual([
          'amount',
          'line_no',
          'name',
          'order_line_id',
          'qty',
          'spec',
          'tax_rate',
          'unit',
          'unit_price',
        ]);
    }
    const readable = {
      orders: await f.sql('sato', 'SELECT * FROM app.orders'),
      quotes,
      lines: await f.sql('sato', 'SELECT * FROM app.order_lines'),
      messages: await f.sql('sato', 'SELECT * FROM app.order_messages'),
      outbox: await f.sql('sato', 'SELECT * FROM app.outbox'),
      audit: await f.sql('sato', 'SELECT * FROM app.audit_log'),
      deliveries: await f.sql(
        'sato',
        'SELECT * FROM app.order_deliveries($1)',
        [orderId],
      ),
    };
    expect(readable.outbox.length).toBeGreaterThan(0);
    expect(readable.outbox.every((r) => r.audience === 'client')).toBe(true);
    expect(readable.audit.length).toBeGreaterThan(0);
    expect(readable.audit.some((r) => r.agent_only)).toBe(false);
    expect(readable.deliveries.some((r) => r.audience === 'maker')).toBe(false);
    expect(leaks(readable)).toEqual([]);
    // The same scan finds the costs in what B社 reads (the check is real).
    expect(
      leaks(await f.sql('yamada', 'SELECT * FROM app.quote_costs')).length,
    ).toBeGreaterThan(0);
  });

  it('only app.issue_quote creates quotes, and only for B社 of the same organization', async () => {
    const f = await fixture();
    const orderId = await submit(f, 'sato');
    const [line] = await outline(f, orderId, [OUTLINE[0]]);
    const mq = await askMaker(f, orderId, f.makers.sakura);
    await recordMaker(f, mq, [{ order_line_id: line, unit_cost: 1000 }]);
    const args = { makerQuoteId: mq, mode: 'markup' as const, markupBp: 1000 };

    await refused(
      issueQuote(f, 'sato', orderId, args),
      '42501',
      /only the agent/,
    );
    await refused(
      issueQuote(f, 'outsider', orderId, args),
      '42501',
      /order not found/,
    );
    await refused(
      f.sql(
        'yamada',
        `INSERT INTO app.quotes (org_id, order_id, version, lines, subtotal_10, tax_10, subtotal_8, tax_8, total, valid_until, issued_by)
         VALUES ($1, $2, 1, '[]', 0, 0, 0, 0, 0, $3, $4)`,
        [f.orgId, orderId, day(7), f.people.yamada.userId],
      ),
      '42501',
      /permission denied/,
    );
    await refused(
      f.sql('yamada', `UPDATE app.orders SET status = 'quoted' WHERE id = $1`, [
        orderId,
      ]),
      '42501',
    );
    // An expired maker quote cannot back a quote.
    // Age it as the owner, bypassing the triggers that forbid it.
    await f.pg.exec('SET session_replication_role = replica');
    await f.owner(
      `UPDATE app.maker_quotes SET valid_until = current_date - 2 WHERE id = $1`,
      [mq],
    );
    await f.pg.exec('SET session_replication_role = origin');
    await refused(issueQuote(f, 'yamada', orderId, args), '23514', /expired/);
    expect(await f.owner('SELECT id FROM app.quotes')).toEqual([]);
  });
});

describe('the intake form', () => {
  it('refuses a request missing a required answer, without using a number', async () => {
    const f = await fixture();
    const missing = validAnswers.filter((a) => a.key !== 'place');
    await refused(
      submit(f, 'sato', { answers: missing }),
      '23514',
      /answer place is required/,
    );
    expect(validateAnswers(DEFAULT_REQUEST_FIELDS, missing)).toEqual({
      ok: false,
      errors: { place: '入力してください。' },
    });
    await refused(
      submit(f, 'sato', {
        answers: [...validAnswers, { key: 'secret', value: 'x' }],
      }),
      '23514',
      /unknown answer secret/,
    );
    const id = await submit(f, 'sato');
    const [o] = await f.owner<{ request_number: string }>(
      'SELECT request_number FROM app.orders WHERE id = $1',
      [id],
    );
    expect(o.request_number).toBe(`R-${year}-0001`);
  });
});
