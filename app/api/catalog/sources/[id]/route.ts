import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { updateSource } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  await updateSource(deps, s, id, body);
  return Response.json({ ok: true });
});
