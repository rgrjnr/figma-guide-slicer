import type { DetectedBand } from "@slicer/core";

export type RowKind = "image" | "button" | "social";

/** One `<td>`. A row with a single full-width cell is the common case. */
export interface Cell {
  /** Design-space x bounds. A single-cell row spans 0..designWidth. */
  x0: number;
  x1: number;
  platform: string | null;
  link: string;
  alt: string;
}

export interface Row {
  kind: RowKind;
  cells: Cell[];
}

export interface SourceImage {
  name: string;
  /** Object URL for display. */
  url: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface Project {
  image: SourceImage | null;
  /**
   * The width the design was drawn at. Defaults to the image's own width, i.e.
   * scale 1, which is what every detector threshold is tuned against. Set it to
   * 600 for a @2x export of a 600px design and the detectors compensate.
   */
  designWidth: number;
  /** Width of the generated email table. Independent of the source resolution. */
  emailWidth: number;
  /** Design-space Y offsets, sorted ascending, exclusive of 0 and height. */
  guides: number[];
  /** Restricts detection to a Y range. Never affects the export. */
  workArea: { y0: number; y1: number } | null;
  /**
   * Keyed by the region's top boundary (y0), not its index. Indices shift the
   * moment a guide is added above, which would silently reattach every link and
   * alt to the wrong row; a y0 only changes for the region actually being split.
   */
  rows: Record<number, Row>;
  addFooter: boolean;
  minGutter: number;
  minSection: number;
  /** Detector output awaiting accept/reject. */
  proposedGuides: number[];
}

export const DEFAULT_MIN_GUTTER = 12;
export const DEFAULT_MIN_SECTION = 60;

export function emptyProject(): Project {
  return {
    image: null,
    designWidth: 600,
    emailWidth: 600,
    guides: [],
    workArea: null,
    rows: {},
    addFooter: true,
    minGutter: DEFAULT_MIN_GUTTER,
    minSection: DEFAULT_MIN_SECTION,
    proposedGuides: [],
  };
}

/** Image pixels per design pixel. Everything the detectors do is in design px. */
export function scaleOf(p: Project): number {
  if (!p.image || !p.designWidth) return 1;
  return p.image.width / p.designWidth;
}

/** Design-space height of the artwork. */
export function designHeight(p: Project): number {
  if (!p.image) return 0;
  return Math.round(p.image.height / scaleOf(p));
}

export function fullWidthCell(designWidth: number): Cell {
  return { x0: 0, x1: designWidth, platform: null, link: "", alt: "" };
}

export function defaultRow(designWidth: number): Row {
  return { kind: "image", cells: [fullWidthCell(designWidth)] };
}

/** Turn a detected social band into the cells for its row. */
export function cellsFromBand(band: DetectedBand, linkCache: Record<string, string>): Cell[] {
  return band.cells.map(c => ({
    x0: c.x0,
    x1: c.x1,
    platform: c.platform,
    link: (c.platform && linkCache[c.platform]) || "",
    alt: c.platform ? `${c.platform} icon` : "",
  }));
}
