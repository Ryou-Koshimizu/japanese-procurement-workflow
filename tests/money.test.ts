// The screens compute amounts with src/core/money.ts and the database with
// db/schema.sql. The database is the authority; these tests keep the two equal.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  costSubtotal,
  priceBeforeTax,
  quoteProfit,
  quoteTotals,
  sellingPrice,
  taxAmount,
  parseYen,
  yen,
  type TaxRate,
} from '../src/core/money';

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync('db/schema.sql', 'utf8'));
});
afterAll(() => pg.close());

// Deterministic pseudo-random numbers so a failure can be reproduced.
function random(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe('tax and price rules', () => {
  it('rounds tax down once per rate, in TypeScript and SQL alike', async () => {
    const next = random(42);
    for (let i = 0; i < 300; i++) {
      const subtotal = Math.floor(next() * 10_000_000);
      const rate: TaxRate = next() < 0.5 ? 8 : 10;
      const r = await pg.query<{ t: number }>(
        'SELECT app.tax_amount($1, $2)::int AS t',
        [subtotal, rate],
      );
      expect(r.rows[0].t).toBe(taxAmount(subtotal, rate));
    }
  });

  it('converts tax-inclusive prices the same way, and back without loss', async () => {
    const next = random(7);
    for (let i = 0; i < 300; i++) {
      const before = Math.floor(next() * 200_000);
      const rate: TaxRate = next() < 0.5 ? 8 : 10;
      // A shop shows the pre-tax price plus tax rounded down.
      const listed = before + Math.floor((before * rate) / 100);
      const r = await pg.query<{ p: number }>(
        'SELECT app.price_before_tax($1, true, $2) AS p',
        [listed, rate],
      );
      expect(r.rows[0].p).toBe(priceBeforeTax(listed, true, rate));
      expect(priceBeforeTax(listed, true, rate)).toBe(before);
    }
    expect(priceBeforeTax(1000, false, 10)).toBe(1000);
  });

  it('totals a quote per rate with shipping at the standard rate', () => {
    expect(
      quoteTotals(
        [
          { unitPrice: 1980, qty: 2, taxRate: 10 },
          { unitPrice: 1700, qty: 3, taxRate: 10 },
          { unitPrice: 2600, qty: 2, taxRate: 8 },
          { unitPrice: 2180, qty: 1, taxRate: 10 },
        ],
        0,
      ),
    ).toEqual({
      subtotal10: 11240,
      tax10: 1124,
      subtotal8: 5200,
      tax8: 416,
      total: 17980,
    });
    expect(quoteTotals([{ unitPrice: 333, qty: 1, taxRate: 8 }], 99)).toEqual({
      subtotal10: 99,
      tax10: 9,
      subtotal8: 333,
      tax8: 26,
      total: 467,
    });
  });

  it('marks up cost in basis points, rounding up to whole yen', () => {
    expect(sellingPrice(1, 1)).toBe(2);
    expect(sellingPrice(1, 0)).toBe(1);
    expect(sellingPrice(1, 30000)).toBe(4);
    expect(sellingPrice(10000, 2500)).toBe(12500);
    expect(sellingPrice(9999, 1)).toBe(10000);
    expect(sellingPrice(100_000_000, 30000)).toBe(400_000_000);
  });

  it('taxes shipping and expenses at 10% and works out the profit', () => {
    expect(
      quoteTotals([{ unitPrice: 1000, qty: 1, taxRate: 8 }], 500, 300),
    ).toEqual({
      subtotal10: 800,
      tax10: 80,
      subtotal8: 1000,
      tax8: 80,
      total: 1960,
    });
    expect(costSubtotal([{ unitCost: 700, qty: 3 }], 250)).toBe(2350);
    expect(quoteProfit(2350, 2000)).toBe(-350);
  });

  it('parses and formats yen', () => {
    expect(parseYen('１，２８０円')).toBe(1280);
    expect(parseYen('¥1,280')).toBe(1280);
    expect(parseYen('12.5')).toBeNull();
    expect(parseYen('-1')).toBeNull();
    expect(yen(1234567)).toBe('¥1,234,567');
  });
});
