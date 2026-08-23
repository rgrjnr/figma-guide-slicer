"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeSliceRegions,
  detectSectionOffsets,
  detectSocialBand,
  normalizeGuides,
  reconcileRowBounds,
  snapToGuide,
  SECTION_TUNING,
  type RasterImage,
} from "@slicer/core";
import {
  cellsFromBand,
  defaultRow,
  designHeight,
  emptyProject,
  fullWidthCell,
  scaleOf,
  type Cell,
  type Project,
  type Row,
} from "./project";
import { decodeImage, toRasterImage, type LoadedImage } from "./raster";
import { loadLinkCache, loadSettings, rememberLink, saveSettings } from "./storage";

export interface ProjectApi {
  project: Project;
  image: LoadedImage | null;
  raster: RasterImage | null;
  regions: ReturnType<typeof computeSliceRegions>;
  rowFor: (y0: number) => Row;
  status: string;
  setStatus: (s: string) => void;

  loadFile: (file: File) => Promise<void>;
  reset: () => void;

  addGuide: (y: number) => void;
  moveGuide: (from: number, to: number) => void;
  removeGuide: (y: number) => void;
  setWorkArea: (area: { y0: number; y1: number } | null) => void;

  detectSections: () => void;
  acceptProposed: (y?: number) => void;
  clearProposed: () => void;
  detectSocial: () => void;
  addButton: (y0: number, y1: number) => void;

  updateCell: (rowY0: number, cellIndex: number, patch: Partial<Cell>) => void;
  setRowKind: (rowY0: number, kind: Row["kind"]) => void;
  patchProject: (patch: Partial<Project>) => void;
}

