import { notFound } from 'next/navigation';
import {
  ArrowDown,
  Ban,
  Building2,
  CircleCheck,
  ClipboardList,
  FileCheck2,
  History,
  Hourglass,
  Info,
  PackageCheck,
  PenLine,
  Send,
  ShoppingCart,
  Store,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import {
  getOrder,
  type AuditEntry,
  type Delivery,
  type OrderDetail,
  type Quote,
} from '../../../../src/server/service';
import { AppError } from '../../../../src/server/db';
import { localDemoSupplierUrl } from '../../../../src/server/demo-supplier';
import { addDays, todayInJapan } from '../../../../src/server/config';
import { can, DEFAULT_QUOTE_DAYS, isHq } from '../../../../src/core/workflow';
import { quoteTotals } from '../../../../src/core/money';
import { auditText } from '../../../../src/ui/audit';
import {
  StatusChip,
  formatDate,
  formatDateTime,
  shortDate,
  yen,
} from '../../../../src/ui/format';
import Totals from '../../totals';
import {
  CancelRequest,
  QuoteEditor,
  RejectForm,
  StoreResponse,
} from './actions';

export const dynamic = 'force-dynamic';

const audienceLabel = {
  store: '店舗',
  hq: '本社',
  supplier: '仕入先',
} as const;

function deliveriesText(list: Delivery[], demo: boolean) {
  const ordered = list.filter((d) => d.event === 'ordered');
  if (!ordered.length) return null;
  const who = ordered
    .map(
      (d) =>
        `${audienceLabel[d.audience]} ${d.recipients}${d.audience === 'supplier' ? '件' : '名'}`,
    )
    .join('・');
  const sent = ordered.every((d) => d.delivered === d.recipients);
  return `${who}に発注金額を通知${demo ? '（公開デモのため送信はせず記録のみ）' : sent ? '（送信済み）' : '（送信待ちあり）'}`;
}

const auditIcon = (a: AuditEntry): LucideIcon =>
  ({
    'status:requested': Send,
    'quote:issued': FileCheck2,
    'quote:accepted': CircleCheck,
    'quote:declined': PenLine,
    'status:ordered': PackageCheck,
    'status:rejected': Ban,
    'status:cancelled': Undo2,
  })[a.action] ?? History;

function QuoteView({ q, order }: { q: Quote; order: OrderDetail }) {
  const totals = {
    subtotal10: q.subtotal_10,
    tax10: q.tax_10,
    subtotal8: q.subtotal_8,
    tax8: q.tax_8,
    total: q.total,
  };
  const quotedIds = new Set(q.lines.map((l) => l.order_line_id));
  const excluded = order.lines.filter((l) => !quotedIds.has(l.id));
  return (
    <>
      <div className="scroll-x">
        <table className="list lines">
          <thead>
            <tr>
              <th>商品</th>
              <th className="num">単価（税抜）</th>
              <th className="num">数量</th>
              <th className="num">金額</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.order_line_id}>
                <td className="name">
                  {l.name}
                  <span className="meta-line" style={{ display: 'block' }}>
                    {l.sku}
                    {l.tax_rate === 8 ? '・軽減税率8%' : ''}
                  </span>
                </td>
                <td className="num">
                  {yen(l.unit_price)}
                  {l.unit_price !== l.reference_price && (
                    <span className="changed-from">
                      参考 {yen(l.reference_price)} から変更
                    </span>
                  )}
                </td>
                <td className="num">
                  {l.qty}
                  {l.unit}
                  {l.qty !== l.requested_qty && (
                    <span className="changed-from">
                      依頼 {l.requested_qty} から変更
                    </span>
                  )}
                </td>
                <td className="num">
                  <b>{yen(l.amount)}</b>
                </td>
              </tr>
            ))}
            {excluded.map((l) => (
              <tr key={l.id} className="excluded">
                <td className="name">
                  {l.name}
                  <span className="meta-line" style={{ display: 'block' }}>
                    今回の見積には含みません
                  </span>
                </td>
                <td className="num">—</td>
                <td className="num">{l.qty}</td>
                <td className="num">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totals totals={totals} shippingFee={q.shipping_fee} />
      {q.note && (
        <p className="notice" style={{ marginTop: 14 }}>
          <Info className="icon" aria-hidden="true" />
          <span>本社からのメモ：{q.note}</span>
        </p>
      )}
    </>
  );
}

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await pageSession();
  const { deps, config } = await runtime();
  const { id } = await params;
  let order: OrderDetail;
  try {
    order = await getOrder(deps, s, id);
  } catch (e) {
    if (e instanceof AppError && (e.status === 404 || e.status === 403))
      notFound();
    throw e;
  }
  const hq = isHq(s.role);
  const ownStore = s.role === 'store' && s.storeId === order.store_id;
  const current =
    order.quotes.find((q) => q.id === order.current_quote_id) ?? null;
  const older = order.quotes.filter((q) => q.id !== current?.id);
  const estimate = quoteTotals(
    order.lines.map((l) => ({
      unitPrice: l.unit_price,
      qty: l.qty,
      taxRate: l.tax_rate,
    })),
  );
  const accepted = order.quotes.find((q) => q.status === 'accepted') ?? null;
  const firstQuote = order.quotes[order.quotes.length - 1];
  const delivered = deliveriesText(order.deliveries, config.mode === 'demo');
  const today = todayInJapan();
  const expired = current?.status === 'sent' && current.valid_until < today;

  const steps = [
    {
      title: '店舗が依頼',
      who: `${order.requested_by_name}（${order.store_name}）`,
      at: order.requested_at,
      done: true,
    },
    {
      title: '本社が承認・見積',
      who: current ? `${current.issued_by_name}・第${current.version}版` : null,
      at: current?.issued_at ?? null,
      done: !!current && order.status !== 'requested',
      stopped: order.status === 'rejected',
    },
    {
      title: '店舗が承諾',
      who: accepted ? accepted.responded_by_name : null,
      at: accepted?.responded_at ?? null,
      done: !!accepted,
      stopped: order.status === 'cancelled',
    },
    {
      title: '発注確定・通知',
      who: order.po_number,
      at: order.ordered_at,
      done: order.status === 'ordered',
    },
  ];
  const currentStep = steps.findIndex((x) => !x.done);

  // What this person should do next, said once.
  type Next = {
    tone: 'act' | 'wait' | 'done' | 'stop';
    Icon: LucideIcon;
    title: string;
    text: string;
    href?: string;
    cta?: string;
  };
  const next: Next | null = (() => {
    switch (order.status) {
      case 'requested':
        if (hq)
          return {
            tone: 'act',
            Icon: Building2,
            title: 'あなたの番：内容を確認して見積を送ってください',
            text: order.revision_note
              ? '店舗から修正の依頼が届いています。直した見積を送ると、店舗が承諾できるようになります。'
              : '単価・数量・送料を決めて送ると、それが本社の承認になります。同意できない依頼は理由を書いて却下します。',
            href: '#editor',
            cta: '見積を作る',
          };
        return {
          tone: 'wait',
          Icon: Hourglass,
          title: '本社の確認を待っています',
          text: '見積が届いたら「通知」でお知らせします。不要になったら取り下げられます。',
        };
      case 'quoted':
        if (ownStore)
          return {
            tone: 'act',
            Icon: Store,
            title: 'あなたの番：届いた見積を確認してください',
            text: expired
              ? '有効期限が切れています。修正を依頼して、新しい見積を受け取ってください。'
              : `承諾すると合計 ${yen(current?.total)}（税込）で発注が確定します。内容に同意できなければ修正を依頼できます。`,
            href: '#quote',
            cta: '見積を確認する',
          };
        return {
          tone: 'wait',
          Icon: Hourglass,
          title: '店舗の承諾を待っています',
          text: '内容を変える場合は、下の「再見積を送る」で新しい版を送ると、今の版は無効になります。',
        };
      case 'ordered':
        return {
          tone: 'done',
          Icon: PackageCheck,
          title: `発注が確定しました（${order.po_number}）`,
          text: delivered ?? '発注金額を通知しました。',
        };
      case 'rejected':
        return {
          tone: 'stop',
          Icon: Ban,
          title: '本社が却下しました',
          text: order.reject_reason ?? '',
        };
      case 'cancelled':
        return {
          tone: 'stop',
          Icon: Undo2,
          title: '店舗が依頼を取り下げました',
          text: order.cancel_reason ?? '理由の記載はありません。',
        };
      default:
        return null;
    }
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ClipboardList className="icon sm" aria-hidden="true" />
            <a href="/">依頼一覧</a> / {order.store_name}
          </span>
          <h1
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span className="num">
              {order.po_number ?? order.request_number}
            </span>
            <StatusChip status={order.status} />
          </h1>
          <p className="sub">
            {order.po_number ? `依頼番号 ${order.request_number}・` : ''}
            仕入先 {order.supplier_name}・依頼者 {order.requested_by_name}（
            {shortDate(order.requested_at)}）
          </p>
        </div>
      </div>

      <ol className="progress glass clear" aria-label="合意までの流れ">
        {steps.map((st, i) => (
          <li
            key={st.title}
            className={
              st.stopped
                ? 'stopped'
                : st.done
                  ? 'done'
                  : i === currentStep
                    ? 'current'
                    : ''
            }
            aria-current={i === currentStep && !st.stopped ? 'step' : undefined}
          >
            <span className="dot" aria-hidden="true">
              {st.stopped ? '×' : st.done ? '✓' : i + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{st.title}</b>
              <small>
                {st.stopped
                  ? order.status === 'rejected'
                    ? '却下'
                    : '取り下げ'
                  : st.done || st.who
                    ? `${st.who ?? ''}${st.at ? `・${shortDate(st.at)}` : ''}`
                    : i === currentStep
                      ? i === 1
                        ? '本社の確認待ち'
                        : i === 2
                          ? '店舗の承諾待ち'
                          : ''
                      : 'まだです'}
              </small>
            </span>
          </li>
        ))}
      </ol>

      {next && (
        <section
          className={`next glass ${next.tone}`}
          aria-label="次にやること"
        >
          <span className="n-icon" aria-hidden="true">
            <next.Icon className="icon lg" />
          </span>
          <b>{next.title}</b>
          <p>{next.text}</p>
          {next.href && (
            <span className="n-action">
              <a className="btn primary" href={next.href}>
                {next.cta}
                <ArrowDown className="icon" aria-hidden="true" />
              </a>
            </span>
          )}
        </section>
      )}

      <div className="order-layout">
        <div className="stack">
          {order.status === 'ordered' && accepted && (
            <section className="agreed glass strong" aria-label="発注の確定">
              <span className="a-head">
                <PackageCheck className="icon lg" aria-hidden="true" />
                双方の合意により発注が確定しました（{order.po_number}）
              </span>
              <span className="amount num">{yen(order.ordered_total)}</span>
              <div className="sign">
                <div>
                  <small>本社の承認</small>
                  <span>
                    本社の承認：{accepted.issued_by_name}（
                    {formatDateTime(accepted.issued_at)}・見積 第
                    {accepted.version}版）
                  </span>
                </div>
                <div>
                  <small>店舗の承諾</small>
                  <span>
                    店舗の承諾：{accepted.responded_by_name}（
                    {formatDateTime(accepted.responded_at)}）
                  </span>
                </div>
              </div>
              {delivered && <span className="meta-line">{delivered}</span>}
            </section>
          )}
          {order.status === 'requested' && order.revision_note && (
            <div className="notice" role="note">
              <PenLine className="icon" aria-hidden="true" />
              <span>
                <b>店舗から見積の修正依頼：</b>
                {order.revision_note}
              </span>
            </div>
          )}

          {current && order.status !== 'requested' && (
            <section
              className="card pad"
              id="quote"
              aria-labelledby="quote-heading"
            >
              <div className="quote-head">
                <h2 id="quote-heading">
                  <FileCheck2 className="icon" aria-hidden="true" />
                  {order.status === 'ordered' ? '発注内容' : '本社からの見積'}
                  （第{current.version}版）
                </h2>
                <span className="meta-line">
                  {current.issued_by_name}が{shortDate(current.issued_at)}
                  に送付・有効期限 {formatDate(current.valid_until)}
                  {expired && (
                    <b style={{ color: 'var(--error)' }}>（期限切れ）</b>
                  )}
                </span>
              </div>
              <QuoteView q={current} order={order} />
              {can(s.role, order.status, 'accept', { ownStore }) && (
                <StoreResponse
                  orderId={order.id}
                  quoteId={current.id}
                  total={current.total}
                  expired={expired}
                />
              )}
            </section>
          )}

          {order.status === 'requested' &&
            can(s.role, order.status, 'cancel', { ownStore }) && (
              <section className="card pad" aria-label="依頼の操作">
                <CancelRequest orderId={order.id} />
              </section>
            )}

          {can(s.role, order.status, 'quote') && (
            <section
              className="card pad"
              id="editor"
              aria-labelledby="editor-heading"
            >
              <h2 id="editor-heading">
                <Send className="icon" aria-hidden="true" />
                {order.status === 'quoted'
                  ? '再見積を送る'
                  : '承認して見積を送る'}
              </h2>
              <p className="sub" style={{ marginTop: -6, marginBottom: 16 }}>
                単価は仕入先の参考価格（税抜）が入っています。送らない商品はチェックを外します。金額と税額はデータベースが計算し、店舗が承諾すると発注が確定します。
              </p>
              <QuoteEditor
                orderId={order.id}
                basedOn={order.quotes[0]?.version ?? null}
                lines={order.lines.map((l) => {
                  const prev = (current ?? firstQuote)?.lines.find(
                    (x) => x.order_line_id === l.id,
                  );
                  return {
                    id: l.id,
                    name: l.name,
                    sku: l.sku,
                    unit: l.unit,
                    taxRate: l.tax_rate,
                    referencePrice: l.unit_price,
                    requestedQty: l.qty,
                    unitPrice: prev?.unit_price ?? l.unit_price,
                    qty: prev?.qty ?? l.qty,
                    included: current || firstQuote ? !!prev : true,
                  };
                })}
                shippingFee={(current ?? firstQuote)?.shipping_fee ?? 0}
                validUntil={addDays(today, DEFAULT_QUOTE_DAYS)}
                today={today}
              />
              {can(s.role, order.status, 'reject') && (
                <RejectForm orderId={order.id} />
              )}
            </section>
          )}

          <section className="card pad" aria-labelledby="request-heading">
            <h2 id="request-heading">
              <ShoppingCart className="icon" aria-hidden="true" />
              店舗からの依頼内容
            </h2>
            <div className="scroll-x">
              <table className="list lines">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th className="num">参考単価（税抜）</th>
                    <th className="num">数量</th>
                    <th className="num">参考金額</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <div className="item-cell">
                          {l.image_id ? (
                            <img
                              className="thumb"
                              src={`/api/catalog/images/${l.image_id}`}
                              alt=""
                              width={48}
                              height={48}
                            />
                          ) : (
                            <span className="thumb" aria-hidden="true" />
                          )}
                          <span>
                            {l.product_url ? (
                              <a
                                href={
                                  localDemoSupplierUrl(l.product_url) ??
                                  undefined
                                }
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {l.name}
                              </a>
                            ) : (
                              l.name
                            )}
                            <span
                              className="meta-line"
                              style={{ display: 'block' }}
                            >
                              {l.sku}
                              {l.tax_rate === 8 ? '・軽減税率8%' : ''}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="num">{yen(l.unit_price)}</td>
                      <td className="num">
                        {l.qty}
                        {l.unit}
                      </td>
                      <td className="num">{yen(l.unit_price * l.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Totals totals={estimate} label="参考の合計（税込）" />
            <dl className="kv section">
              <dt>希望納期</dt>
              <dd>
                {order.needed_by ? formatDate(order.needed_by) : '指定なし'}
              </dd>
              <dt>店舗のメモ</dt>
              <dd>{order.note ?? 'なし'}</dd>
            </dl>
          </section>
        </div>

        <aside className="stack" aria-label="詳細と記録">
          <section className="card pad" aria-labelledby="detail-heading">
            <h2 id="detail-heading">
              <Info className="icon" aria-hidden="true" />
              詳細
            </h2>
            <dl className="kv">
              <dt>依頼番号</dt>
              <dd className="num">{order.request_number}</dd>
              <dt>発注番号</dt>
              <dd className="num">{order.po_number ?? '未確定'}</dd>
              <dt>店舗</dt>
              <dd>{order.store_name}</dd>
              <dt>仕入先</dt>
              <dd>{order.supplier_name}</dd>
              {hq && (
                <>
                  <dt>発注書の送り先</dt>
                  <dd>
                    {order.supplier_order_email ?? '未設定（本社が手配）'}
                  </dd>
                </>
              )}
              <dt>依頼日時</dt>
              <dd>{formatDateTime(order.requested_at)}</dd>
            </dl>
          </section>

          {older.length > 0 && (
            <section className="card pad">
              <details className="history">
                <summary>
                  <History className="icon" aria-hidden="true" />
                  以前の見積（{older.length}件）
                </summary>
                {older.map((q) => (
                  <div key={q.id} className="section">
                    <p style={{ margin: '0 0 8px' }}>
                      <b>第{q.version}版</b>　
                      <span className="num">{yen(q.total)}</span>
                      <span className="meta-line">
                        {q.status === 'declined'
                          ? `修正依頼（${q.responded_by_name}）：${q.response_note}`
                          : q.status === 'superseded'
                            ? '再見積で置き換え'
                            : ''}
                      </span>
                    </p>
                    <QuoteView q={q} order={order} />
                  </div>
                ))}
              </details>
            </section>
          )}

          <section className="card pad" aria-labelledby="log-heading">
            <h2 id="log-heading">
              <History className="icon" aria-hidden="true" />
              記録
            </h2>
            <ul className="timeline">
              {order.audit
                .map((a) => ({ a, text: auditText(a), Icon: auditIcon(a) }))
                .filter((x) => x.text)
                .map(({ a, text, Icon }) => (
                  <li key={a.id}>
                    <span className="t-dot" aria-hidden="true">
                      <Icon className="icon" />
                    </span>
                    <span>
                      {text}
                      <time dateTime={a.at}>
                        {shortDate(a.at)}・{a.actor_name}
                      </time>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}
