import { cookies } from 'next/headers';
import { logout } from '../../../../src/server/auth';
import { route, SESSION_COOKIE } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';

export const POST = route(
  async () => {
    const store = await cookies();
    const { deps } = await runtime();
    await logout(deps.db, store.get(SESSION_COOKIE)?.value);
    store.delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  },
  { auth: false },
);
