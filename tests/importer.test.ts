import { describe, expect, it } from 'vitest';
import { crawlCatalog, DEFAULT_LIMITS } from '../src/server/importer';
import { FetchError, type Fetcher } from '../src/server/net';
import { demoSupplierFetcher } from '../src/server/demo-supplier';
import { DEMO_SUPPLIER, PRODUCTS } from '../src/demo/supplier-data';

const fast = { ...DEFAULT_LIMITS, delayMs: 0 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

/** A fake site: path -> [content type, body], or a status code. */
function site(pages: Record<string, [string, string | Buffer] | number>) {
  const requested: string[] = [];
  const fetcher: Fetcher = async (url) => {
    requested.push(url);
    const page =
      pages[new URL(url).pathname + new URL(url).search] ?? pages[url];
    if (page === undefined || typeof page === 'number')
      throw new FetchError(
        `サーバーが ${page ?? 404} を返しました`,
        'http',
        page ?? 404,
      );
    return {
      url,
      status: 200,
      contentType: page[0],
      body: Buffer.from(page[1]),
    };
  };
  return { fetcher, requested };
}
const html = (data: unknown) =>
  [
    'text/html',
    `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
  ] as [string, string];

describe('crawling a supplier site', () => {
  it('reads the list, follows same-host product pages and copies images', async () => {
    const s = site({
      '/robots.txt': ['text/plain', 'User-agent: *\nDisallow: /secret\n'],
      '/list': html({
        '@type': 'ItemList',
        itemListElement: [
          { '@type': 'ListItem', url: '/p/1' },
          { '@type': 'ListItem', url: '/secret/2' },
          { '@type': 'ListItem', url: 'https://other.example/p/3' },
        ],
      }),
      '/p/1': html({
        '@type': 'Product',
        sku: 'A1',
        name: '石鹸',
        image: '/i/1.png',
        offers: { price: 100 },
      }),
      '/i/1.png': ['image/png', PNG],
    });
    const r = await crawlCatalog(
      ['https://shop.example/list'],
      s.fetcher,
      fast,
    );
    expect(r.products.map((p) => p.sku)).toEqual(['A1']);
    expect(r.images.get('https://shop.example/i/1.png')?.mime).toBe(
      'image/png',
    );
    expect(r.errors).toEqual([
      {
        url: 'https://shop.example/secret/2',
        message: 'robots.txt で読み込みが禁止されています',
      },
    ]);
    // Never followed to another host, never fetched the disallowed page.
    expect(s.requested).not.toContain('https://other.example/p/3');
    expect(s.requested).not.toContain('https://shop.example/secret/2');
  });

  it('treats a missing robots.txt as allowed but an unreachable one as not', async () => {
    const ok = site({
      '/p': html({ '@type': 'Product', name: 'x', offers: { price: 1 } }),
    });
    expect(
      (await crawlCatalog(['https://a.example/p'], ok.fetcher, fast)).products,
    ).toHaveLength(1);
    const down = site({
      '/robots.txt': 503,
      '/p': html({ '@type': 'Product', name: 'x', offers: { price: 1 } }),
    });
    const r = await crawlCatalog(['https://b.example/p'], down.fetcher, fast);
    expect(r.products).toHaveLength(0);
    expect(r.errors[0].message).toContain('robots.txt を確認できない');
  });

  it('stops at the page limit and says so', async () => {
    const pages: Record<string, [string, string]> = {
      '/robots.txt': ['text/plain', ''],
    };
    for (let i = 0; i < 10; i++)
      pages[`/p/${i}`] = html({
        '@type': 'ItemList',
        itemListElement: [{ '@type': 'ListItem', url: `/p/${i + 1}` }],
      });
    const r = await crawlCatalog(
      ['https://c.example/p/0'],
      site(pages).fetcher,
      { ...fast, maxPages: 3 },
    );
    expect(r.pages).toBe(3);
    expect(r.stoppedEarly).toContain('3ページ');
  });

  it('refuses non-image bodies as images', async () => {
    const s = site({
      '/robots.txt': ['text/plain', ''],
      '/p': html({
        '@type': 'Product',
        name: 'x',
        image: '/evil.svg',
        offers: { price: 1 },
      }),
      '/evil.svg': ['image/svg+xml', '<svg onload="alert(1)"/>'],
    });
    const r = await crawlCatalog(['https://d.example/p'], s.fetcher, fast);
    expect(r.images.size).toBe(0);
  });

  it('reads the whole bundled demo supplier site', async () => {
    const r = await crawlCatalog(
      [`${DEMO_SUPPLIER.origin}${DEMO_SUPPLIER.catalogPath}`],
      demoSupplierFetcher(),
      fast,
    );
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(PRODUCTS.length);
    expect(r.images.size).toBe(PRODUCTS.length);
    const tea = r.products.find((p) => p.sku === 'SK-5001')!;
    expect(tea).toMatchObject({
      price: 2808,
      includesTax: true,
      taxRate: 8,
      unit: 'ケース',
    });
    expect(r.products.find((p) => p.sku === 'SK-2004')!.available).toBe(false);
  });

  it('the demo reads nothing outside the bundled site', async () => {
    const r = await crawlCatalog(
      ['https://example.com/'],
      demoSupplierFetcher(),
      fast,
    );
    expect(r.products).toEqual([]);
    expect(r.errors[0].message).toContain('架空の仕入先サイト');
  });
});
