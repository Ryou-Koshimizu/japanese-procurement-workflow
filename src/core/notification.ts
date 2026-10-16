// Text of the notifications the database queues (app.order_events). The
// amounts come from the payload, which the database wrote from the quote in
// the same transaction as the change; nothing here recomputes them.
import { yen } from './money';

export type NotificationEvent =
  'requested' | 'quoted' | 'revision' | 'rejected' | 'cancelled' | 'ordered';
export type Audience = 'store' | 'hq' | 'supplier';

type Line = {
  name: string;
  sku?: string | null;
  unit?: string | null;
  qty: number;
  unit_price: number;
  tax_rate: number;
  amount?: number;
};

export type Payload = {
  order_id: string;
  request_number?: string | null;
  po_number?: string | null;
  org_name?: string;
  store_name?: string;
  store_code?: string;
  supplier_name?: string;
  requested_by?: string;
  needed_by?: string | null;
  note?: string | null;
  event_at?: string;
  quote_version?: number;
  valid_until?: string;
  lines?: Line[];
  shipping_fee?: number;
  subtotal_10?: number;
  tax_10?: number;
  subtotal_8?: number;
  tax_8?: number;
  total?: number;
  quote_note?: string | null;
  issued_by?: string;
  issued_at?: string;
  responded_by?: string | null;
  responded_at?: string | null;
  revision_note?: string | null;
  reason?: string | null;
};

/** One header line: no line breaks or control characters from the data. */
const oneLine = (s: unknown) =>
  String(s ?? '')
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ')
    .trim();

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : '—';
}

export function subjectOf(
  event: NotificationEvent,
  audience: Audience,
  p: Payload,
): string {
  const store = oneLine(p.store_name);
  const request = oneLine(p.request_number);
  const total = p.total !== undefined ? yen(p.total) : '';
  switch (event) {
    case 'requested':
      return `【発注依頼】${store} ${request}`;
    case 'quoted':
      return `【見積のご確認】${request} 合計 ${total}（税込）`;
    case 'revision':
      return `【見積の修正依頼】${store} ${request}`;
    case 'rejected':
      return `【依頼の却下】${request}`;
    case 'cancelled':
      return `【依頼の取り下げ】${store} ${request}`;
    case 'ordered':
      return audience === 'supplier'
        ? `【発注書】${oneLine(p.po_number)} ${oneLine(p.org_name)} 合計 ${total}（税込）`
        : `【発注確定】${oneLine(p.po_number)} ${store} 合計 ${total}（税込）`;
  }
}

function lineTable(lines: Line[], withAmounts: boolean): string[] {
  return lines.map((l, i) => {
    const amount = l.amount ?? l.unit_price * l.qty;
    const sku = l.sku ? `［${oneLine(l.sku)}］` : '';
    const reduced = l.tax_rate === 8 ? '※' : '';
    return withAmounts
      ? `${i + 1}. ${oneLine(l.name)}${reduced}${sku}  ${yen(l.unit_price)} × ${l.qty}${oneLine(l.unit)} = ${yen(amount)}`
      : `${i + 1}. ${oneLine(l.name)}${reduced}${sku}  ${l.qty}${oneLine(l.unit)}（参考単価 ${yen(l.unit_price)}）`;
  });
}

function totals(p: Payload): string[] {
  const out = [];
  if (p.shipping_fee) out.push(`送料：${yen(p.shipping_fee)}（10%対象に含む）`);
  out.push(
    `10%対象 ${yen(p.subtotal_10)}　消費税 ${yen(p.tax_10)}`,
    `8%対象（※軽減税率）${yen(p.subtotal_8)}　消費税 ${yen(p.tax_8)}`,
    `合計（税込）：${yen(p.total)}`,
  );
  return out;
}

export function bodyOf(
  event: NotificationEvent,
  audience: Audience,
  p: Payload,
  origin: string | null,
): string {
  const link = origin ? `${origin}/orders/${p.order_id}` : null;
  const head = [
    `依頼番号：${oneLine(p.request_number) || '—'}`,
    `店舗：${oneLine(p.store_name)}（依頼者 ${oneLine(p.requested_by)}）`,
    `仕入先：${oneLine(p.supplier_name)}`,
  ];
  if (p.needed_by) head.push(`希望納期：${formatDate(p.needed_by)}`);
  const out: string[] = [];
  switch (event) {
    case 'requested':
      out.push(
        `${oneLine(p.store_name)}から備品の発注依頼が届きました。内容を確認し、見積を送るか却下してください。`,
        '',
        ...head,
        '',
        ...lineTable(p.lines ?? [], false),
      );
      if (p.note) out.push('', `店舗からのメモ：${p.note}`);
      break;
    case 'quoted':
      out.push(
        `本社が依頼を承認し、見積（第${p.quote_version}版）を送りました。内容を確認し、承諾すると発注が確定します。`,
        '',
        ...head,
        `有効期限：${formatDate(p.valid_until)}`,
        '',
        ...lineTable(p.lines ?? [], true),
        '',
        ...totals(p),
      );
      if (p.quote_note) out.push('', `本社からのメモ：${p.quote_note}`);
      break;
    case 'revision':
      out.push(
        `${oneLine(p.store_name)}から見積（第${p.quote_version}版）の修正依頼が届きました。`,
        '',
        ...head,
        '',
        `修正してほしい内容：${p.revision_note ?? ''}`,
      );
      break;
    case 'rejected':
      out.push(
        '本社が発注依頼を却下しました。',
        '',
        ...head,
        '',
        `理由：${p.reason ?? ''}`,
      );
      break;
    case 'cancelled':
      out.push(
        `${oneLine(p.store_name)}が発注依頼を取り下げました。`,
        '',
        ...head,
      );
      if (p.reason) out.push('', `理由：${p.reason}`);
      break;
    case 'ordered':
      if (audience === 'supplier') {
        out.push(
          `${oneLine(p.org_name)}より、下記のとおり発注いたします。`,
          '',
          `発注番号：${oneLine(p.po_number)}`,
          `発注者：${oneLine(p.org_name)}`,
          `納品先：${oneLine(p.store_name)}（店舗コード ${oneLine(p.store_code)}）`,
        );
        if (p.needed_by) out.push(`希望納期：${formatDate(p.needed_by)}`);
        out.push('', ...lineTable(p.lines ?? [], true), '', ...totals(p));
        break;
      }
      out.push(
        '本社の承認（見積）と店舗の承諾がそろったため、発注が確定しました。',
        '',
        `発注番号：${oneLine(p.po_number)}`,
        ...head,
        '',
        ...lineTable(p.lines ?? [], true),
        '',
        ...totals(p),
        '',
        '合意の記録',
        `・本社の承認：${oneLine(p.issued_by)}（${formatDateTime(p.issued_at)}・見積 第${p.quote_version}版）`,
        `・店舗の承諾：${oneLine(p.responded_by)}（${formatDateTime(p.responded_at)}）`,
      );
      break;
  }
  if (link && audience !== 'supplier') out.push('', `詳細：${link}`);
  out.push('', '※ このメールは備品発注ワークフローから自動で送信しています。');
  return out.join('\n');
}
