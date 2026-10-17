// The application operations end to end on the fixture, as each person.
import { describe, expect, it } from 'vitest';
import { day, deps, fixture, session, validAnswers } from './helpers';
import {
  acceptQuote,
  addNote,
  answerQuestion,
  askQuestion,
  confirmOutline,
  getOrder,
  issueQuote,
  listOrders,
  orderStats,
  placeOrder,
  recordMakerQuote,
  requestMakerQuotes,
  scheduleDelivery,
  setOutline,
  submitRequest,
} from '../src/server/service';
import { AppError } from '../src/server/db';

const status = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.status : String(e)),
  );

describe('services', () => {
  it('one request from the form to the delivery notice', async () => {
    const f = await fixture();
    const d = deps(f);
    const sato = session(f, 'sato');
    const yamada = session(f, 'yamada');

    // A refused request leaves nothing behind (draft and send are one transaction).
    expect(
      await status(
        submitRequest(d, sato, {
          title: '棚',
          answers: [{ key: 'item', value: '棚' }],
        }),
      ),
    ).toBe(422);
    expect(await f.owner('SELECT id FROM app.orders')).toEqual([]);

    const id = await submitRequest(d, sato, {
      title: '休憩室の収納棚',
      answers: [...validAnswers, { key: 'budget', value: '60,000' }],
      needed_by: day(20),
      note: '急ぎではありません',
    });
    // A社 cannot do B社's work.
    expect(await status(askQuestion(d, sato, id, '質問'))).toBe(403);

    await askQuestion(d, yamada, id, '幅は何cmまで置けますか？');
    await answerQuestion(d, sato, id, '90cmまでです');
    await addNote(d, yamada, id, '電話で確認済み：原価は抑えめに');
    await setOutline(d, yamada, id, [
      { name: 'スチール収納棚', spec: '5段 W900', qty: 2, unit: '台' },
      { name: '組立', qty: 1, unit: '式' },
    ]);
    await confirmOutline(d, yamada, id);
    const [mqA, mqB] = await requestMakerQuotes(d, yamada, id, [
      f.makers.sakura,
      f.makers.aoba,
    ]);
    const lines = (await getOrder(d, yamada, id)).lines;
    const reply = (costs: number[], shipping: number) => ({
      lines: lines.map((l, i) => ({
        order_line_id: l.id,
        unit_cost: costs[i],
        stock: 'in_stock',
      })),
      shipping_cost: shipping,
      lead_time: '受注後7日',
      valid_until: day(30),
    });
    await recordMakerQuote(d, yamada, mqA, reply([17_777, 3_333], 1_111));
    await recordMakerQuote(d, yamada, mqB, reply([19_999, 4_444], 2_222));
    await issueQuote(d, yamada, id, {
      maker_quote_id: mqA,
      mode: 'markup',
      markup_bp: 2000,
      shipping_fee: 1_500,
      expenses: 2_000,
      valid_until: day(14),
    });

    // What B社 sees, and what A社 does not.
    const agentView = await getOrder(d, yamada, id);
    expect(agentView.makerQuotes).toHaveLength(2);
    expect(agentView.quoteCosts).toHaveLength(1);
    expect(agentView.messages.map((m) => m.kind)).toContain('note');
    const clientView = await getOrder(d, sato, id);
    expect(clientView.makerQuotes).toEqual([]);
    expect(clientView.quoteCosts).toEqual([]);
    expect(clientView.messages.map((m) => m.kind)).toEqual([
      'question',
      'answer',
    ]);
    const seen = JSON.stringify(clientView);
    for (const secret of [
      '17777',
      '3333',
      '19999',
      '4444',
      '1111',
      '2222',
      'さくら備品サプライ',
      'あおば什器製作所',
      'sakura-supply',
      '原価は抑えめに',
      String(agentView.quoteCosts[0].profit),
    ])
      expect(seen).not.toContain(secret);
    // Selling price: ceil(17,777 × 1.2) = 21,333.
    expect(clientView.quotes[0].lines[0].unit_price).toBe(21_333);

    const total = (await acceptQuote(d, sato, id, clientView.current_quote_id))
      .total;
    expect(total).toBe(clientView.quotes[0].total);
    const { poNumber } = await placeOrder(d, yamada, id, {
      delivery_mode: 'direct',
      delivery_note: '午前中に搬入',
    });
    expect(poNumber).toMatch(/^PO-\d{4}-0001$/);
    await scheduleDelivery(d, yamada, id, { delivery_date: day(10) });

    const done = await getOrder(d, sato, id);
    expect(done.status).toBe('scheduled');
    expect(done.notice?.subject).toBe(
      `【納期のお知らせ】休憩室の収納棚（${done.request_number}）`,
    );
    expect(done.notice?.body).toMatch(
      /^ご依頼の什器・備品をメーカーに発注し、納期が決まりました。/,
    );
    expect(done.notice?.body).toContain(`¥${total.toLocaleString('ja-JP')}`);
    expect(done.notice?.body).toContain('渋谷店');
    expect(await listOrders(d, sato, 'done')).toHaveLength(1);
    expect((await orderStats(d, yamada)).done).toBe(1);
  });
});
