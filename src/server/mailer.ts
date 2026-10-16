// Delivery of the outbox the database fills (app.outbox). Rows are claimed
// with SKIP LOCKED so parallel senders never send the same row twice at the
// same time; a sender that dies leaves its rows to be retried after the claim
// expires (at-least-once delivery). Failures back off and stop after 5 tries.
import { asMailer, type Database } from './db';
import {
  bodyOf,
  subjectOf,
  type Audience,
  type NotificationEvent,
  type Payload,
} from '../core/notification';

export type OutgoingMail = { to: string; subject: string; text: string };

export type MailTransport =
  /** Public demo: render and record, never send. */
  | { kind: 'demo' }
  /** Live mode without SMTP settings: rows stay queued. */
  | { kind: 'none' }
  | { kind: 'smtp'; send(mail: OutgoingMail): Promise<void> };

export async function smtpTransport(
  url: string,
  from: string,
): Promise<MailTransport> {
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport(url);
  return {
    kind: 'smtp',
    async send(mail) {
      await transporter.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}

const MAX_ATTEMPTS = 5;

type Claimed = {
  id: string;
  to_email: string;
  event: NotificationEvent;
  audience: Audience;
  payload: Payload;
  attempts: number;
};

export function render(
  row: Pick<Claimed, 'event' | 'audience' | 'payload'>,
  origin: string | null,
) {
  return {
    subject: subjectOf(row.event, row.audience, row.payload),
    text: bodyOf(row.event, row.audience, row.payload, origin),
  };
}

export async function deliverOutbox(
  db: Database,
  transport: MailTransport,
  origin: string | null,
  limit = 25,
): Promise<{ sent: number; failed: number }> {
  if (transport.kind === 'none') return { sent: 0, failed: 0 };
  const claimed = await asMailer(db, (tx) =>
    tx.query<Claimed>(
      `UPDATE app.outbox
          SET status = 'sending', attempts = attempts + 1,
              next_attempt_at = now() + interval '10 minutes'
        WHERE id IN (SELECT id FROM app.outbox
                      WHERE status IN ('pending', 'sending', 'failed')
                        AND next_attempt_at <= now() AND attempts < $2
                      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text, to_email, event, audience, payload, attempts`,
      [limit, MAX_ATTEMPTS],
    ),
  );
  let sent = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    if (transport.kind === 'demo') {
      await mark(db, row.id, 'demo', null, 0);
      sent++;
      continue;
    }
    try {
      const mail = render(row, origin);
      await transport.send({ to: row.to_email, ...mail });
      await mark(db, row.id, 'sent', null, 0);
      sent++;
    } catch (e) {
      failed++;
      const message = String((e as Error)?.message ?? 'send failed').slice(
        0,
        300,
      );
      // 1, 4, 9, 16 minutes between tries.
      await mark(db, row.id, 'failed', message, row.attempts ** 2);
    }
  }
  return { sent, failed };
}

async function mark(
  db: Database,
  id: string,
  status: 'sent' | 'failed' | 'demo',
  error: string | null,
  retryMinutes: number,
) {
  await asMailer(db, (tx) =>
    tx.query(
      `UPDATE app.outbox
          SET status = $2, last_error = $3,
              sent_at = CASE WHEN $2 = 'failed' THEN NULL ELSE now() END,
              next_attempt_at = now() + make_interval(mins => $4::int)
        WHERE id = $1::bigint`,
      [id, status, error, retryMinutes],
    ),
  );
}
