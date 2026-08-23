import type { RasterImage } from "./types";

interface GlyphCandidate {
  compactness: number;
  cells: number[];
  bx0: number;
  by0: number;
  bw: number;
  bh: number;
  w: number;
}

// ---- Platform identification ----
//
// Each icon's glyph is normalized to a 24x24 binary bitmap and compared
// against reference marks by Jaccard overlap, allowing a small translation.
// Anything that does not clearly win is left unlabelled rather than guessed.

const GLYPH_N = 24;
const GLYPH_ACCEPT = 0.55;
const GLYPH_MARGIN = 0.08;

const PLATFORM_TEMPLATES: Record<string, string> = {
  linkedin: "000700000700fffff0fffff8fffffefffffefffffefffffeff81feff81feff81feff81feff81feff81feff81feff81feff81feff81feff81feff81feff80fe1f807e1f807e",
  facebook: "001fc0003fc0007fc0007fc0007c00007c00007c00007c00007c00ffffc0ffffc0ffffc0ffffc0ffffc0007c00007c00007c00007c00007c00007c00007c00007c00007c00",
  instagram: "7ffff8fffffcf0003ee0001ec0000ec0780fc1fe0fc3ff0ec3ff8ec781cec701cec601cec601cec303cec387cec3ff8ec3ff0ec1fe0ec0000ec0000efffffe7ffffe3ffffc1fffe0",
};

export const PLATFORM_URLS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/company/…",
  facebook: "https://www.facebook.com/…",
  instagram: "https://www.instagram.com/…",
};

function unpackTemplate(hex: string): Uint8Array {
  const out = new Uint8Array(GLYPH_N * GLYPH_N);
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    for (let b = 0; b < 4; b++) out[i * 4 + b] = (nibble >> (3 - b)) & 1;
  }
  return out;
}

const TEMPLATES = Object.keys(PLATFORM_TEMPLATES).map(name => ({
  name,
  bits: unpackTemplate(PLATFORM_TEMPLATES[name]),
}));

// 8-connected components of `want` cells.
function connectedComponents(mask: Uint8Array, w: number, h: number, want: number): number[][] {
  const label = new Int32Array(w * h).fill(-1);
  const comps: number[][] = [];
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== want || label[s] >= 0) continue;
    const idx = comps.length;
    const cells: number[] = [];
    const stack: number[] = [s];
    label[s] = idx;
    while (stack.length) {
      const p = stack.pop() as number;
      cells.push(p);
      const py = (p / w) | 0, px = p % w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = py + dy, nx = px + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] === want && label[q] < 0) { label[q] = idx; stack.push(q); }
        }
      }
    }
    comps.push(cells);
  }
  return comps;
}

// Pull the glyph out of an icon cell as normalized 24x24 bitmaps — one
// candidate per polarity, because a knocked-out glyph on a solid button
// reads as "the plate" in one pass and as "the glyph" in the other, and
// only template scores can tell which one carries the identity. The
// button plate/ring is discarded by dropping components that touch the cell
// border, and stray marks are discarded by keeping only what sits with the
// dominant component (an "i" dot belongs; a guide artifact does not).
export function extractGlyph(
  imageData: RasterImage,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number
): Uint8Array[] | null {
  const w = cx1 - cx0, h = cy1 - cy0;
  if (w < 6 || h < 6) return null;

  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((cy0 + y) * imageData.width + (cx0 + x)) * 4;
      lum[y * w + x] =
        0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2];
    }
  }

  const sorted = Array.from(lum).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  if (hi - lo < 20) return null;

  const candidates: GlyphCandidate[] = [];
  for (const bright of [true, false]) {
    const thr = lo + (hi - lo) * (bright ? 0.62 : 0.38);
    const m = new Uint8Array(w * h);
    let total = 0;
    for (let i = 0; i < w * h; i++) {
      const on = bright ? lum[i] > thr : lum[i] < thr;
      if (on) { m[i] = 1; total++; }
    }
    if (total < 4 || total > w * h * 0.75) continue;

    const comps = connectedComponents(m, w, h, 1);
    let keep = comps.filter(c => !c.some(p => {
      const px = p % w, py = (p / w) | 0;
      return px === 0 || px === w - 1 || py === 0 || py === h - 1;
    }));
    if (keep.length === 0) keep = comps;

    let main = keep[0];
    for (const c of keep) if (c.length > main.length) main = c;
    let px0 = w, px1 = -1, py0 = h, py1 = -1;
    for (const p of main) {
      const px = p % w, py = (p / w) | 0;
      if (px < px0) px0 = px; if (px > px1) px1 = px;
      if (py < py0) py0 = py; if (py > py1) py1 = py;
    }
    const padx = Math.max(2, Math.round((px1 - px0 + 1) * 0.25));
    const pady = Math.max(2, Math.round((py1 - py0 + 1) * 0.25));

    const cells: number[] = [];
    for (const c of keep) {
      let ok = true;
      for (const p of c) {
        const px = p % w, py = (p / w) | 0;
        if (px < px0 - padx || px > px1 + padx || py < py0 - pady || py > py1 + pady) {
          ok = false;
          break;
        }
      }
      if (ok) for (const p of c) cells.push(p);
    }
    if (cells.length < 4) continue;

    let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
    for (const p of cells) {
      const px = p % w, py = (p / w) | 0;
      if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
      if (py < by0) by0 = py; if (py > by1) by1 = py;
    }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const compactness = cells.length / (bw * bh);
    candidates.push({ compactness, cells, bx0, by0, bw, bh, w });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.compactness - a.compactness);
  return candidates.map(normalizeGlyph);
}

