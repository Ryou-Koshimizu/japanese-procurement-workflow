// The importer fetches URLs that people type in. These tests pin down that it
// cannot be pointed at the server's own network and that hostile responses
// (huge, compressed bombs, endless redirects, slow) are cut off.
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkUrl,
  createFetcher,
  decodeText,
  guardedLookup,
  isPublicAddress,
  sniffImage,
} from '../src/server/net';

describe('addresses', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a9fe:a9fe',
    '2002:c0a8:0101::1',
    'not-an-ip',
  ])('%s is not public', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['8.8.8.8', '133.242.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://localhost/',
    'http://printer.local/',
    'http://example.com:8080/',
    'http://user:pass@example.com/',
    'file:///etc/passwd',
    'gopher://example.com/',
  ])('refuses %s before connecting', (url) =>
    expect(() => checkUrl(url)).toThrow(),
  );

  it('accepts ordinary public URLs', () => {
    expect(checkUrl('https://shop.example.com/catalog?page=2').href).toBe(
      'https://shop.example.com/catalog?page=2',
    );
  });

  it('refuses a name that resolves to a private address at connect time', async () => {
    const lookup = guardedLookup(false);
    const err = await new Promise<Error | null>((resolve) =>
      lookup('localhost', { all: true }, (e) => resolve(e)),
    );
    expect(err?.message).toContain('社内・ローカル');
  });
});

describe('fetching', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = req.url ?? '/';
      if (u === '/ok') {
        res.setHeader('content-type', 'text/html; charset=shift_jis');
        res.end(Buffer.from([0x8f, 0xa4, 0x95, 0x69]));
      } else if (u === '/big') {
        res.setHeader('content-type', 'text/html');
        res.end('x'.repeat(200_000));
      } else if (u === '/bomb') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-encoding', 'gzip');
        res.end(zlib.gzipSync(Buffer.alloc(5_000_000)));
      } else if (u.startsWith('/loop')) {
        res.statusCode = 302;
        res.setHeader('location', `/loop${u.length}`);
        res.end();
      } else if (u === '/to-file') {
        res.statusCode = 302;
        res.setHeader('location', 'file:///etc/passwd');
        res.end();
      } else if (u === '/to-creds') {
        res.statusCode = 301;
        res.setHeader('location', 'http://admin:secret@127.0.0.1/');
        res.end();
      } else if (u === '/slow') {
        setTimeout(() => res.end('late'), 3000);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  // allowPrivateNetwork only lets the tests reach this local server.
  const fetcher = createFetcher({ allowPrivateNetwork: true });

  it('decodes the declared charset', async () => {
    const r = await fetcher(`${base}/ok`, { maxBytes: 1000 });
    expect(decodeText(r.body, r.contentType)).toBe('商品');
  });

  it('cuts off large and decompressed-large bodies', async () => {
    await expect(fetcher(`${base}/big`, { maxBytes: 100_000 })).rejects.toThrow(
      'KB',
    );
    await expect(
      fetcher(`${base}/bomb`, { maxBytes: 1_000_000 }),
    ).rejects.toThrow('KB');
  });

  it('stops endless redirects and re-checks every hop', async () => {
    await expect(fetcher(`${base}/loop`, { maxBytes: 1000 })).rejects.toThrow(
      'リダイレクト',
    );
    await expect(
      fetcher(`${base}/to-file`, { maxBytes: 1000 }),
    ).rejects.toThrow('http または https');
    await expect(
      fetcher(`${base}/to-creds`, { maxBytes: 1000 }),
    ).rejects.toThrow('パスワード');
  });

  it('gives up on slow servers and reports HTTP errors', async () => {
    await expect(
      fetcher(`${base}/slow`, { maxBytes: 1000, timeoutMs: 300 }),
    ).rejects.toThrow('遅い');
    await expect(
      fetcher(`${base}/missing`, { maxBytes: 1000 }),
    ).rejects.toThrow('404');
  });

  it('without the test switch, the same local server is refused', async () => {
    await expect(
      createFetcher()(`${base}/ok`, { maxBytes: 1000 }),
    ).rejects.toThrow();
  });
});

describe('images', () => {
  it('accepts raster formats by their first bytes and refuses SVG', () => {
    expect(
      sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])),
    ).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(sniffImage(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe(
      'image/webp',
    );
    expect(
      sniffImage(new TextEncoder().encode('<svg onload="alert(1)">')),
    ).toBeNull();
  });
});
