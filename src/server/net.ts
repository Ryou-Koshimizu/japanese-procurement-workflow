// Fetching a supplier's pages and images on behalf of a person, without
// letting that person reach the server's own network (SSRF): only http(s) on
// ports 80/443, no credentials in URLs, every DNS answer checked at connect
// time (so a rebinding name cannot switch to a private address after the
// check), redirects re-checked hop by hop, and hard limits on time and size,
// including after decompression.
import { BlockList, isIP } from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { pipeline, type Readable } from 'node:stream';

export const USER_AGENT =
  'ProcurementCatalogBot/0.1 (+https://github.com/Ryou-Koshimizu/japanese-procurement-workflow)';
export const ROBOTS_TOKEN = 'ProcurementCatalogBot';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly kind:
      'blocked' | 'http' | 'timeout' | 'too_large' | 'type' | 'network',
    readonly status?: number,
  ) {
    super(message);
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96], // IPv4-compatible (deprecated)
  ['::ffff:0:0:0', 96], // IPv4-translated (::ffff:0:a.b.c.d)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

function hextets(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const parts = v4[1].split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    s =
      s.slice(0, -v4[1].length) +
      ((parts[0] << 8) | parts[1]).toString(16) +
      ':' +
      ((parts[2] << 8) | parts[3]).toString(16);
  }
  const [head, tail = ''] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - a.length - b.length : 0;
  const all = [...a, ...Array(fill).fill('0'), ...b];
  if (all.length !== 8) return null;
  return all.map((h) => parseInt(h || '0', 16));
}

