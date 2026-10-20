// Regressions for the two code-scanning alerts (CodeQL):
// js/regex/missing-regexp-anchor in src/server/db.ts and
// js/bad-tag-filter in src/core/catalog/html.ts.
import { describe, expect, it } from 'vitest';
import { AppError, mapDbError } from '../src/server/db';
import { jsonLdBlocks } from '../src/core/catalog/html';

const ruleError = (message: string) =>
  mapDbError({ code: '23514', message }) as AppError;

const FORM = '依頼フォームの回答を確認してください。';

describe('database rule messages', () => {
  it.each([
    'answers must be a list',
    'malformed answer',
    'duplicate answer size',
    'unknown answer color',
    'answer size is required',
    'answer qty must be a whole number',
    'answer url must be a web address',
  ])('maps the intake check "%s" to the form message', (message) => {
    const e = ruleError(message);
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(409);
    expect(e.message).toBe(FORM);
  });

  it.each([
    'request needs an unknown answer later',
    'the maker quote has a malformed answer field',
    'quote has expired: duplicate answer',
  ])(
    'does not take "%s" for an intake error when the words come later',
    (message) => {
      expect(ruleError(message).message).not.toBe(FORM);
    },
  );

  it('still maps the other rules', () => {
    expect(ruleError('request needs a title').message).toBe(
      '件名を入力してください。',
    );
    expect(ruleError('something new').message).toBe(
      '入力が業務ルールを満たしていません。',
    );
  });
});

describe('JSON-LD inside an HTML comment', () => {
  const wrap = (body: string) =>
    `<html><head><script type="application/ld+json">${body}</script></head></html>`;
  const json = '{"@type":"Product","name":"トレー"}';

  it('reads a block closed with -->', () => {
    expect(jsonLdBlocks(wrap(`<!--${json}-->`))).toEqual([
      { '@type': 'Product', name: 'トレー' },
    ]);
  });

  it('reads a block closed with --!> (the other comment end HTML accepts)', () => {
    expect(jsonLdBlocks(wrap(`<!--\n${json}\n--!>`))).toEqual([
      { '@type': 'Product', name: 'トレー' },
    ]);
  });

  it('reads a CDATA-wrapped block', () => {
    expect(jsonLdBlocks(wrap(`//<![CDATA[\n${json}\n//]]>`))).toEqual([
      { '@type': 'Product', name: 'トレー' },
    ]);
  });
});
