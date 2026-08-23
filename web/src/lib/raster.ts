import type { RasterImage, RGB } from "@slicer/core";
import { averageColor } from "@slicer/core";

export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export async function decodeImage(blob: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

function canvasOf(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function context2d(canvas: OffscreenCanvas | HTMLCanvasElement): CanvasRenderingContext2D {
  // willReadFrequently matters: the detectors pull the whole frame back out.
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is unavailable");
  return ctx as CanvasRenderingContext2D;
}

/** Full-frame pixels, for the detectors. */
export function toRasterImage(img: LoadedImage): RasterImage {
  const canvas = canvasOf(img.width, img.height);
  const ctx = context2d(canvas);
  ctx.drawImage(img.bitmap, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop a region out of the source at native resolution. */
export function cropCanvas(img: LoadedImage, rect: CropRect): OffscreenCanvas | HTMLCanvasElement {
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const canvas = canvasOf(w, h);
  const ctx = context2d(canvas);
  ctx.drawImage(img.bitmap, Math.round(rect.x), Math.round(rect.y), w, h, 0, 0, w, h);
  return canvas;
}

export async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.92
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      b => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      type,
      quality
    );
  });
}

/**
 * Top and bottom edge colours of a crop. These become the `<td>` bgcolor and
 * gradient, so a slice blends into the one above and below it in clients that
 * letterbox the image.
 */
export function extractEdgeColors(
  canvas: OffscreenCanvas | HTMLCanvasElement
): { top: RGB; bottom: RGB } {
  const ctx = context2d(canvas);
  const { width, height } = canvas;
  return {
    top: averageColor(ctx.getImageData(0, 0, width, 1)),
    bottom: averageColor(ctx.getImageData(0, height - 1, width, 1)),
  };
}
