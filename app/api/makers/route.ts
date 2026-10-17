import { route, readJson } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { createMaker } from '../../../src/server/service';

export const POST = route(async (s, request) => {
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await createMaker(deps, s, body);
  return Response.json({ ok: true, result: result ?? null });
});
