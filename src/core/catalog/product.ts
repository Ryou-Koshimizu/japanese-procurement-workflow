// A product as read from a supplier's site or CSV, before it is stored.

export type ParsedProduct = {
  /** Stable key within one supplier: SKU when published, otherwise the URL. */
  key: string;
  sku?: string;
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  unit?: string;
  /** Whole yen as listed. */
  price: number;
  /** Set when the page says so (schema.org valueAddedTaxIncluded). */
  includesTax?: boolean;
  /** Set when the CSV gives a rate. */
  taxRate?: 8 | 10;
  available: boolean;
  url?: string;
  image?: string;
};

export type Skipped = { name?: string; where: string; reason: string };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  yen: '¥',
};

export function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi,
    (m, e: string) => {
      if (e[0] === '#') {
        const code =
          e[1] === 'x' || e[1] === 'X'
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    },
  );
}

/** Plain text: no tags, no control characters, single spaces, at most max chars. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string') return undefined;
  // [^<>] keeps tag removal linear; the cut keeps hostile long values cheap.
  const text = decodeEntities(
    value.slice(0, max * 8 + 200).replace(/<[^<>]*>/g, ' '),
  )
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return [...text].slice(0, max).join('');
}

/**
 * Whole yen from a listed price: 1280, "1280", "1,280", "¥1,280", "1280.00".
 * Fractions of a yen and negative prices are refused.
 */
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isInteger(value) && value >= 0 && value <= 100_000_000
      ? value
      : null;
  if (typeof value !== 'string') return null;
  const s = value
    .normalize('NFKC')
    .replace(/[¥￥,\s円]|JPY/gi, '')
    .replace(/\.0+$/, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= 100_000_000 ? n : null;
}

/** An absolute http(s) URL without credentials or fragment, or undefined. */
export function absoluteUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    return undefined;
  try {
    const u = new URL(decodeEntities(value.trim()), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    if (u.username || u.password) return undefined;
    u.hash = '';
    return u.href;
  } catch {
    return undefined;
  }
}

export function productKey(p: {
  sku?: string;
  url?: string;
  name: string;
}): string {
  if (p.sku) return `sku:${p.sku}`;
  if (p.url) return `url:${p.url}`;
  return `name:${p.name}`;
}
