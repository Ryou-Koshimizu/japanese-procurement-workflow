// The intake form (規定フォーマット): everyone reads the active fields; B社
// admins add, edit, reorder and deactivate them (never delete).
import { asUser, AppError } from '../db';
import type { Session } from '../auth';
import {
  validateFieldDefinition,
  trimText,
  type FieldKind,
  type RequestField,
} from '../../core/intake';
import { ctx, id, requireAdmin, type Deps } from './common';

export type Field = RequestField & { id: string };

export async function listRequestFields(
  deps: Deps,
  s: Session,
  all = false,
): Promise<Field[]> {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<Field>(
      `SELECT id, key, label, kind, required, options, help, position, active
         FROM app.request_fields
        ${all ? '' : 'WHERE active'}
        ORDER BY position, created_at, key`,
    );
    return r.rows;
  });
}

function fieldInput(raw: unknown, key?: string) {
  const o = (raw ?? {}) as Record<string, unknown>;
  const kind = o.kind as FieldKind;
  const options = Array.isArray(o.options)
    ? o.options
        .map((x) => (typeof x === 'string' ? trimText(x) : x))
        .filter((x) => x !== '')
    : [];
  const input = {
    key: key ?? (typeof o.key === 'string' ? o.key.trim() : o.key),
    label: typeof o.label === 'string' ? trimText(o.label) : o.label,
    kind,
    options: kind === 'choice' ? options : [],
    help: typeof o.help === 'string' ? trimText(o.help) : (o.help ?? ''),
  };
  const check = validateFieldDefinition(input);
  if (!check.ok)
    throw new AppError(
      400,
      Object.values(check.errors)[0] ?? '項目の内容を確認してください。',
      'INVALID_FIELD',
      check.errors,
    );
  return {
    ...(input as {
      key: string;
      label: string;
      kind: FieldKind;
      options: string[];
      help: string;
    }),
    required: o.required === true,
    active: o.active !== false,
  };
}

export async function createRequestField(deps: Deps, s: Session, raw: unknown) {
  requireAdmin(s);
  const f = fieldInput(raw);
  return asUser(deps.db, ctx(s), async (tx) => {
    const pos = await tx.query<{ p: number }>(
      'SELECT coalesce(max(position), 0) + 10 AS p FROM app.request_fields',
    );
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.request_fields (org_id, key, label, kind, required, options, help, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        s.orgId,
        f.key,
        f.label,
        f.kind,
        f.required,
        f.options,
        f.help,
        Math.min(pos.rows[0].p, 100_000),
      ],
    );
    return r.rows[0].id;
  });
}

export async function updateRequestField(
  deps: Deps,
  s: Session,
  fieldId: string,
  raw: unknown,
) {
  requireAdmin(s);
  const fid = id(fieldId, '項目');
  await asUser(deps.db, ctx(s), async (tx) => {
    const cur = await tx.query<{ key: string }>(
      'SELECT key FROM app.request_fields WHERE id = $1',
      [fid],
    );
    if (!cur.rows[0]) throw new AppError(404, '項目が見つかりません。');
    // The key stays: old requests keep their answers under it.
    const f = fieldInput(raw, cur.rows[0].key);
    await tx.query(
      `UPDATE app.request_fields
          SET label = $2, kind = $3, required = $4, options = $5, help = $6, active = $7
        WHERE id = $1`,
      [fid, f.label, f.kind, f.required, f.options, f.help, f.active],
    );
  });
}

/** Swap a field with its neighbour above or below. */
export async function moveRequestField(
  deps: Deps,
  s: Session,
  fieldId: string,
  dir: unknown,
) {
  requireAdmin(s);
  const fid = id(fieldId, '項目');
  if (dir !== 'up' && dir !== 'down')
    throw new AppError(400, '動かす向きが正しくありません。');
  await asUser(deps.db, ctx(s), async (tx) => {
    const rows = (
      await tx.query<{ id: string; position: number }>(
        'SELECT id, position FROM app.request_fields ORDER BY position, created_at, key',
      )
    ).rows;
    const i = rows.findIndex((r) => r.id === fid);
    if (i < 0) throw new AppError(404, '項目が見つかりません。');
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    // Renumber in steps of 10 so positions stay distinct.
    for (const [n, r] of rows.entries())
      if (r.position !== (n + 1) * 10)
        await tx.query(
          'UPDATE app.request_fields SET position = $2 WHERE id = $1',
          [r.id, (n + 1) * 10],
        );
  });
}
