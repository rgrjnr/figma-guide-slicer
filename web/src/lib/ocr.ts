import type { ExportedCell } from "./export";

// Ported from the plugin, where it ran in the Figma iframe under a CSP that
// made blob-loading a worker risky. In a real page that risk is gone.
const OCR_LANGS = "por+eng";
const OCR_MIN_CONFIDENCE = 55;
const OCR_MAX_CHARS = 120;
const OCR_MAX_DIM = 4000; // beyond this the 2x upscale stops paying off

type Worker = {
  recognize: (input: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker(OCR_LANGS)) as unknown as Worker;
    })();
  }
  return workerPromise;
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

/**
 * Upscale 2x, flatten to greyscale, and invert light-on-dark artwork — the
 * three things that move Tesseract's accuracy on flattened marketing design.
 */
async function preprocess(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const factor = Math.min(2, OCR_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * Math.max(1, factor)));
  const h = Math.max(1, Math.round(bitmap.height * Math.max(1, factor)));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = lum;
    sum += lum;
  }
  if (sum / (d.length / 4) < 128) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
    }
  }
  ctx.putImageData(data, 0, 0);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("OCR preprocessing failed"))), "image/png")
  );
}

/** Reject low-confidence noise and anything too short to be a real phrase. */
function clean(raw: string, confidence: number): string {
  if (confidence < OCR_MIN_CONFIDENCE) return "";
  const text = raw.replace(/\s+/g, " ").trim();
  const alnum = text.replace(/[^a-z0-9]/gi, "").length;
  if (alnum < 3) return "";
  return text.length > OCR_MAX_CHARS ? `${text.slice(0, OCR_MAX_CHARS - 1).trimEnd()}…` : text;
}

export async function readAltText(
  cells: ExportedCell[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string>> {
  const worker = await getWorker();
  const out = new Map<string, string>();
  let done = 0;
  for (const cell of cells) {
    try {
      const { data } = await worker.recognize(await preprocess(cell.blob));
      const text = clean(data.text, data.confidence);
      if (text) out.set(cell.fileName, text);
    } catch {
      // One unreadable slice should not abort the batch.
    }
    onProgress?.(++done, cells.length);
  }
  return out;
}
