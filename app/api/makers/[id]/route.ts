import { route, readJson } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { updateMaker } from '../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await updateMaker(deps, s, id, body);
  return Response.json({ ok: true, result: result ?? null });
});
