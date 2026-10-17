// Amount rules shared by the screens and the notifications. The database
// applies the same rules in db/schema.sql (app.tax_amount, app.price_before_tax,
// app.selling_price, app.issue_quote) and is the authority; tests/money.test.ts
// compares the two.

export type TaxRate = 8 | 10;
export const TAX_RATES: readonly TaxRate[] = [10, 8];

/** Consumption tax on one rate's subtotal, rounded down once per document. */
export function taxAmount(subtotal: number, rate: TaxRate): number {
  return Math.floor((subtotal * rate) / 100);
}

/**
 * Price before tax from a listed price. A tax-inclusive price is converted by
 * rounding up: the smallest pre-tax price whose tax-inclusive price, rounded
 * down, is not below the listed one.
 */
export function priceBeforeTax(
  price: number,
  includesTax: boolean,
  rate: TaxRate,
): number {
  if (!includesTax) return price;
  return Math.floor((price * 100 + (100 + rate) - 1) / (100 + rate));
}

export type AmountLine = { unitPrice: number; qty: number; taxRate: TaxRate };

export type Totals = {
  subtotal10: number;
  tax10: number;
  subtotal8: number;
  tax8: number;
  total: number;
};

/** Highest markup on cost a quote may use: 300%, in basis points. */
export const MAX_MARKUP_BP = 30_000;

/**
 * Selling price from the maker's unit cost and a markup in basis points
 * (100 bp = 1%), rounded up to whole yen: ceil(cost × (10000 + bp) / 10000).
 */
export function sellingPrice(unitCost: number, markupBp: number): number {
  return Math.floor((unitCost * (10_000 + markupBp) + 9_999) / 10_000);
}

/**
 * Totals of a quote to A社: shipping and expenses (諸経費) are taxed at the
 * standard rate.
 */
export function quoteTotals(
  lines: AmountLine[],
  shippingFee = 0,
  expenses = 0,
): Totals {
  let sum10 = 0;
  let sum8 = 0;
  for (const l of lines) {
    const amount = l.unitPrice * l.qty;
    if (l.taxRate === 10) sum10 += amount;
    else sum8 += amount;
  }
  const subtotal10 = sum10 + shippingFee + expenses;
  const subtotal8 = sum8;
  const tax10 = taxAmount(subtotal10, 10);
  const tax8 = taxAmount(subtotal8, 8);
  return {
    subtotal10,
    tax10,
    subtotal8,
    tax8,
    total: subtotal10 + tax10 + subtotal8 + tax8,
  };
}

/** What the maker charges B社 before tax: Σ unit cost × qty + the maker's shipping. */
export function costSubtotal(
  lines: { unitCost: number; qty: number }[],
  shippingCost = 0,
): number {
  return lines.reduce((sum, l) => sum + l.unitCost * l.qty, shippingCost);
}

/** B社's profit before tax (may be negative): sales subtotal − cost subtotal. */
export function quoteProfit(
  costSubtotal: number,
  salesSubtotal: number,
): number {
  return salesSubtotal - costSubtotal;
}

export function yen(n: number | string | bigint | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

/** Whole yen from user input such as "1,280" or "¥1280". */
export function parseYen(input: string): number | null {
  const s = input.normalize('NFKC').replace(/[¥,\s円]/g, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}
