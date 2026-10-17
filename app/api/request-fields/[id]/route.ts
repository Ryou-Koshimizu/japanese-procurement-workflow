import { route, readJson } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { updateRequestField } from '../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await updateRequestField(deps, s, id, body);
  return Response.json({ ok: true, result: result ?? null });
});