/** An IPv4 address carried inside an IPv6 one (mapped, NAT64, 6to4). */
function embeddedIPv4(ip: string): string | null {
  const h = hextets(ip);
  if (!h) return null;
  const v4 = (hi: number, lo: number) =>
    `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff)
    return v4(h[6], h[7]);
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0))
    return v4(h[6], h[7]);
  if (h[0] === 0x2002) return v4(h[1], h[2]);
  return null;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family !== 6) return false;
  const inner = embeddedIPv4(ip);
  if (inner) return isPublicAddress(inner);
  return !blocked.check(ip, 'ipv6');
}

/** Refuse a URL before any connection: scheme, port, credentials, IP literals. */
export function checkUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError('URLの形式が正しくありません', 'blocked');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FetchError('http または https のURLだけ読み込めます', 'blocked');
  if (url.username || url.password)
    throw new FetchError('ID・パスワード付きのURLは読み込めません', 'blocked');
  if (url.port && url.port !== '80' && url.port !== '443' && !allowPrivate)
    throw new FetchError('ポート番号付きのURLは読み込めません', 'blocked');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !allowPrivate && !isPublicAddress(host))
    throw new FetchError(
      '社内・ローカルのアドレスには接続できません',
      'blocked',
    );
  if (
    !allowPrivate &&
    /(^|\.)(localhost|local|internal|localdomain)$/i.test(host)
  )
    throw new FetchError(
      '社内・ローカルのアドレスには接続できません',
      'blocked',
    );
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** dns.lookup that fails when any answer is not a public address. */
export function guardedLookup(allowPrivate: boolean) {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: LookupCallback,
  ) => {
    dns.lookup(
      hostname,
      { all: true, family: options.family ?? 0 },
      (err, addresses) => {
        if (err) return callback(err, []);
        const list = addresses as dns.LookupAddress[];
        if (
          !list.length ||
          (!allowPrivate && list.some((a) => !isPublicAddress(a.address)))
        ) {
          const e = new FetchError(
            '社内・ローカルのアドレスには接続できません',
            'blocked',
          ) as FetchError & NodeJS.ErrnoException;
          return callback(e, []);
        }
        if (options.all) callback(null, list);
        else callback(null, list[0].address, list[0].family);
      },
    );
  };
}

export type FetchResult = {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
};

export type FetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  accept?: string;
};

export type Fetcher = (
  url: string,
  options: FetchOptions,
) => Promise<FetchResult>;

const MAX_REDIRECTS = 5;

const tooLarge = (maxBytes: number) =>
  new FetchError(
    `${Math.round(maxBytes / 1024)}KBを超えるため読み込みを止めました`,
    'too_large',
  );

/**
 * Collect a body up to maxBytes. Settles exactly once: on the end, on an
 * error, or when the stream closes early (a dropped connection or the
 * timeout), so a half-sent body never leaves the import waiting.
 */
function readLimited(
  stream: Readable,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(
        e instanceof FetchError
          ? e
          : signal.aborted
            ? new FetchError('応答が遅いため中止しました', 'timeout')
            : new FetchError('通信が途中で切れました', 'network'),
      );
    };
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) fail(tooLarge(maxBytes));
      else chunks.push(chunk);
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', fail);
    stream.on('close', () => fail(null));
  });
}

function once(
  url: URL,
  options: FetchOptions,
  signal: AbortSignal,
  allowPrivate: boolean,
) {
  return new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        lookup: guardedLookup(allowPrivate) as never,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? '*/*',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'ja,en;q=0.5',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > options.maxBytes) {
          res.destroy();
          reject(tooLarge(options.maxBytes));
          return;
        }
        const encoding = String(
          res.headers['content-encoding'] ?? '',
        ).toLowerCase();
        const decoder =
          encoding === 'gzip' || encoding === 'x-gzip'
            ? zlib.createGunzip()
            : encoding === 'deflate'
              ? zlib.createInflate()
              : encoding === 'br'
                ? zlib.createBrotliDecompress()
                : null;
        // pipeline() hands an error or early close of the response on to the
        // decoder. The size limit applies after decompression (no zip bombs).
        const body: Readable = decoder ? pipeline(res, decoder, () => {}) : res;
        readLimited(body, options.maxBytes, signal).then(
          (data) => resolve({ status, headers: res.headers, body: data }),
          (e) => {
            res.destroy();
            reject(e);
          },
        );
      },
    );
    req.on('error', (e) => {
      if (e instanceof FetchError) reject(e);
      else if ((e as Error).name === 'AbortError')
        reject(new FetchError('応答が遅いため中止しました', 'timeout'));
      else if ((e as NodeJS.ErrnoException).code === 'ENOTFOUND')
        reject(new FetchError('ホスト名が見つかりません', 'network'));
      else reject(new FetchError('接続できませんでした', 'network'));
    });
    req.end();
  });
}

/**
 * The guarded fetcher. allowPrivateNetwork exists only for tests against a
 * local server; nothing in the application sets it.
 */
export function createFetcher({ allowPrivateNetwork = false } = {}): Fetcher {
  return async (raw, options) => {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    let url = checkUrl(raw, allowPrivateNetwork);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await once(url, options, signal, allowPrivateNetwork);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location;
        if (!location)
          throw new FetchError(
            `転送先のないリダイレクト（${res.status}）`,
            'http',
          );
        url = checkUrl(new URL(location, url).href, allowPrivateNetwork);
        continue;
      }
      if (res.status < 200 || res.status >= 300)
        throw new FetchError(
          `サーバーが ${res.status} を返しました`,
          'http',
          res.status,
        );
      return {
        url: url.href,
        status: res.status,
        contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
        body: res.body,
      };
    }
    throw new FetchError('リダイレクトが多すぎます', 'http');
  };
}

/** Text of an HTML or text response in its declared (or sniffed) charset. */
export function decodeText(body: Buffer, contentType: string): string {
  const declared =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(
      body.subarray(0, 4096).toString('latin1'),
    )?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(body);
    } catch {
      /* unknown label: fall through */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('shift_jis').decode(body);
  }
}

/** The image type from its first bytes; SVG and everything else is refused. */
export function sniffImage(
  body: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  const b = body;
  if (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  )
    return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'image/jpeg';
  if (
    b.length > 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  if (b.length > 6 && String.fromCharCode(...b.subarray(0, 4)) === 'GIF8')
    return 'image/gif';
  return null;
}
