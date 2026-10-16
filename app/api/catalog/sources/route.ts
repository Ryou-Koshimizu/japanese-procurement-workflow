import { route, readJson } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { createSource } from '../../../../src/server/service';

export const POST = route(async (s, request) => {
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  return Response.json({ id: await createSource(deps, s, body) });
});
