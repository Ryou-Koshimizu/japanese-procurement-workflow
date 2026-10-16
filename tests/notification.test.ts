import { describe, expect, it } from 'vitest';
import { bodyOf, subjectOf, type Payload } from '../src/core/notification';

const ordered: Payload = {
  order_id: '00000000-0000-4000-8000-000000000001',
  request_number: 'R-2026-0001',
  po_number: 'PO-2026-0001',
  org_name: '株式会社サンプルカフェ',
  store_name: '渋谷店\r\nBcc: attacker@example.com',
  store_code: 'S01',
  supplier_name: 'さくら備品サプライ',
  requested_by: '佐藤 美咲',
  quote_version: 1,
  lines: [
    {
      name: 'コピー用紙',
      sku: 'SK-3001',
      unit: '箱',
      qty: 1,
      unit_price: 2180,
      tax_rate: 10,
      amount: 2180,
    },
    {
      name: '緑茶',
      sku: 'SK-5001',
      unit: 'ケース',
      qty: 2,
      unit_price: 2600,
      tax_rate: 8,
      amount: 5200,
    },
  ],
  shipping_fee: 0,
  subtotal_10: 2180,
  tax_10: 218,
  subtotal_8: 5200,
  tax_8: 416,
  total: 8014,
  issued_by: '山田 花子',
  issued_at: '2026-10-14T01:00:00Z',
  responded_by: '佐藤 美咲',
  responded_at: '2026-10-14T02:30:00Z',
};

describe('notifications', () => {
  it('puts the agreed amount in the subject for both parties and the supplier', () => {
    expect(subjectOf('ordered', 'store', ordered)).toBe(
      '【発注確定】PO-2026-0001 渋谷店 Bcc: attacker@example.com 合計 ¥8,014（税込）',
    );
    expect(subjectOf('ordered', 'supplier', ordered)).toBe(
      '【発注書】PO-2026-0001 株式会社サンプルカフェ 合計 ¥8,014（税込）',
    );
  });

  it('never lets data break a header line', () => {
    for (const audience of ['store', 'hq', 'supplier'] as const)
      expect(subjectOf('ordered', audience, ordered)).not.toMatch(/[\r\n]/);
  });

  it('lists lines, per-rate totals and both signatures', () => {
    const body = bodyOf('ordered', 'hq', ordered, 'https://orders.example.com');
    expect(body).toContain('2. 緑茶※［SK-5001］  ¥2,600 × 2ケース = ¥5,200');
    expect(body).toContain('8%対象（※軽減税率）¥5,200　消費税 ¥416');
    expect(body).toContain('合計（税込）：¥8,014');
    expect(body).toContain(
      '本社の承認：山田 花子（2026/10/14 10:00・見積 第1版）',
    );
    expect(body).toContain('店舗の承諾：佐藤 美咲（2026/10/14 11:30）');
    expect(body).toContain(
      `詳細：https://orders.example.com/orders/${ordered.order_id}`,
    );
  });

  it('gives the supplier a purchase order without internal links', () => {
    const body = bodyOf(
      'ordered',
      'supplier',
      ordered,
      'https://orders.example.com',
    );
    expect(body).toContain('下記のとおり発注いたします');
    expect(body).toContain(
      '納品先：渋谷店 Bcc: attacker@example.com（店舗コード S01）',
    );
    expect(body).not.toContain('https://orders.example.com');
  });
});
