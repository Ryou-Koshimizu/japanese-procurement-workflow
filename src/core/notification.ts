// Text of the notifications the database queues (app.order_events,
// app.maker_quote_events). The amounts come from the payload, which the
// database wrote in the same transaction as the change; nothing here
// recomputes them. Payloads for A社 (audience 'client') never carry costs,
// maker quotes or profit: the database builds them from A社-visible data only.
import { yen } from './money';
import { deliveryModeLabels, type DeliveryMode } from './workflow';

export type NotificationEvent =
  | 'requested'
  | 'question'
  | 'answered'
  | 'rfq'
  | 'quoted'
  | 'revision'
  | 'agreed'
  | 'ordered'
  | 'scheduled'
  | 'rejected'
  | 'cancelled';
export type Audience = 'client' | 'agent' | 'maker';

/** A line as it appears in a payload: spec lines (rfq), selling lines (quoted, scheduled) or cost lines (ordered). */
export type PayloadLine = {
  name: string;
  spec?: string | null;
  unit?: string | null;
  qty: number;
  tax_rate?: number;
  unit_price?: number;
  amount?: number;
  unit_cost?: number;
  cost_amount?: number;
};

export type Payload = {
  order_id?: string;
  request_number?: string | null;
  po_number?: string | null;
  title?: string | null;
  /** B社 (the organization). */
  org_name?: string;
  /** A社 (the client company). */
  client_name?: string;
  store_name?: string;
  store_code?: string;
  requested_by?: string;
  needed_by?: string | null;
  note?: string | null;
  answers?: {
    key: string;
    label: string;
    kind: string;
    value: string | number;
  }[];
  question?: string;
  asked_by?: string;
  answer?: string;
  answered_by?: string;
  maker_name?: string;
  agent_name?: string;
  agent_email?: string;
  quote_version?: number;
  valid_until?: string;
  lines?: PayloadLine[];
  shipping_fee?: number;
  expenses?: number;
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
  shipping_cost?: number;
  cost_subtotal?: number;
  delivery_mode?: DeliveryMode;
  destination?: string;
  delivery_note?: string | null;
  delivery_date?: string;
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
  const what = `${oneLine(p.title)}（${oneLine(p.request_number)}）`;
  switch (event) {
    case 'requested':
      return `【新しい依頼】${store} ${what}`;
    case 'question':
      return `【B社からの質問】${what}`;
    case 'answered':
      return `【質問への回答】${store} ${what}`;
    // To a maker: numbers only, never A社's free-text title.
    case 'rfq':
      return `【見積のご依頼】${oneLine(p.request_number)}（${oneLine(p.org_name)}）`;
    case 'quoted':
      return `【見積書】${what} 合計 ${yen(p.total)}（税込）`;
    case 'revision':
      return `【見積書の修正依頼】${store} ${what}`;
    case 'agreed':
      return `【合意】${store} ${what} 合計 ${yen(p.total)}（税込）`;
    case 'ordered':
      return `【発注書】${oneLine(p.po_number)}（${oneLine(p.org_name)}）`;
    case 'scheduled':
      return `【納期のお知らせ】${what}`;
    case 'rejected':
      return `【お断り】${what}`;
    case 'cancelled':
      return `【取り下げ】${store} ${what}`;
  }
}

const specOf = (l: PayloadLine) => (l.spec ? `（${oneLine(l.spec)}）` : '');

function sellingLines(lines: PayloadLine[]): string[] {
  return lines.map(
    (l, i) =>
      `${i + 1}. ${oneLine(l.name)}${l.tax_rate === 8 ? '※' : ''}${specOf(l)}  ${yen(l.unit_price)} × ${l.qty}${oneLine(l.unit)} = ${yen(l.amount)}`,
  );
}

function totals(p: Payload): string[] {
  const out = [];
  if (p.shipping_fee) out.push(`送料：${yen(p.shipping_fee)}（10%対象に含む）`);
  if (p.expenses) out.push(`諸経費：${yen(p.expenses)}（10%対象に含む）`);
  if (p.subtotal_10 || !p.subtotal_8)
    out.push(`10%対象 ${yen(p.subtotal_10)}　消費税 ${yen(p.tax_10)}`);
  if (p.subtotal_8)
    out.push(`8%対象（※軽減税率）${yen(p.subtotal_8)}　消費税 ${yen(p.tax_8)}`);
  out.push(`合計（税込）：${yen(p.total)}`);
  return out;
}

const answerValue = (a: { kind: string; value: string | number }) =>
  a.kind === 'number'
    ? Number(a.value).toLocaleString('ja-JP')
    : oneLine(a.value);

const contact = (p: Payload) =>
  `${oneLine(p.org_name)} ${oneLine(p.agent_name)}（${oneLine(p.agent_email)}）`;

