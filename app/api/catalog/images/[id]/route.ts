import { route } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { catalogImage } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const GET = route(async (s, _request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  const img = await catalogImage(deps, s, id);
  // Content-addressed rows never change. The type was checked by magic bytes
  // at import, and the policy keeps an opened image from running anything.
  return new Response(Buffer.from(img.content), {
    headers: {
      'Content-Type': img.mime,
      'Cache-Control': 'private, max-age=604800, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    },
  });
});
