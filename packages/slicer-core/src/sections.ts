import type { RasterImage, Bounds } from "./types";
import { median, clamp } from "./util";


// ============================================================
// Section Detection
//
// Marketing emails are stacks of cards separated by bands of untouched
// background, and those bands are what a human drags a guide through. So:
// find the rows that are pure background, and cut through the middle of the
// thick ones.
//
// "Pure background" is judged per scanline against that row's own median
// colour, never a global one — the frame background is usually a vertical
// gradient, so a global reference would call the whole bottom half content.
// A row crossing a card is not uniform (page background on both sides, card
// in the middle) and so is never a gutter.
//
// The known failure mode is a solid, full-bleed colour block: its interior
// rows are uniform too, so a tall flat area inside one card can read as a
// gap. MIN_GUTTER and MIN_SECTION are the knobs for that, which is why they
// are exposed in the panel rather than hardcoded here.
//
// Decorative background art (gradient rings, glows) crosses the gaps a
// human would still cut through, so a row also counts as background when
// everything deviating from its median is faint — real content is
// high-contrast, ring art is not.
// ============================================================

const SECTION_UNIFORM_TOL = 12;      // per-pixel distance from the row median
const SECTION_DEVIANT_MAX = 0.004;   // JPEG ringing needs a little slack
const SECTION_SOFT_TOL = 45;         // faint decorative art stays below this
const SECTION_SOFT_DEVIANT_MAX = 0.02;
const SECTION_SAMPLES = 240;         // columns sampled per row
const MAX_SECTION_CUTS = 60;

export function detectSectionOffsets(
  imageData: RasterImage,
  scale: number,
  frameHeight: number,
  minGutter: number,
  minSection: number,
  bounds?: Bounds | null
): number[] {
  const { width, height, data } = imageData;
  const step = Math.max(1, Math.floor(width / SECTION_SAMPLES));

  // The work area, if any, only narrows the scan window. Everything below is
  // expressed relative to it, so a cut is never proposed at its own edge.
  const yStart = bounds ? clamp(Math.round(bounds.y0 * scale), 0, height) : 0;
  const yEnd = bounds ? clamp(Math.round(bounds.y1 * scale), yStart, height) : height;
  const rangeTop = Math.round(yStart / scale);
  const rangeBottom = Math.round(yEnd / scale);

  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const uniform = new Uint8Array(height);

  for (let y = yStart; y < yEnd; y++) {
    const rowStart = y * width * 4;

    rs.length = 0; gs.length = 0; bs.length = 0;
    for (let x = 0; x < width; x += step) {
      const i = rowStart + x * 4;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }

    const bgR = median(rs), bgG = median(gs), bgB = median(bs);
    let deviant = 0, strong = 0;
    for (let k = 0; k < rs.length; k++) {
      const d = (Math.abs(rs[k] - bgR) * 2 + Math.abs(gs[k] - bgG) * 4 + Math.abs(bs[k] - bgB) * 3) / 9;
      if (d > SECTION_UNIFORM_TOL) deviant++;
      if (d > SECTION_SOFT_TOL) strong++;
    }
    uniform[y] =
      deviant / rs.length <= SECTION_DEVIANT_MAX ||
      strong / rs.length <= SECTION_SOFT_DEVIANT_MAX ? 1 : 0;
  }

  // Cut through the middle of each thick gap. Gaps touching the top or
  // bottom edge are the frame's own padding, not a boundary between
  // sections, so they are skipped.
  const minGutterPx = Math.max(2, Math.round(minGutter * scale));
  const cuts: number[] = [];
  let y = yStart;
  while (y < yEnd) {
    if (!uniform[y]) { y++; continue; }
    let end = y;
    while (end < yEnd && uniform[end]) end++;
    if (end - y >= minGutterPx && y > yStart && end < yEnd) {
      cuts.push(Math.round(((y + end) / 2) / scale));
    }
    y = end;
  }

  // Drop boundaries that would carve off a sliver — paragraph leading and
  // the gap between a heading and its body both show up as real gaps, and
  // slicing there is noise, not structure.
  const kept: number[] = [];
  let prev = rangeTop;
  for (const c of cuts) {
    if (c - prev < minSection) continue;
    if (rangeBottom - c < minSection) break;
    kept.push(c);
    prev = c;
  }

  return kept;
}

export const SECTION_TUNING = {
  SECTION_UNIFORM_TOL,
  SECTION_DEVIANT_MAX,
  SECTION_SOFT_TOL,
  SECTION_SOFT_DEVIANT_MAX,
  SECTION_SAMPLES,
  MAX_SECTION_CUTS,
};
