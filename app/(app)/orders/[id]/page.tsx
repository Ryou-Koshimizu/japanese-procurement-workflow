import { notFound } from 'next/navigation';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import {
  getOrder,
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
                <td>
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
                <td className="num">{yen(l.amount)}</td>
              </tr>
            ))}
            {excluded.map((l) => (
              <tr key={l.id} className="excluded">
                <td>
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
          本社からのメモ：{q.note}
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
  const requestedAudit = order.audit.find(
    (a) => a.action === 'status:requested',
  );
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
      title: '本社が承認して見積を送付',
      who: current ? `${current.issued_by_name}・第${current.version}版` : null,
      at: current?.issued_at ?? null,
      done: !!current && order.status !== 'requested',
      stopped: order.status === 'rejected',
    },
    {
      title: '店舗が見積を承諾',
      who: accepted ? accepted.responded_by_name : null,
      at: accepted?.responded_at ?? null,
      done: !!accepted,
      stopped: order.status === 'cancelled',
    },
    {
      title: '発注確定・金額を双方へ通知',
      who: order.po_number,
      at: order.ordered_at,
      done: order.status === 'ordered',
    },
  ];
  const currentStep = steps.findIndex((x) => !x.done);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="meta-line" style={{ margin: 0 }}>
            <a href="/">依頼一覧</a> / {order.store_name}
          </p>
          <h1
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {order.po_number ?? order.request_number}
            <StatusChip status={order.status} />
          </h1>
          <p className="sub">
            {order.po_number ? `依頼番号 ${order.request_number}・` : ''}
            仕入先 {order.supplier_name}・依頼者 {order.requested_by_name}（
            {shortDate(order.requested_at)}）
          </p>
        </div>
      </div>

      <div className="order-layout">
        <div className="stack">
          {order.status === 'ordered' && accepted && (
            <section className="agreed" aria-label="発注の確定">
              <b>双方の合意により発注が確定しました（{order.po_number}）</b>
              <span className="amount num">{yen(order.ordered_total)}</span>
              <span className="meta-line" style={{ color: 'var(--success)' }}>
                本社の承認：{accepted.issued_by_name}（
                {formatDateTime(accepted.issued_at)}・見積 第{accepted.version}
                版）／ 店舗の承諾：{accepted.responded_by_name}（
                {formatDateTime(accepted.responded_at)}）
              </span>
              {delivered && <span>{delivered}</span>}
            </section>
          )}
          {order.status === 'rejected' && (
            <div className="alert" role="note">
              本社が却下しました：{order.reject_reason}
            </div>
          )}
          {order.status === 'cancelled' && (
            <div className="notice" role="note">
              店舗が依頼を取り下げました
              {order.cancel_reason ? `：${order.cancel_reason}` : '。'}
            </div>
          )}
          {order.status === 'requested' && order.revision_note && (
            <div className="notice" role="note">
              <b>店舗から見積の修正依頼：</b>
              {order.revision_note}
            </div>
          )}

          {current && order.status !== 'requested' && (
            <section className="card pad" aria-labelledby="quote-heading">
              <div className="quote-head">
                <h2 id="quote-heading" style={{ margin: 0 }}>
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
              {hq && order.status === 'quoted' && (
                <p className="meta-line" style={{ marginTop: 14 }}>
                  店舗の承諾を待っています。内容を変える場合は、下の「再見積」で新しい版を送ると、この版は無効になります。
                </p>
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
            <section className="card pad" aria-labelledby="editor-heading">
              <h2 id="editor-heading">
                {order.status === 'quoted'
                  ? '再見積を送る'
                  : '承認して見積を送る'}
              </h2>
              <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
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
            <h2 id="request-heading">店舗からの依頼内容</h2>
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
                              width={44}
                              height={44}
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

        <aside className="stack" aria-label="進み具合と記録">
          <section className="card pad" aria-labelledby="steps-heading">
            <h2 id="steps-heading">合意までの流れ</h2>
            <ol className="steps">
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
                  aria-current={
                    i === currentStep && !st.stopped ? 'step' : undefined
                  }
                >
                  <span className="dot" aria-hidden="true">
                    {st.stopped ? '×' : st.done ? '✓' : i + 1}
                  </span>
                  <span>
                    <b>{st.title}</b>
                    {st.stopped ? (
                      <small>
                        {order.status === 'rejected'
                          ? '本社が却下しました'
                          : '店舗が取り下げました'}
                      </small>
                    ) : st.done || st.who ? (
                      <small>
                        {st.who}
                        {st.at ? `・${shortDate(st.at)}` : ''}
                      </small>
                    ) : (
                      <small>
                        {i === currentStep
                          ? i === 1
                            ? '本社の確認待ち'
                            : i === 2
                              ? '店舗の承諾待ち'
                              : ''
                          : 'まだです'}
                      </small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="card pad" aria-labelledby="detail-heading">
            <h2 id="detail-heading">詳細</h2>
            <dl className="kv">
              <dt>依頼番号</dt>
              <dd>{order.request_number}</dd>
              <dt>発注番号</dt>
              <dd>{order.po_number ?? '未確定'}</dd>
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
              <dd>
                {formatDateTime(requestedAudit?.at ?? order.requested_at)}
              </dd>
            </dl>
          </section>

          {older.length > 0 && (
            <section className="card pad">
              <details className="history">
                <summary>以前の見積（{older.length}件）</summary>
                {older.map((q) => (
                  <div key={q.id} className="section">
                    <p style={{ margin: '0 0 8px' }}>
                      <b>第{q.version}版</b>　{yen(q.total)}　
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
            <h2 id="log-heading">記録</h2>
            <ul className="timeline">
              {order.audit
                .map((a) => ({ a, text: auditText(a) }))
                .filter((x) => x.text)
                .map(({ a, text }) => (
                  <li key={a.id}>
                    <time dateTime={a.at}>{shortDate(a.at)}</time>
                    <span>
                      {text}
                      <span className="meta-line" style={{ display: 'block' }}>
                        {a.actor_name}
                      </span>
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
