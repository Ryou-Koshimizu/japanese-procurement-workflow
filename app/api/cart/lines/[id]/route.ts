import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { setCartLine } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 1000);
  const { deps } = await runtime();
  await setCartLine(deps, s, id, body.qty);
  return Response.json({ ok: true });
});
