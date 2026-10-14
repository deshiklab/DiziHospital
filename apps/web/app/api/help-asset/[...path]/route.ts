import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { resolveAssetPath } from '@/lib/help';

/* Serves screenshots out of the mirrored help library.
 *
 * The images live in docs/help-library/assets and are *reference material* — they are streamed for reading,
 * never copied into the app bundle, and the path is resolved strictly inside the assets directory so a crafted
 * URL cannot walk out of it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const file = resolveAssetPath(path ?? []);
  if (!file) return new Response('Not found', { status: 404 });

  const type = file.endsWith('.png')
    ? 'image/png'
    : file.endsWith('.webp')
      ? 'image/webp'
      : file.endsWith('.gif')
        ? 'image/gif'
        : 'image/jpeg';

  const size = statSync(file).size;
  const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      'content-type': type,
      'content-length': String(size),
      // Immutable source material: a mirrored screenshot never changes under the same name.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
