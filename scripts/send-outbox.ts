// Send queued notifications (live mode). The app already sends right after
// each change; run this from a scheduler (e.g. every 5 minutes) to retry
// failures and pick up anything a stopped server left behind.
//
//   npm run outbox:send
import { readConfig, publicOrigin } from '../src/server/config';
import { pgDatabase } from '../src/server/db';
import { deliverOutbox, smtpTransport } from '../src/server/mailer';

const config = readConfig();
if (config.mode !== 'live' || !config.SMTP_URL || !config.MAIL_FROM)
  throw new Error('outbox:send needs APP_MODE=live, SMTP_URL and MAIL_FROM.');
const db = await pgDatabase(config.DATABASE_URL);
try {
  const transport = await smtpTransport(config.SMTP_URL, config.MAIL_FROM);
  let total = { sent: 0, failed: 0 };
  for (;;) {
    const r = await deliverOutbox(db, transport, publicOrigin(), 50);
    total = { sent: total.sent + r.sent, failed: total.failed + r.failed };
    if (r.sent + r.failed < 50) break;
  }
  console.log(JSON.stringify({ event: 'outbox_sent', ...total }));
} finally {
  await db.close();
}
