import { beforeEach, describe, expect, it } from 'vitest';
import {
  deps,
  fixture,
  outline,
  session,
  submit,
  type Fixture,
} from './helpers';
import { deliverOutbox, type OutgoingMail } from '../src/server/mailer';
import { requestMakerQuotes } from '../src/server/service';
import { asMailer } from '../src/server/db';

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
  // 渋谷店 sends a request (B社's two people are told), B社 asks a maker.
  const orderId = await submit(f, 'sato');
  await outline(f, orderId, [{ name: '収納棚', qty: 2, unit: '台' }]);
  await requestMakerQuotes(deps(f), session(f, 'yamada'), orderId, [
    f.makers.sakura,
  ]);
});

describe('delivering the outbox', () => {
  it('sends each queued notification once', async () => {
    const sent: OutgoingMail[] = [];
    const smtp = {
      kind: 'smtp' as const,
      send: async (m: OutgoingMail) => void sent.push(m),
    };
    const first = await deliverOutbox(
      f.db,
      smtp,
      'https://orders.example.com',
      100,
    );
    expect(first).toEqual({ sent: 3, failed: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual([
      'orders@sakura-supply.example',
      'tanaka@midori.example',
      'yamada@midori.example',
    ]);
    const rfq = sent.find((m) => m.to.startsWith('orders@'))!;
    expect(rfq.subject).toMatch(
      /^【見積のご依頼】R-\d{4}-0001（みどり購買サポート株式会社）$/,
    );
    // The maker learns nothing about A社, not even its free-text title.
    expect(rfq.text).not.toMatch(/渋谷|サンプルカフェ|sample-cafe|入れ替え/);
    expect(await deliverOutbox(f.db, smtp, null, 100)).toEqual({
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
    expect(await deliverOutbox(f.db, failing, null, 100)).toEqual({
      sent: 0,
      failed: 3,
    });
    const rows = await f.owner<{
      status: string;
      last_error: string;
      due: boolean;
    }>(
      `SELECT status, last_error, next_attempt_at > now() AS due FROM app.outbox`,
    );
    expect(
      rows.every(
        (r) =>
          r.status === 'failed' && r.last_error === '535 auth failed' && r.due,
      ),
    ).toBe(true);
  });

  it('without SMTP settings, everything stays queued', async () => {
    expect(await deliverOutbox(f.db, { kind: 'none' }, null)).toEqual({
      sent: 0,
      failed: 0,
    });
    const r = await f.owner<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.outbox WHERE status = 'pending'`,
    );
    expect(r[0].n).toBe(3);
  });

  it('the mailer role sees the outbox and nothing else', async () => {
    await expect(
      asMailer(f.db, (tx) => tx.query('SELECT * FROM app.orders')),
    ).rejects.toThrow();
    await expect(
      asMailer(f.db, (tx) => tx.query('SELECT name FROM app.users')),
    ).rejects.toThrow();
    await expect(
      asMailer(f.db, (tx) =>
        tx.query(`UPDATE app.outbox SET to_email = 'x@example.com'`),
      ),
    ).rejects.toThrow();
  });
});
