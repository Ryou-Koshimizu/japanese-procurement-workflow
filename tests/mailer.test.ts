import { beforeEach, describe, expect, it } from 'vitest';
import { demoWorld, orderBy, type World } from './helpers';
import { deliverOutbox, type OutgoingMail } from '../src/server/mailer';
import { acceptQuote } from '../src/server/service';
import { asMailer } from '../src/server/db';

let w: World;
beforeEach(async () => {
  w = await demoWorld();
  const o = await orderBy(w, 'R-2026-0003');
  await acceptQuote(w.deps, w.as.yokohama, o.id, o.current_quote_id);
});

describe('delivering the outbox', () => {
  it('sends each queued notification once', async () => {
    const sent: OutgoingMail[] = [];
    const smtp = {
      kind: 'smtp' as const,
      send: async (m: OutgoingMail) => void sent.push(m),
    };
    const first = await deliverOutbox(
      w.deps.db,
      smtp,
      'https://orders.example.com',
      100,
    );
    expect(first).toEqual({ sent: 4, failed: 0 });
    // The store (its one staff member), headquarters (two) and the supplier.
    expect(sent.map((m) => m.to).sort()).toEqual([
      'orders@sakura-supply.example',
      'suzuki@sample-cafe.example',
      'tanaka@sample-cafe.example',
      'yamada@sample-cafe.example',
    ]);
    expect(sent.find((m) => m.to.startsWith('orders@'))!.subject).toMatch(
      /^【発注書】PO-2026-0002/,
    );
    expect(await deliverOutbox(w.deps.db, smtp, null, 100)).toEqual({
      sent: 0,
      failed: 0,
    });
  });

  it('keeps failures for a later retry with backoff', async () => {
    const failing = {
      kind: 'smtp' as const,
      send: async () => {
        throw new Error('535 auth failed');
      },
    };
    expect(await deliverOutbox(w.deps.db, failing, null, 100)).toEqual({
      sent: 0,
      failed: 4,
    });
    const rows = await w.pg.query<{
      status: string;
      last_error: string;
      due: boolean;
    }>(
      `SELECT status, last_error, next_attempt_at > now() AS due FROM app.outbox WHERE status <> 'demo'`,
    );
    expect(
      rows.rows.every(
        (r) =>
          r.status === 'failed' && r.last_error === '535 auth failed' && r.due,
      ),
    ).toBe(true);
  });

  it('without SMTP settings, everything stays queued', async () => {
    expect(await deliverOutbox(w.deps.db, { kind: 'none' }, null)).toEqual({
      sent: 0,
      failed: 0,
    });
    const r = await w.pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.outbox WHERE status = 'pending'`,
    );
    expect(r.rows[0].n).toBe(4);
  });

  it('the mailer role sees the outbox and nothing else', async () => {
    await expect(
      asMailer(w.deps.db, (tx) => tx.query('SELECT * FROM app.orders')),
    ).rejects.toThrow();
    await expect(
      asMailer(w.deps.db, (tx) => tx.query('SELECT name FROM app.users')),
    ).rejects.toThrow();
    await expect(
      asMailer(w.deps.db, (tx) =>
        tx.query(`UPDATE app.outbox SET to_email = 'x@example.com'`),
      ),
    ).rejects.toThrow();
  });
});
