import type { SliceRegion, DetectedBand } from "./types";

/** How close a proposed boundary has to be to an existing guide to reuse it. */
export const GUIDE_SNAP_PX = 10;

/** Normalize a raw guide list: rounded, inside the frame, deduped, ascending. */
export function normalizeGuides(guides: number[], frameHeight: number): number[] {
  const frameH = Math.round(frameHeight);
  const positions = guides
    .map(g => Math.round(g))
    .filter(y => y > 0 && y < frameH);
  return [...new Set(positions)].sort((a, b) => a - b);
}

/**
 * Guides → row regions. With no guides the frame is simply one region, so a
 * guide-less design still exports and detection can add guides afterwards.
 */
export function computeSliceRegions(guides: number[], frameHeight: number): SliceRegion[] {
  const frameH = Math.round(frameHeight);
  const boundaries = [0, ...normalizeGuides(guides, frameH), frameH];
  const regions: SliceRegion[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const y0 = boundaries[i];
    const y1 = boundaries[i + 1];
    if (y1 <= y0) continue;
    regions.push({
      index: i,
      y0,
      y1,
      name: `slice-${String(i + 1).padStart(3, "0")}`,
    });
  }

  return regions;
}

export function snapToGuide(y: number, guides: number[]): number {
  for (const g of guides) {
    if (Math.abs(g - y) <= GUIDE_SNAP_PX) return g;
  }
  return y;
}

/**
 * Decide the row bounds for a detected icon band: prefer a row the user already
 * defined with guides, fall back to the band's own padded bounds.
 */
export function reconcileRowBounds(
  guides: number[],
  frameHeight: number,
  band: DetectedBand
): { y0: number; y1: number; usedExistingGuides: boolean } {
  const frameH = Math.round(frameHeight);
  const sorted = normalizeGuides(guides, frameH);

  const bandH = band.bottom - band.top;
  const center = (band.top + band.bottom) / 2;
  const bounds = [0, ...sorted, frameH];

  let lo = 0;
  let hi = frameH;
  for (let i = 0; i < bounds.length - 1; i++) {
    if (center >= bounds[i] && center < bounds[i + 1]) {
      lo = bounds[i];
      hi = bounds[i + 1];
      break;
    }
  }

  // The user's row counts as "close enough" when it contains the icons and is
  // not so tall that it has clearly swallowed unrelated content.
  const tightEnough = hi - lo <= Math.max(bandH * 3, bandH + 80);
  if (sorted.length > 0 && lo <= band.top && hi >= band.bottom && tightEnough) {
    return { y0: lo, y1: hi, usedExistingGuides: true };
  }

  return {
    y0: Math.max(0, snapToGuide(band.padTop, sorted)),
    y1: Math.min(frameH, snapToGuide(band.padBottom, sorted)),
    usedExistingGuides: false,
  };
}

/** Merge proposed offsets into an existing guide list, deduped by rounded value. */
export function mergeGuides(existing: number[], added: number[], frameHeight: number): number[] {
  return normalizeGuides([...existing, ...added], frameHeight);
}
