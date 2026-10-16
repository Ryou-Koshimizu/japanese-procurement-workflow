import {
  ChevronRight,
  ClipboardList,
  Hourglass,
  Inbox,
  JapaneseYen,
  PackageCheck,
  Plus,
  Sparkles,
} from 'lucide-react';
import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import {
  listOrders,
  orderStats,
  LIST_LIMIT,
  type OrderFilter,
} from '../../src/server/service';
import { isHq, waitingOn } from '../../src/core/workflow';
import { MiniSteps, StatusChip, shortDate, yen } from '../../src/ui/format';

export const dynamic = 'force-dynamic';

const amountLabel = {
  ordered: '確定',
  quote: '見積',
  estimate: '参考',
} as const;
const FILTERS: OrderFilter[] = ['todo', 'open', 'ordered', 'all'];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const s = await pageSession();
  const { deps } = await runtime();
  const hq = isHq(s.role);
  const stats = await orderStats(deps, s);
  const asked = String((await searchParams).tab ?? '');
  const tab: OrderFilter = FILTERS.includes(asked as OrderFilter)
    ? (asked as OrderFilter)
    : stats.todo
      ? 'todo'
      : 'all';
  const rows = await listOrders(deps, s, tab);
  const tabs: { key: OrderFilter; label: string; count: number }[] = [
    { key: 'todo', label: hq ? '見積待ち' : '承諾待ち', count: stats.todo },
    { key: 'open', label: '進行中', count: stats.open },
    { key: 'ordered', label: '発注済み', count: stats.ordered },
    { key: 'all', label: 'すべて', count: stats.all },
  ];
  const shown = tabs.find((t) => t.key === tab)!.count;
  const mine = hq ? 'hq' : 'store';

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ClipboardList className="icon sm" aria-hidden="true" />
            {hq ? '本社' : s.storeName}
          </span>
          <h1>依頼一覧</h1>
          <p className="sub">
            {hq
              ? '店舗からの発注依頼です。内容を確認し、承認して見積を送るか、却下します。'
              : `${s.storeName}の発注依頼です。本社から届いた見積を承諾すると発注が確定します。`}
          </p>
        </div>
        {!hq && (
          <a className="btn primary big" href="/catalog">
            <Plus className="icon" aria-hidden="true" />
            カタログから依頼する
          </a>
        )}
      </div>

      <div className="metrics">
        <div className="glass metric turn">
          <span className="m-icon" aria-hidden="true">
            <Sparkles className="icon" />
          </span>
          <small>{hq ? 'あなたの番：見積待ち' : 'あなたの番：承諾待ち'}</small>
          <b className="num">{stats.todo}件</b>
        </div>
        <div className="glass metric">
          <span className="m-icon" aria-hidden="true">
            <Hourglass className="icon" />
          </span>
          <small>{hq ? '店舗の承諾待ち' : '本社の確認待ち'}</small>
          <b className="num">{stats.waiting}件</b>
        </div>
        <div className="glass metric">
          <span className="m-icon" aria-hidden="true">
            <PackageCheck className="icon" />
          </span>
          <small>今月の発注</small>
          <b className="num">{stats.orderedThisMonth}件</b>
        </div>
        <div className="glass metric">
          <span className="m-icon" aria-hidden="true">
            <JapaneseYen className="icon" />
          </span>
          <small>今月の発注額（税込）</small>
          <b className="num">{yen(stats.orderedThisMonthTotal)}</b>
        </div>
      </div>

      <section className="card" aria-label="依頼">
        <nav className="tabs" aria-label="絞り込み">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/?tab=${t.key}`}
              aria-current={t.key === tab ? 'page' : undefined}
            >
              {t.label}
              <span className="num">{t.count}</span>
            </a>
          ))}
        </nav>
        {rows.length === 0 ? (
          <div className="empty">
            <Inbox className="icon" aria-hidden="true" />
            <b>
              {tab === 'todo'
                ? hq
                  ? '見積を待っている依頼はありません'
                  : '承諾を待っている見積はありません'
                : '該当する依頼はありません'}
            </b>
            {!hq && (
              <a className="btn" href="/catalog">
                カタログを開く
              </a>
            )}
          </div>
        ) : (
          <ul className="order-rows">
            {rows.map((o) => {
              const turn = waitingOn(o.status) === mine;
              return (
                <li key={o.id} className="order-row">
                  <div>
                    <a className="row-link num" href={`/orders/${o.id}`}>
                      {o.po_number ?? o.request_number}
                    </a>
                    <div className="meta-line">
                      {o.po_number ? `${o.request_number}・` : ''}
                      {hq ? `${o.store_name}・` : ''}
                      {o.requested_by_name}・{o.line_count}品目・
                      {shortDate(o.updated_at)}
                    </div>
                  </div>
                  <div className="supplier meta-line">{o.supplier_name}</div>
                  <div
                    className="progress-cell"
                    style={{ display: 'grid', gap: 6 }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <StatusChip status={o.status} />
                      {turn && (
                        <span className="turn-badge">
                          <Sparkles className="icon sm" aria-hidden="true" />
                          あなたの番
                        </span>
                      )}
                    </span>
                    <MiniSteps status={o.status} />
                    {o.status === 'quoted' && o.valid_until && (
                      <span className="meta-line">
                        第{o.quote_version}版・期限{' '}
                        {o.valid_until.slice(5).replace('-', '/')}
                      </span>
                    )}
                  </div>
                  <div className="amount num">
                    {yen(o.amount)}
                    <div className="meta-line" style={{ fontWeight: 600 }}>
                      {amountLabel[o.amount_kind]}・税込
                    </div>
                  </div>
                  <ChevronRight className="icon go" aria-hidden="true" />
                </li>
              );
            })}
          </ul>
        )}
        {shown > rows.length && (
          <p className="meta-line" style={{ padding: '0 24px 16px' }}>
            新しい順に{LIST_LIMIT}件を表示しています（全{shown}件）。
          </p>
        )}
      </section>
    </>
  );
}
