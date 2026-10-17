import { route } from '../../../../../../src/server/http';
import { runtime } from '../../../../../../src/server/runtime';
import { reopenOutline } from '../../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, _request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  const result = await reopenOutline(deps, s, id);
  return Response.json({ ok: true, result: result ?? null });
});
