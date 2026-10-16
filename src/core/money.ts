// Amount rules shared by the screens and the notifications. The database
// applies the same rules in db/schema.sql (app.tax_amount, app.price_before_tax,
// app.quote_issue) and is the authority; tests/money.test.ts compares the two.

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

/** Totals of a quote: shipping is taxed at the standard rate. */
export function quoteTotals(lines: AmountLine[], shippingFee = 0): Totals {
  let sum10 = 0;
  let sum8 = 0;
  for (const l of lines) {
    const amount = l.unitPrice * l.qty;
    if (l.taxRate === 10) sum10 += amount;
    else sum8 += amount;
  }
  const subtotal10 = sum10 + shippingFee;
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
