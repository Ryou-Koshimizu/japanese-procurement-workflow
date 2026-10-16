import { describe, expect, it } from 'vitest';
import { parseProductPage } from '../src/core/catalog/html';
import { parseCatalogCsv, parseCsvRows } from '../src/core/catalog/csv';
import { isAllowed, parseRobots } from '../src/core/catalog/robots';
import { parsePrice, cleanText } from '../src/core/catalog/product';

const page = (...blocks: unknown[]) =>
  `<html><head>${blocks
    .map(
      (b) =>
        `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`,
    )
    .join('')}</head><body></body></html>`;

describe('JSON-LD products', () => {
  it('reads a product page with an offer and a price specification', () => {
    const r = parseProductPage(
      page({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'ハンドソープ &amp; 詰替',
        sku: 'HS-2',
        brand: { '@type': 'Brand', name: 'あおば' },
        category: '備品 > 衛生用品',
        image: [{ '@type': 'ImageObject', url: '/img/hs.webp' }],
        offers: {
          '@type': 'Offer',
          price: '1,958',
          priceCurrency: 'JPY',
          availability: 'https://schema.org/InStock',
          priceSpecification: [
            {
              '@type': 'UnitPriceSpecification',
              priceType: 'https://schema.org/StrikethroughPrice',
              price: 2500,
            },
            {
              '@type': 'UnitPriceSpecification',
              price: 1958,
              valueAddedTaxIncluded: true,
              referenceQuantity: { unitText: '袋' },
            },
          ],
        },
      }),
      'https://shop.example/items/hs',
    );
    expect(r.products).toEqual([
      {
        key: 'sku:HS-2',
        sku: 'HS-2',
        name: 'ハンドソープ & 詰替',
        brand: 'あおば',
        category: '衛生用品',
        description: undefined,
        taxRate: undefined,
        unit: '袋',
        price: 1958,
        includesTax: true,
        available: true,
        url: 'https://shop.example/items/hs',
        image: 'https://shop.example/img/hs.webp',
      },
    ]);
  });

  it('follows item lists, graphs, product groups and aggregate offers', () => {
    const r = parseProductPage(
      page(
        {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'BreadcrumbList',
              itemListElement: [{ '@type': 'ListItem', item: '/' }],
            },
            {
              '@type': 'ItemList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, url: '/p/1' },
                {
                  '@type': 'ListItem',
                  position: 2,
                  item: { '@id': 'https://shop.example/p/2' },
                },
                {
                  '@type': 'ListItem',
                  item: {
                    '@type': 'Product',
                    name: '一覧の商品',
                    url: '/p/3',
                    offers: { price: 300 },
                  },
                },
              ],
            },
          ],
        },
        {
          '@type': 'ProductGroup',
          name: 'ゴミ袋',
          hasVariant: [
            {
              '@type': 'Product',
              sku: 'G-45',
              name: 'ゴミ袋 45L',
              offers: {
                '@type': 'AggregateOffer',
                lowPrice: '880',
                priceCurrency: 'JPY',
              },
            },
            {
              '@type': 'Product',
              sku: 'G-70',
              offers: { price: 1080, availability: 'OutOfStock' },
            },
          ],
        },
      ),
      'https://shop.example/list',
    );
    expect(r.links).toEqual([
      'https://shop.example/p/1',
      'https://shop.example/p/2',
    ]);
    expect(
      r.products.map((p) => [p.key, p.name, p.price, p.available]),
    ).toEqual([
      ['url:https://shop.example/p/3', '一覧の商品', 300, true],
      ['sku:G-45', 'ゴミ袋 45L', 880, true],
      ['sku:G-70', 'ゴミ袋', 1080, false],
    ]);
  });

  it('skips foreign currencies, missing prices and broken blocks with a reason', () => {
    const r = parseProductPage(
      page(
        {
          '@type': 'Product',
          name: 'Imported',
          offers: { price: 12.5, priceCurrency: 'USD' },
        },
        { '@type': 'Product', name: '価格なし' },
        '{ not json',
      ),
      'https://shop.example/x',
    );
    expect(r.products).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      '価格が読み取れません',
      '価格の情報（offers）がありません',
      '構造化データ（JSON-LD）1件がJSONとして読めません',
    ]);
  });

  it('marks reduced-rate food and drink from the text', () => {
    const r = parseProductPage(
      page({
        '@type': 'Product',
        name: '緑茶 24本',
        description: '軽減税率（8%）対象',
        offers: { price: 2808 },
      }),
      'https://shop.example/tea',
    );
    expect(r.products[0].taxRate).toBe(8);
  });

  it('falls back to Open Graph product tags', () => {
    const r = parseProductPage(
      `<head><meta property="og:type" content="product"><meta property="og:title" content="モップ">
       <meta property="product:price:amount" content="3080"><meta property="product:price:currency" content="JPY">
       <link rel="canonical" href="https://shop.example/mop"></head>`,
      'https://shop.example/mop?utm=1',
    );
    expect(r.products).toMatchObject([
      { name: 'モップ', price: 3080, url: 'https://shop.example/mop' },
    ]);
  });

  it('never keeps markup, scripts or control characters in text', () => {
    expect(cleanText('<img src=x onerror=alert(1)>石鹸\u0000‮', 50)).toBe(
      '石鹸',
    );
    expect(cleanText('あ'.repeat(10), 3)).toBe('あああ');
  });

  it('reads whole-yen prices only', () => {
    expect(parsePrice('¥1,280')).toBe(1280);
    expect(parsePrice('１２８０円')).toBe(1280);
    expect(parsePrice('1280.00')).toBe(1280);
    expect(parsePrice('1280.5')).toBeNull();
    expect(parsePrice(-1)).toBeNull();
    expect(parsePrice('1e9')).toBeNull();
  });
});

