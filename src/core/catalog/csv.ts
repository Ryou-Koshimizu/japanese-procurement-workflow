// A supplier's product list as CSV (UTF-8 or Shift_JIS, as Japanese systems
// often export). Columns are found by their header, in Japanese or English.
import {
  absoluteUrl,
  cleanText,
  parsePrice,
  productKey,
  type ParsedProduct,
  type Skipped,
} from './product';

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

const COLUMNS = {
  name: ['商品名', '品名', '名称', 'name', 'product_name', 'title'],
  sku: ['品番', '商品コード', '型番', 'sku', 'code', 'item_code', 'jan'],
  price: ['価格', '単価', '販売価格', 'price', 'unit_price'],
  priceIncl: [
    '税込価格',
    '税込単価',
    '価格（税込）',
    '価格(税込)',
    'price_incl_tax',
  ],
  priceExcl: [
    '税抜価格',
    '税抜単価',
    '本体価格',
    '価格（税抜）',
    '価格(税抜)',
    'price_excl_tax',
  ],
  includesTax: ['税込', '税区分', 'price_includes_tax', 'tax_included'],
  taxRate: ['税率', '消費税率', 'tax_rate'],
  brand: ['メーカー', 'ブランド', 'メーカー名', 'brand', 'maker'],
  category: ['カテゴリ', 'カテゴリー', '分類', 'category'],
  unit: ['単位', 'unit'],
  url: ['url', '商品url', '商品ページ', 'product_url'],
  image: ['画像url', '画像', 'image', 'image_url'],
  description: ['説明', '商品説明', 'description'],
  stock: ['在庫', '在庫状況', 'availability', 'stock'],
} as const;

type Column = keyof typeof COLUMNS;

/** UTF-8 when the bytes are valid UTF-8, otherwise Shift_JIS. */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** RFC 4180 rows: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsvRows(text: string, maxRows = MAX_CSV_ROWS + 1) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const normalizeHeader = (h: string) =>
  h.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');

function findColumns(header: string[]): Partial<Record<Column, number>> {
  const normalized = header.map(normalizeHeader);
  const found: Partial<Record<Column, number>> = {};
  for (const [column, names] of Object.entries(COLUMNS) as [
    Column,
    readonly string[],
  ][]) {
    const i = normalized.findIndex((h) =>
      names.some((n) => normalizeHeader(n) === h),
    );
    if (i >= 0) found[column] = i;
  }
  return found;
}

function parseRate(value: string | undefined): 8 | 10 | undefined {
  if (!value) return undefined;
  const v = value.normalize('NFKC').replace(/\s|%|％/g, '');
  if (v === '8' || v === '0.08' || /軽減/.test(v)) return 8;
  if (v === '10' || v === '0.1' || v === '0.10' || /標準/.test(v)) return 10;
  return undefined;
}

function parseIncludesTax(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const v = value.normalize('NFKC').trim().toLowerCase();
  if (['税込', '内税', 'true', '1', 'yes', 'incl'].includes(v)) return true;
  if (['税抜', '税別', '外税', 'false', '0', 'no', 'excl'].includes(v))
    return false;
  return undefined;
}

export type CsvResult = {
  products: ParsedProduct[];
  skipped: Skipped[];
  /** Fatal problems with the file as a whole. */
  error?: string;
};

export function parseCatalogCsv(bytes: Uint8Array): CsvResult {
  if (bytes.byteLength > MAX_CSV_BYTES)
    return { products: [], skipped: [], error: 'CSVは2MBまでです。' };
  const rows = parseCsvRows(decodeCsv(bytes));
  if (rows.length < 2)
    return {
      products: [],
      skipped: [],
      error: '見出し行と1行以上の商品が必要です。',
    };
  const header = rows[0];
  const col = findColumns(header);
  const priceColumn = col.price ?? col.priceIncl ?? col.priceExcl;
  if (col.name === undefined || priceColumn === undefined)
    return {
      products: [],
      skipped: [],
      error:
        '「商品名」と「価格」（または「税込価格」「税抜価格」）の列が見つかりません。',
    };
  const products: ParsedProduct[] = [];
  const skipped: Skipped[] = [];
  const keys = new Set<string>();
  const body = rows.slice(1, MAX_CSV_ROWS + 1);
  if (rows.length > MAX_CSV_ROWS + 1)
    skipped.push({
      where: `${MAX_CSV_ROWS + 2}行目以降`,
      reason: `1回に取り込めるのは${MAX_CSV_ROWS}行までです`,
    });
  body.forEach((row, i) => {
    const where = `${i + 2}行目`;
    const get = (c: Column) => {
      const index = col[c];
      return index === undefined ? undefined : row[index];
    };
    const name = cleanText(get('name'), 200);
    if (!name) {
      skipped.push({ where, reason: '商品名が空です' });
      return;
    }
    const price = parsePrice(row[priceColumn]);
    if (price === null) {
      skipped.push({ name, where, reason: '価格が整数の円で読み取れません' });
      return;
    }
    const includesTax =
      parseIncludesTax(get('includesTax')) ??
      (priceColumn === col.priceIncl
        ? true
        : priceColumn === col.priceExcl
          ? false
          : undefined);
    const stock = get('stock')?.normalize('NFKC').trim().toLowerCase() ?? '';
    const product: ParsedProduct = {
      key: '',
      sku: cleanText(get('sku'), 100),
      name,
      brand: cleanText(get('brand'), 100),
      category: cleanText(get('category'), 100),
      description: cleanText(get('description'), 300),
      unit: cleanText(get('unit'), 20),
      price,
      includesTax,
      taxRate: parseRate(get('taxRate')),
      available: !/^(なし|欠品|品切れ|×|0|false|no|outofstock)$/.test(stock),
      url: absoluteUrl(get('url')),
      image: absoluteUrl(get('image')),
    };
    product.key = productKey(product);
    if (keys.has(product.key)) {
      skipped.push({
        name,
        where,
        reason: '同じ品番（またはURL）が前の行にあります',
      });
      return;
    }
    keys.add(product.key);
    products.push(product);
  });
  return { products, skipped };
}
