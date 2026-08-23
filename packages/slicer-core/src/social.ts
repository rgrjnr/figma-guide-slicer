import type { RasterImage, Bounds, DetectedBand, DetectedCell } from "./types";
import { median, clamp } from "./util";
import { extractGlyph, classifyGlyph } from "./glyphs";

interface Band { y0: number; y1: number; }
interface MaskedBand extends Band { mask: Uint8Array; }
interface Profile { ink: Int32Array; minY: Int32Array; maxY: Int32Array; h: number; }
interface Blob { x0: number; x1: number; w: number; h: number; cx: number; }
interface Chain { chain: Blob[]; pitch: number; score: number; }
interface RawCell { x0: number; x1: number; isIcon: boolean; blob: Blob | null; platform?: string | null; }
interface BestBand { score: number; hit: Chain; band: MaskedBand; prev?: MaskedBand; next?: MaskedBand; }

// ============================================================
// Social Icon Detection
//
// Runs on a render of the whole frame — guides are not required. Two stages:
//
//   1. Vertical: measure how much each scanline differs from the frame's
//      background and segment the frame into horizontal content bands.
//   2. Horizontal: inside each band, project ink onto the x axis and look
//      for a run of evenly spaced, roughly square blobs.
//
// Cells are then split at the midpoints between icon centers, which also
// compensates for low-contrast buttons: if only the white glyph is detected,
// the midpoint split still re-inflates the cell to cover the whole button
// plus padding. Each icon's glyph is finally matched against a small
// template set to name the platform.
// ============================================================

const INK_THRESHOLD = 24;       // per-pixel distance from background, 0-255
const INK_STRONG_THRESHOLD = 60; // decorative art stays below this; content does not
const ASPECT_MIN = 0.5;         // blob w/h bounds — social glyphs are ~square,
const ASPECT_MAX = 1.4;         // wordmarks like "HBO family" are 2.5-4x wide
const MIN_ICONS = 2;
const MAX_ICONS = 6;
const PITCH_TOLERANCE = 0.25;   // consecutive gaps must match within +/-25%
const MAX_SPAN_RATIO = 0.7;     // icon group must not dominate the row
const MAX_ICON_WIDTH_RATIO = 0.25;
const SIZE_UNIFORMITY = 1.35;   // icons in a bar are all the same size
const MIN_BAND_H = 8;
const MAX_BAND_H = 240;
const MIN_CELL_FRAME_PX = 10;   // hairline <td>s break in Outlook
const BOTTOM_PRIOR_BONUS = 15;  // social bars live in footers

// Per-pixel "is this content, not background" mask for the whole frame.
// Background is estimated per scanline from the left/right margins, so a
// vertical gradient does not poison it, and by median rather than mean so a
// wide element bleeding into the margin cannot skew it.
function buildInkMask(imageData: RasterImage, threshold?: number): Uint8Array {
  const inkThreshold = threshold || INK_THRESHOLD;
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  const sample = Math.min(8, Math.max(2, Math.floor(width * 0.02)));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];

  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;

    rs.length = 0; gs.length = 0; bs.length = 0;
    for (let s = 0; s < sample; s++) {
      const xs = [s, width - 1 - s];
      for (let k = 0; k < 2; k++) {
        const i = rowStart + xs[k] * 4;
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      }
    }
    const bgR = median(rs), bgG = median(gs), bgB = median(bs);

    const maskRow = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      const dr = Math.abs(data[i] - bgR);
      const dg = Math.abs(data[i + 1] - bgG);
      const db = Math.abs(data[i + 2] - bgB);
      if ((dr * 2 + dg * 4 + db * 3) / 9 > inkThreshold) mask[maskRow + x] = 1;
    }
  }

  return mask;
}

// Contiguous runs of scanlines that contain content, i.e. candidate rows.
function findBands(mask: Uint8Array, width: number, yStart: number, yEnd: number): Band[] {
  const threshold = Math.max(2, Math.round(width * 0.004));
  const on = new Uint8Array(yEnd - yStart);
  for (let y = yStart; y < yEnd; y++) {
    let count = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) count += mask[row + x];
    on[y - yStart] = count >= threshold ? 1 : 0;
  }

  const bands: Band[] = [];
  let y = 0;
  const span = yEnd - yStart;
  while (y < span) {
    if (!on[y]) { y++; continue; }
    let end = y;
    while (end < span && on[end]) end++;
    bands.push({ y0: yStart + y, y1: yStart + end });
    y = end;
  }
  return bands;
}

