import type { RasterImage, RGB } from "./types";

export const WHITE: RGB = { r: 255, g: 255, b: 255 };

/** Mean RGB of a raster (alpha ignored). Used on 1px-tall edge strips. */
export function averageColor(imageData: RasterImage): RGB {
  const d = imageData.data;
  let r = 0, g = 0, b = 0;
  const pixels = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; g += d[i + 1]; b += d[i + 2];
  }
  return {
    r: Math.round(r / pixels),
    g: Math.round(g / pixels),
    b: Math.round(b / pixels),
  };
}

export function toHex(c: RGB): string {
  return "#" + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Flat fallback for clients that drop the CSS gradient. */
export function midColor(top: RGB, bottom: RGB): RGB {
  return {
    r: Math.round((top.r + bottom.r) / 2),
    g: Math.round((top.g + bottom.g) / 2),
    b: Math.round((top.b + bottom.b) / 2),
  };
}
