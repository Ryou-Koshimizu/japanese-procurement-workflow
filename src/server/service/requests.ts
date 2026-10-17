// Requests from A社's branches: sending one (through the intake form), the
// lists, and one request in full. What each person sees is decided by
// row-level security alone: an A社 user's getOrder() runs the same queries as
// B社's, and the database returns no maker quotes, costs or B社 notes.
import { asUser, AppError } from '../db';
import type { Session } from '../auth';
import { validateAnswers, type Answer } from '../../core/intake';
import {
  isAgent,
  waitingOn,
  type DeliveryMode,
  type MakerQuoteStatus,
  type MessageKind,
  type PricingMode,
  type QuoteStatus,
  type Status,
  type Stock,
} from '../../core/workflow';
import type { TaxRate } from '../../core/money';
import {
  bodyOf,
  subjectOf,
  type Audience,
  type NotificationEvent,
  type Payload,
} from '../../core/notification';
import { todayInJapan } from '../config';
import {
  ctx,
  id,
  isDate,
  LIST_LIMIT,
  requireClient,
  text,
  toNumber,
  type Deps,
} from './common';
import type { Field } from './intake';

// Sending a request ---------------------------------------------------------------

/**
 * Create the request and send it in one transaction: the draft exists only
 * inside it, so a refused request leaves nothing behind and uses no number.
 */
export async function submitRequest(
  deps: Deps,
  s: Session,
  raw: unknown,
): Promise<string> {
  requireClient(s);
  const o = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const check = <T>(key: string, fn: () => T): T | null => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof AppError) errors[key] = e.message;
      else throw e;
      return null;
    }
  };
  const title = check('_title', () => {
    const t = text(o.title, 100, '件名');
    if (!t) throw new AppError(400, '件名を入力してください。');
    return t;
  });
  const neededBy = check('_needed_by', () => {
    const d = text(o.needed_by, 10, 'いつまでに');
    if (!d) return null;
    if (!isDate(d))
      throw new AppError(400, '「いつまでに」の日付が正しくありません。');
    if (d < todayInJapan())
      throw new AppError(400, '「いつまでに」は今日以降にしてください。');
    return d;
  });
  const note = check('_note', () => text(o.note, 1000, 'メモ'));

  return asUser(deps.db, ctx(s), async (tx) => {
    const fields = await tx.query<Field>(
      `SELECT id, key, label, kind, required, options, help, position, active
         FROM app.request_fields WHERE active ORDER BY position, created_at, key`,
    );
    const v = validateAnswers(fields.rows, o.answers);
    if (!v.ok) Object.assign(errors, v.errors);
    if (Object.keys(errors).length || !v.ok)
      throw new AppError(
        422,
        '入力内容を確認してください。',
        'INVALID_REQUEST',
        errors,
      );
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.orders (org_id, store_id, created_by, title, answers, needed_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        s.orgId,
        s.storeId,
        s.userId,
        title,
        JSON.stringify(v.answers.map((a) => ({ key: a.key, value: a.value }))),
        neededBy,
        note,
      ],
    );
    await tx.query(`UPDATE app.orders SET status = 'requested' WHERE id = $1`, [
      r.rows[0].id,
    ]);
    return r.rows[0].id;
  });
}

// Lists ---------------------------------------------------------------------------

export type OrderSummary = {
  id: string;
  status: Status;
  request_number: string | null;
  po_number: string | null;
  store_id: string;
  store_name: string;
  title: string | null;
  requested_by_name: string;
  requested_at: string | null;
  updated_at: string;
  needed_by: string | null;
  delivery_date: string | null;
  /** The agreed total, or the current quote's total while A社 reviews it. */
  amount: number | null;
  amount_kind: 'agreed' | 'quote' | null;
  quote_version: number | null;
  valid_until: string | null;
};

export type OrderFilter = 'todo' | 'open' | 'done' | 'all';
export const ORDER_FILTERS: OrderFilter[] = ['todo', 'open', 'done', 'all'];

const STATUSES: Status[] = [
  'requested',
  'hearing',
  'sourcing',
  'quoted',
  'agreed',
  'ordered',
  'scheduled',
  'rejected',
  'cancelled',
];
const side = (s: Session) => (isAgent(s.role) ? 'agent' : 'client');
/** The statuses waiting on this person's side. */
export const myTurn = (s: Session) =>
  STATUSES.filter((st) => waitingOn(st) === side(s));