function bandColumnProfile(mask: Uint8Array, width: number, y0: number, y1: number): Profile {
  const h = y1 - y0;
  const ink = new Int32Array(width);
  const minY = new Int32Array(width).fill(h);
  const maxY = new Int32Array(width).fill(-1);

  for (let y = y0; y < y1; y++) {
    const row = y * width;
    const ry = y - y0;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        ink[x]++;
        if (ry < minY[x]) minY[x] = ry;
        if (ry > maxY[x]) maxY[x] = ry;
      }
    }
  }
  return { ink, minY, maxY, h };
}

function dilate(mask: Uint8Array, k: number): Uint8Array {
  if (k <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < mask.length; x++) {
    let on = 0;
    for (let d = -k; d <= k && !on; d++) {
      const j = x + d;
      if (j >= 0 && j < mask.length && mask[j]) on = 1;
    }
    out[x] = on;
  }
  return out;
}

function erode(mask: Uint8Array, k: number): Uint8Array {
  if (k <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < mask.length; x++) {
    let on = 1;
    for (let d = -k; d <= k && on; d++) {
      const j = x + d;
      // Out-of-range counts as set, so closing does not eat edge blobs.
      if (j >= 0 && j < mask.length && !mask[j]) on = 0;
    }
    out[x] = on;
  }
  return out;
}

function maskToBlobs(mask: Uint8Array, profile: Profile): Blob[] {
  const blobs: Blob[] = [];
  let x = 0;
  while (x < mask.length) {
    if (!mask[x]) { x++; continue; }
    let end = x;
    while (end < mask.length && mask[end]) end++;

    let top = profile.h, bottom = -1;
    for (let i = x; i < end; i++) {
      if (profile.maxY[i] >= 0) {
        if (profile.minY[i] < top) top = profile.minY[i];
        if (profile.maxY[i] > bottom) bottom = profile.maxY[i];
      }
    }
    if (bottom >= 0) {
      blobs.push({ x0: x, x1: end, w: end - x, h: bottom - top + 1, cx: (x + end) / 2 });
    }
    x = end;
  }
  return blobs;
}

// Longest run of blobs whose consecutive center-to-center gaps all match the
// gap that started the run. This is what isolates the icon cluster from a
// wordmark sitting in the same row.
function longestEvenlySpacedChain(blobs: Blob[]): Blob[] | null {
  let best: Blob[] | null = null;
  for (let i = 0; i < blobs.length - 1; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const pitch = blobs[j].cx - blobs[i].cx;
      if (pitch <= 0) continue;
      const chain = [blobs[i], blobs[j]];
      let last = blobs[j];
      for (let k = j + 1; k < blobs.length; k++) {
        const gap = blobs[k].cx - last.cx;
        if (Math.abs(gap - pitch) <= pitch * PITCH_TOLERANCE) {
          chain.push(blobs[k]);
          last = blobs[k];
        }
      }
      if (!best || chain.length > best.length) best = chain;
    }
  }
  return best;
}

function scoreChain(chain: Blob[] | null, width: number): Chain | null {
  if (!chain || chain.length < MIN_ICONS || chain.length > MAX_ICONS) return null;

  const widths = chain.map(b => b.w);
  const heights = chain.map(b => b.h);
  const minW = Math.min.apply(null, widths), maxW = Math.max.apply(null, widths);
  const minH = Math.min.apply(null, heights), maxH = Math.max.apply(null, heights);

  if (maxW / minW > SIZE_UNIFORMITY) return null;
  if (maxH / minH > SIZE_UNIFORMITY) return null;
  if (maxW > width * MAX_ICON_WIDTH_RATIO) return null;
  if (chain[chain.length - 1].x1 - chain[0].x0 > width * MAX_SPAN_RATIO) return null;

  const gaps: number[] = [];
  for (let i = 1; i < chain.length; i++) gaps.push(chain[i].cx - chain[i - 1].cx);
  const pitch = median(gaps);
  if (pitch <= 0) return null;

  const spread = gaps.reduce((acc, g) => acc + Math.abs(g - pitch), 0) / gaps.length / pitch;
  const aspectPenalty = chain.reduce((acc, b) => acc + Math.abs(b.w / b.h - 1), 0) / chain.length;

  return { chain, pitch, score: chain.length * 100 - spread * 60 - aspectPenalty * 40 };
}

