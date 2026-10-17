import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { declineMakerQuote } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const { deps } = await runtime();
  const result = await declineMakerQuote(deps, s, id, body.note);
  return Response.json({ ok: true, result: result ?? null });
});
