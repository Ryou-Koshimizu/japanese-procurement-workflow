// The notifications a person received (and, for B社, the mail to makers),
// rendered with the same text the mail carries.
import { asUser } from '../db';
import type { Session } from '../auth';
import { render } from '../mailer';
import type {
  Audience,
  NotificationEvent,
  Payload,
} from '../../core/notification';
import { ctx, type Deps } from './common';
import { myTurn } from './requests';

export type Notification = {
  id: string;
  order_id: string;
  event: NotificationEvent;
  audience: Audience;
  to_email: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'demo';
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  subject: string;
  body: string;
};

export async function listNotifications(
  deps: Deps,
  s: Session,
  limit = 100,
): Promise<Notification[]> {
  const rows = await asUser(deps.db, ctx(s), (tx) =>
    tx.query<Omit<Notification, 'subject' | 'body'> & { payload: Payload }>(
      `SELECT id::text, order_id, event, audience, to_email, status, attempts, last_error,
              created_at, sent_at, payload
         FROM app.outbox ORDER BY app.outbox.id DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 300)],
    ),
  );
  return rows.rows.map(({ payload, ...row }) => {
    const mail = render(
      { event: row.event, audience: row.audience, payload },
      deps.origin,
    );
    return { ...row, subject: mail.subject, body: mail.text };
  });
}

/** Badges: requests waiting on this person's side, notifications of the last day. */
export async function counts(deps: Deps, s: Session) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ todo: number; recent: number }>(
      `SELECT
         (SELECT count(*)::int FROM app.orders WHERE status = ANY($2::text[])) AS todo,
         (SELECT count(*)::int FROM app.outbox
           WHERE to_user_id = $1 AND created_at > now() - interval '1 day') AS recent`,
      [s.userId, myTurn(s)],
    );
    return r.rows[0];
  });
}