// The right amount of morphological closing depends on the glyph, not on the
// row: a solid circular button needs none, while "in" or a dotted "i" must be
// merged before it reads as one icon. Too much closing fuses adjacent icons
// into one wide blob. So try a range of kernels and keep the best-scoring
// result instead of guessing a single constant.
function detectInBand(mask: Uint8Array, width: number, y0: number, y1: number): Chain | null {
  const profile = bandColumnProfile(mask, width, y0, y1);
  const h = profile.h;

  const minInk = Math.max(2, Math.round(h * 0.02));
  const base = new Uint8Array(width);
  for (let x = 0; x < width; x++) base[x] = profile.ink[x] >= minInk ? 1 : 0;

  const minBlobW = Math.max(3, Math.round(h * 0.15));
  const maxKernel = Math.max(2, Math.round(h * 0.25));
  const kernels = [0, 2, 3, 5, 8, 12, 16, 20].filter(k => k <= maxKernel);

  let best: Chain | null = null;
  for (const k of kernels) {
    let m = erode(dilate(base, k), k);   // close: merge glyph fragments
    m = dilate(erode(m, 2), 2);          // open: drop JPEG speckle

    const blobs = maskToBlobs(m, profile).filter(b => {
      if (b.w < minBlobW || b.h <= 0) return false;
      const aspect = b.w / b.h;
      return aspect >= ASPECT_MIN && aspect <= ASPECT_MAX;
    });
    if (blobs.length < MIN_ICONS) continue;

    const scored = scoreChain(longestEvenlySpacedChain(blobs), width);
    if (scored && (!best || scored.score > best.score)) best = scored;
  }
  return best;
}

// Midpoint split: each icon's cell reaches halfway into the gap on both
// sides, so cells touch edge to edge and every icon sits centered in a cell
// slightly larger than itself. That margin is the padding.
function chainToCells(best: Chain, imageWidth: number, scale: number, frameWidth: number): RawCell[] {
  const { chain, pitch } = best;
  const n = chain.length;
  const centers = chain.map(b => b.cx);

  const bounds: number[] = [Math.max(0, centers[0] - pitch / 2)];
  for (let i = 0; i < n - 1; i++) bounds.push((centers[i] + centers[i + 1]) / 2);
  bounds.push(Math.min(imageWidth, centers[n - 1] + pitch / 2));

  const minCellPx = MIN_CELL_FRAME_PX * scale;
  let left = bounds[0];
  let right = bounds[n];
  if (left < minCellPx) left = 0;
  if (imageWidth - right < minCellPx) right = imageWidth;

  const raw: RawCell[] = [];
  if (left > 0) raw.push({ x0: 0, x1: left, isIcon: false, blob: null });
  for (let i = 0; i < n; i++) {
    raw.push({
      x0: i === 0 ? left : bounds[i],
      x1: i === n - 1 ? right : bounds[i + 1],
      isIcon: true,
      blob: chain[i],
    });
  }
  if (right < imageWidth) raw.push({ x0: right, x1: imageWidth, isIcon: false, blob: null });

  // Convert to frame pixels, forcing contiguity and exact edge alignment so
  // the generated <td> widths sum back to the full row.
  const cells: RawCell[] = [];
  let cursor = 0;
  for (let i = 0; i < raw.length; i++) {
    const isLast = i === raw.length - 1;
    const x1 = isLast ? frameWidth : Math.round(raw[i].x1 / scale);
    if (x1 - cursor < 1) continue;
    cells.push({ x0: cursor, x1, isIcon: raw[i].isIcon, blob: raw[i].blob, platform: null });
    cursor = x1;
  }
  if (cells.length > 0) cells[cells.length - 1].x1 = frameWidth;
  return cells;
}

// Icon bars sit on a row of their own; a chain of word-fragments inside a
// paragraph does not. Demand clear space above and below the band.
const ISOLATION_RATIO = 0.35;

function bandIsIsolated(bands: Band[], i: number, scale: number): boolean {
  const b = bands[i];
  const needed = Math.max(3 * scale, (b.y1 - b.y0) * ISOLATION_RATIO);
  // Sub-MIN_BAND_H neighbours are speckle, not content; look past them.
  const noise = MIN_BAND_H * scale;
  let p = i - 1;
  while (p >= 0 && bands[p].y1 - bands[p].y0 < noise) p--;
  let n = i + 1;
  while (n < bands.length && bands[n].y1 - bands[n].y0 < noise) n++;
  const gapAbove = p >= 0 ? b.y0 - bands[p].y1 : b.y0 + needed;
  const gapBelow = n < bands.length ? bands[n].y0 - b.y1 : needed;
  return gapAbove >= needed && gapBelow >= needed;
}