export function useProject(): ProjectApi {
  const [project, setProject] = useState<Project>(emptyProject);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [status, setStatus] = useState("");
  // The full-frame pixels are needed by both detectors and cost ~100ms to
  // produce for a tall email, so they are computed once per upload.
  const rasterRef = useRef<RasterImage | null>(null);

  useEffect(() => {
    const stored = loadSettings({ minGutter: emptyProject().minGutter, minSection: emptyProject().minSection });
    setProject(p => ({ ...p, ...stored }));
  }, []);

  const patchProject = useCallback((patch: Partial<Project>) => {
    setProject(p => {
      const next = { ...p, ...patch };
      if (patch.minGutter !== undefined || patch.minSection !== undefined) {
        saveSettings({ minGutter: next.minGutter, minSection: next.minSection });
      }
      return next;
    });
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setStatus("Decoding image…");
    const loaded = await decodeImage(file);
    rasterRef.current = toRasterImage(loaded);
    setImage(loaded);
    setProject(p => ({
      ...emptyProject(),
      minGutter: p.minGutter,
      minSection: p.minSection,
      addFooter: p.addFooter,
      emailWidth: p.emailWidth,
      // Default to scale 1: the detector thresholds are all tuned in frame
      // pixels at 1x. Lower designWidth for a @2x export and they compensate.
      designWidth: loaded.width,
      image: {
        name: file.name,
        url: URL.createObjectURL(file),
        blob: file,
        width: loaded.width,
        height: loaded.height,
      },
    }));
    setStatus("");
  }, []);

  const reset = useCallback(() => {
    setImage(null);
    rasterRef.current = null;
    setProject(p => ({ ...emptyProject(), minGutter: p.minGutter, minSection: p.minSection }));
    setStatus("");
  }, []);

  // --- Guides ---

  const addGuide = useCallback((y: number) => {
    setProject(p => ({ ...p, guides: normalizeGuides([...p.guides, y], designHeight(p)) }));
  }, []);

  const moveGuide = useCallback((from: number, to: number) => {
    setProject(p => ({
      ...p,
      guides: normalizeGuides([...p.guides.filter(g => g !== from), to], designHeight(p)),
    }));
  }, []);

  const removeGuide = useCallback((y: number) => {
    setProject(p => ({ ...p, guides: p.guides.filter(g => g !== y) }));
  }, []);

  const setWorkArea = useCallback((workArea: { y0: number; y1: number } | null) => {
    setProject(p => ({ ...p, workArea }));
  }, []);

  // --- Detection ---

  const detectSections = useCallback(() => {
    const raster = rasterRef.current;
    if (!raster) return;
    setProject(p => {
      const found = detectSectionOffsets(
        raster,
        scaleOf(p),
        designHeight(p),
        p.minGutter,
        p.minSection,
        p.workArea
      );
      // Runaway detection is worse than none: a proposal of 60+ cuts means the
      // thresholds are wrong for this artwork, not that it has 60 sections.
      if (found.length > SECTION_TUNING.MAX_SECTION_CUTS) {
        setStatus(`Detection found ${found.length} cuts — raise Min section and try again.`);
        return { ...p, proposedGuides: [] };
      }
      const fresh = found.filter(y => !p.guides.some(g => Math.abs(g - y) <= 2));
      setStatus(
        fresh.length
          ? `Proposed ${fresh.length} cut${fresh.length === 1 ? "" : "s"}.`
          : "No new section boundaries found."
      );
      return { ...p, proposedGuides: fresh };
    });
  }, []);

  const acceptProposed = useCallback((y?: number) => {
    setProject(p => {
      const taking = y === undefined ? p.proposedGuides : [y];
      return {
        ...p,
        guides: normalizeGuides([...p.guides, ...taking], designHeight(p)),
        proposedGuides: y === undefined ? [] : p.proposedGuides.filter(g => g !== y),
      };
    });
    setStatus("");
  }, []);

  const clearProposed = useCallback(() => {
    setProject(p => ({ ...p, proposedGuides: [] }));
    setStatus("");
  }, []);

  const detectSocial = useCallback(() => {
    const raster = rasterRef.current;
    if (!raster) return;
    setProject(p => {
      const band = detectSocialBand(raster, scaleOf(p), p.designWidth, designHeight(p), p.workArea);
      if (!band || !band.found) {
        setStatus("No social icon row found.");
        return p;
      }
      // Prefer a row the user already bracketed with guides; otherwise add the
      // two guides the band needs.
      const bounds = reconcileRowBounds(p.guides, designHeight(p), band);
      const guides = normalizeGuides([...p.guides, bounds.y0, bounds.y1], designHeight(p));

      const cells = cellsFromBand(band, loadLinkCache());
      const named = cells.filter(c => c.platform).length;
      setStatus(
        `Social row: ${cells.filter((_, i) => band.cells[i].isIcon).length} icons, ${named} identified.`
      );
      return {
        ...p,
        guides,
        rows: {
          ...p.rows,
          [bounds.y0]: { kind: "social", cells },
        },
      };
    });
  }, []);

  /**
   * A drawn rectangle only contributes its vertical extent: the button becomes a
   * full-width row the height of what you drew, snapped onto nearby guides.
   */
  const addButton = useCallback((rawY0: number, rawY1: number) => {
    setProject(p => {
      const h = designHeight(p);
      const y0 = Math.max(0, Math.min(h, Math.round(Math.min(rawY0, rawY1))));
      const y1 = Math.max(0, Math.min(h, Math.round(Math.max(rawY0, rawY1))));
      if (y1 - y0 < 4) {
        setStatus("That selection is too short to be a button row.");
        return p;
      }
      const snapped0 = snapToGuide(y0, p.guides);
      const snapped1 = snapToGuide(y1, p.guides);
      const guides = normalizeGuides([...p.guides, snapped0, snapped1], h);
      setStatus("Button row added — add its link below.");
      return {
        ...p,
        guides,
        rows: {
          ...p.rows,
          [snapped0]: { ...(p.rows[snapped0] ?? defaultRow(p.designWidth)), kind: "button" },
        },
      };
    });
  }, []);

  // --- Row edits ---

  const rowFor = useCallback(
    (y0: number): Row => project.rows[y0] ?? defaultRow(project.designWidth),
    [project.rows, project.designWidth]
  );

  const updateCell = useCallback((rowY0: number, cellIndex: number, patch: Partial<Cell>) => {
    setProject(p => {
      const existing = p.rows[rowY0];
      const base: Row = existing ?? { ...defaultRow(p.designWidth) };
      const cells = base.cells.length ? [...base.cells] : [fullWidthCell(p.designWidth)];
      const merged = { ...cells[cellIndex], ...patch };
      cells[cellIndex] = merged;
      if (patch.link !== undefined && merged.platform) rememberLink(merged.platform, patch.link);
      return { ...p, rows: { ...p.rows, [rowY0]: { ...base, cells } } };
    });
  }, []);

  const setRowKind = useCallback((rowY0: number, kind: Row["kind"]) => {
    setProject(p => {
      const base = p.rows[rowY0] ?? defaultRow(p.designWidth);
      return { ...p, rows: { ...p.rows, [rowY0]: { ...base, kind } } };
    });
  }, []);

  const regions = useMemo(
    () => (image ? computeSliceRegions(project.guides, designHeight(project)) : []),
    [image, project.guides, project.designWidth, project.image]
  );

  return {
    project,
    image,
    raster: rasterRef.current,
    regions,
    rowFor,
    status,
    setStatus,
    loadFile,
    reset,
    addGuide,
    moveGuide,
    removeGuide,
    setWorkArea,
    detectSections,
    acceptProposed,
    clearProposed,
    detectSocial,
    addButton,
    updateCell,
    setRowKind,
    patchProject,
  };
}
