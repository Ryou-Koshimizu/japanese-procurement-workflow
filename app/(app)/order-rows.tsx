import { ChevronRight, Inbox, Sparkles } from 'lucide-react';
import type { OrderSummary } from '../../src/server/service';
import { waitingOn, type Role } from '../../src/core/workflow';
import {
  MiniSteps,
  StatusChip,
  formatDate,
  shortDate,
  yen,
} from '../../src/ui/format';

/** Requests as rows: number and title, status and progress, amount. */
export default function OrderRows({
  rows,
  role,
  empty,
}: {
  rows: OrderSummary[];
  role: Role;
  empty: string;
}) {
  const mine = role === 'client' ? 'client' : 'agent';
  if (!rows.length)
    return (
      <div className="empty">
        <Inbox className="icon" aria-hidden="true" />
        <b>{empty}</b>
      </div>
    );
  return (
    <ul className="order-rows">
      {rows.map((o) => {
        const turn = waitingOn(o.status) === mine;
        return (
          <li key={o.id} className="order-row">
            <div>
              <a className="row-link" href={`/orders/${o.id}`}>
                {o.title}
              </a>
              <div className="meta-line num">
                {o.request_number}
                {o.po_number ? `・${o.po_number}` : ''}・{o.store_name}・
                {o.requested_by_name}・{shortDate(o.updated_at)}
              </div>
            </div>
            <div className="supplier meta-line">
              {o.delivery_date
                ? `納期 ${formatDate(o.delivery_date)}`
                : o.needed_by
                  ? `いつまでに ${formatDate(o.needed_by)}`
                  : ''}
            </div>
            <div className="progress-cell" style={{ display: 'grid', gap: 6 }}>
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
            </div>
            <div className="amount num">
              {o.amount !== null ? yen(o.amount) : '—'}
              <div className="meta-line" style={{ fontWeight: 600 }}>
                {o.amount_kind === 'agreed'
                  ? '合意額・税込'
                  : o.amount_kind === 'quote'
                    ? `見積書 第${o.quote_version}版・税込`
                    : '見積前'}
              </div>
            </div>
            <ChevronRight className="icon go" aria-hidden="true" />
          </li>
        );
      })}
    </ul>
  );
}
