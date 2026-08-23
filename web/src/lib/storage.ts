// Same two keys, and the same payload shapes, the Figma plugin kept in
// figma.clientStorage — so settings carry across if you use both.
const SETTINGS_KEY = "slicer-settings";
const LINK_CACHE_KEY = "social-link-cache";

export interface StoredSettings {
  minGutter: number;
  minSection: number;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode. Persistence is a convenience, not a requirement.
  }
}

export function loadSettings(fallback: StoredSettings): StoredSettings {
  return read(SETTINGS_KEY, fallback);
}

export function saveSettings(settings: StoredSettings): void {
  write(SETTINGS_KEY, settings);
}

/** platform -> the URL you last used for it, so social links fill themselves in. */
export function loadLinkCache(): Record<string, string> {
  return read<Record<string, string>>(LINK_CACHE_KEY, {});
}

export function rememberLink(platform: string, url: string): void {
  if (!platform || !url) return;
  write(LINK_CACHE_KEY, { ...loadLinkCache(), [platform]: url });
}
