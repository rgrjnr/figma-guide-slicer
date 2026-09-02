import { getProject, readArtwork, updateProject, writeArtwork } from "@/lib/server/store";
import { MAX_ARTWORK_BYTES, artworkContentType, artworkFileFor } from "@/lib/server/artwork.mjs";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * A project's source artwork: the file the guides were drawn on.
 *
 * Its own route rather than a field on the project JSON, because a multi-megabyte
 * PNG base64'd into `projects.json` would end that file's other job — being
 * readable and hand-editable — and would be re-sent on every autosave and every
 * project listing. Here it moves exactly twice: once up when the design is
 * saved, once down when the project is reopened.
 *
 * Both methods sit behind the same middleware as everything else, so an
 * unauthenticated request is a 401 before it reaches this file.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return Response.json({ error: "No such project" }, { status: 404 });

  const fileName = project.markup.imageFile;
  const contentType = fileName ? artworkContentType(fileName) : null;
  // A project saved before artwork was stored, or one whose record names
  // something outside the closed table. Both are "there is no art here", which
  // the studio turns back into "adicione a arte novamente".
  if (!fileName || !contentType) return Response.json({ error: "No artwork stored" }, { status: 404 });

  const bytes = readArtwork(id, fileName);
  if (!bytes) return Response.json({ error: "No artwork stored" }, { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      // The URL never changes but the file behind it does, every time the
      // design is replaced. Caching it would show the previous artwork under
      // the current guides, which is the one wrong answer that looks right.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * PUT, not POST: one project has one artwork at one URL, and re-uploading
 * replaces it. The body is the raw image and the type comes from the header —
 * no multipart, because there is exactly one field and nothing to name.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  if (!getProject(id)) return Response.json({ error: "No such project" }, { status: 404 });

  const fileName = artworkFileFor(request.headers.get("content-type"));
  if (!fileName) {
    return Response.json({ error: "A arte precisa ser PNG, JPEG, WebP, GIF ou AVIF." }, { status: 415 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return Response.json({ error: "A arte chegou vazia." }, { status: 400 });
  if (bytes.byteLength > MAX_ARTWORK_BYTES) {
    const mb = Math.round(MAX_ARTWORK_BYTES / (1024 * 1024));
    return Response.json({ error: `A arte passa de ${mb} MB.` }, { status: 413 });
  }

  writeArtwork(id, fileName, bytes);
  // The record is what makes the file findable, so it is updated only after the
  // bytes have landed. The reverse order leaves a project pointing at a file
  // that a failed write never created.
  const project = updateProject(id, { markup: { imageFile: fileName } as never });
  return Response.json({ project });
}
