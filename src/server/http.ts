import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError } from './db';
import { sessionFromToken, type Session } from './auth';
import { runtime } from './runtime';
import { publicOrigin } from './config';

export const SESSION_COOKIE = 'procurement_session';

export async function currentSession(): Promise<Session | null> {
  const { deps } = await runtime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionFromToken(deps.db, token);
}

/** For pages: send people without a session to the login screen. */
export async function pageSession(): Promise<Session> {
  const s = await currentSession();
  if (!s) redirect('/login');
  return s;
}

/**
 * Same-origin check for state-changing requests (cookies are SameSite=Lax too).
 * Browsers send Origin and Sec-Fetch-Site on every cross-site POST; requests
 * without them come from non-browser clients, which hold no victim's cookie.
 * Live mode compares against the configured public origin exactly.
 */
export function assertSameOrigin(request: Request) {
  const refuse = () =>
    new AppError(
      403,
      '別のサイトからのリクエストは受け付けません。',
      'BAD_ORIGIN',
    );
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw refuse();
  const origin = request.headers.get('origin');
  if (!origin) return;
  const expected = publicOrigin();
  if (expected) {
    if (origin !== expected) throw refuse();
    return;
  }
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw refuse();
  }
  if (host !== request.headers.get('host')) throw refuse();
}

/** Wrap a route handler: session, origin check and uniform JSON errors. */
export function route<A extends unknown[]>(
  handler: (
    session: Session,
    request: Request,
    ...args: A
  ) => Promise<Response>,
  { auth = true }: { auth?: boolean } = {},
) {
  return async (request: Request, ...args: A): Promise<Response> => {
    try {
      if (request.method !== 'GET') assertSameOrigin(request);
      const session = await currentSession();
      if (auth && !session)
        throw new AppError(401, 'ログインしてください。', 'UNAUTHENTICATED');
      return await handler(session!, request, ...args);
    } catch (e) {
      if (e instanceof AppError)
        return Response.json(
          { error: e.message, code: e.code, fields: e.fields },
          { status: e.status },
        );
      console.error(
        JSON.stringify({ event: 'unhandled_error', name: (e as Error)?.name }),
      );
      return Response.json(
        { error: 'サーバーでエラーが発生しました。', code: 'INTERNAL' },
        { status: 500 },
      );
    }
  };
}

/** Read the body, refusing it as soon as it grows past `limit` bytes. */
export async function readBody(
  request: Request,
  limit: number,
  message = 'リクエストが大きすぎます。',
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new AppError(413, message, 'TOO_LARGE');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new AppError(413, message, 'TOO_LARGE');
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function readJson(
  request: Request,
  limit = 200_000,
): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await readBody(request, limit));
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value;
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'リクエストの形式が正しくありません。');
}
