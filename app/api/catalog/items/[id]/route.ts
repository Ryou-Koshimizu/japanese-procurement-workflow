import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { updateItem } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 2000);
  const { deps } = await runtime();
  await updateItem(deps, s, id, body);
  return Response.json({ ok: true });
});
