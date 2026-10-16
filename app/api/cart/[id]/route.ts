import { route } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { discardCart } from '../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const DELETE = route(async (s, _request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  await discardCart(deps, s, id);
  return Response.json({ ok: true });
});
