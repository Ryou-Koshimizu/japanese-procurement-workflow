// Regressions for the issues the pre-publication review found
// (docs/security-publication.md). The cart and catalog-ordering cases went
// with the cart (schema version 2).
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  askMaker,
  day,
  deps,
  fixture,
  outline,
  recordMaker,
  refused,
  session,
  submit,
} from './helpers';
import {
  issueQuote,
  listNotifications,
  storageKey,
  submitRequest,
} from '../src/server/service';
import { AppError } from '../src/server/db';
import { createFetcher, isPublicAddress } from '../src/server/net';
import { parseProductPage } from '../src/core/catalog/html';
import { cleanText } from '../src/core/catalog/product';
import { isAllowed, parseRobots } from '../src/core/catalog/robots';

describe('database roles', () => {
  it('the request role cannot call the login functions', async () => {
    const f = await fixture();
    await refused(
      f.sql(
        'tanaka',
        `SELECT * FROM app.auth_lookup('sato@sample-cafe.example')`,
      ),
      '42501',
    );
    await refused(
      f.sql(
        'tanaka',
        `SELECT app.auth_create_session('x', $1, $2, interval '1 day')`,
        [f.people.sato.userId, f.orgId],
      ),
      '42501',
    );
  });
});

const status = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.status : String(e)),
  );

describe('services', () => {
  it('impossible dates are a 4xx, not a server error', async () => {
    const f = await fixture();
    const d = deps(f);
    const answers = [
      { key: 'item', value: '棚' },
      { key: 'purpose', value: '収納' },
      { key: 'place', value: '倉庫' },
      { key: 'quantity', value: 1 },
    ];
    expect(
      await status(
        submitRequest(d, session(f, 'sato'), {
          title: '棚',
          answers,
          needed_by: '2026-02-30',
        }),
      ),
    ).toBe(422);
    const orderId = await submit(f, 'sato');
    const [line] = await outline(f, orderId, [{ name: '棚', qty: 1 }]);
    const mq = await askMaker(f, orderId, f.makers.sakura);
    await recordMaker(f, mq, [{ order_line_id: line, unit_cost: 1000 }]);
    expect(
      await status(
        issueQuote(d, session(f, 'yamada'), orderId, {
          maker_quote_id: mq,
          mode: 'markup',
          markup_bp: 1000,
          shipping_fee: 0,
          expenses: 0,
          valid_until: `${day(30).slice(0, 7)}-32`,
        }),
      ),
    ).toBe(400);
  });

  it('lists notifications newest first (by number, not as text)', async () => {
    const f = await fixture();
    for (let i = 0; i < 6; i++) await submit(f, 'sato', { title: `依頼${i}` });
    const mails = await listNotifications(deps(f), session(f, 'yamada'));
    const ids = mails.map((m) => Number(m.id));
    expect(ids.length).toBe(6);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(mails[0].subject).toMatch(/^【新しい依頼】渋谷店 依頼5/);
  });

  it('long catalog keys stay distinct instead of being cut into one', () => {
    const a = `url:https://shop.example/${'x'.repeat(600)}/a`;
    const b = `url:https://shop.example/${'x'.repeat(600)}/b`;
    expect(storageKey(a)).not.toBe(storageKey(b));
    expect(storageKey(a).length).toBeLessThanOrEqual(500);
    expect(storageKey('sku:A1')).toBe('sku:A1');
  });
});

describe('hostile supplier content', () => {
  const fast = (fn: () => unknown) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  it('pages of unclosed tags are scanned in linear time', () => {
    const page =
      '<meta '.repeat(400_000) +
      '<script '.repeat(100_000) +
      '<link '.repeat(100_000) +
      '>';
    expect(
      fast(() => parseProductPage(page, 'https://shop.example/')),
    ).toBeLessThan(1500);
    expect(fast(() => cleanText('<'.repeat(3_000_000), 300))).toBeLessThan(200);
  });
  it('robots.txt wildcards cannot backtrack', () => {
    const robots = parseRobots(
      `User-agent: *\nDisallow: /${'*a'.repeat(200)}*b\n`,
      'x',
    );
    const path = '/' + 'a'.repeat(2000);
    let allowed = false;
    expect(fast(() => (allowed = isAllowed(robots, path)))).toBeLessThan(100);
    expect(allowed).toBe(true);
    expect(isAllowed(robots, path + 'b')).toBe(false);
  });
  it('still blocks IPv4-translated and local-use NAT64 forms', () => {
    expect(isPublicAddress('::ffff:0:7f00:1')).toBe(false);
    expect(isPublicAddress('64:ff9b:1::7f00:1')).toBe(false);
  });
  it('a compressed body cut off midway fails instead of hanging', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      });
      const gz = zlib.gzipSync(Buffer.alloc(200_000, 'a'));
      res.write(gz.subarray(0, 200));
      setTimeout(() => res.socket?.destroy(), 50);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      await expect(
        createFetcher({ allowPrivateNetwork: true })(url, {
          maxBytes: 1_000_000,
          timeoutMs: 5000,
        }),
      ).rejects.toThrow('通信が途中で切れました');
    } finally {
      server.close();
    }
  });
});
