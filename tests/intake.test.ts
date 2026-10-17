// The intake form (規定フォーマット) rules for screens. The database applies the
// same rules when a request is sent (app.normalize_answers) and is the
// authority; tests/database.test.ts checks that both agree.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_FIELDS,
  FIELD_KINDS,
  trimText,
  validateAnswers,
  validateFieldDefinition,
  type RequestField,
} from '../src/core/intake';

const field = (f: Partial<RequestField> & { key: string }): RequestField => ({
  label: f.key,
  kind: 'text',
  required: false,
  options: [],
  help: '',
  position: 100,
  active: true,
  ...f,
});

const fields: RequestField[] = [
  ...DEFAULT_REQUEST_FIELDS,
  field({
    key: 'color',
    label: '色',
    kind: 'choice',
    options: ['白', '黒'],
    position: 95,
  }),
  field({ key: 'deadline', label: '搬入日', kind: 'date', position: 96 }),
  field({ key: 'old', label: '使わない項目', required: true, active: false }),
];

const valid = [
  { key: 'item', value: '受付カウンター' },
  { key: 'purpose', value: '今のカウンターが壊れた' },
  { key: 'place', value: '1階 入口の右側' },
  { key: 'quantity', value: 2 },
];

const errorsOf = (answers: unknown) => {
  const r = validateAnswers(fields, answers);
  return r.ok ? {} : r.errors;
};

describe('default intake fields', () => {
  it('are the agreed nine, in order, with the required ones marked', () => {
    expect(
      DEFAULT_REQUEST_FIELDS.map((f) => [f.key, f.label, f.kind, f.required]),
    ).toEqual([
      ['item', 'ほしい物', 'text', true],
      ['purpose', '使い道・理由', 'textarea', true],
      ['place', '置く場所', 'text', true],
      ['size', '置く場所の寸法', 'text', false],
      ['quantity', '数量', 'number', true],
      ['current_model', '今使っている物の型番', 'text', false],
      ['budget', '予算の目安（円・税抜）', 'number', false],
      ['delivery', '搬入の条件', 'textarea', false],
      ['reference_url', '参考になる商品のページ', 'url', false],
    ]);
    expect(DEFAULT_REQUEST_FIELDS[0].help).toBe('例：受付カウンター、収納棚');
    expect(DEFAULT_REQUEST_FIELDS[3].help).toBe('幅×奥行×高さ（cm）');
    expect(DEFAULT_REQUEST_FIELDS[4].help).toBe('');
    const positions = DEFAULT_REQUEST_FIELDS.map((f) => f.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const f of DEFAULT_REQUEST_FIELDS)
      expect(validateFieldDefinition(f)).toMatchObject({ ok: true });
  });
});

