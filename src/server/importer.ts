// Read a supplier's catalog from the pages headquarters names: each page's
// structured product data, plus the product pages its product lists point to
// (same host only), politely (robots.txt, one request at a time, a pause
// between requests) and within fixed limits.
import { createHash } from 'node:crypto';
import { parseProductPage } from '../core/catalog/html';
import {
  isAllowed,
  parseRobots,
  ALLOW_ALL,
  type Robots,
} from '../core/catalog/robots';
import type { ParsedProduct, Skipped } from '../core/catalog/product';
import {
  FetchError,
  ROBOTS_TOKEN,
  decodeText,
  sniffImage,
  type Fetcher,
} from './net';

export type ImportLimits = {
  maxPages: number;
  maxProducts: number;
  maxImages: number;
  deadlineMs: number;
  /** Minimum pause between two requests to the same host. */
  delayMs: number;
};

export const DEFAULT_LIMITS: ImportLimits = {
  maxPages: 60,
  maxProducts: 500,
  maxImages: 500,
  deadlineMs: 80_000,
  delayMs: 300,
};

export type FetchedImage = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  sha256: string;
  content: Buffer;
};

export type CrawlReport = {
  products: ParsedProduct[];
  images: Map<string, FetchedImage>;
  pages: number;
  skipped: Skipped[];
  errors: { url: string; message: string }[];
  stoppedEarly?: string;
};

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const strip = (u: string) => {
  const url = new URL(u);
  url.hash = '';
  return url.href;
};

type Session = {
  limits: ImportLimits;
  fetcher: Fetcher;
  timeLeft: () => number;
  robotsFor: (url: URL) => Promise<Robots>;
  polite: (url: URL, robots: Robots) => Promise<void>;
};

function createSession(
  fetcher: Fetcher,
  limits: ImportLimits,
  now: () => number,
): Session {
  const started = now();
  const timeLeft = () => limits.deadlineMs - (now() - started);
  const robotsByOrigin = new Map<string, Robots | FetchError>();
  const lastRequest = new Map<string, number>();

  const polite = async (url: URL, robots: Robots) => {
    const wait = Math.max(
      limits.delayMs,
      Math.min(robots.crawlDelay ?? 0, 5) * 1000,
    );
    const last = lastRequest.get(url.host) ?? 0;
    const pause = last + wait - now();
    if (pause > 0) await sleep(pause);
    lastRequest.set(url.host, now());
  };

  const robotsFor = async (url: URL): Promise<Robots> => {
    const cached = robotsByOrigin.get(url.origin);
    if (cached instanceof FetchError) throw cached;
    if (cached) return cached;
    let robots: Robots;
    try {
      await polite(url, ALLOW_ALL);
      const res = await fetcher(`${url.origin}/robots.txt`, {
        maxBytes: MAX_ROBOTS_BYTES,
        timeoutMs: Math.min(10_000, Math.max(1000, timeLeft())),
        accept: 'text/plain',
      });
      robots = parseRobots(decodeText(res.body, res.contentType), ROBOTS_TOKEN);
    } catch (e) {
      // No robots.txt (a 4xx answer) allows everything; an unreachable one
      // does not.
      if (
        e instanceof FetchError &&
        e.kind === 'http' &&
        e.status !== undefined &&
        e.status >= 400 &&
        e.status < 500
      ) {
        robots = ALLOW_ALL;
      } else {
        const error = new FetchError(
          `robots.txt を確認できないため読み込みませんでした（${(e as Error).message}）`,
          'blocked',
        );
        robotsByOrigin.set(url.origin, error);
        throw error;
      }
    }
    robotsByOrigin.set(url.origin, robots);
    return robots;
  };
  return { limits, fetcher, timeLeft, robotsFor, polite };
}

