import {
  Ban,
  CalendarCheck,
  Factory,
  FileCheck2,
  Handshake,
  Inbox,
  MessageCircleQuestionMark,
  PackageCheck,
  PenLine,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { formatDate, formatDateTime } from '../core/notification';
import {
  PROGRESS_STEPS,
  progressIndex,
  statusLabels,
  type Status,
} from '../core/workflow';
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
  draft: PenLine,
  requested: Inbox,
  hearing: MessageCircleQuestionMark,
  sourcing: Factory,
  quoted: FileCheck2,
  agreed: Handshake,
  ordered: PackageCheck,
  scheduled: CalendarCheck,
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

/** One segment per step of PROGRESS_STEPS (依頼 → … → 納期確定). */
export function MiniSteps({ status }: { status: Status }) {
  const stopped = status === 'rejected' || status === 'cancelled';
  const reached = stopped ? 1 : progressIndex(status);
  const done = status === 'scheduled';
  return (
    <span className="mini-steps" aria-hidden="true">
      {PROGRESS_STEPS.map((step, i) => (
        <i
          key={step}
          className={
            i < reached || done
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
