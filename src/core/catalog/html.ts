// Product data from a supplier's web page: schema.org JSON-LD first (what
// search engines read, so most shops publish it), then Open Graph product
// tags. No scripts are run and nothing but these blocks is read.
import {
  absoluteUrl,
  cleanText,
  parsePrice,
  productKey,
  type ParsedProduct,
  type Skipped,
} from './product';

export type PageResult = {
  products: ParsedProduct[];
  /** Product or list pages named by an ItemList on this page. */
  links: string[];
  skipped: Skipped[];
};

const MAX_NODES = 5000;
const MAX_DEPTH = 12;

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

/** "Product", "schema:Product" and "https://schema.org/Product" alike. */
function types(n: Node): string[] {
  return list(n['@type'])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.split(/[/:#]/).pop()!.toLowerCase());
}

const PRODUCT_TYPES = new Set([
  'product',
  'individualproduct',
  'productmodel',
  'someproducts',
]);
const LIST_TYPES = new Set(['itemlist', 'offercatalog']);

// Tags are found with indexOf, never with patterns like <x[^>]*>: on a page
// of thousands of unclosed "<meta" those take quadratic time.
const MAX_TAG = 4000;

/** Opening tags named `name`, in order, in time linear in the page size. */
function* openTags(html: string, lower: string, name: string) {
  const open = `<${name}`;
  let i = 0;
  let nextGt = -1;
  while ((i = lower.indexOf(open, i)) !== -1) {
    const after = lower[i + open.length];
    if (after === undefined) return;
    if (!/[\s/>]/.test(after)) {
      i += open.length;
      continue;
    }
    if (nextGt < i) nextGt = lower.indexOf('>', i);
    if (nextGt === -1) return;
    if (nextGt - i > MAX_TAG) {
      i += open.length;
      continue;
    }
    yield { tag: html.slice(i, nextGt + 1), end: nextGt + 1 };
    i = nextGt + 1;
  }
}

/** Attribute names (lower case) and values of one tag, in one pass. */
export function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const n = tag.length;
  let i = 1;
  while (i < n && !/[\s/>]/.test(tag[i])) i++; // the tag name
  while (i < n) {
    while (i < n && /[\s/]/.test(tag[i])) i++;
    if (i >= n || tag[i] === '>') break;
    const start = i;
    while (i < n && !/[\s=/>]/.test(tag[i])) i++;
    const name = tag.slice(start, i).toLowerCase();
    while (i < n && /\s/.test(tag[i])) i++;
    if (tag[i] !== '=') {
      if (name && !(name in out)) out[name] = '';
      continue;
    }
    i++;
    while (i < n && /\s/.test(tag[i])) i++;
    let value = '';
    const quote = tag[i];
    if (quote === '"' || quote === "'") {
      const close = tag.indexOf(quote, i + 1);
      value = tag.slice(i + 1, close === -1 ? n : close);
      i = close === -1 ? n : close + 1;
    } else {
      const v = i;
      while (i < n && !/[\s>]/.test(tag[i])) i++;
      value = tag.slice(v, i);
    }
    if (name && !(name in out)) out[name] = value;
  }
  return out;
}

export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const lower = html.toLowerCase();
  let from = 0;
  for (const { tag, end } of openTags(html, lower, 'script')) {
    if (end <= from) continue;
    const type = attributes(tag).type?.trim().toLowerCase();
    if (type !== 'application/ld+json') continue;
    const close = lower.indexOf('</script', end);
    if (close === -1) break;
    from = close;
    const raw = html
      .slice(end, close)
      .trim()
      // An HTML comment may also be closed by "--!>" (the HTML parser
      // accepts it as an incorrectly closed comment), so strip both.
      .replace(/^<!--/, '')
      .replace(/--!?>$/, '')
      .replace(/^\/\/\s*<!\[CDATA\[/, '')
      .replace(/\/\/\s*\]\]>$/, '')
      .trim();
    try {
      out.push(JSON.parse(raw));
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

function text(v: unknown, max: number): string | undefined {
  if (isNode(v)) return cleanText(v.name ?? v['@value'], max);
  if (Array.isArray(v)) return text(v[0], max);
  return cleanText(v, max);
}

function firstImage(v: unknown, base: string): string | undefined {
  for (const item of list(v)) {
    const url = isNode(item)
      ? absoluteUrl(item.contentUrl ?? item.url, base)
      : absoluteUrl(item, base);
    if (url) return url;
  }
  return undefined;
}

type OfferPick = {
  price: number;
  includesTax?: boolean;
  available: boolean;
  unit?: string;
};

/** The price a buyer pays now: not a strikethrough or list price. */
function pickOffer(
  offers: unknown,
  depth = 0,
): OfferPick | { error: string } | null {
  let error: string | null = null;
  for (const o of list(offers)) {
    if (!isNode(o) || depth > 3) continue;
    const kind = types(o);
    if (kind.includes('aggregateoffer') && o.offers) {
      const inner = pickOffer(o.offers, depth + 1);
      if (inner && !('error' in inner)) return inner;
    }
    const currency =
      typeof o.priceCurrency === 'string' ? o.priceCurrency.trim() : '';
    let price = parsePrice(o.price ?? o.lowPrice);
    let includesTax: boolean | undefined;
    let unit: string | undefined;
    for (const spec of list(o.priceSpecification)) {
      if (!isNode(spec)) continue;
      const priceType = String(spec.priceType ?? '').toLowerCase();
      if (/strikethrough|listprice|msrp|srp/.test(priceType)) continue;
      const specPrice = parsePrice(spec.price);
      if (specPrice === null) continue;
      const specCurrency =
        typeof spec.priceCurrency === 'string' ? spec.priceCurrency : '';
      if (specCurrency && specCurrency.toUpperCase() !== 'JPY') continue;
      price ??= specPrice;
      if (specPrice === price) {
        if (typeof spec.valueAddedTaxIncluded === 'boolean')
          includesTax = spec.valueAddedTaxIncluded;
        else if (spec.valueAddedTaxIncluded === 'true') includesTax = true;
        else if (spec.valueAddedTaxIncluded === 'false') includesTax = false;
        if (isNode(spec.referenceQuantity))
          unit = cleanText(spec.referenceQuantity.unitText, 20);
      }
    }
    if (price === null) {
      error ??= '価格が読み取れません';
      continue;
    }
    if (currency && currency.toUpperCase() !== 'JPY') {
      error ??= `通貨が円ではありません（${currency.slice(0, 5)}）`;
      continue;
    }
    if (isNode(o.eligibleQuantity))
      unit ??= cleanText(o.eligibleQuantity.unitText, 20);
    const availability = String(o.availability ?? '');
    const available = !/outofstock|soldout|discontinued/i.test(availability);
    return { price, includesTax, available, unit };
  }
  return error ? { error } : null;
}

/**
 * Shops mark food and drink as 軽減税率 (8%) in the text; schema.org has no
 * field for the rate. Anything else takes the supplier's default rate.
 */
export function reducedRate(...texts: (string | undefined)[]): 8 | undefined {
  return texts.some((t) => t && /軽減税率/.test(t)) ? 8 : undefined;
}

function toProduct(
  n: Node,
  pageUrl: string,
  inherited: { name?: string; brand?: string; category?: string } = {},
): ParsedProduct | Skipped {
  const name = text(n.name, 200) ?? inherited.name;
  const where = absoluteUrl(n.url, pageUrl) ?? pageUrl;
  if (!name) return { where, reason: '商品名がありません' };
  const offer = pickOffer(n.offers);
  if (!offer)
    return { name, where, reason: '価格の情報（offers）がありません' };
  if ('error' in offer) return { name, where, reason: offer.error };
  const sku = text(n.sku ?? n.mpn ?? n.gtin13 ?? n.gtin ?? n.productID, 100);
  const category = text(n.category, 200)
    ?.split(/\s*[>＞/｜|]\s*/)
    .pop();
  const url = absoluteUrl(n.url, pageUrl);
  const description = cleanText(n.description, 300);
  const product: ParsedProduct = {
    key: '',
    sku,
    name,
    brand: text(n.brand, 100) ?? inherited.brand,
    category: category?.slice(0, 100) || inherited.category,
    description,
    taxRate: reducedRate(name, description),
    unit: offer.unit,
    price: offer.price,
    includesTax: offer.includesTax,
    available: offer.available,
    url,
    image: firstImage(n.image, pageUrl),
  };
  product.key = productKey(product);
  return product;
}

export function parseProductPage(html: string, pageUrl: string): PageResult {
  const products: ParsedProduct[] = [];
  const links: string[] = [];
  const skipped: Skipped[] = [];
  let visited = 0;
  let invalidBlocks = 0;

  const visit = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (!isNode(v)) return;
    visited++;
    const t = types(v);
    if (v['@graph']) visit(v['@graph'], depth + 1);
    if (t.includes('productgroup')) {
      const variants = list(v.hasVariant).filter(isNode);
      const inherited = {
        name: text(v.name, 200),
        brand: text(v.brand, 100),
        category: text(v.category, 100),
      };
      if (variants.length) {
        for (const variant of variants) collect(variant, inherited);
        return;
      }
      collect(v);
      return;
    }
    if (t.some((x) => PRODUCT_TYPES.has(x))) {
      collect(v);
      return;
    }
    if (t.includes('offer') && isNode(v.itemOffered)) {
      const item = v.itemOffered;
      visit({ ...item, offers: item.offers ?? v }, depth + 1);
      return;
    }
    if (t.some((x) => LIST_TYPES.has(x))) {
      for (const el of list(v.itemListElement)) {
        if (typeof el === 'string') {
          const url = absoluteUrl(el, pageUrl);
          if (url) links.push(url);
          continue;
        }
        if (!isNode(el)) continue;
        const inner = types(el).includes('listitem') ? (el.item ?? el) : el;
        if (isNode(inner)) {
          const it = types(inner);
          if (
            it.some((x) => PRODUCT_TYPES.has(x)) ||
            it.includes('productgroup') ||
            it.includes('offer')
          ) {
            visit(inner, depth + 1);
            continue;
          }
        }
        const url =
          absoluteUrl(
            isNode(inner) ? (inner.url ?? inner['@id']) : inner,
            pageUrl,
          ) ?? absoluteUrl(el.url, pageUrl);
        if (url) links.push(url);
      }
      return;
    }
    // A collection or web page wrapping the list or the product.
    for (const key of ['mainEntity', 'mainEntityOfPage', 'about']) {
      if (isNode(v[key]) || Array.isArray(v[key])) visit(v[key], depth + 1);
    }
  };

  const collect = (
    n: Node,
    inherited?: { name?: string; brand?: string; category?: string },
  ) => {
    const p = toProduct(n, pageUrl, inherited);
    if ('reason' in p) skipped.push(p);
    else products.push(p);
  };

  for (const block of jsonLdBlocks(html)) {
    if (block === undefined) invalidBlocks++;
    else visit(block, 0);
  }

  if (!products.length && !links.length) {
    const og = openGraphProduct(html, pageUrl);
    if (og && 'reason' in og) skipped.push(og);
    else if (og) products.push(og);
  }

  // A product page usually describes one product without its own URL.
  const canonical = canonicalUrl(html, pageUrl) ?? pageUrl;
  if (products.length === 1 && !products[0].url) {
    products[0].url = canonical;
    products[0].key = productKey(products[0]);
  }
  for (const p of products)
    if (!p.url) {
      p.url = canonical;
      p.key = productKey(p);
    }
  if (invalidBlocks && !products.length)
    skipped.push({
      where: pageUrl,
      reason: `構造化データ（JSON-LD）${invalidBlocks}件がJSONとして読めません`,
    });
  return { products, links: [...new Set(links)], skipped };
}

function metaTags(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const { tag } of openTags(html, html.toLowerCase(), 'meta')) {
    const a = attributes(tag);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content !== undefined && !meta.has(key))
      meta.set(key, a.content);
  }
  return meta;
}

