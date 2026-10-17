import { route } from '../../../../../../src/server/http';
import { runtime } from '../../../../../../src/server/runtime';
import { confirmOutline } from '../../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, _request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  const result = await confirmOutline(deps, s, id);
  return Response.json({ ok: true, result: result ?? null });
});
