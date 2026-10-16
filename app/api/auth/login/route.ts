import { cookies } from 'next/headers';
import { login } from '../../../../src/server/auth';
import { route, readJson, SESSION_COOKIE } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { publicOrigin } from '../../../../src/server/config';
import { AppError } from '../../../../src/server/db';

// Small in-memory brake on password guessing, per account and per client
// address. An attempt is counted before the password is checked (no await in
// between), so parallel requests cannot all pass the check. The account limit
// cannot be dodged by changing the address. The address comes from proxy
// headers, which a client can forge when the app is not behind a proxy that
// overwrites them, so it is only a second layer. The public demo publishes its
// passwords, so there only the address limit applies (otherwise anyone could
// lock the shared demo accounts) — unless no address is known at all.
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 5 * 60_000;
const ACCOUNT_LIMIT = 5;
const ADDRESS_LIMIT = 20;
const MAX_KEYS = 10_000;

function clientAddress(request: Request) {
  // x-real-ip, or the last x-forwarded-for hop (the one our proxy appended).
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').pop();
  return (request.headers.get('x-real-ip') ?? forwarded ?? '')
    .trim()
    .slice(0, 64);
}

/** Count one attempt for every key, or none if any key is over its limit. */
function take(keys: [string, number][], now: number) {
  const current = keys.map(([key]) => {
    const a = attempts.get(key);
    return a && a.until > now ? a.n : 0;
  });
  if (keys.some(([, limit], i) => current[i] >= limit)) return false;
  if (attempts.size + keys.length > MAX_KEYS) {
    for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    while (attempts.size + keys.length > MAX_KEYS)
      attempts.delete(attempts.keys().next().value as string);
  }
  keys.forEach(([key], i) =>
    attempts.set(key, { n: current[i] + 1, until: now + WINDOW_MS }),
  );
  return true;
}

/** Give an attempt back (successful login, or a failure that was not a guess). */
function giveBack(key: string) {
  const a = attempts.get(key);
  if (a && a.n > 1) a.n--;
  else attempts.delete(key);
}

export const POST = route(
  async (_s, request) => {
    const body = await readJson(request, 2000);
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const password = String(body.password ?? '').slice(0, 200);
    const { config, deps, refreshDemo } = await runtime();
    // Shared public demo: start each day's visitors from the original data.
    await refreshDemo?.();
    // Without a proxy header every client would share one address bucket, so
    // twenty failures anywhere would lock everyone out; count accounts only.
    const address = clientAddress(request);
    const keys: [string, number][] = address
      ? [[`address:${address}`, ADDRESS_LIMIT]]
      : [];
    if (config.mode === 'live' || !address)
      keys.push([`account:${email}`, ACCOUNT_LIMIT]);
    if (!take(keys, Date.now()))
      throw new AppError(
        429,
        'ログインの試行が多すぎます。5分後にお試しください。',
        'TOO_MANY',
      );
    let token: string;
    try {
      token = await login(deps.db, email, password);
    } catch (e) {
      if (!(e instanceof AppError && e.code === 'LOGIN_FAILED'))
        keys.forEach(([key]) => giveBack(key));
      throw e;
    }
    attempts.delete(`account:${email}`);
    if (address) giveBack(`address:${address}`);
    const origin = publicOrigin();
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin
        ? origin.startsWith('https:')
        : new URL(request.url).protocol === 'https:' ||
          request.headers.get('x-forwarded-proto') === 'https',
      path: '/',
      maxAge: 12 * 60 * 60,
    });
    return Response.json({ ok: true });
  },
  { auth: false },
);
