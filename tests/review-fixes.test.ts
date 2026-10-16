// Regressions for the issues the pre-publication review found
// (docs/security-publication.md).
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { demoWorld, itemId, orderBy, type World } from './helpers';
import {
  addToCart,
  getOrder,
  importFromSite,
  issueQuote,
  listCatalog,
  listSources,
  orderStats,
  setCartLine,
  storageKey,
  submitCart,
  updateItem,
} from '../src/server/service';
import { AppError } from '../src/server/db';
import { demoSupplierFetcher } from '../src/server/demo-supplier';
import { FetchError, createFetcher, isPublicAddress } from '../src/server/net';
import { parseProductPage } from '../src/core/catalog/html';
import { cleanText } from '../src/core/catalog/product';
import { isAllowed, parseRobots } from '../src/core/catalog/robots';
import { addDays, todayInJapan } from '../src/server/config';

let w: World;
beforeEach(async () => {
  w = await demoWorld();
});

const status = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.status : String(e)),
  );

describe('workflow', () => {
  it('a cart cannot be sent with an item headquarters stopped listing', async () => {
    const { orderId } = await addToCart(
      w.deps,
      w.as.omiya,
      await itemId(w, 'SK-1002'),
      1,
    );
    await updateItem(w.deps, w.as.admin, await itemId(w, 'SK-1002'), {
      active: false,
    });
    expect(await status(submitCart(w.deps, w.as.omiya, orderId, {}))).toBe(409);
  });

  it('sending a cart re-copies today’s catalog price', async () => {
    const id = await itemId(w, 'SK-1002');
    const { orderId } = await addToCart(w.deps, w.as.omiya, id, 1);
    await w.pg.query(
      `UPDATE app.catalog_items SET listed_price = 1100 WHERE id = $1`,
      [id],
    );
    await submitCart(w.deps, w.as.omiya, orderId, {});
    const order = await getOrder(w.deps, w.as.buyer, orderId);
    expect(order.lines[0].unit_price).toBe(1000);
  });

  it('an empty or null quantity does not delete a cart line', async () => {
    const { orderId } = await addToCart(
      w.deps,
      w.as.omiya,
      await itemId(w, 'SK-1002'),
      2,
    );
    const [line] = await w.sql(
      'omiya',
      'SELECT id FROM app.order_lines WHERE order_id = $1',
      [orderId],
    );
    for (const bad of ['', null, false, [], '1.5'])
      expect(
        await status(setCartLine(w.deps, w.as.omiya, line.id as string, bad)),
      ).toBe(400);
    const left = await w.sql(
      'omiya',
      'SELECT qty FROM app.order_lines WHERE order_id = $1',
      [orderId],
    );
    expect(left).toEqual([{ qty: 2 }]);
  });

  it('impossible dates are a 400, not a server error', async () => {
    const { orderId } = await addToCart(
      w.deps,
      w.as.omiya,
      await itemId(w, 'SK-1002'),
      1,
    );
    expect(
      await status(
        submitCart(w.deps, w.as.omiya, orderId, { neededBy: '2026-02-30' }),
      ),
    ).toBe(400);
    const o = await orderBy(w, 'R-2026-0004');
    const order = await getOrder(w.deps, w.as.buyer, o.id);
    expect(
      await status(
        issueQuote(w.deps, w.as.buyer, o.id, {
          lines: order.lines.map((l) => ({
            orderLineId: l.id,
            unitPrice: 1,
            qty: 1,
          })),
          shippingFee: 0,
          validUntil: `${addDays(todayInJapan(), 30).slice(0, 7)}-32`,
          basedOn: null,
        }),
      ),
    ).toBe(400);
  });

  it('the request role cannot call the login functions', async () => {
    expect(
      await status(
        w.sql(
          'admin',
          `SELECT * FROM app.auth_lookup('sato@sample-cafe.example')`,
        ),
      ),
    ).toBe(403);
    expect(
      await status(
        w.sql(
          'admin',
          `SELECT app.auth_create_session('x', $1, $2, interval '1 day')`,
          [w.as.shibuya.userId, w.as.shibuya.orgId],
        ),
      ),
    ).toBe(403);
  });

  it('counts every order for the tabs, not a page of them', async () => {
    expect(await orderStats(w.deps, w.as.buyer)).toMatchObject({
      todo: 1,
      waiting: 1,
      open: 2,
      ordered: 1,
      all: 4,
    });
    expect(await orderStats(w.deps, w.as.shibuya)).toMatchObject({
      todo: 0,
      waiting: 1,
      ordered: 1,
      all: 2,
    });
  });
});

describe('imports', () => {
  it('a partial read does not take unread items off the catalog', async () => {
    const real = demoSupplierFetcher();
    w.deps.fetcher = async (url, o) => {
      if (url.endsWith('/items/SK-1001.html'))
        throw new FetchError('サーバーが 503 を返しました', 'http', 503);
      return real(url, o);
    };
    const [source] = await listSources(w.deps, w.as.admin);
    const summary = await importFromSite(w.deps, w.as.admin, source.id);
    expect(summary).toMatchObject({ found: 22, missing: 0, complete: false });
    const { items } = await listCatalog(w.deps, w.as.admin, { q: 'SK-1001' });
    expect(items[0].available).toBe(true);
  });

  it('long keys stay distinct instead of being cut into one', () => {
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
