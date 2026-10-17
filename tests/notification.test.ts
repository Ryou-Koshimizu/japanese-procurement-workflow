import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  subjectOf,
  type Audience,
  type NotificationEvent,
  type Payload,
} from '../src/core/notification';

const scheduled: Payload = {
  order_id: '00000000-0000-4000-8000-000000000001',
  request_number: 'R-2026-0001',
  title: '受付カウンター\r\nBcc: attacker@example.com',
  client_name: '株式会社サンプルカフェ',
  store_name: '渋谷店',
  org_name: 'みどり購買サポート株式会社',
  agent_name: '山田 花子',
  agent_email: 'yamada@midori.example',
  lines: [
    {
      name: '受付カウンター',
      spec: 'W1800',
      unit: '台',
      qty: 1,
      tax_rate: 10,
      unit_price: 150000,
      amount: 150000,
    },
    {
      name: '緑茶',
      unit: 'ケース',
      qty: 2,
      tax_rate: 8,
      unit_price: 2600,
      amount: 5200,
    },
  ],
  shipping_fee: 3000,
  expenses: 2000,
  subtotal_10: 155000,
  tax_10: 15500,
  subtotal_8: 5200,
  tax_8: 416,
  total: 176116,
  delivery_date: '2026-11-20',
  delivery_mode: 'direct',
  destination: '株式会社サンプルカフェ 渋谷店 東京都渋谷区（架空）1-2-3',
  delivery_note: '午前中に搬入',
};

const events: NotificationEvent[] = [
  'requested',
  'question',
  'answered',
  'rfq',
  'quoted',
  'revision',
  'agreed',
  'ordered',
  'scheduled',
  'rejected',
  'cancelled',
];

describe('notifications', () => {
  it('tells A社 the delivery date, total and whom to ask', () => {
    expect(subjectOf('scheduled', 'client', scheduled)).toBe(
      '【納期のお知らせ】受付カウンター Bcc: attacker@example.com（R-2026-0001）',
    );
    const body = bodyOf(
      'scheduled',
      'client',
      scheduled,
      'https://orders.example.com',
    );
    expect(
      body.startsWith(
        'ご依頼の什器・備品をメーカーに発注し、納期が決まりました。',
      ),
    ).toBe(true);
    expect(body).toContain('納期：2026年11月20日');
    expect(body).toContain('届け方：メーカーから直送');
    expect(body).toContain(
      '1. 受付カウンター（W1800）  ¥150,000 × 1台 = ¥150,000',
    );
    expect(body).toContain('諸経費：¥2,000（10%対象に含む）');
    expect(body).toContain('8%対象（※軽減税率）¥5,200　消費税 ¥416');
    expect(body).toContain('合計（税込）：¥176,116');
    expect(body).toContain(
      'お問い合わせ先：みどり購買サポート株式会社 山田 花子（yamada@midori.example）',
    );
    expect(body).toContain(
      `詳細：https://orders.example.com/orders/${scheduled.order_id}`,
    );
  });

  it('never lets data break a header line', () => {
    for (const event of events)
      for (const audience of ['client', 'agent', 'maker'] as Audience[])
        expect(subjectOf(event, audience, scheduled)).not.toMatch(/[\r\n]/);
  });

  it('gives a maker a purchase order with costs and no internal link', () => {
    const body = bodyOf(
      'ordered',
      'maker',
      {
        ...scheduled,
        po_number: 'PO-2026-0001',
        lines: [
          {
            name: '受付カウンター',
            spec: 'W1800',
            unit: '台',
            qty: 1,
            unit_cost: 120000,
            cost_amount: 120000,
          },
        ],
        shipping_cost: 1500,
        cost_subtotal: 121500,
      },
      'https://orders.example.com',
    );
    expect(body).toContain('¥120,000 × 1台 = ¥120,000');
    expect(body).toContain('合計（税抜）：¥121,500');
    expect(body).toContain('届け先：株式会社サンプルカフェ 渋谷店');
    expect(body).not.toContain('https://orders.example.com');
  });
});