export async function listOrders(
  deps: Deps,
  s: Session,
  filter: OrderFilter = 'all',
): Promise<OrderSummary[]> {
  const statuses: Record<OrderFilter, Status[]> = {
    todo: myTurn(s),
    open: STATUSES.filter((st) => waitingOn(st) !== null),
    done: ['scheduled'],
    all: STATUSES,
  };
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<OrderSummary>(
      `SELECT o.id, o.status, o.request_number, o.po_number, o.store_id, st.name AS store_name,
              o.title, u.name AS requested_by_name, o.requested_at, o.updated_at,
              o.needed_by, o.delivery_date,
              coalesce(o.agreed_total, CASE WHEN o.status = 'quoted' THEN q.total END) AS amount,
              CASE WHEN o.agreed_total IS NOT NULL THEN 'agreed'
                   WHEN o.status = 'quoted' THEN 'quote' END AS amount_kind,
              q.version AS quote_version, q.valid_until
         FROM app.orders o
         JOIN app.stores st ON st.id = o.store_id
         JOIN app.users u ON u.id = o.created_by
         LEFT JOIN app.quotes q ON q.id = o.current_quote_id
        WHERE o.status = ANY($1::text[])
        ORDER BY o.updated_at DESC LIMIT ${LIST_LIMIT}`,
      [statuses[filter]],
    );
    return r.rows.map((row) => toNumber(row, ['amount']));
  });
}

export type OrderStats = {
  byStatus: Record<Status, number>;
  todo: number;
  waiting: number;
  open: number;
  done: number;
  all: number;
  scheduledThisMonth: number;
  scheduledThisMonthTotal: number;
};

/** Counts over every request (not a page of them). */
export async function orderStats(deps: Deps, s: Session): Promise<OrderStats> {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ status: Status; n: number }>(
      `SELECT status, count(*)::int AS n FROM app.orders WHERE status <> 'draft' GROUP BY status`,
    );
    const m = await tx.query<{ n: number; total: number }>(
      `SELECT count(*)::int AS n, coalesce(sum(agreed_total), 0)::bigint AS total
         FROM app.orders
        WHERE status = 'scheduled'
          AND date_trunc('month', scheduled_at AT TIME ZONE 'Asia/Tokyo')
              = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo')`,
    );
    const byStatus = Object.fromEntries(
      STATUSES.map((st) => [st, 0]),
    ) as Record<Status, number>;
    for (const row of r.rows) byStatus[row.status] = row.n;
    const sum = (list: Status[]) => list.reduce((n, st) => n + byStatus[st], 0);
    const mine = side(s);
    return {
      byStatus,
      todo: sum(STATUSES.filter((st) => waitingOn(st) === mine)),
      waiting: sum(
        STATUSES.filter((st) => waitingOn(st) && waitingOn(st) !== mine),
      ),
      open: sum(STATUSES.filter((st) => waitingOn(st) !== null)),
      done: byStatus.scheduled,
      all: sum(STATUSES),
      scheduledThisMonth: m.rows[0].n,
      scheduledThisMonthTotal: Number(m.rows[0].total),
    };
  });
}

// One request ---------------------------------------------------------------------

export type Message = {
  id: string;
  kind: MessageKind;
  body: string;
  author_name: string | null;
  created_at: string;
};

export type OutlineLine = {
  id: string;
  position: number;
  name: string;
  spec: string;
  qty: number;
  unit: string;
  tax_rate: TaxRate;
  item_id: string | null;
};

export type QuoteLine = {
  line_no: number;
  order_line_id: string;
  name: string;
  spec: string;
  unit: string;
  tax_rate: TaxRate;
  qty: number;
  unit_price: number;
  amount: number;
};

export type Quote = {
  id: string;
  version: number;
  status: QuoteStatus;
  lines: QuoteLine[];
  shipping_fee: number;
  expenses: number;
  subtotal_10: number;
  tax_10: number;
  subtotal_8: number;
  tax_8: number;
  total: number;
  valid_until: string;
  note: string | null;
  issued_by_name: string | null;
  issued_at: string;
  responded_by_name: string | null;
  responded_at: string | null;
  response_note: string | null;
};

/** B社 only: row-level security returns none of these to A社. */
export type MakerQuote = {
  id: string;
  maker_id: string;
  maker_name: string;
  maker_email: string;
  status: MakerQuoteStatus;
  requested_by_name: string | null;
  requested_at: string;
  answered_at: string | null;
  lines: { order_line_id: string; unit_cost: number; stock: Stock }[];
  shipping_cost: number;
  lead_time: string | null;
  valid_until: string | null;
  note: string | null;
  cost_subtotal: number | null;
};

