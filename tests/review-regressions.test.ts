// Two fixes from the pre-publication review (docs/security-publication.md)
// whose tests went with the cart: an import that read only part of a site
// keeps the unread items, and the request tabs count every request, not only
// the newest LIST_LIMIT shown in the list.
import { describe, expect, it } from 'vitest';
import { deps, fixture, session, submit } from './helpers';
import {
  createSource,
  importFromSite,
  listCatalog,
  listOrders,
  orderStats,
  LIST_LIMIT,
  type Deps,
} from '../src/server/service';
import { FetchError, type Fetcher } from '../src/server/net';

/** A maker site whose pages can be changed between imports. */
function makerSite() {
  const pages: Record<string, string | number> = {};
  const product = (sku: string, name: string, price: number) =>
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name,
      sku,
      offers: { '@type': 'Offer', price, priceCurrency: 'JPY' },
    })}</script>`;
  const list = (...paths: string[]) =>
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'ItemList',
      itemListElement: paths.map((url, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url,
      })),
    })}</script>`;
  const fetcher: Fetcher = async (url) => {
    const page = pages[new URL(url).pathname];
    if (page === undefined || typeof page === 'number')
      throw new FetchError(
        `サーバーが ${page ?? 404} を返しました`,
        'http',
        page ?? 404,
      );
    return {
      url,
      status: 200,
      contentType: url.endsWith('robots.txt') ? 'text/plain' : 'text/html',
      body: Buffer.from(page),
    };
  };
  pages['/robots.txt'] = '';
  pages['/list'] = list('/p/tray', '/p/cup');
  pages['/p/tray'] = product('TR-1', 'トレー', 1200);
  pages['/p/cup'] = product('CP-1', 'カップ', 300);
  return { pages, list, fetcher };
}

describe('importing a maker site', () => {
  it('takes items off only after a complete read', async () => {
    const f = await fixture();
    const site = makerSite();
    const d: Deps = {
      ...deps(f),
      demo: false,
      fetcher: site.fetcher,
    };
    const admin = session(f, 'tanaka');
    const sourceId = await createSource(d, admin, {
      name: 'テストのメーカー',
      kind: 'site',
      urls: ['https://maker.example/list'],
      pricesIncludeTax: false,
      defaultTaxRate: 10,
    });
    const available = async () =>
      Object.fromEntries(
        (await listCatalog(d, admin, { sourceId })).items.map((i) => [
          i.name,
          i.available,
        ]),
      );

    const first = await importFromSite(d, admin, sourceId);
    expect(first.created).toBe(2);
    expect(await available()).toEqual({ トレー: true, カップ: true });

    // The cup's page fails this time: the read is partial, nothing goes.
    site.pages['/p/cup'] = 500;
    const partial = await importFromSite(d, admin, sourceId);
    expect(partial.complete).toBe(false);
    expect(partial.missing).toBe(0);
    expect(await available()).toEqual({ トレー: true, カップ: true });

    // The list stops naming the cup and every page is read: now it goes.
    site.pages['/list'] = site.list('/p/tray');
    const complete = await importFromSite(d, admin, sourceId);
    expect(complete.complete).toBe(true);
    expect(complete.missing).toBe(1);
    expect(await available()).toEqual({ トレー: true, カップ: false });
  });
});

describe('request tabs', () => {
  it(`count every request, beyond the ${LIST_LIMIT} the list shows`, async () => {
    const f = await fixture();
    const before = await orderStats(deps(f), session(f, 'yamada'));
    const extra = LIST_LIMIT + 5 - before.all;
    for (let i = 0; i < extra; i++)
      await submit(f, i % 2 ? 'sato' : 'suzuki', { title: `依頼 ${i}` });

    const stats = await orderStats(deps(f), session(f, 'yamada'));
    expect(stats.all).toBe(LIST_LIMIT + 5);
    const shown = await listOrders(deps(f), session(f, 'yamada'), 'all');
    expect(shown).toHaveLength(LIST_LIMIT);
  }, 120_000);
});
