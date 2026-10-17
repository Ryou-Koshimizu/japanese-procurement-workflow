// Shared pieces of the application operations. Every query runs through
// asUser(), so row-level security and the workflow triggers in db/schema.sql
// decide what each person may see and do; the checks here only turn input
// into clear messages.
import { z } from 'zod';
import { AppError, type Database, type Sql } from '../db';
import type { Session } from '../auth';
import type { Fetcher } from '../net';
import type { MailTransport } from '../mailer';
import type { Role, Status } from '../../core/workflow';
import { addDays, todayInJapan } from '../config';

export type Deps = {
  db: Database;
  /** The guarded network fetcher, or the demo supplier on disk. */
  fetcher: Fetcher;
  mail: MailTransport;
  /** Public origin for links in emails (live mode). */
  origin: string | null;
  demo: boolean;
};

export const ctx = (s: Session) => ({ userId: s.userId, orgId: s.orgId });
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LIST_LIMIT = 300;
export const AGENTS: Role[] = ['agent', 'admin'];

export function id(value: unknown, what = '対象'): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AppError(404, `${what}が見つかりません。`, 'NOT_FOUND');
  return value;
}

/** Optional text: trimmed, line breaks normalized, null when empty. */
export function text(
  value: unknown,
  max: number,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    throw new AppError(400, `${label}の形式が正しくありません。`);
  const t = value.replace(/\r\n?/g, '\n').trim();
  if ([...t].length > max)
    throw new AppError(400, `${label}は${max}文字以内で入力してください。`);
  return t || null;
}

/** Required text. */
export function required(value: unknown, max: number, label: string): string {
  const t = text(value, max, label);
  if (!t) throw new AppError(400, `${label}を入力してください。`);
  return t;
}

export function requireRole(s: Session, roles: Role[], message: string) {
  if (!roles.includes(s.role)) throw new AppError(403, message, 'FORBIDDEN');
}

export const requireAgent = (s: Session) =>
  requireRole(s, AGENTS, 'B社の担当者の操作です。');
export const requireClient = (s: Session) =>
  requireRole(s, ['client'], 'A社の担当者の操作です。');
export const requireAdmin = (s: Session) =>
  requireRole(s, ['admin'], 'B社の管理者の操作です。');

export const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not). */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A date input: YYYY-MM-DD, real, and within [today + from, today + to] days. */
export function dateInput(
  value: unknown,
  label: string,
  range: { from?: number; to?: number } = {},
): string {
  if (typeof value !== 'string' || !isDate(value))
    throw new AppError(400, `${label}の日付が正しくありません。`);
  const today = todayInJapan();
  if (range.from !== undefined && value < addDays(today, range.from))
    throw new AppError(
      400,
      range.from === 0
        ? `${label}は今日以降の日付にしてください。`
        : `${label}の日付が早すぎます。`,
    );
  if (range.to !== undefined && value > addDays(today, range.to))
    throw new AppError(
      400,
      `${label}は今日から${range.to}日以内で指定してください。`,
    );
  return value;
}

export const yenInt = (max: number) => z.number().int().min(0).max(max);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

export const toNumber = <T extends Record<string, unknown>>(
  row: T,
  keys: (keyof T)[],
) => {
  for (const k of keys)
    if (row[k] !== null && row[k] !== undefined)
      (row as Record<string, unknown>)[k as string] = Number(row[k]);
  return row;
};

/**
 * Lock the order first, in every change to it, so the changes to one request
 * queue up in the same order app.issue_quote takes its locks (the order, then
 * the maker quote) and never deadlock.
 */
export async function lockOrder(tx: Sql, orderId: string) {
  const r = await tx.query<{ status: Status; current_quote_id: string | null }>(
    'SELECT status, current_quote_id FROM app.orders WHERE id = $1 FOR UPDATE',
    [orderId],
  );
  if (!r.rows[0])
    throw new AppError(404, '依頼が見つかりません。', 'NOT_FOUND');
  return r.rows[0];
}

/** The request is not in a status that allows this; the screen is out of date. */
export const wrongState = () =>
  new AppError(
    409,
    'この依頼は今この操作ができません。画面を更新して確認してください。',
    'STATE',
  );

export function expectStatus(status: Status, allowed: Status[]) {
  if (!allowed.includes(status)) throw wrongState();
}
