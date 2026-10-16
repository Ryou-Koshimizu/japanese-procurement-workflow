import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { listOrders, type OrderFilter } from '../../src/server/service';
import { isHq } from '../../src/core/workflow';
import { todayInJapan } from '../../src/server/config';
import { StatusChip, shortDate, yen } from '../../src/ui/format';

export const dynamic = 'force-dynamic';

const amountLabel = {
  ordered: '確定',
  quote: '見積',
  estimate: '参考',
} as const;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const s = await pageSession();
  const { deps } = await runtime();
  const hq = isHq(s.role);
  const all = await listOrders(deps, s, 'all');
  const month = todayInJapan().slice(0, 7);
  const todo = all.filter((o) => o.status === (hq ? 'requested' : 'quoted'));
  const waiting = all.filter((o) => o.status === (hq ? 'quoted' : 'requested'));
  const orderedThisMonth = all.filter(
    (o) =>
      o.status === 'ordered' &&
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })
        .format(new Date(o.updated_at))
        .startsWith(month),
  );
  const tab = (
    ['todo', 'open', 'ordered', 'all'].includes(
      String((await searchParams).tab),
    )
      ? (await searchParams).tab
      : todo.length
        ? 'todo'
        : 'all'
  ) as OrderFilter;
  const rows = {
    todo,
    open: all.filter((o) => o.status === 'requested' || o.status === 'quoted'),
    ordered: all.filter((o) => o.status === 'ordered'),
    all,
  }[tab];
  const tabs: { key: OrderFilter; label: string; count: number }[] = [
    { key: 'todo', label: hq ? '見積待ち' : '承諾待ち', count: todo.length },
    {
      key: 'open',
      label: '進行中',
      count: all.filter(
        (o) => o.status === 'requested' || o.status === 'quoted',
      ).length,
    },
    {
      key: 'ordered',
      label: '発注済み',
      count: all.filter((o) => o.status === 'ordered').length,
    },
    { key: 'all', label: 'すべて', count: all.length },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>依頼一覧</h1>
          <p className="sub">
            {hq
              ? '店舗からの発注依頼です。内容を確認し、承認して見積を送るか、却下します。'
              : `${s.storeName}の発注依頼です。本社から届いた見積を承諾すると発注が確定します。`}
          </p>
        </div>
        {!hq && (
          <a className="btn primary" href="/catalog">
            カタログから依頼する
          </a>
        )}
      </div>

      <div className="metrics">
        <div className="card metric">
          <small>{hq ? 'あなたの番：見積待ち' : 'あなたの番：承諾待ち'}</small>
          <b className="num">{todo.length}件</b>
        </div>
        <div className="card metric">
          <small>{hq ? '店舗の承諾待ち' : '本社の確認待ち'}</small>
          <b className="num">{waiting.length}件</b>
        </div>
        <div className="card metric">
          <small>今月の発注</small>
          <b className="num">{orderedThisMonth.length}件</b>
        </div>
        <div className="card metric">
          <small>今月の発注額（税込）</small>
          <b className="num">
            {yen(orderedThisMonth.reduce((sum, o) => sum + o.amount, 0))}
          </b>
        </div>
      </div>

      <div className="card">
        <nav className="tabs" aria-label="絞り込み">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/?tab=${t.key}`}
              aria-current={t.key === tab ? 'page' : undefined}
            >
              {t.label}
              <span>{t.count}</span>
            </a>
          ))}
        </nav>
        {rows.length === 0 ? (
          <div className="empty">
            {tab === 'todo'
              ? hq
                ? '見積を待っている依頼はありません。'
                : '承諾を待っている見積はありません。'
              : '該当する依頼はありません。'}
          </div>
        ) : (
          <div className="scroll-x">
            <table className="list">
              <thead>
                <tr>
                  <th>依頼</th>
                  {hq && <th className="hide-sm">店舗</th>}
                  <th className="hide-sm">仕入先</th>
                  <th>状態</th>
                  <th className="right">金額（税込）</th>
                  <th className="hide-sm">更新</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <a className="row-link" href={`/orders/${o.id}`}>
                        {o.po_number ?? o.request_number}
                      </a>
                      <div className="meta-line">
                        {o.po_number ? `${o.request_number}・` : ''}
                        {o.requested_by_name}・{o.line_count}品目
                        {hq && (
                          <span className="show-sm">・{o.store_name}</span>
                        )}
                      </div>
                    </td>
                    {hq && <td className="hide-sm">{o.store_name}</td>}
                    <td className="hide-sm">{o.supplier_name}</td>
                    <td>
                      <StatusChip status={o.status} />
                      {o.status === 'quoted' && o.valid_until && (
                        <div className="meta-line">
                          第{o.quote_version}版・期限{' '}
                          {o.valid_until.slice(5).replace('-', '/')}
                        </div>
                      )}
                    </td>
                    <td className="right num">
                      {yen(o.amount)}
                      <div className="meta-line">
                        {amountLabel[o.amount_kind]}
                      </div>
                    </td>
                    <td className="hide-sm meta-line">
                      {shortDate(o.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
