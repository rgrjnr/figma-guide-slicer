/**
 * The rules for the one asset a project cannot rebuild: its source artwork.
 *
 * Plain ESM for the same reason as `access.mjs` and `session.mjs` next door —
 * `node --test` imports it without a compile step. Nothing here touches the
 * filesystem; it decides a name and a type, and the route does the writing.
 *
 * Why the artwork is stored at all: everything else in a project can be typed
 * again — the subject, the audience, the guides — but the design is a file that
 * only exists on whoever's laptop made it. Without it a reopened project could
 * restore its marks and still render nothing, which is what "Aberto — adicione
 * a arte novamente para ver" used to mean.
 */

/**
 * One name per project, so re-saving replaces the artwork instead of growing a
 * pile of orphans, and so nothing derived from user input ever reaches `join()`.
 * The extension is chosen from a closed table rather than from the uploaded file
 * name — a name is attacker-controlled and an extension is a path.
 */
const EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
});

/** The reverse table, so a stored file is served as what it is. */
const TYPES = Object.freeze(
  Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type])),
);

/**
 * A design is a tall PNG and they run large — the ones in this workspace are
 * a few MB. The cap is here so a wrong file (a video, a PSD) is refused with a
 * sentence instead of filling the volume the JSON database lives on.
 */
export const MAX_ARTWORK_BYTES = 32 * 1024 * 1024;

/** `image/png; charset=binary` → `source.png`, and anything else → null. */
export function artworkFileFor(contentType) {
  const type = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXTENSIONS[type];
  return ext ? `source.${ext}` : null;
}

/**
 * The type to serve a stored artwork as. Reads the extension off our own
 * generated name, and still refuses anything outside the table: the value comes
 * out of projects.json, which is meant to be hand-edited.
 */
export function artworkContentType(fileName) {
  const match = /^source\.([a-z0-9]+)$/.exec(String(fileName ?? "").toLowerCase());
  return match ? (TYPES[match[1]] ?? null) : null;
}
