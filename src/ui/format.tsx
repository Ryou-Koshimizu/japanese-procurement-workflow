import {
  Ban,
  FileCheck2,
  Hourglass,
  PackageCheck,
  ShoppingCart,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { formatDate, formatDateTime } from '../core/notification';
import { statusLabels, type Status } from '../core/workflow';
export { yen } from '../core/money';
export { formatDate, formatDateTime };

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export const statusIcons: Record<Status, LucideIcon> = {
  draft: ShoppingCart,
  requested: Hourglass,
  hearing: Hourglass,
  sourcing: Hourglass,
  quoted: FileCheck2,
  agreed: FileCheck2,
  ordered: PackageCheck,
  scheduled: PackageCheck,
  rejected: Ban,
  cancelled: Undo2,
};

/** State in words and a shape, never in color alone. */
export function StatusChip({ status }: { status: Status }) {
  const Icon = statusIcons[status];
  return (
    <span className={`status s-${status}`}>
      <Icon className="icon" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

/** Four segments for request → quote → acceptance → order. */
export function MiniSteps({ status }: { status: Status }) {
  const reached: number = {
    draft: 0,
    requested: 1,
    hearing: 1,
    sourcing: 1,
    quoted: 2,
    agreed: 3,
    ordered: 3,
    scheduled: 4,
    rejected: 1,
    cancelled: 1,
  }[status];
  const stopped = status === 'rejected' || status === 'cancelled';
  return (
    <span className="mini-steps" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <i
          key={i}
          className={
            i < reached
              ? 'done'
              : i === reached
                ? stopped
                  ? 'stop'
                  : 'now'
                : ''
          }
        />
      ))}
    </span>
  );
}

/** Catalog image URL served by the app (never the supplier's own host). */
export const imageUrl = (id: string | null | undefined) =>
  id ? `/api/catalog/images/${id}` : null;
