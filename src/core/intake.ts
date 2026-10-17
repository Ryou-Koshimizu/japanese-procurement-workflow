// The intake form (規定フォーマット): the questions B社 asks every request.
// B社 admins edit the fields (app.request_fields); a request stores a snapshot
// of the answers. The database checks the same rules when a request is sent
// (app.normalize_answers) and is the authority; these mirror it for screens.

export type FieldKind =
  'text' | 'textarea' | 'number' | 'date' | 'choice' | 'url';
export const FIELD_KINDS: readonly FieldKind[] = [
  'text',
  'textarea',
  'number',
  'date',
  'choice',
  'url',
];

export const fieldKindLabels: Record<FieldKind, string> = {
  text: '1行の文字',
  textarea: '複数行の文字',
  number: '整数',
  date: '日付',
  choice: '選択肢',
  url: 'URL',
};

export type RequestField = {
  id?: string;
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
  help: string;
  position: number;
  active: boolean;
};

/** One stored answer: label and kind are copied from the form at sending time. */
export type Answer = {
  key: string;
  label: string;
  kind: FieldKind;
  value: string | number;
};

export const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_NUMBER_ANSWER = 100_000_000;
const MAX_LENGTH: Record<Exclude<FieldKind, 'number'>, number> = {
  text: 200,
  textarea: 2000,
  url: 2000,
  date: 10,
  choice: 60,
};

const f = (
  position: number,
  key: string,
  label: string,
  kind: FieldKind,
  required: boolean,
  help = '',
): RequestField => ({
  key,
  label,
  kind,
  required,
  options: [],
  help,
  position,
  active: true,
});

/** Seeded for every new organization (demo seed and scripts/create-org.ts). */
export const DEFAULT_REQUEST_FIELDS: readonly RequestField[] = [
  f(10, 'item', 'ほしい物', 'text', true, '例：受付カウンター、収納棚'),
  f(
    20,
    'purpose',
    '使い道・理由',
    'textarea',
    true,
    '例：今のカウンターが壊れた、席を増やす',
  ),
  f(30, 'place', '置く場所', 'text', true, '例：1階 入口の右側'),
  f(40, 'size', '置く場所の寸法', 'text', false, '幅×奥行×高さ（cm）'),
  f(50, 'quantity', '数量', 'number', true),
  f(
    60,
    'current_model',
    '今使っている物の型番',
    'text',
    false,
    '買い替えのときだけ',
  ),
  f(70, 'budget', '予算の目安（円・税抜）', 'number', false),
  f(
    80,
    'delivery',
    '搬入の条件',
    'textarea',
    false,
    '例：2階、エレベーターなし、搬入口の幅80cm',
  ),
  f(90, 'reference_url', '参考になる商品のページ', 'url', false),
];

/** Same characters as app.trim_text: ASCII whitespace and the full-width space. */
export const trimText = (s: string) =>
  s.replace(/^[ \t\n\r\f\v　]+|[ \t\n\r\f\v　]+$/g, '');

/**
 * A web address that is safe to link to: it parses as a URL and its scheme is
 * http or https. Returns the normalized address, or null for anything else.
 */
export function safeHttpUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Length in characters (code points), like PostgreSQL's length(). */
export const textLength = (s: string) => [...s].length;

function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d
  );
}

const MESSAGES = {
  malformed: '回答の形式が正しくありません。',
  unknown: 'この項目はフォームにありません。',
  duplicate: '同じ項目が2回あります。',
  required: '入力してください。',
  number: '0〜100,000,000の整数で入力してください。',
  text: '文字で入力してください。',
  url: 'http:// か https:// で始まるURLを入力してください。',
  date: '日付を正しく入力してください。',
  choice: '選択肢から選んでください。',
};