function normalizeGlyph(best: GlyphCandidate): Uint8Array {
  const { cells, bx0, by0, bw, bh, w } = best;
  const src = new Uint8Array(bw * bh);
  for (const p of cells) src[(((p / w) | 0) - by0) * bw + ((p % w) - bx0)] = 1;

  // Inverse-mapped area resample into a 24x24 box, aspect preserved and
  // centered, so upscaling a small glyph does not leave gaps.
  const scale = Math.min(GLYPH_N / bw, GLYPH_N / bh);
  const offx = (GLYPH_N - bw * scale) / 2;
  const offy = (GLYPH_N - bh * scale) / 2;
  const out = new Uint8Array(GLYPH_N * GLYPH_N);
  for (let ny = 0; ny < GLYPH_N; ny++) {
    for (let nx = 0; nx < GLYPH_N; nx++) {
      const sx0 = (nx - offx) / scale, sy0 = (ny - offy) / scale;
      const ax0 = Math.max(0, Math.floor(sx0)), ay0 = Math.max(0, Math.floor(sy0));
      const ax1 = Math.min(bw, Math.max(ax0 + 1, Math.floor(sx0 + 1 / scale) + 1));
      const ay1 = Math.min(bh, Math.max(ay0 + 1, Math.floor(sy0 + 1 / scale) + 1));
      if (ax0 >= bw || ay0 >= bh || ax1 <= ax0 || ay1 <= ay0) continue;
      let on = 0, tot = 0;
      for (let yy = ay0; yy < ay1; yy++) {
        for (let xx = ax0; xx < ax1; xx++) { tot++; on += src[yy * bw + xx]; }
      }
      if (tot && on * 2 >= tot) out[ny * GLYPH_N + nx] = 1;
    }
  }
  return out;
}

function jaccardShifted(glyph: Uint8Array, tmpl: Uint8Array, shift: number): number {
  let best = 0;
  for (let dy = -shift; dy <= shift; dy++) {
    for (let dx = -shift; dx <= shift; dx++) {
      let inter = 0, union = 0;
      for (let y = 0; y < GLYPH_N; y++) {
        for (let x = 0; x < GLYPH_N; x++) {
          const sy = y + dy, sx = x + dx;
          const a = (sy >= 0 && sy < GLYPH_N && sx >= 0 && sx < GLYPH_N)
            ? glyph[sy * GLYPH_N + sx] : 0;
          const b = tmpl[y * GLYPH_N + x];
          if (a && b) inter++;
          if (a || b) union++;
        }
      }
      if (union) best = Math.max(best, inter / union);
    }
  }
  return best;
}

// `glyphs` holds one candidate bitmap per polarity; whichever candidate
// matches a template decisively and best names the platform.
export function classifyGlyph(glyphs: Uint8Array[] | null): string | null {
  if (!glyphs) return null;
  let best: { name: string; score: number } | null = null;
  for (const glyph of glyphs) {
    const scores = TEMPLATES
      .map(t => ({ name: t.name, score: jaccardShifted(glyph, t.bits, 2) }))
      .sort((a, b) => b.score - a.score);
    if (scores.length === 0) continue;
    if (scores[0].score < GLYPH_ACCEPT) continue;
    if (scores.length > 1 && scores[0].score - scores[1].score < GLYPH_MARGIN) continue;
    if (!best || scores[0].score > best.score) best = scores[0];
  }
  return best ? best.name : null;
}

export const GLYPH_TUNING = { GLYPH_N, GLYPH_ACCEPT, GLYPH_MARGIN };
export const PLATFORMS = Object.keys(PLATFORM_TEMPLATES);
