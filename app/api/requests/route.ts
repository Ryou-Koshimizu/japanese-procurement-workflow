import { route, readJson } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { submitRequest } from '../../../src/server/service';
import { deliverAfterResponse } from '../../../src/server/after';

export const POST = route(async (s, request) => {
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await submitRequest(deps, s, body);
  deliverAfterResponse();
  return Response.json({ ok: true, result: result ?? null });
});
