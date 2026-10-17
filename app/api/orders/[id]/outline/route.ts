import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { setOutline } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PUT = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await setOutline(deps, s, id, body.lines);
  return Response.json({ ok: true, result: result ?? null });
});
