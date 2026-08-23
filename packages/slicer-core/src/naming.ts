/**
 * A trailing `(https://…)` in a slice name is the link. Anything else in
 * parentheses is just part of the name.
 */
export function parseLinkFromName(name: string): { cleanName: string; linkUrl: string | null } {
  const match = name.match(/\(([^)]+)\)\s*$/);
  if (match) {
    const url = match[1].trim();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const cleanName = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
      return { cleanName, linkUrl: url };
    }
  }
  return { cleanName: name, linkUrl: null };
}

/** Round-trips with parseLinkFromName, so renaming is idempotent. */
export function formatNameWithLink(cleanName: string, linkUrl?: string | null): string {
  const { cleanName: base } = parseLinkFromName(cleanName);
  return linkUrl ? `${base} (${linkUrl})` : base;
}

export function sanitizeFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "slice"
  );
}

/** A bare host like `example.com` typed into a link field becomes https. */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

/** In-place dedup of `name.ext` collisions: `x.jpg`, `x-1.jpg`, `x-2.jpg`. */
export function dedupeFileNames<T extends { fileName: string }>(entries: T[]): T[] {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const count = seen.get(entry.fileName) || 0;
    seen.set(entry.fileName, count + 1);
    if (count > 0) {
      const dot = entry.fileName.lastIndexOf(".");
      entry.fileName =
        dot < 0
          ? `${entry.fileName}-${count}`
          : `${entry.fileName.slice(0, dot)}-${count}${entry.fileName.slice(dot)}`;
    }
  }
  return entries;
}
