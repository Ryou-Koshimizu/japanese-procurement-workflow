// Regressions for the issues the pre-publication review found
// (docs/security-publication.md). The cart, catalog-ordering and service-level
// cases went with the cart (schema version 2); see the agency-flow commit.
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { fixture, refused } from './helpers';
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