export function bodyOf(
  event: NotificationEvent,
  audience: Audience,
  p: Payload,
  origin: string | null,
): string {
  const head = [
    `依頼番号：${oneLine(p.request_number) || '—'}`,
    `件名：${oneLine(p.title)}`,
    `依頼元：${oneLine(p.client_name)} ${oneLine(p.store_name)}（${oneLine(p.requested_by)}）`,
  ];
  if (p.needed_by) head.push(`希望納期：${formatDate(p.needed_by)}`);
  const out: string[] = [];
  switch (event) {
    case 'requested':
      out.push(
        `${oneLine(p.client_name)} ${oneLine(p.store_name)}から依頼が届きました。内容を確認して、必要なら質問を送ってください。`,
        '',
        ...head,
        '',
        ...(p.answers ?? []).map(
          (a) => `・${oneLine(a.label)}：${answerValue(a)}`,
        ),
      );
      if (p.note) out.push('', `メモ：${p.note}`);
      break;
    case 'question':
      out.push(
        'B社から依頼について質問が届きました。画面から回答してください。',
        '',
        ...head,
        '',
        `質問（${oneLine(p.asked_by)}）：`,
        p.question ?? '',
      );
      break;
    case 'answered':
      out.push(
        `${oneLine(p.store_name)}から質問への回答が届きました。`,
        '',
        ...head,
        '',
        `回答（${oneLine(p.answered_by)}）：`,
        p.answer ?? '',
      );
      break;
    case 'rfq':
      // To a maker: no A社 name, branch, address or free-text title (the
      // database leaves them out).
      out.push(
        `${oneLine(p.org_name)}の${oneLine(p.agent_name)}です。下記の商品の規格・在庫・金額（税抜）・納期をお知らせください。`,
        '',
        `見積依頼番号：${oneLine(p.request_number)}`,
      );
      if (p.needed_by) out.push(`希望納期：${formatDate(p.needed_by)}`);
      out.push(
        '',
        ...(p.lines ?? []).map(
          (l, i) =>
            `${i + 1}. ${oneLine(l.name)}${specOf(l)}  ${l.qty}${oneLine(l.unit)}`,
        ),
        '',
        `ご連絡先：${contact(p)}`,
      );
      break;
    case 'quoted':
      out.push(
        `B社から見積書（第${p.quote_version}版）が届きました。内容を確認して、合意するか修正を頼んでください。`,
        '',
        ...head,
        `有効期限：${formatDate(p.valid_until)}`,
        '',
        ...sellingLines(p.lines ?? []),
        '',
        ...totals(p),
      );
      if (p.quote_note) out.push('', `B社からのメモ：${p.quote_note}`);
      break;
    case 'revision':
      out.push(
        `${oneLine(p.store_name)}から見積書（第${p.quote_version}版）の修正依頼が届きました。`,
        '',
        ...head,
        '',
        `修正してほしい内容：${p.revision_note ?? ''}`,
      );
      break;
    case 'agreed':
      out.push(
        `${oneLine(p.store_name)}が見積書（第${p.quote_version}版）に合意しました。メーカーに発注してください。`,
        '',
        ...head,
        `合計（税込）：${yen(p.total)}`,
        '',
        '合意の記録',
        `・見積書：${oneLine(p.issued_by)}（${formatDateTime(p.issued_at)}）`,
        `・合意：${oneLine(p.responded_by)}（${formatDateTime(p.responded_at)}）`,
      );
      break;
    case 'ordered':
      out.push(
        `${oneLine(p.org_name)}より、下記のとおり発注いたします。`,
        '',
        `発注番号：${oneLine(p.po_number)}`,
        `見積依頼番号：${oneLine(p.request_number)}`,
        `届け方：${p.delivery_mode ? deliveryModeLabels[p.delivery_mode] : '—'}`,
        `届け先：${oneLine(p.destination)}`,
      );
      if (p.needed_by) out.push(`希望納期：${formatDate(p.needed_by)}`);
      out.push(
        '',
        ...(p.lines ?? []).map(
          (l, i) =>
            `${i + 1}. ${oneLine(l.name)}${specOf(l)}  ${yen(l.unit_cost)} × ${l.qty}${oneLine(l.unit)} = ${yen(l.cost_amount)}`,
        ),
        '',
        `送料：${yen(p.shipping_cost)}`,
        `合計（税抜）：${yen(p.cost_subtotal)}`,
      );
      if (p.delivery_note) out.push('', `メモ：${p.delivery_note}`);
      out.push('', `ご連絡先：${contact(p)}`);
      break;
    case 'scheduled':
      out.push(
        'ご依頼の什器・備品をメーカーに発注し、納期が決まりました。',
        '',
        `納期：${formatDate(p.delivery_date)}`,
        `届け方：${p.delivery_mode ? deliveryModeLabels[p.delivery_mode] : '—'}`,
        `届け先：${oneLine(p.destination)}`,
        `依頼番号：${oneLine(p.request_number)}`,
        `件名：${oneLine(p.title)}`,
        `依頼元：${oneLine(p.client_name)} ${oneLine(p.store_name)}`,
        '',
        ...sellingLines(p.lines ?? []),
        '',
        ...totals(p),
      );
      if (p.delivery_note) out.push('', `メモ：${p.delivery_note}`);
      out.push('', `お問い合わせ先：${contact(p)}`);
      break;
    case 'rejected':
      out.push(
        'B社が依頼をお断りしました。',
        '',
        ...head,
        '',
        `理由：${p.reason ?? ''}`,
      );
      break;
    case 'cancelled':
      out.push(`${oneLine(p.store_name)}が依頼を取り下げました。`, '', ...head);
      if (p.reason) out.push('', `理由：${p.reason}`);
      break;
  }
  if (origin && audience !== 'maker' && p.order_id)
    out.push('', `詳細：${origin}/orders/${p.order_id}`);
  out.push('', '※ このメールは備品発注ワークフローから自動で送信しています。');
  return out.join('\n');
}
