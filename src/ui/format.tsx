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

export function StatusChip({ status }: { status: Status }) {
  return <span className={`status s-${status}`}>{statusLabels[status]}</span>;
}

/** Catalog image URL served by the app (never the supplier's own host). */
export const imageUrl = (id: string | null | undefined) =>
  id ? `/api/catalog/images/${id}` : null;