function checkValue(
  field: RequestField,
  raw: unknown,
): { value: string | number } | { error: string } {
  if (field.kind === 'number') {
    let n: number | null = null;
    if (typeof raw === 'number') n = raw;
    else if (typeof raw === 'string') {
      const s = trimText(raw.normalize('NFKC')).replace(/,/g, '');
      if (/^\d{1,9}$/.test(s)) n = Number(s);
    }
    if (n === null || !Number.isInteger(n) || n < 0 || n > MAX_NUMBER_ANSWER)
      return { error: MESSAGES.number };
    return { value: n };
  }
  if (typeof raw !== 'string') return { error: MESSAGES.text };
  const s = trimText(raw);
  switch (field.kind) {
    case 'text':
    case 'textarea':
      if (textLength(s) > MAX_LENGTH[field.kind])
        return {
          error: `${MAX_LENGTH[field.kind].toLocaleString('ja-JP')}文字以内で入力してください。`,
        };
      break;
    case 'url':
      if (
        !/^https?:\/\/\S+$/.test(s) ||
        textLength(s) > MAX_LENGTH.url ||
        !safeHttpUrl(s)
      )
        return { error: MESSAGES.url };
      break;
    case 'date':
      if (!isDate(s)) return { error: MESSAGES.date };
      break;
    case 'choice':
      if (!field.options.includes(s)) return { error: MESSAGES.choice };
      break;
  }
  return { value: s };
}

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && trimText(v) === '');

/**
 * Check the answers to the active fields and return them as the database
 * stores them: in form order, label and kind from the form, values trimmed,
 * empty optional answers left out.
 */
export function validateAnswers(
  fields: readonly RequestField[],
  answers: unknown,
):
  | { ok: true; answers: Answer[] }
  | { ok: false; errors: Record<string, string> } {
  const active = fields
    .filter((x) => x.active)
    .sort((a, b) => a.position - b.position);
  const byKey = new Map(active.map((x) => [x.key, x]));
  const errors: Record<string, string> = {};
  const given = new Map<string, unknown>();
  if (!Array.isArray(answers))
    return { ok: false, errors: { _: MESSAGES.malformed } };
  for (const a of answers) {
    if (
      typeof a !== 'object' ||
      a === null ||
      Array.isArray(a) ||
      typeof (a as { key?: unknown }).key !== 'string'
    )
      return { ok: false, errors: { _: MESSAGES.malformed } };
    const { key, value } = a as { key: string; value?: unknown };
    if (given.has(key)) errors[key] = MESSAGES.duplicate;
    else if (!byKey.has(key)) errors[key] = MESSAGES.unknown;
    given.set(key, value);
  }
  const out: Answer[] = [];
  for (const field of active) {
    if (errors[field.key]) continue;
    const raw = given.get(field.key);
    if (isEmpty(raw)) {
      if (field.required) errors[field.key] = MESSAGES.required;
      continue;
    }
    const r = checkValue(field, raw);
    if ('error' in r) errors[field.key] = r.error;
    else
      out.push({
        key: field.key,
        label: field.label,
        kind: field.kind,
        value: r.value,
      });
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, answers: out };
}

/** The checks app.request_fields applies to a field definition. */
export function validateFieldDefinition(
  input: Record<string, unknown>,
): { ok: true } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const { key, label, kind, options, help } = input;
  if (typeof key !== 'string' || !FIELD_KEY.test(key))
    errors.key =
      '半角の英小文字で始まる、英小文字・数字・_ の40文字以内にしてください。';
  if (
    typeof label !== 'string' ||
    textLength(label) < 1 ||
    textLength(label) > 60
  )
    errors.label = '項目名は1〜60文字にしてください。';
  if (typeof kind !== 'string' || !FIELD_KINDS.includes(kind as FieldKind))
    errors.kind = '種類を選んでください。';
  const opts = Array.isArray(options) ? options : null;
  if (
    !opts ||
    (kind === 'choice'
      ? opts.length < 1 ||
        opts.length > 20 ||
        new Set(opts).size !== opts.length ||
        opts.some(
          (o) =>
            typeof o !== 'string' || textLength(o) < 1 || textLength(o) > 60,
        )
      : opts.length > 0)
  )
    errors.options =
      kind === 'choice'
        ? '選択肢は1〜20個、それぞれ1〜60文字で、重ならないようにしてください。'
        : '選択肢は「選択肢」の項目だけに付けられます。';
  if (typeof help !== 'string' || textLength(help) > 200)
    errors.help = '説明は200文字以内にしてください。';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}
