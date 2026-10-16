import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { asUser, AppError, type Database } from './db';
import type { Role } from '../core/workflow';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 200)
    throw new AppError(400, 'パスワードは10〜200文字です。');
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, 'base64url'),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Used when the email is unknown so a login takes the same time either way.
let dummyHash: Promise<string> | undefined;

export async function login(db: Database, email: string, password: string) {
  const rows = await asUser(db, null, (tx) =>
    tx.query<{ user_id: string; password_hash: string; org_id: string | null }>(
      'SELECT * FROM app.auth_lookup($1)',
      [email.trim().toLowerCase()],
    ),
  );
  const user = rows.rows[0];
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verifyPassword(
    password,
    user?.password_hash ?? (await dummyHash),
  );
  if (!user || !ok || !user.org_id)
    throw new AppError(
      401,
      'メールアドレスまたはパスワードが違います。',
      'LOGIN_FAILED',
    );
  const token = randomBytes(32).toString('base64url');
  await asUser(db, null, (tx) =>
    tx.query(
      `SELECT app.auth_create_session($1, $2, $3, interval '12 hours')`,
      [tokenHash(token), user.user_id, user.org_id],
    ),
  );
  return token;
}

export type Session = {
  userId: string;
  orgId: string;
  role: Role;
  /** Store staff only. */
  storeId: string | null;
  storeName: string | null;
  userName: string;
  email: string;
  orgName: string;
};

export async function sessionFromToken(
  db: Database,
  token: string | undefined,
) {
  if (!token || token.length > 100) return null;
  const rows = await asUser(db, null, (tx) =>
    tx.query<{
      user_id: string;
      org_id: string;
      role: Role;
      store_id: string | null;
      store_name: string | null;
      user_name: string;
      email: string;
      org_name: string;
    }>('SELECT * FROM app.auth_session($1)', [tokenHash(token)]),
  );
  const s = rows.rows[0];
  return s
    ? ({
        userId: s.user_id,
        orgId: s.org_id,
        role: s.role,
        storeId: s.store_id,
        storeName: s.store_name,
        userName: s.user_name,
        email: s.email,
        orgName: s.org_name,
      } satisfies Session)
    : null;
}

export async function logout(db: Database, token: string | undefined) {
  if (!token) return;
  await asUser(db, null, (tx) =>
    tx.query('SELECT app.auth_delete_session($1)', [tokenHash(token)]),
  );
}
