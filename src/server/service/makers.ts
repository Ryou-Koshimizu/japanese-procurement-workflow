// Makers B社 asks for quotes (B社 only). Deactivated, never deleted.
import { z } from 'zod';
import { asUser, AppError } from '../db';
import type { Session } from '../auth';
import { ctx, emailSchema, id, requireAgent, UUID, type Deps } from './common';

export type Maker = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string;
  phone: string | null;
  note: string | null;
  catalog_source_id: string | null;
  catalog_name: string | null;
  active: boolean;
  updated_at: string;
};

export async function listMakers(deps: Deps, s: Session): Promise<Maker[]> {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<Maker>(
      `SELECT m.id, m.name, m.contact_name, m.email, m.phone, m.note, m.catalog_source_id,
              c.name AS catalog_name, m.active, m.updated_at
         FROM app.makers m LEFT JOIN app.catalog_sources c ON c.id = m.catalog_source_id
        ORDER BY m.active DESC, m.created_at, m.name`,
    );
    return r.rows;
  });
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const makerInput = z.object({
  name: z.string().trim().min(1).max(100),
  contact_name: opt(100),
  email: emailSchema,
  phone: opt(30),
  note: opt(1000),
  catalog_source_id: z
    .union([z.string().regex(UUID), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  active: z.boolean().default(true),
});

function check(raw: unknown) {
  const p = makerInput.safeParse(raw);
  if (!p.success) {
    const fields: Record<string, string> = {};
    for (const issue of p.error.issues) {
      const k = String(issue.path[0] ?? '_');
      fields[k] ??=
        k === 'name'
          ? '名前を1〜100文字で入力してください。'
          : k === 'email'
            ? '見積の依頼を送るメールアドレスを正しく入力してください。'
            : k === 'phone'
              ? '電話番号は30文字以内で入力してください。'
              : '入力内容を確認してください。';
    }
    throw new AppError(400, Object.values(fields)[0], 'INVALID_MAKER', fields);
  }
  return p.data;
}

export async function createMaker(deps: Deps, s: Session, raw: unknown) {
  requireAgent(s);
  const m = check(raw);
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.makers (org_id, name, contact_name, email, phone, note, catalog_source_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        s.orgId,
        m.name,
        m.contact_name,
        m.email,
        m.phone,
        m.note,
        m.catalog_source_id,
        m.active,
      ],
    );
    return r.rows[0].id;
  });
}

export async function updateMaker(
  deps: Deps,
  s: Session,
  makerId: string,
  raw: unknown,
) {
  requireAgent(s);
  const mid = id(makerId, 'メーカー');
  const m = check(raw);
  await asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query(
      `UPDATE app.makers SET name = $2, contact_name = $3, email = $4, phone = $5, note = $6,
              catalog_source_id = $7, active = $8
        WHERE id = $1 RETURNING id`,
      [
        mid,
        m.name,
        m.contact_name,
        m.email,
        m.phone,
        m.note,
        m.catalog_source_id,
        m.active,
      ],
    );
    if (!r.rows[0])
      throw new AppError(404, 'メーカーが見つかりません。', 'NOT_FOUND');
  });
}