describe('CSV catalogs', () => {
  it('parses quoted fields, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsvRows('a,"b,c","d""e"\r\n"f\ng",h\n')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['f\ng', 'h'],
    ]);
  });

  it('finds Japanese headers, the tax basis and the reduced rate', () => {
    const csv =
      '商品名,品番,税込価格,税率,単位,在庫\nお茶 24本,T-1,"2,808",8%,ケース,あり\nモップ,M-1,3080,10,本,欠品\n';
    const sjis = new TextEncoder().encode(csv);
    const r = parseCatalogCsv(sjis);
    expect(
      r.products.map((p) => [
        p.sku,
        p.price,
        p.includesTax,
        p.taxRate,
        p.unit,
        p.available,
      ]),
    ).toEqual([
      ['T-1', 2808, true, 8, 'ケース', true],
      ['M-1', 3080, true, 10, '本', false],
    ]);
  });

  it('decodes Shift_JIS', async () => {
    // "商品名,価格\n石鹸,100\n" in Shift_JIS.
    const bytes = new Uint8Array([
      0x8f, 0xa4, 0x95, 0x69, 0x96, 0xbc, 0x2c, 0x89, 0xbf, 0x8a, 0x69, 0x0a,
      0x90, 0xce, 0x8c, 0xb2, 0x2c, 0x31, 0x30, 0x30, 0x0a,
    ]);
    expect(parseCatalogCsv(bytes).products).toMatchObject([
      { name: '石鹸', price: 100 },
    ]);
  });

  it('explains what is missing', () => {
    expect(
      parseCatalogCsv(new TextEncoder().encode('名前,値段\nx,1\n')).error,
    ).toContain('商品名');
    const r = parseCatalogCsv(
      new TextEncoder().encode(
        '\uFEFF商品名,価格,品番\n,100,A\nB,abc,B\nC,100,C\nC2,100,C\n',
      ),
    );
    expect(r.products.map((p) => p.name)).toEqual(['C']);
    expect(r.skipped.map((s) => s.where)).toEqual(['2行目', '3行目', '5行目']);
  });
});

describe('robots.txt', () => {
  const txt = `
User-agent: *
Disallow: /cart/
Allow: /cart/public
Crawl-delay: 2

User-agent: ProcurementCatalogBot
Disallow: /private
Disallow: /*.pdf$
`;
  it('uses the group for our token when there is one', () => {
    const r = parseRobots(txt, 'ProcurementCatalogBot');
    expect(isAllowed(r, '/cart/x')).toBe(true);
    expect(isAllowed(r, '/private/a')).toBe(false);
    expect(isAllowed(r, '/a/b.pdf')).toBe(false);
    expect(isAllowed(r, '/a/b.pdf?x')).toBe(true);
    expect(r.crawlDelay).toBeUndefined();
  });
  it('otherwise the * group, longest match first, Allow on a tie', () => {
    const r = parseRobots(txt, 'OtherBot');
    expect(isAllowed(r, '/cart/x')).toBe(false);
    expect(isAllowed(r, '/cart/public/1')).toBe(true);
    expect(r.crawlDelay).toBe(2);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:\n', 'x'), '/')).toBe(
      true,
    );
    expect(
      isAllowed(parseRobots('User-agent: *\nDisallow: /\n', 'x'), '/'),
    ).toBe(false);
  });
});