describe('validateAnswers', () => {
  it('accepts the required answers and snapshots label and kind from the form', () => {
    const r = validateAnswers(fields, [
      ...valid,
      { key: 'reference_url', value: ' https://shop.example/item/1 ' },
      { key: 'color', value: '白', label: '偽のラベル', kind: 'number' },
    ]);
    expect(r).toEqual({
      ok: true,
      answers: [
        {
          key: 'item',
          label: 'ほしい物',
          kind: 'text',
          value: '受付カウンター',
        },
        {
          key: 'purpose',
          label: '使い道・理由',
          kind: 'textarea',
          value: '今のカウンターが壊れた',
        },
        {
          key: 'place',
          label: '置く場所',
          kind: 'text',
          value: '1階 入口の右側',
        },
        { key: 'quantity', label: '数量', kind: 'number', value: 2 },
        {
          key: 'reference_url',
          label: '参考になる商品のページ',
          kind: 'url',
          value: 'https://shop.example/item/1',
        },
        { key: 'color', label: '色', kind: 'choice', value: '白' },
      ],
    });
  });

  it('drops empty optional answers and requires the required ones', () => {
    const r = validateAnswers(fields, [
      ...valid,
      { key: 'size', value: '  ' },
      { key: 'budget', value: null },
    ]);
    expect(r.ok && r.answers.map((a) => a.key)).toEqual([
      'item',
      'purpose',
      'place',
      'quantity',
    ]);
    expect(errorsOf(valid.slice(1))).toEqual({ item: '入力してください。' });
    expect(
      errorsOf([{ key: 'item', value: '　\n' }, ...valid.slice(1)]),
    ).toEqual({ item: '入力してください。' });
  });

  it('ignores inactive fields: they are neither required nor accepted', () => {
    expect(validateAnswers(fields, valid).ok).toBe(true);
    expect(errorsOf([...valid, { key: 'old', value: 'x' }])).toEqual({
      old: 'この項目はフォームにありません。',
    });
  });

  it('refuses unknown and duplicate keys and malformed lists', () => {
    expect(errorsOf([...valid, { key: 'secret', value: 'x' }])).toEqual({
      secret: 'この項目はフォームにありません。',
    });
    expect(errorsOf([...valid, { key: 'item', value: '棚' }])).toEqual({
      item: '同じ項目が2回あります。',
    });
    expect(errorsOf('item=棚')).toEqual({
      _: '回答の形式が正しくありません。',
    });
    expect(errorsOf([...valid, 'x'])).toEqual({
      _: '回答の形式が正しくありません。',
    });
    expect(errorsOf([...valid, { value: 'x' }])).toEqual({
      _: '回答の形式が正しくありません。',
    });
  });

  it('numbers are whole, 0 to 100,000,000; digits typed in a form are read', () => {
    const quantity = (value: unknown) =>
      validateAnswers(fields, [
        ...valid.slice(0, 3),
        { key: 'quantity', value },
      ]);
    expect(quantity('１２')).toMatchObject({ ok: true });
    const r = quantity('1,200');
    expect(r.ok && r.answers[3].value).toBe(1200);
    for (const bad of [1.5, -1, 100_000_001, '1.5', '十', true, '1e3'])
      expect(quantity(bad)).toEqual({
        ok: false,
        errors: { quantity: '0〜100,000,000の整数で入力してください。' },
      });
    expect(quantity(0)).toMatchObject({ ok: true });
    expect(quantity(100_000_000)).toMatchObject({ ok: true });
  });

  it('checks text length in characters, URLs, dates and choices', () => {
    const one = (key: string, value: unknown) =>
      errorsOf([...valid, { key, value }]);
    expect(one('size', 'あ'.repeat(200))).toEqual({});
    expect(one('size', '😀'.repeat(200))).toEqual({});
    expect(one('size', 'あ'.repeat(201))).toEqual({
      size: '200文字以内で入力してください。',
    });
    expect(one('delivery', 'あ'.repeat(2001))).toEqual({
      delivery: '2,000文字以内で入力してください。',
    });
    expect(one('size', 120)).toEqual({ size: '文字で入力してください。' });
    for (const bad of [
      'shop.example/item',
      'javascript:alert(1)',
      'https://a b',
    ])
      expect(one('reference_url', bad)).toEqual({
        reference_url: 'http:// か https:// で始まるURLを入力してください。',
      });
    expect(
      one('reference_url', `https://shop.example/${'a'.repeat(1990)}`),
    ).toEqual({
      reference_url: 'http:// か https:// で始まるURLを入力してください。',
    });
    expect(one('deadline', '2026-11-30')).toEqual({});
    for (const bad of ['2026-02-30', '2026/11/30', '0000-01-01'])
      expect(one('deadline', bad)).toEqual({
        deadline: '日付を正しく入力してください。',
      });
    expect(one('color', '赤')).toEqual({ color: '選択肢から選んでください。' });
  });

  it('collects one error per field', () => {
    expect(
      errorsOf([
        { key: 'quantity', value: 'たくさん' },
        { key: 'reference_url', value: 'ftp://x' },
      ]),
    ).toEqual({
      item: '入力してください。',
      purpose: '入力してください。',
      place: '入力してください。',
      quantity: '0〜100,000,000の整数で入力してください。',
      reference_url: 'http:// か https:// で始まるURLを入力してください。',
    });
  });
});

describe('field definitions', () => {
  it('mirror the database checks on request_fields', () => {
    const ok = {
      key: 'color',
      label: '色',
      kind: 'choice',
      required: false,
      options: ['白', '黒'],
      help: '',
      position: 10,
      active: true,
    };
    expect(validateFieldDefinition(ok)).toMatchObject({ ok: true });
    const errors = (patch: Record<string, unknown>) => {
      const r = validateFieldDefinition({ ...ok, ...patch });
      return r.ok ? {} : r.errors;
    };
    expect(errors({ key: 'Color' })).toHaveProperty('key');
    expect(errors({ key: '1st' })).toHaveProperty('key');
    expect(errors({ key: 'a'.repeat(41) })).toHaveProperty('key');
    expect(errors({ label: '' })).toHaveProperty('label');
    expect(errors({ label: 'あ'.repeat(61) })).toHaveProperty('label');
    expect(errors({ kind: 'file' })).toHaveProperty('kind');
    expect(errors({ options: [] })).toHaveProperty('options');
    expect(errors({ options: ['白', '白'] })).toHaveProperty('options');
    expect(errors({ options: [''] })).toHaveProperty('options');
    expect(
      errors({ options: Array.from({ length: 21 }, (_, i) => `${i}`) }),
    ).toHaveProperty('options');
    expect(errors({ kind: 'text' })).toHaveProperty('options');
    expect(errors({ kind: 'text', options: [] })).toEqual({});
    expect(errors({ help: 'あ'.repeat(201) })).toHaveProperty('help');
    expect(FIELD_KINDS).toEqual([
      'text',
      'textarea',
      'number',
      'date',
      'choice',
      'url',
    ]);
  });

  it('trims spaces, tabs, line breaks and full-width spaces at both ends', () => {
    expect(trimText('　 \t\n 棚 の 上 \n　')).toBe('棚 の 上');
  });
});
