import { notFound } from 'next/navigation';
import {
  ArrowDown,
  Ban,
  Bell,
  CalendarCheck,
  ClipboardList,
  Factory,
  FileCheck2,
  History,
  Hourglass,
  Info,
  ListChecks,
  MessagesSquare,
  PenLine,
  Sparkles,
  Truck,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import {
  getOrder,
  listCatalog,
  listMakers,
  type AuditEntry,
  type OrderDetail,
  type Quote,
} from '../../../../src/server/service';
import { AppError } from '../../../../src/server/db';
import { addDays, todayInJapan } from '../../../../src/server/config';
import {
  can,
  DEFAULT_QUOTE_DAYS,
  deliveryModeLabels,
  isAgent,
  makerQuoteStatusLabels,
  PROGRESS_STEPS,
  progressIndex,
  statusLabels,
  stockLabels,
} from '../../../../src/core/workflow';
import type { NotificationEvent } from '../../../../src/core/notification';
import { safeHttpUrl } from '../../../../src/core/intake';
import { auditText } from '../../../../src/ui/audit';
import {
  ScrollX,
  StatusChip,
  formatDate,
  formatDateTime,
  shortDate,
  yen,
} from '../../../../src/ui/format';
import Totals from '../../totals';
import {
  CancelRequest,
  ClientQuoteResponse,
  MakerQuoteActions,
  MakerRequest,
  MessageForm,
  OutlineEditor,
  OutlineReopen,
  PlaceOrderForm,
  QuoteBuilder,
  RejectForm,
  ScheduleForm,
} from './actions';

export const dynamic = 'force-dynamic';

const eventLabel: Record<NotificationEvent, string> = {
  requested: '新しい依頼',
  question: 'B社からの質問',
  answered: '質問への回答',
  rfq: 'メーカーへの見積依頼',
  quoted: '見積書',
  revision: '見積書の修正依頼',
  agreed: '合意',
  ordered: 'メーカーへの発注書',
  scheduled: '納期のお知らせ',
  rejected: 'お断り',
  cancelled: '取り下げ',
};
const audienceLabel = {
  client: 'A社',
  agent: 'B社',
  maker: 'メーカー',
} as const;

function QuoteView({ q }: { q: Quote }) {
  return (
    <>
      <ScrollX label={`見積書 第${q.version}版の明細`}>
        <table className="list lines">
          <thead>
            <tr>
              <th>品名</th>
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
                    {l.spec}
                    {l.tax_rate === 8 ? '・軽減税率8%' : ''}
                  </span>
                </td>
                <td className="num">{yen(l.unit_price)}</td>
                <td className="num">
                  {l.qty}
                  {l.unit}
                </td>
                <td className="num">
                  <b>{yen(l.amount)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <Totals
        totals={{
          subtotal10: q.subtotal_10,
          tax10: q.tax_10,
          subtotal8: q.subtotal_8,
          tax8: q.tax_8,
          total: q.total,
        }}
        shippingFee={q.shipping_fee}
        expenses={q.expenses}
      />
      {q.note && (
        <p className="notice" style={{ marginTop: 14 }}>
          <Info className="icon" aria-hidden="true" />
          <span>B社からのメモ：{q.note}</span>
        </p>
      )}
    </>
  );
}

const auditIcon = (a: AuditEntry): LucideIcon =>
  a.action.startsWith('message:')
    ? MessagesSquare
    : a.action.startsWith('maker_quote:')
      ? Factory
      : a.action.startsWith('quote:')
        ? FileCheck2
        : a.action === 'status:ordered'
          ? Truck
          : a.action === 'status:scheduled'
            ? CalendarCheck
            : a.action === 'status:rejected'
              ? Ban
              : a.action === 'status:cancelled'
                ? Undo2
                : History;

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await pageSession();
  const { deps } = await runtime();
  const { id } = await params;
  let order: OrderDetail;
  try {
    order = await getOrder(deps, s, id);
  } catch (e) {
    if (e instanceof AppError && (e.status === 404 || e.status === 403))
      notFound();
    throw e;
  }
  const agent = isAgent(s.role);
  const ownStore = s.role === 'client' && s.storeId === order.store_id;
  const st = order.status;
  const may = (action: Parameters<typeof can>[2]) =>
    can(s.role, st, action, { ownStore });
  const today = todayInJapan();
  const defaultValid = addDays(today, DEFAULT_QUOTE_DAYS);

  // B社's working data; A社 never needs (or gets) these.
  const makers = agent ? await listMakers(deps, s) : [];
  const catalog =
    agent && may('editOutline') ? (await listCatalog(deps, s)).items : [];

  const current =
    order.quotes.find((q) => q.id === order.current_quote_id) ?? null;
  const accepted = order.quotes.find((q) => q.status === 'accepted') ?? null;
  const older = order.quotes.filter((q) => q.id !== current?.id);
  const expired = current?.status === 'sent' && current.valid_until < today;
  const received = order.makerQuotes.filter((m) => m.status === 'received');
  const cheapestId = [...received].sort(
    (x, y) => (x.cost_subtotal ?? 0) - (y.cost_subtotal ?? 0),
  )[0]?.id;
  const currentCost =
    order.quoteCosts.find((c) => c.quote_id === order.current_quote_id) ?? null;
  const adopted = currentCost
    ? (order.makerQuotes.find((m) => m.id === currentCost.maker_quote_id) ??
      null)
    : null;
  const questions = order.messages.filter((m) => m.kind !== 'note');
  const notes = order.messages.filter((m) => m.kind === 'note');

  // Progress: 依頼 → ヒアリング → メーカー確認 → 見積書 → 合意 → 発注 → 納期確定.
  const stopped = st === 'rejected' || st === 'cancelled';
  const at = stopped
    ? order.quotes.length
      ? 3
      : order.lines.length
        ? 2
        : 1
    : progressIndex(st);
  const finished = st === 'scheduled';

  // What this person should do next, said once.
  type Next = {
    tone: 'act' | 'wait' | 'done' | 'stop';
    Icon: LucideIcon;
    title: string;
    text: string;
    href?: string;
    cta?: string;
  };
  const wait = (title: string, text: string): Next => ({
    tone: 'wait',
    Icon: Hourglass,
    title,
    text,
  });
  const next: Next | null = (() => {
    switch (st) {
      case 'requested':
        return agent
          ? {
              tone: 'act',
              Icon: Sparkles,
              title: 'あなたの番：依頼を確認して商品概要を決めてください',
              text: order.lines.length
                ? '商品概要の下書きがあります。確定するとメーカーに見積を頼めます。'
                : 'わからない点はA社に質問できます。決まったら品名・仕様・数量を書いて確定します。',
              href: '#outline',
              cta: '商品概要へ',
            }
          : wait(
              'B社が依頼を確認しています',
              '質問や見積書が届いたら「通知」でお知らせします。',
            );
      case 'hearing':
        return ownStore
          ? {
              tone: 'act',
              Icon: Sparkles,
              title: 'あなたの番：B社からの質問に答えてください',
              text: '回答を送ると、B社が確認を続けます。',
              href: '#hearing',
              cta: '質問に答える',
            }
          : wait(
              'A社の回答を待っています',
              '回答が届くと「通知」でお知らせします。',
            );
      case 'sourcing':
        return agent
          ? {
              tone: 'act',
              Icon: Sparkles,
              title: order.revision_note
                ? 'あなたの番：A社から見積書の修正依頼が届いています'
                : 'あなたの番：メーカーの見積を集めて見積書を送ってください',
              text: order.revision_note
                ? `修正してほしい内容：${order.revision_note}`
                : received.length
                  ? `受け取った見積 ${received.length}件。1つを選んで利益を載せ、見積書をA社に送ります。`
                  : 'メーカーに見積を依頼し、届いた原価・在庫・納期を入力します。',
              href: received.length ? '#quote' : '#makers',
              cta: received.length ? '見積書を作る' : 'メーカーに見積を依頼',
            }
          : wait(
              'B社がメーカーに確認しています',
              '見積書が届いたら「通知」でお知らせします。',
            );
      case 'quoted':
        return ownStore
          ? {
              tone: 'act',
              Icon: Sparkles,
              title: 'あなたの番：見積書を確認してください',
              text: expired
                ? '有効期限が切れています。修正を頼んで、新しい見積書を受け取ってください。'
                : `合意すると合計 ${yen(current?.total)}（税込）でB社がメーカーに発注します。`,
              href: '#quote',
              cta: '見積書を見る',
            }
          : wait(
              'A社の合意を待っています',
              '内容を変えるときは、新しい見積書を送ると今の版は使えなくなります。',
            );
      case 'agreed':
        return agent
          ? {
              tone: 'act',
              Icon: Sparkles,
              title: 'あなたの番：メーカーに発注してください',
              text: `A社が合計 ${yen(order.agreed_total)}（税込）で合意しました。届き方を選んで発注します。`,
              href: '#order',
              cta: '発注へ',
            }
          : wait(
              'B社がメーカーに発注します',
              '納期が決まったら「通知」でお知らせします。',
            );
      case 'ordered':
        return agent
          ? {
              tone: 'act',
              Icon: Sparkles,
              title: 'あなたの番：納期を確定してA社に知らせてください',
              text: `発注済み（${order.po_number}）。メーカーに確認した納期を入れると、A社に「納期のお知らせ」が届きます。`,
              href: '#delivery',
              cta: '納期を入れる',
            }
          : wait(
              'B社がメーカーに納期を確認しています',
              '納期が決まったら「通知」でお知らせします。',
            );
      case 'scheduled':
        return {
          tone: 'done',
          Icon: CalendarCheck,
          title: `納期が決まりました：${formatDate(order.delivery_date)}`,
          text: `${order.delivery_mode ? deliveryModeLabels[order.delivery_mode] : ''}で届きます。お知らせの内容は下にあります。`,
          href: '#delivery',
          cta: 'お知らせを見る',
        };
      case 'rejected':
        return {
          tone: 'stop',
          Icon: Ban,
          title: 'B社がお断りしました',
          text: order.reject_reason ?? '',
        };
      case 'cancelled':
        return {
          tone: 'stop',
          Icon: Undo2,
          title: 'A社が依頼を取り下げました',
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
            <a href={agent ? '/orders' : '/'}>
              {agent ? '依頼' : 'ホーム'}
            </a> / {order.client_name} {order.store_name}
          </span>
          <h1
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>{order.title}</span>
            <StatusChip status={st} />
          </h1>
          <p className="sub num">
            {order.request_number}
            {order.po_number
              ? `・発注番号 ${order.po_number}`
              : ''}・依頼者 {order.requested_by_name}（
            {shortDate(order.requested_at)}）
          </p>
        </div>
      </div>

      <ol
        className="progress glass clear"
        aria-label="依頼から納期確定までの流れ"
      >
        {PROGRESS_STEPS.map((step, i) => {
          const done = finished || i < at;
          const isNow = !finished && i === at;
          return (
            <li
              key={step}
              className={
                isNow && stopped
                  ? 'stopped'
                  : done
                    ? 'done'
                    : isNow
                      ? 'current'
                      : ''
              }
              aria-current={isNow && !stopped ? 'step' : undefined}
            >
              <span className="dot" aria-hidden="true">
                {isNow && stopped ? '×' : done ? '✓' : i + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <b>{step}</b>
                <small>
                  {done ? '済み' : isNow ? statusLabels[st] : 'まだです'}
                </small>
              </span>
            </li>
          );
        })}
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
          <section className="card pad" aria-labelledby="request-heading">
            <h2 id="request-heading">
              <ClipboardList className="icon" aria-hidden="true" />
              依頼内容
            </h2>
            <dl className="kv answers">
              {order.answers.map((a) => (
                <div key={a.key} style={{ display: 'contents' }}>
                  <dt>{a.label}</dt>
                  <dd>
                    {a.kind === 'number' ? (
                      Number(a.value).toLocaleString('ja-JP')
                    ) : a.kind === 'url' && safeHttpUrl(String(a.value)) ? (
                      <a
                        href={safeHttpUrl(String(a.value))!}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {String(a.value)}
                      </a>
                    ) : (
                      String(a.value)
                    )}
                  </dd>
                </div>
              ))}
              <dt>いつまでに</dt>
              <dd>
                {order.needed_by ? formatDate(order.needed_by) : '指定なし'}
              </dd>
              <dt>B社へのメモ</dt>
              <dd>{order.note ?? 'なし'}</dd>
            </dl>
          </section>

          {(questions.length > 0 ||
            notes.length > 0 ||
            may('ask') ||
            may('answer') ||
            may('note')) && (
            <section
              className="card pad"
              id="hearing"
              aria-labelledby="hearing-heading"
            >
              <h2 id="hearing-heading">
                <MessagesSquare className="icon" aria-hidden="true" />
                ヒアリング
              </h2>
              {order.messages.length > 0 && (
                <ul className="thread">
                  {order.messages.map((m) => (
                    <li key={m.id} className={`msg ${m.kind}`}>
                      <span className="meta-line">
                        {m.kind === 'question'
                          ? 'B社の質問'
                          : m.kind === 'answer'
                            ? 'A社の回答'
                            : 'B社メモ'}
                        ・{m.author_name}・{shortDate(m.created_at)}
                        {m.kind === 'note' && (
                          <span className="agent-only">
                            　B社だけに見えます
                          </span>
                        )}
                      </span>
                      <p>{m.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="stack" style={{ gap: 16 }}>
                {may('answer') && (
                  <MessageForm
                    orderId={order.id}
                    kind="answer"
                    label="回答（B社に届きます）"
                    button="回答を送る"
                  />
                )}
                {may('ask') && (
                  <MessageForm
                    orderId={order.id}
                    kind="question"
                    label="A社への質問（送るとA社の回答待ちになります）"
                    button="質問を送る"
                    placeholder="例：置く場所の幅は何cmまでですか？"
                  />
                )}
                {may('note') && (
                  <MessageForm
                    orderId={order.id}
                    kind="note"
                    label="B社メモ（B社だけに見えます。電話で聞いたことなど）"
                    button="メモを残す"
                  />
                )}
              </div>
            </section>
          )}

          {(agent || order.lines.length > 0) && (
            <section
              className="card pad"
              id="outline"
              aria-labelledby="outline-heading"
            >
              <h2 id="outline-heading">
                <ListChecks className="icon" aria-hidden="true" />
                商品概要
              </h2>
              {may('editOutline') ? (
                <>
                  <p className="sub" style={{ marginTop: -6 }}>
                    メーカーに見積を頼む内容です。確定するとA社にも見えるようになります。
                  </p>
                  <OutlineEditor
                    orderId={order.id}
                    lines={order.lines}
                    catalog={catalog.map((i) => ({
                      id: i.id,
                      source_id: i.source_id,
                      name: i.name,
                      sku: i.sku,
                      unit: i.unit,
                      tax_rate: i.tax_rate,
                    }))}
                    makers={makers
                      .filter((m) => m.active && m.catalog_source_id)
                      .map((m) => ({
                        name: m.name,
                        source_id: m.catalog_source_id!,
                      }))}
                  />
                </>
              ) : order.lines.length ? (
                <>
                  <ScrollX label="商品概要">
                    <table className="list lines">
                      <thead>
                        <tr>
                          <th>品名</th>
                          <th>仕様</th>
                          <th className="num">数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="name">
                              {l.name}
                              {l.tax_rate === 8 && (
                                <span
                                  className="meta-line"
                                  style={{ display: 'block' }}
                                >
                                  軽減税率8%
                                </span>
                              )}
                            </td>
                            <td>{l.spec || '—'}</td>
                            <td className="num">
                              {l.qty}
                              {l.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollX>
                  {may('reopenOutline') && (
                    <div className="actions section">
                      <OutlineReopen orderId={order.id} />
                    </div>
                  )}
                </>
              ) : (
                <p className="meta-line">まだ商品概要はありません。</p>
              )}
            </section>
          )}

          {agent &&
            (order.makerQuotes.length > 0 || may('requestMakerQuote')) && (
              <section
                className="card pad"
                id="makers"
                aria-labelledby="makers-heading"
              >
                <h2 id="makers-heading">
                  <Factory className="icon" aria-hidden="true" />
                  メーカーの見積
                  <span className="agent-only">B社だけに見えます</span>
                </h2>
                {may('requestMakerQuote') && (
                  <div style={{ marginBottom: 18 }}>
                    <MakerRequest
                      orderId={order.id}
                      makers={makers
                        .filter((m) => m.active)
                        .map((m) => ({
                          id: m.id,
                          name: m.name,
                          busy: order.makerQuotes.some(
                            (q) =>
                              q.maker_id === m.id &&
                              (q.status === 'requested' ||
                                q.status === 'received'),
                          ),
                        }))}
                    />
                  </div>
                )}
                {received.length > 0 && (
                  <ScrollX
                    label="受け取った見積の比較"
                    style={{ marginBottom: 18 }}
                  >
                    <table className="list">
                      <caption className="sr-only">
                        受け取った見積の比較
                      </caption>
                      <thead>
                        <tr>
                          <th>メーカー</th>
                          <th className="num">原価計（送料込・税抜）</th>
                          <th>納期の目安</th>
                          <th>在庫</th>
                          <th>有効期限</th>
                        </tr>
                      </thead>
                      <tbody>
                        {received.map((m) => (
                          <tr key={m.id}>
                            <td>
                              {m.maker_name}
                              {m.id === cheapestId && received.length > 1 && (
                                <span className="cheapest">　最安</span>
                              )}
                            </td>
                            <td className="num">{yen(m.cost_subtotal)}</td>
                            <td>{m.lead_time ?? '—'}</td>
                            <td>
                              {[
                                ...new Set(
                                  m.lines.map((l) => stockLabels[l.stock]),
                                ),
                              ].join('・')}
                            </td>
                            <td>{formatDate(m.valid_until)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollX>
                )}
                <div className="mq-cards">
                  {order.makerQuotes.map((m) => (
                    <article key={m.id} className="mq">
                      <h3>{m.maker_name}</h3>
                      <span className="meta-line">
                        {makerQuoteStatusLabels[m.status]}・依頼{' '}
                        {shortDate(m.requested_at)}
                        {m.answered_at
                          ? `・回答 ${shortDate(m.answered_at)}`
                          : ''}
                      </span>
                      {m.status === 'received' && (
                        <dl className="kv num" style={{ margin: 0 }}>
                          {m.lines.map((l) => {
                            const line = order.lines.find(
                              (x) => x.id === l.order_line_id,
                            );
                            return (
                              <div
                                key={l.order_line_id}
                                style={{ display: 'contents' }}
                              >
                                <dt>{line?.name ?? '—'}</dt>
                                <dd>
                                  {yen(l.unit_cost)} × {line?.qty}
                                  {line?.unit}（{stockLabels[l.stock]}）
                                </dd>
                              </div>
                            );
                          })}
                          <dt>送料</dt>
                          <dd>{yen(m.shipping_cost)}</dd>
                          <dt>原価計</dt>
                          <dd>
                            <b>{yen(m.cost_subtotal)}</b>
                          </dd>
                        </dl>
                      )}
                      {m.note && (
                        <span className="meta-line">メモ：{m.note}</span>
                      )}
                      {(m.status === 'requested' || m.status === 'received') &&
                        (st === 'sourcing' || st === 'quoted') &&
                        adopted?.id !== m.id && (
                          <MakerQuoteActions
                            makerQuoteId={m.id}
                            makerName={m.maker_name}
                            lines={order.lines.map((l) => ({
                              id: l.id,
                              name: l.name,
                              qty: l.qty,
                              unit: l.unit,
                            }))}
                            today={today}
                            defaultValid={addDays(today, 30)}
                            canRecord={m.status === 'requested'}
                          />
                        )}
                    </article>
                  ))}
                </div>
              </section>
            )}

          {(order.quotes.length > 0 || may('issueQuote')) && (
            <section
              className="card pad"
              id="quote"
              aria-labelledby="quote-heading"
            >
              <h2 id="quote-heading">
                <FileCheck2 className="icon" aria-hidden="true" />
                見積書
              </h2>
              {st === 'sourcing' && order.revision_note && (
                <div
                  className="notice"
                  role="note"
                  style={{ marginBottom: 14 }}
                >
                  <PenLine className="icon" aria-hidden="true" />
                  <span>
                    <b>A社からの修正依頼：</b>
                    {order.revision_note}
                  </span>
                </div>
              )}
              {current && (
                <>
                  <div className="quote-head">
                    <b>第{current.version}版</b>
                    <span className="meta-line">
                      {current.issued_by_name}が{shortDate(current.issued_at)}
                      に送付・有効期限 {formatDate(current.valid_until)}
                      {expired && (
                        <b style={{ color: 'var(--error)' }}>（期限切れ）</b>
                      )}
                      {current.status === 'accepted' &&
                        `・${current.responded_by_name}が${shortDate(current.responded_at)}に合意`}
                      {current.status === 'declined' &&
                        `・${current.responded_by_name}が修正を依頼`}
                    </span>
                  </div>
                  <QuoteView q={current} />
                  {currentCost && (
                    <div className="agent-box" style={{ marginTop: 14 }}>
                      <span className="agent-only">B社だけに見えます</span>
                      <dl className="kv num" style={{ margin: 0 }}>
                        <dt>もとにした見積</dt>
                        <dd>{adopted?.maker_name ?? '—'}</dd>
                        <dt>利益の載せ方</dt>
                        <dd>
                          {currentCost.pricing_mode === 'markup'
                            ? `原価に${(currentCost.markup_bp ?? 0) / 100}%`
                            : '売値を入力'}
                        </dd>
                        <dt>原価計・売上計（税抜）</dt>
                        <dd>
                          {yen(currentCost.cost_subtotal)}・
                          {yen(currentCost.sales_subtotal)}
                        </dd>
                        <dt>利益</dt>
                        <dd>
                          {yen(currentCost.profit)}
                          {currentCost.sales_subtotal > 0 &&
                            `（売上の${((currentCost.profit / currentCost.sales_subtotal) * 100).toFixed(1)}%）`}
                        </dd>
                      </dl>
                    </div>
                  )}
                  {may('accept') && current.status === 'sent' && (
                    <ClientQuoteResponse
                      orderId={order.id}
                      quoteId={current.id}
                      total={current.total}
                      expired={expired}
                    />
                  )}
                </>
              )}
              {may('issueQuote') && (
                <div className={current ? 'section' : undefined}>
                  <h3 style={{ marginTop: 0 }}>
                    {order.quotes.length
                      ? '新しい見積書を作る'
                      : '見積書を作る'}
                  </h3>
                  <QuoteBuilder
                    orderId={order.id}
                    lines={order.lines}
                    makerQuotes={received.map((m) => ({
                      id: m.id,
                      maker_name: m.maker_name,
                      shipping_cost: m.shipping_cost,
                      cost_subtotal: m.cost_subtotal ?? 0,
                      lead_time: m.lead_time,
                      costs: Object.fromEntries(
                        m.lines.map((l) => [l.order_line_id, l.unit_cost]),
                      ),
                    }))}
                    initial={
                      currentCost &&
                      received.some((m) => m.id === currentCost.maker_quote_id)
                        ? {
                            maker_quote_id: currentCost.maker_quote_id,
                            mode: currentCost.pricing_mode,
                            markup_bp: currentCost.markup_bp,
                            prices: Object.fromEntries(
                              currentCost.lines.map((l) => [
                                l.order_line_id,
                                l.unit_price,
                              ]),
                            ),
                            shipping_fee: current?.shipping_fee ?? 0,
                            expenses: current?.expenses ?? 0,
                          }
                        : null
                    }
                    today={today}
                    defaultValid={defaultValid}
                    requote={order.quotes.length > 0}
                  />
                </div>
              )}
            </section>
          )}

          {(may('placeOrder') || order.po_number) && (
            <section
              className="card pad"
              id="order"
              aria-labelledby="order-heading"
            >
              <h2 id="order-heading">
                <Truck className="icon" aria-hidden="true" />
                発注
              </h2>
              {may('placeOrder') ? (
                <PlaceOrderForm
                  orderId={order.id}
                  destinations={order.destinations}
                  makerName={adopted?.maker_name ?? null}
                />
              ) : (
                <dl className="kv">
                  <dt>発注番号</dt>
                  <dd className="num">{order.po_number}</dd>
                  <dt>発注日時</dt>
                  <dd>{formatDateTime(order.ordered_at)}</dd>
                  {agent && adopted && (
                    <>
                      <dt>メーカー</dt>
                      <dd>
                        {adopted.maker_name}
                        <span className="agent-only">　B社だけに見えます</span>
                      </dd>
                    </>
                  )}
                  <dt>届き方</dt>
                  <dd>
                    {order.delivery_mode
                      ? deliveryModeLabels[order.delivery_mode]
                      : '—'}
                  </dd>
                  <dt>届け先</dt>
                  <dd>
                    {order.delivery_mode
                      ? order.destinations[order.delivery_mode]
                      : '—'}
                  </dd>
                  <dt>B社の担当</dt>
                  <dd>
                    {order.assigned_name}（{order.assigned_email}）
                  </dd>
                  {order.delivery_note && (
                    <>
                      <dt>発注メモ</dt>
                      <dd>{order.delivery_note}</dd>
                    </>
                  )}
                </dl>
              )}
            </section>
          )}

          {(may('schedule') || order.notice) && (
            <section
              className="card pad"
              id="delivery"
              aria-labelledby="delivery-heading"
            >
              <h2 id="delivery-heading">
                <CalendarCheck className="icon" aria-hidden="true" />
                納期
              </h2>
              {may('schedule') && (
                <ScheduleForm orderId={order.id} today={today} />
              )}
              {order.notice && (
                <div
                  className="notice-mail"
                  style={{ display: 'grid', gap: 10 }}
                >
                  <p className="meta-line" style={{ margin: 0 }}>
                    <Bell className="icon sm" aria-hidden="true" />{' '}
                    A社に送ったお知らせ（
                    {formatDateTime(order.scheduled_at)}）
                  </p>
                  <b>{order.notice.subject}</b>
                  <pre>{order.notice.body}</pre>
                </div>
              )}
            </section>
          )}

          {(may('reject') || (may('cancel') && st !== 'quoted')) && (
            <section className="card pad" aria-label="依頼の操作">
              <div className="actions">
                {may('reject') && <RejectForm orderId={order.id} />}
                {may('cancel') && st !== 'quoted' && (
                  <CancelRequest orderId={order.id} />
                )}
              </div>
            </section>
          )}
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
              <dd className="num">{order.po_number ?? 'まだです'}</dd>
              <dt>依頼元</dt>
              <dd>
                {order.client_name} {order.store_name}
              </dd>
              <dt>依頼者</dt>
              <dd>{order.requested_by_name}</dd>
              <dt>依頼日時</dt>
              <dd>{formatDateTime(order.requested_at)}</dd>
              {order.agreed_total !== null && (
                <>
                  <dt>合意額（税込）</dt>
                  <dd className="num">{yen(order.agreed_total)}</dd>
                </>
              )}
              {order.delivery_date && (
                <>
                  <dt>納期</dt>
                  <dd>{formatDate(order.delivery_date)}</dd>
                </>
              )}
            </dl>
          </section>

          {older.length > 0 && (
            <section className="card pad">
              <details className="history">
                <summary>
                  <History className="icon" aria-hidden="true" />
                  以前の見積書（{older.length}件）
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
                            ? '新しい版で置き換え'
                            : ''}
                      </span>
                    </p>
                    <QuoteView q={q} />
                  </div>
                ))}
              </details>
            </section>
          )}

          {order.deliveries.length > 0 && (
            <section className="card pad" aria-labelledby="mail-heading">
              <h2 id="mail-heading">
                <Bell className="icon" aria-hidden="true" />
                通知の記録
              </h2>
              <ul className="timeline">
                {order.deliveries.map((d) => (
                  <li key={`${d.event}-${d.audience}`}>
                    <span className="t-dot" aria-hidden="true">
                      <Bell className="icon" />
                    </span>
                    <span>
                      {eventLabel[d.event]} → {audienceLabel[d.audience]}{' '}
                      {d.recipients}
                      {d.audience === 'maker' ? '件' : '名'}
                      {d.delivered === d.recipients ? '' : '（送信待ちあり）'}
                      <time dateTime={d.latest}>{shortDate(d.latest)}</time>
                    </span>
                  </li>
                ))}
              </ul>
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
