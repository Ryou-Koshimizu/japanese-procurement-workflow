import { route } from '../../../../../../src/server/http';
import { runtime } from '../../../../../../src/server/runtime';
import { importFromSite } from '../../../../../../src/server/service';

// Reading a supplier's pages politely takes time (see src/server/importer.ts).
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, _request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  return Response.json({ summary: await importFromSite(deps, s, id) });
});