export function detectSocialBand(
  imageData: RasterImage,
  scale: number,
  frameWidth: number,
  frameHeight: number,
  bounds?: Bounds | null
): DetectedBand | null {
  const { width, height } = imageData;
  const mask = buildInkMask(imageData);

  // The work area selects which bands are *eligible*, but segmentation still
  // runs over the whole image. Windowing the segmentation instead would truncate
  // a band at the window edge and change whether it trips the oversized-band
  // re-split below, which silently loses rows that are found without a work area.
  const yStart = bounds ? clamp(Math.round(bounds.y0 * scale), 0, height) : 0;
  const yEnd = bounds ? clamp(Math.round(bounds.y1 * scale), yStart, height) : height;

  // Decorative art (rings, glows) can bridge separate rows into one giant
  // band. Re-segment any oversized band with a stricter mask the art does
  // not survive, and detect inside those pieces on the strict mask too so
  // the art cannot pollute the column profiles either.
  let strongMask: Uint8Array | null = null;
  const maxBandPx = MAX_BAND_H * scale;
  const bands: MaskedBand[] = [];
  for (const b of findBands(mask, width, 0, height)) {
    if (b.y1 - b.y0 <= maxBandPx) { bands.push({ ...b, mask }); continue; }
    if (!strongMask) strongMask = buildInkMask(imageData, INK_STRONG_THRESHOLD);
    for (const sub of findBands(strongMask, width, b.y0, b.y1)) {
      bands.push({ ...sub, mask: strongMask });
    }
  }

  let bestBand: BestBand | null = null;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.y0 < yStart || b.y1 > yEnd) continue;
    const h = (b.y1 - b.y0) / scale;
    if (h < MIN_BAND_H || h > MAX_BAND_H) continue;
    if (!bandIsIsolated(bands, i, scale)) continue;

    const hit = detectInBand(b.mask, width, b.y0, b.y1);
    if (!hit) continue;

    // Footers are where social bars live; use that only to break ties.
    const center = (b.y0 + b.y1) / 2;
    const score = hit.score + (center > height * 0.7 ? BOTTOM_PRIOR_BONUS : 0);
    if (!bestBand || score > bestBand.score) {
      bestBand = { score, hit, band: b, prev: bands[i - 1], next: bands[i + 1] };
    }
  }
  if (!bestBand) return null;

  const b = bestBand.band;
  const cells = chainToCells(bestBand.hit, width, scale, frameWidth);

  for (const cell of cells) {
    if (!cell.isIcon || !cell.blob) continue;
    const glyph = extractGlyph(
      imageData,
      Math.round(cell.blob.x0), b.y0,
      Math.round(cell.blob.x1), b.y1
    );
    cell.platform = classifyGlyph(glyph);
  }

  // Pad the tight band out toward its neighbours so the row has some
  // breathing room, without reaching into adjacent content.
  const bandH = b.y1 - b.y0;
  const gapAbove = bestBand.prev ? b.y0 - bestBand.prev.y1 : b.y0;
  const gapBelow = bestBand.next ? bestBand.next.y0 - b.y1 : height - b.y1;
  const padTop = b.y0 - Math.min(bandH, Math.floor(gapAbove / 2));
  const padBottom = b.y1 + Math.min(bandH, Math.floor(gapBelow / 2));

  return {
    found: cells.length > 1,
    top: Math.round(b.y0 / scale),
    bottom: Math.round(b.y1 / scale),
    padTop: Math.max(0, Math.round(padTop / scale)),
    padBottom: Math.min(frameHeight, Math.round(padBottom / scale)),
    cells: cells.map(c => ({ x0: c.x0, x1: c.x1, isIcon: c.isIcon, platform: c.platform ?? null })),
  };
}

export const SOCIAL_TUNING = {
  INK_THRESHOLD,
  INK_STRONG_THRESHOLD,
  ASPECT_MIN,
  ASPECT_MAX,
  MIN_ICONS,
  MAX_ICONS,
  PITCH_TOLERANCE,
  MAX_SPAN_RATIO,
  MAX_ICON_WIDTH_RATIO,
  SIZE_UNIFORMITY,
  MIN_BAND_H,
  MAX_BAND_H,
  MIN_CELL_FRAME_PX,
  BOTTOM_PRIOR_BONUS,
};
