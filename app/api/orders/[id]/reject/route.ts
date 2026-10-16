import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { rejectOrder } from '../../../../../src/server/service';
import { deliverAfterResponse } from '../../../../../src/server/after';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await rejectOrder(deps, s, id, body.reason);
  deliverAfterResponse();
  return Response.json({ ok: true, result: result ?? null });
});
