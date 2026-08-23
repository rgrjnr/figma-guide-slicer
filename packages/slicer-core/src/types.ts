/**
 * The only image representation this package understands. It is structurally
 * compatible with the browser's ImageData and with a buffer decoded by
 * jpeg-js/pngjs in Node, so nothing here needs an adapter.
 */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Restricts a detector to a slice of the image, in frame (design) pixels. */
export interface Bounds {
  y0: number;
  y1: number;
}

export interface DetectedCell {
  x0: number;
  x1: number;
  isIcon: boolean;
  platform: string | null;
}

export interface DetectedBand {
  found: boolean;
  top: number;
  bottom: number;
  padTop: number;
  padBottom: number;
  cells: DetectedCell[];
}

export interface SliceRegion {
  index: number;
  y0: number;
  y1: number;
  name: string;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** One exported image cell, as consumed by the HTML generator. */
export interface HtmlSlice {
  fileName: string;
  width: number;
  height: number;
  absX: number;
  absY: number;
  linkUrl?: string | null;
  alt?: string | null;
  colors?: { top: RGB; bottom: RGB } | null;
}