function canonicalUrl(html: string, base: string): string | undefined {
  for (const { tag } of openTags(html, html.toLowerCase(), 'link')) {
    const a = attributes(tag);
    if (a.rel?.toLowerCase() === 'canonical') return absoluteUrl(a.href, base);
  }
  return undefined;
}

/** Open Graph product tags (og:type product, product:price:amount). */
export function openGraphProduct(
  html: string,
  pageUrl: string,
): ParsedProduct | Skipped | null {
  const meta = metaTags(html);
  const type = meta.get('og:type') ?? '';
  const amount =
    meta.get('product:price:amount') ?? meta.get('og:price:amount');
  if (!/product/i.test(type) && amount === undefined) return null;
  const name = cleanText(meta.get('og:title'), 200);
  if (!name) return { where: pageUrl, reason: '商品名がありません' };
  const price = parsePrice(amount);
  if (price === null)
    return { name, where: pageUrl, reason: '価格が読み取れません' };
  const currency =
    meta.get('product:price:currency') ?? meta.get('og:price:currency') ?? '';
  if (currency && currency.toUpperCase() !== 'JPY')
    return {
      name,
      where: pageUrl,
      reason: `通貨が円ではありません（${currency.slice(0, 5)}）`,
    };
  const availability = meta.get('product:availability') ?? '';
  const product: ParsedProduct = {
    key: '',
    sku: cleanText(meta.get('product:retailer_item_id'), 100),
    name,
    brand: cleanText(meta.get('product:brand'), 100),
    description: cleanText(meta.get('og:description'), 300),
    price,
    available: !/out of stock|oos|discontinued/i.test(availability),
    url: absoluteUrl(meta.get('og:url'), pageUrl),
    image: absoluteUrl(meta.get('og:image'), pageUrl),
  };
  product.key = productKey(product);
  return product;
}