export async function crawlCatalog(
  startUrls: string[],
  fetcher: Fetcher,
  limits: ImportLimits = DEFAULT_LIMITS,
  now: () => number = Date.now,
): Promise<CrawlReport> {
  const session = createSession(fetcher, limits, now);
  const { timeLeft, robotsFor, polite } = session;
  const report: CrawlReport = {
    products: [],
    images: new Map(),
    pages: 0,
    skipped: [],
    errors: [],
  };
  const hosts = new Set<string>();
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const raw of startUrls) {
    try {
      const url = strip(raw);
      hosts.add(new URL(url).host);
      if (!seen.has(url)) {
        seen.add(url);
        queue.push(url);
      }
    } catch {
      report.errors.push({ url: raw, message: 'URLの形式が正しくありません' });
    }
  }

  const keys = new Set<string>();
  while (queue.length) {
    if (report.pages >= limits.maxPages) {
      report.stoppedEarly = `ページ数の上限（${limits.maxPages}ページ）に達したため、残り${queue.length}ページは読みませんでした`;
      break;
    }
    if (timeLeft() < 2000) {
      report.stoppedEarly = `時間の上限に達したため、残り${queue.length}ページは読みませんでした`;
      break;
    }
    if (report.products.length >= limits.maxProducts) {
      report.stoppedEarly = `商品数の上限（${limits.maxProducts}件）に達しました`;
      break;
    }
    const pageUrl = queue.shift()!;
    try {
      const url = new URL(pageUrl);
      const robots = await robotsFor(url);
      if (!isAllowed(robots, url.pathname + url.search))
        throw new FetchError(
          'robots.txt で読み込みが禁止されています',
          'blocked',
        );
      await polite(url, robots);
      const res = await fetcher(pageUrl, {
        maxBytes: MAX_PAGE_BYTES,
        timeoutMs: Math.min(15_000, Math.max(1000, timeLeft())),
        accept: 'text/html,application/xhtml+xml',
      });
      if (!/html|xml/.test(res.contentType))
        throw new FetchError('HTMLのページではありません', 'type');
      report.pages++;
      const page = parseProductPage(
        decodeText(res.body, res.contentType),
        res.url,
      );
      report.skipped.push(...page.skipped);
      for (const p of page.products) {
        if (keys.has(p.key)) continue;
        keys.add(p.key);
        report.products.push(p);
      }
      for (const link of page.links) {
        const next = strip(link);
        if (!seen.has(next) && hosts.has(new URL(next).host)) {
          seen.add(next);
          queue.push(next);
        }
      }
      if (!page.products.length && !page.links.length && !page.skipped.length)
        report.errors.push({
          url: pageUrl,
          message:
            '商品の構造化データ（schema.org の Product / ItemList）が見つかりません',
        });
    } catch (e) {
      report.errors.push({
        url: pageUrl,
        message: e instanceof FetchError ? e.message : '読み込めませんでした',
      });
    }
  }
  if (report.products.length > limits.maxProducts)
    report.products.length = limits.maxProducts;

  const images = await fetchImagesWith(session, report.products);
  report.images = images.images;
  if (images.stoppedEarly) report.stoppedEarly ??= images.stoppedEarly;
  return report;
}

/** Product images, with the same guard, robots.txt and pauses as pages. */
export async function fetchProductImages(
  products: ParsedProduct[],
  fetcher: Fetcher,
  limits: ImportLimits = DEFAULT_LIMITS,
  now: () => number = Date.now,
) {
  return fetchImagesWith(createSession(fetcher, limits, now), products);
}

async function fetchImagesWith(session: Session, products: ParsedProduct[]) {
  const { limits, fetcher, timeLeft, robotsFor, polite } = session;
  const images = new Map<string, FetchedImage>();
  let stoppedEarly: string | undefined;
  const wanted = [
    ...new Set(products.map((p) => p.image).filter((u): u is string => !!u)),
  ];
  for (const imageUrl of wanted.slice(0, limits.maxImages)) {
    if (timeLeft() < 1500) {
      stoppedEarly = '時間の上限に達したため、一部の商品画像は読みませんでした';
      break;
    }
    try {
      const url = new URL(imageUrl);
      const robots = await robotsFor(url);
      if (!isAllowed(robots, url.pathname + url.search)) continue;
      await polite(url, robots);
      const res = await fetcher(imageUrl, {
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: Math.min(10_000, Math.max(1000, timeLeft())),
        accept: 'image/webp,image/png,image/jpeg,image/gif',
      });
      const mime = sniffImage(res.body);
      if (!mime) continue;
      images.set(imageUrl, {
        mime,
        sha256: createHash('sha256').update(res.body).digest('hex'),
        content: res.body,
      });
    } catch {
      // A missing image does not stop the import; the item shows without it.
    }
  }
  return { images, stoppedEarly };
}
