import JSZip from "jszip";
import {
  computeSliceRegions,
  dedupeFileNames,
  generateEmailHTML,
  sanitizeFileName,
  type HtmlSlice,
} from "@slicer/core";
import { canvasToBlob, cropCanvas, extractEdgeColors, type LoadedImage } from "./raster";
import { designHeight, scaleOf, type Cell, type Project } from "./project";

export interface ExportedCell extends HtmlSlice {
  rowY0: number;
  cellIndex: number;
  blob: Blob;
  /** Object URL for the preview strip; revoke when the export is replaced. */
  previewUrl: string;
}

export interface ExportResult {
  cells: ExportedCell[];
  html: string;
}

/** Design-space cells for a region, falling back to one full-width cell. */
function cellsOf(project: Project, y0: number): Cell[] {
  const row = project.rows[y0];
  if (row && row.cells.length > 0) return row.cells;
  return [{ x0: 0, x1: project.designWidth, platform: null, link: "", alt: "" }];
}

/**
 * Cut every region into its cells and render each one. Replaces the plugin's
 * createSlice / temp-slice / exportAsync machinery with a canvas crop.
 */
export async function sliceProject(
  project: Project,
  image: LoadedImage,
  onProgress?: (done: number, total: number) => void
): Promise<ExportedCell[]> {
  const scale = scaleOf(project);
  const regions = computeSliceRegions(project.guides, designHeight(project));

  const jobs: { rowY0: number; cellIndex: number; cell: Cell; y0: number; y1: number; name: string }[] = [];
  for (const region of regions) {
    const cells = cellsOf(project, region.y0);
    cells.forEach((cell, cellIndex) => {
      // A single-cell row keeps the plain slice-00N name; split rows get the
      // platform, or the column number when the platform is unknown.
      const suffix = cells.length > 1 ? cell.platform || String(cellIndex + 1) : "";
      jobs.push({
        rowY0: region.y0,
        cellIndex,
        cell,
        y0: region.y0,
        y1: region.y1,
        name: suffix ? `${region.name}-${suffix}` : region.name,
      });
    });
  }

  const out: ExportedCell[] = [];
  for (const job of jobs) {
    const canvas = cropCanvas(image, {
      x: job.cell.x0 * scale,
      y: job.y0 * scale,
      w: (job.cell.x1 - job.cell.x0) * scale,
      h: (job.y1 - job.y0) * scale,
    });
    const blob = await canvasToBlob(canvas);
    out.push({
      rowY0: job.rowY0,
      cellIndex: job.cellIndex,
      fileName: `${sanitizeFileName(job.name)}.jpg`,
      width: job.cell.x1 - job.cell.x0,
      height: job.y1 - job.y0,
      absX: job.cell.x0,
      absY: job.y0,
      linkUrl: job.cell.link || null,
      alt: job.cell.alt || "",
      colors: extractEdgeColors(canvas),
      blob,
      previewUrl: URL.createObjectURL(blob),
    });
    onProgress?.(out.length, jobs.length);
  }

  dedupeFileNames(out);
  return out;
}

export function buildHtml(project: Project, cells: ExportedCell[]): string {
  return generateEmailHTML(cells, project.addFooter, project.emailWidth);
}

/**
 * index.html at the root, images/ beside it, relative src attributes — the
 * shape Braze's HTML-upload importer expects.
 */
export async function packageZip(html: string, cells: ExportedCell[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file("index.html", html);
  const images = zip.folder("images");
  if (!images) throw new Error("Could not create the images folder");
  for (const cell of cells) {
    images.file(cell.fileName, cell.blob);
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
