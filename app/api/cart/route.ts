import { route, readJson } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { addToCart } from '../../../src/server/service';

export const POST = route(async (s, request) => {
  const body = await readJson(request, 2000);
  const { deps } = await runtime();
  return Response.json(
    await addToCart(deps, s, String(body.itemId ?? ''), body.qty),
  );
});