/** B社 only: row-level security returns none of these to A社. */
export type QuoteCost = {
  quote_id: string;
  maker_quote_id: string;
  pricing_mode: PricingMode;
  markup_bp: number | null;
  lines: {
    order_line_id: string;
    unit_cost: number;
    unit_price: number;
    qty: number;
    cost_amount: number;
    sales_amount: number;
    profit: number;
  }[];
  cost_subtotal: number;
  sales_subtotal: number;
  profit: number;
};

export type AuditEntry = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  actor_name: string | null;
  at: string;
  request_number?: string | null;
  order_id?: string | null;
};

export type Delivery = {
  event: NotificationEvent;
  audience: Audience;
  recipients: number;
  delivered: number;
  latest: string;
};

export type OrderDetail = {
  id: string;
  status: Status;
  request_number: string | null;
  po_number: string | null;
  store_id: string;
  store_name: string;
  store_address: string | null;
  org_name: string;
  client_name: string;
  org_address: string | null;
  title: string | null;
  answers: Answer[];
  needed_by: string | null;
  note: string | null;
  requested_by_name: string;
  created_by: string;
  requested_at: string | null;
  updated_at: string;
  current_quote_id: string | null;
  revision_note: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  agreed_at: string | null;
  agreed_total: number | null;
  ordered_at: string | null;
  delivery_mode: DeliveryMode | null;
  delivery_note: string | null;
  delivery_date: string | null;
  scheduled_at: string | null;
  assigned_name: string | null;
  assigned_email: string | null;
  /** Where the goods go for each delivery mode. */
  destinations: Record<DeliveryMode, string>;
  messages: Message[];
  lines: OutlineLine[];
  quotes: Quote[];
  makerQuotes: MakerQuote[];
  quoteCosts: QuoteCost[];
  audit: AuditEntry[];
  deliveries: Delivery[];
  /** The delivery notice A社 received, once the date is fixed. */
  notice: { subject: string; body: string } | null;
};

const QUOTE_AMOUNTS = [
  'subtotal_10',
  'tax_10',
  'subtotal_8',
  'tax_8',
  'total',
] as const;

