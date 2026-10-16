// Build the fictional supplier's shop site into public/demo-supplier/:
// a top page, a catalog page with a schema.org ItemList, one page per product
// with schema.org Product data and robots.txt. The product photos in
// public/demo-supplier/images/ are committed files (generated with ChatGPT
// from scripts/demo-supplier/photo-prompts/) and are not touched here.
//
//   npm run supplier:build
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORIES,
  DEMO_SUPPLIER,
  PRODUCTS,
  type DemoProduct,
} from '../src/demo/supplier-data';

const OUT = 'public/demo-supplier';
const origin = DEMO_SUPPLIER.origin;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
// JSON inside <script>: keep "</script>" and "<!--" from closing or opening anything.
const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}</script>`;

const STYLE = `
:root{--ink:#2d2a32;--muted:#6b6470;--line:#ece4e7;--brand:#b4466a;--bg:#fffafb}
*{box-sizing:border-box}body{margin:0;font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:var(--ink);background:var(--bg);line-height:1.7}
a{color:var(--brand)}header{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid var(--line);background:#fff}
.mark{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f6c1d1,#b4466a)}
header b{font-size:17px}header nav{margin-left:auto;display:flex;gap:18px;font-size:14px}
.fiction{background:#fff3cd;color:#6b4e00;font-size:13px;padding:8px 24px;border-bottom:1px solid #f1df9c}
main{max-width:1080px;margin:0 auto;padding:28px 24px 64px}h1{font-size:26px;margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px;margin-top:22px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:1;display:block}.card div{padding:10px 14px 14px}
.card small{color:var(--muted);display:block}.price{font-weight:700;font-size:17px}.price small{display:inline;font-weight:400;font-size:12px}
.out{color:#9b1c31;font-size:12px;font-weight:700}
.item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px;align-items:start}
.item img{width:100%;border-radius:16px;border:1px solid var(--line)}
dl{display:grid;grid-template-columns:7em 1fr;gap:6px 12px;font-size:14px}dt{color:var(--muted)}
.cats{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.cats span{background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px}
@media (max-width:640px){.item{grid-template-columns:1fr}header nav{display:none}}
`;

function page(title: string, body: string, depth: number, extraHead = '') {
  const up = depth ? '../'.repeat(depth) : './';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}｜${esc(DEMO_SUPPLIER.name)}</title>
<style>${STYLE}</style>
${extraHead}
</head>
<body>
<header><span class="mark" aria-hidden="true"></span><b>${esc(DEMO_SUPPLIER.name)}</b>
<nav><a href="${up}index.html">トップ</a><a href="${up}catalog.html">商品一覧</a></nav></header>
<p class="fiction">これは「備品発注ワークフロー」の公開デモ用に作った架空の仕入先サイトです。会社・商品・価格はすべて架空で、購入はできません。</p>
<main>${body}</main>
</body>
</html>
`;
}

function card(p: DemoProduct, up: string) {
  return `<a class="card" href="${up}items/${p.sku}.html">
<img src="${up}images/${p.sku}.webp" alt="" width="240" height="240" loading="lazy">
<div><small>${esc(p.brand)}</small>${esc(p.name)}
<span class="price">${yen(p.price)}<small>（税込）</small></span>${p.inStock ? '' : '<span class="out">在庫切れ</span>'}</div></a>`;
}

function buildPages() {
  mkdirSync(join(OUT, 'items'), { recursive: true });
  writeFileSync(
    join(OUT, 'index.html'),
    page(
      'トップ',
      `<h1>店舗・オフィスの備品をまとめて</h1>
<p>消耗品から衛生用品、来客用の飲料まで${PRODUCTS.length}点を取り扱っています。</p>
<div class="cats">${CATEGORIES.map((c) => `<span>${esc(c.name)}</span>`).join('')}</div>
<p><a href="catalog.html">商品一覧を見る →</a></p>`,
      0,
    ),
  );
  writeFileSync(
    join(OUT, 'catalog.html'),
    page(
      '商品一覧',
      `<h1>商品一覧</h1><p>価格はすべて税込です。</p>
<div class="grid">${PRODUCTS.map((p) => card(p, './')).join('\n')}</div>`,
      0,
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: '商品一覧',
        numberOfItems: PRODUCTS.length,
        itemListElement: PRODUCTS.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${origin}/items/${p.sku}.html`,
          name: p.name,
        })),
      }),
    ),
  );
  for (const p of PRODUCTS) {
    const url = `${origin}/items/${p.sku}.html`;
    writeFileSync(
      join(OUT, 'items', `${p.sku}.html`),
      page(
        p.name,
        `<div class="item"><img src="../images/${p.sku}.webp" alt="${esc(p.name)}" width="480" height="480">
<div><small>${esc(p.brand)}</small><h1>${esc(p.name)}</h1>
<p class="price">${yen(p.price)}<small>（税込）</small> / ${esc(p.unit)}</p>
${p.inStock ? '<p>在庫あり</p>' : '<p class="out">在庫切れ（入荷待ち）</p>'}
<p>${esc(p.description)}</p>
<dl><dt>品番</dt><dd>${p.sku}</dd><dt>カテゴリ</dt><dd>${esc(p.category)}</dd><dt>単位</dt><dd>${esc(p.unit)}</dd></dl>
<p><a href="../catalog.html">← 商品一覧へ</a></p></div></div>`,
        1,
        `<link rel="canonical" href="${url}">\n` +
          jsonLd({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: p.name,
            sku: p.sku,
            brand: { '@type': 'Brand', name: p.brand },
            category: `備品 > ${p.category}`,
            description: p.description,
            image: `${origin}/images/${p.sku}.webp`,
            url,
            offers: {
              '@type': 'Offer',
              url,
              price: p.price,
              priceCurrency: 'JPY',
              availability: p.inStock
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: p.price,
                priceCurrency: 'JPY',
                valueAddedTaxIncluded: true,
                referenceQuantity: {
                  '@type': 'QuantitativeValue',
                  value: 1,
                  unitText: p.unit,
                },
              },
            },
          }),
      ),
    );
  }
  writeFileSync(
    join(OUT, 'robots.txt'),
    'User-agent: *\nAllow: /\nDisallow: /cart/\n',
  );
}

buildPages();
const missing = PRODUCTS.filter(
  (p) => !existsSync(join(OUT, 'images', `${p.sku}.webp`)),
);
if (missing.length)
  throw new Error(
    `Missing product photos: ${missing.map((p) => p.sku).join(', ')}`,
  );
console.log(`Built ${PRODUCTS.length} products into ${OUT}/`);
