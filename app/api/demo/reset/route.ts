import { cookies } from 'next/headers';
import { route, SESSION_COOKIE } from '../../../../src/server/http';
import { runtime, resetDemo } from '../../../../src/server/runtime';
import { AppError } from '../../../../src/server/db';

export const POST = route(async (s) => {
  const { config } = await runtime();
  if (config.mode !== 'demo') throw new AppError(404, '見つかりません。');
  if (s.role !== 'admin')
    throw new AppError(403, '管理者の操作です。', 'FORBIDDEN');
  await resetDemo();
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
});