export async function getOrder(
  deps: Deps,
  s: Session,
  orderId: string,
): Promise<OrderDetail> {
  const oid = id(orderId, '依頼');
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<
      Omit<
        OrderDetail,
        | 'destinations'
        | 'messages'
        | 'lines'
        | 'quotes'
        | 'makerQuotes'
        | 'quoteCosts'
        | 'audit'
        | 'deliveries'
        | 'notice'
      > & { direct: string; via_agent: string }
    >(
      `SELECT o.id, o.status, o.request_number, o.po_number, o.store_id, st.name AS store_name,
              st.address AS store_address, org.name AS org_name, org.client_name,
              org.address AS org_address, o.title, o.answers, o.needed_by, o.note,
              u.name AS requested_by_name, o.created_by, o.requested_at, o.updated_at,
              o.current_quote_id, o.revision_note, o.reject_reason, o.cancel_reason,
              o.agreed_at, o.agreed_total, o.ordered_at, o.delivery_mode, o.delivery_note,
              o.delivery_date, o.scheduled_at, a.name AS assigned_name, a.email AS assigned_email,
              concat_ws(' ', org.client_name, st.name, st.address) AS direct,
              concat_ws(' ', org.name, org.address) AS via_agent
         FROM app.orders o
         JOIN app.stores st ON st.id = o.store_id
         JOIN app.organizations org ON org.id = o.org_id
         JOIN app.users u ON u.id = o.created_by
         LEFT JOIN app.users a ON a.id = o.assigned_to
        WHERE o.id = $1 AND o.status <> 'draft'`,
      [oid],
    );
    const row = r.rows[0];
    if (!row) throw new AppError(404, '依頼が見つかりません。', 'NOT_FOUND');
    const { direct, via_agent, ...order } = toNumber(row, ['agreed_total']);

    // The same queries for everyone; row-level security leaves out what a
    // person may not see (B社 notes, maker quotes and costs for A社).
    const messages = await tx.query<Message>(
      `SELECT m.id, m.kind, m.body, u.name AS author_name, m.created_at
         FROM app.order_messages m LEFT JOIN app.users u ON u.id = m.author_id
        WHERE m.order_id = $1 ORDER BY m.created_at, m.id`,
      [oid],
    );
    const lines = await tx.query<OutlineLine>(
      `SELECT id, position, name, spec, qty, unit, tax_rate, item_id
         FROM app.order_lines WHERE order_id = $1 ORDER BY position, created_at, id`,
      [oid],
    );
    const quotes = await tx.query<Quote>(
      `SELECT q.id, q.version, q.status, q.lines, q.shipping_fee, q.expenses, q.subtotal_10,
              q.tax_10, q.subtotal_8, q.tax_8, q.total, q.valid_until, q.note,
              i.name AS issued_by_name, q.issued_at, r.name AS responded_by_name,
              q.responded_at, q.response_note
         FROM app.quotes q
         LEFT JOIN app.users i ON i.id = q.issued_by
         LEFT JOIN app.users r ON r.id = q.responded_by
        WHERE q.order_id = $1 ORDER BY q.version DESC`,
      [oid],
    );
    const makerQuotes = await tx.query<MakerQuote>(
      `SELECT mq.id, mq.maker_id, mk.name AS maker_name, mk.email AS maker_email, mq.status,
              ru.name AS requested_by_name, mq.requested_at, mq.answered_at, mq.lines,
              mq.shipping_cost, mq.lead_time, mq.valid_until, mq.note, mq.cost_subtotal
         FROM app.maker_quotes mq
         JOIN app.makers mk ON mk.id = mq.maker_id
         LEFT JOIN app.users ru ON ru.id = mq.requested_by
        WHERE mq.order_id = $1 ORDER BY mq.requested_at, mk.name, mq.id`,
      [oid],
    );
    const quoteCosts = await tx.query<QuoteCost>(
      `SELECT c.quote_id, c.maker_quote_id, c.pricing_mode, c.markup_bp, c.lines,
              c.cost_subtotal, c.sales_subtotal, c.profit
         FROM app.quote_costs c JOIN app.quotes q ON q.id = c.quote_id
        WHERE q.order_id = $1`,
      [oid],
    );
    const audit = await tx.query<AuditEntry>(
      `SELECT a.id::text, a.action, a.detail, u.name AS actor_name, a.at
         FROM app.audit_log a LEFT JOIN app.users u ON u.id = a.actor_id
        WHERE a.order_id = $1 ORDER BY a.id`,
      [oid],
    );
    const deliveries = await tx.query<Delivery>(
      'SELECT * FROM app.order_deliveries($1)',
      [oid],
    );

    const detail: OrderDetail = {
      ...order,
      answers: order.answers ?? [],
      destinations: { direct, via_agent },
      messages: messages.rows,
      lines: lines.rows,
      quotes: quotes.rows.map((q) => toNumber(q, [...QUOTE_AMOUNTS])),
      makerQuotes: makerQuotes.rows.map((m) => toNumber(m, ['cost_subtotal'])),
      quoteCosts: quoteCosts.rows.map((c) =>
        toNumber(c, ['cost_subtotal', 'sales_subtotal', 'profit']),
      ),
      audit: audit.rows,
      deliveries: deliveries.rows.map((d) => ({
        ...d,
        recipients: Number(d.recipients),
        delivered: Number(d.delivered),
      })),
      notice: null,
    };
    detail.notice = deliveryNotice(detail, deps.origin);
    return detail;
  });
}

/**
 * The delivery notice as A社 received it (same payload keys as the database's
 * app.order_events, same text as the mail), from what this page already shows.
 */
function deliveryNotice(o: OrderDetail, origin: string | null) {
  const q = o.quotes.find((x) => x.status === 'accepted');
  if (o.status !== 'scheduled' || !q || !o.delivery_mode) return null;
  const payload: Payload = {
    order_id: o.id,
    request_number: o.request_number,
    title: o.title,
    client_name: o.client_name,
    store_name: o.store_name,
    lines: q.lines.map((l) => ({
      name: l.name,
      spec: l.spec,
      qty: l.qty,
      unit: l.unit,
      tax_rate: l.tax_rate,
      unit_price: l.unit_price,
      amount: l.amount,
    })),
    shipping_fee: q.shipping_fee,
    expenses: q.expenses,
    subtotal_10: q.subtotal_10,
    tax_10: q.tax_10,
    subtotal_8: q.subtotal_8,
    tax_8: q.tax_8,
    total: o.agreed_total ?? q.total,
    delivery_date: o.delivery_date ?? undefined,
    delivery_mode: o.delivery_mode,
    destination: o.destinations[o.delivery_mode],
    delivery_note: o.delivery_note,
    org_name: o.org_name,
    agent_name: o.assigned_name ?? '',
    agent_email: o.assigned_email ?? '',
  };
  return {
    subject: subjectOf('scheduled', 'client', payload),
    body: bodyOf('scheduled', 'client', payload, origin),
  };
}
