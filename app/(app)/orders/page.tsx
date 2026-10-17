import { ListChecks } from 'lucide-react';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import {
  listOrders,
  orderStats,
  LIST_LIMIT,
  ORDER_FILTERS,
  type OrderFilter,
} from '../../../src/server/service';
import OrderRows from '../order-rows';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const s = await pageSession();
  const { deps } = await runtime();
  const stats = await orderStats(deps, s);
  const asked = String((await searchParams).tab ?? '');
  const tab: OrderFilter = ORDER_FILTERS.includes(asked as OrderFilter)
    ? (asked as OrderFilter)
    : 'open';
  const rows = await listOrders(deps, s, tab);
  const tabs: { key: OrderFilter; label: string; count: number }[] = [
    { key: 'todo', label: 'あなたの番', count: stats.todo },
    { key: 'open', label: '進行中', count: stats.open },
    { key: 'done', label: '納期確定', count: stats.done },
    { key: 'all', label: 'すべて', count: stats.all },
  ];
  const shown = tabs.find((t) => t.key === tab)!.count;
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ListChecks className="icon sm" aria-hidden="true" />
            {s.orgName}
          </span>
          <h1>依頼</h1>
          <p className="sub">A社の全拠点からの依頼です。</p>
        </div>
      </div>
      <section className="card" aria-label="依頼">
        <nav className="tabs" aria-label="絞り込み">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/orders?tab=${t.key}`}
              aria-current={t.key === tab ? 'page' : undefined}
            >
              {t.key === tab && (
                <span
                  className="lg-ind"
                  style={{ viewTransitionName: 'tab-ind' }}
                  aria-hidden="true"
                />
              )}
              {t.label}
              <span className="num tab-count">{t.count}</span>
            </a>
          ))}
        </nav>
        <OrderRows rows={rows} role={s.role} empty="該当する依頼はありません" />
        {shown > rows.length && (
          <p className="meta-line" style={{ padding: '0 24px 16px' }}>
            新しい順に{LIST_LIMIT}件を表示しています（全{shown}件）。
          </p>
        )}
      </section>
    </>
  );
}
