import { route, readBody } from '../../../../../../src/server/http';
import { runtime } from '../../../../../../src/server/runtime';
import { importFromCsv } from '../../../../../../src/server/service';
import { MAX_CSV_BYTES } from '../../../../../../src/core/catalog/csv';

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const bytes = await readBody(request, MAX_CSV_BYTES, 'CSVは2MBまでです。');
  const { deps } = await runtime();
  return Response.json({ summary: await importFromCsv(deps, s, id, bytes) });
});
