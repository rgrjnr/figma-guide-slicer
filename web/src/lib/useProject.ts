"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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

/**
 * The part of a project that undo restores. The image is excluded: loading a
 * different one starts a new piece of work rather than being a step within one.
 */
type Snapshot = Pick<
  Project,
  "guides" | "workArea" | "rows" | "proposedGuides" | "designWidth" | "emailWidth" | "addFooter"
>;

const HISTORY_LIMIT = 60;
/**
 * Fallback window for collapsing consecutive edits of the same kind. Gestures
 * signal their own end through endGesture(), which is authoritative — this only
 * catches things with no natural boundary, like typing into a field.
 */
const COALESCE_MS = 1500;

function snapshot(p: Project): Snapshot {
  return {
    guides: p.guides,
    workArea: p.workArea,
    rows: p.rows,
    proposedGuides: p.proposedGuides,
    designWidth: p.designWidth,
    emailWidth: p.emailWidth,
    addFooter: p.addFooter,
  };
}

export interface ProjectApi {
  undo: () => void;
  redo: () => void;
  /** Close the current gesture so the next edit starts a new undo step. */
  endGesture: () => void;
  canUndo: boolean;
  canRedo: boolean;

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
  /** Drop every split and detected row, back to a single full-height row. */
  clearMarks: () => void;
  /** Turn one existing row into a social bar, splitting it at the icons. */
  makeSocialRow: (y0: number) => void;
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

  // History lives in refs so an undo can be applied without scheduling state
  // updates from inside another updater; `bump` re-renders for canUndo/canRedo.
  const projectRef = useRef<Project>(project);
  projectRef.current = project;
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const lastEdit = useRef<{ tag: string; at: number } | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  /**
   * Apply an undoable edit. `tag` groups rapid edits of the same kind — a guide
   * drag fires on every pointer move, and without coalescing a single drag
   * would bury everything before it under a hundred history entries.
   */
  const commit = useCallback((tag: string | null, updater: (p: Project) => Project) => {
    const previous = projectRef.current;
    const next = updater(previous);
    if (next === previous) return;

    const now = Date.now();
    const history = historyRef.current;
    const sameRun =
      tag !== null && lastEdit.current?.tag === tag && now - lastEdit.current.at < COALESCE_MS;

    if (!sameRun) {
      history.past = [...history.past, snapshot(previous)].slice(-HISTORY_LIMIT);
    }
    history.future = [];
    lastEdit.current = tag ? { tag, at: now } : null;

    projectRef.current = next;
    setProject(next);
    bump();
  }, []);

  /**
   * Marks the end of a continuous gesture. Without it, coalescing would have to
   * guess from timing alone — and three deliberate clicks half a second apart
   * would collapse into one undo step, which is not what anyone means.
   */
  const endGesture = useCallback(() => {
    lastEdit.current = null;
  }, []);

  const applySnapshot = useCallback((snap: Snapshot) => {
    const next = { ...projectRef.current, ...snap };
    projectRef.current = next;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    history.future = [snapshot(projectRef.current), ...history.future].slice(0, HISTORY_LIMIT);
    history.past = history.past.slice(0, -1);
    lastEdit.current = null;
    applySnapshot(previous);
    bump();
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.future.length === 0) return;
    const next = history.future[0];
    history.past = [...history.past, snapshot(projectRef.current)].slice(-HISTORY_LIMIT);
    history.future = history.future.slice(1);
    lastEdit.current = null;
    applySnapshot(next);
    bump();
  }, [applySnapshot]);
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
    historyRef.current = { past: [], future: [] };
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
    historyRef.current = { past: [], future: [] };
    setProject(p => ({ ...emptyProject(), minGutter: p.minGutter, minSection: p.minSection }));
    setStatus("");
  }, []);

  // --- Guides ---

  const addGuide = useCallback((y: number) => {
    commit("guide-gesture", p => ({ ...p, guides: normalizeGuides([...p.guides, y], designHeight(p)) }));
  }, [commit]);

  // Shares the add tag: dropping a guide and dragging it into place is one
  // gesture, so it is one undo step. The boundary is endGesture, not a timer.
  const moveGuide = useCallback((from: number, to: number) => {
    commit("guide-gesture", p => ({
      ...p,
      guides: normalizeGuides([...p.guides.filter(g => g !== from), to], designHeight(p)),
    }));
  }, [commit]);

  const removeGuide = useCallback((y: number) => {
    commit(null, p => ({ ...p, guides: p.guides.filter(g => g !== y) }));
  }, [commit]);

  const setWorkArea = useCallback((workArea: { y0: number; y1: number } | null) => {
    commit(null, p => ({ ...p, workArea }));
  }, [commit]);

  // --- Detection ---

  const clearMarks = useCallback(() => {
    commit(null, p => ({ ...p, guides: [], rows: {}, proposedGuides: [], workArea: null }));
    setStatus("");
  }, [commit]);

  const detectSections = useCallback(() => {
    const raster = rasterRef.current;
    if (!raster) return;
    commit(null, p => {
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
        setStatus(`Foram encontradas ${found.length} divisões — algo está errado com a arte.`);
        return { ...p, proposedGuides: [] };
      }
      const fresh = found.filter(y => !p.guides.some(g => Math.abs(g - y) <= 2));
      setStatus(
        fresh.length
          ? `${fresh.length} divisão${fresh.length === 1 ? "" : "ões"} encontrada${fresh.length === 1 ? "" : "s"}.`
          : "Nenhuma divisão nova encontrada."
      );
      return { ...p, proposedGuides: fresh };
    });
  }, [commit]);

  const acceptProposed = useCallback((y?: number) => {
    commit(null, p => {
      const taking = y === undefined ? p.proposedGuides : [y];
      return {
        ...p,
        guides: normalizeGuides([...p.guides, ...taking], designHeight(p)),
        proposedGuides: y === undefined ? [] : p.proposedGuides.filter(g => g !== y),
      };
    });
    setStatus("");
  }, [commit]);

  const clearProposed = useCallback(() => {
    commit(null, p => ({ ...p, proposedGuides: [] }));
    setStatus("");
  }, [commit]);

  /**
   * Make one row a social bar. Icons are looked for inside that row only, so
   * pointing at the right row is enough. If none are found the row is still
   * marked, with a single cell — the user saying "this is the social row" is
   * better information than the detector's opinion.
   */
  const makeSocialRow = useCallback((y0: number) => {
    const raster = rasterRef.current;
    commit(null, p => {
      const height = designHeight(p);
      const region = computeSliceRegions(p.guides, height).find(r => r.y0 === y0);
      if (!region) return p;

      const band = raster
        ? detectSocialBand(raster, scaleOf(p), p.designWidth, height, { y0: region.y0, y1: region.y1 })
        : null;
      const cells = band?.found ? cellsFromBand(band, loadLinkCache()) : [fullWidthCell(p.designWidth)];

      setStatus(
        band?.found
          ? `Redes sociais: ${cells.filter(c => c.platform).length} de ${cells.length} ícones reconhecidos.`
          : "Marcada como barra de redes sociais — informe os links."
      );
      return { ...p, rows: { ...p.rows, [y0]: { kind: "social", cells } } };
    });
  }, [commit]);

  const detectSocial = useCallback(() => {
    const raster = rasterRef.current;
    if (!raster) return;
    commit(null, p => {
      const band = detectSocialBand(raster, scaleOf(p), p.designWidth, designHeight(p), p.workArea);
      if (!band || !band.found) {
        setStatus("Nenhuma barra de redes sociais encontrada.");
        return p;
      }
      // Prefer a row the user already bracketed with guides; otherwise add the
      // two guides the band needs.
      const bounds = reconcileRowBounds(p.guides, designHeight(p), band);
      const guides = normalizeGuides([...p.guides, bounds.y0, bounds.y1], designHeight(p));

      const cells = cellsFromBand(band, loadLinkCache());
      const named = cells.filter(c => c.platform).length;
      setStatus(
        `Redes sociais: ${cells.filter((_, i) => band.cells[i].isIcon).length} ícones, ${named} reconhecidos.`
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
  }, [commit]);

  /**
   * A drawn rectangle only contributes its vertical extent: the button becomes a
   * full-width row the height of what you drew, snapped onto nearby guides.
   */
  const addButton = useCallback((rawY0: number, rawY1: number) => {
    commit(null, p => {
      const h = designHeight(p);
      const y0 = Math.max(0, Math.min(h, Math.round(Math.min(rawY0, rawY1))));
      const y1 = Math.max(0, Math.min(h, Math.round(Math.max(rawY0, rawY1))));
      if (y1 - y0 < 4) {
        setStatus("Essa seleção é curta demais.");
        return p;
      }
      const snapped0 = snapToGuide(y0, p.guides);
      const snapped1 = snapToGuide(y1, p.guides);
      const guides = normalizeGuides([...p.guides, snapped0, snapped1], h);
      setStatus("Área clicável criada — informe o link.");
      return {
        ...p,
        guides,
        rows: {
          ...p.rows,
          [snapped0]: { ...(p.rows[snapped0] ?? defaultRow(p.designWidth)), kind: "button" },
        },
      };
    });
  }, [commit]);

  // --- Row edits ---

  const rowFor = useCallback(
    (y0: number): Row => project.rows[y0] ?? defaultRow(project.designWidth),
    [project.rows, project.designWidth]
  );

  // Typing in a link or alt field coalesces per field, so undo steps back a
  // whole edit rather than one character.
  const updateCell = useCallback((rowY0: number, cellIndex: number, patch: Partial<Cell>) => {
    commit(`cell-${rowY0}-${cellIndex}-${Object.keys(patch).join()}`, p => {
      const existing = p.rows[rowY0];
      const base: Row = existing ?? { ...defaultRow(p.designWidth) };
      const cells = base.cells.length ? [...base.cells] : [fullWidthCell(p.designWidth)];
      const merged = { ...cells[cellIndex], ...patch };
      cells[cellIndex] = merged;
      if (patch.link !== undefined && merged.platform) rememberLink(merged.platform, patch.link);
      return { ...p, rows: { ...p.rows, [rowY0]: { ...base, cells } } };
    });
  }, [commit]);

  const setRowKind = useCallback((rowY0: number, kind: Row["kind"]) => {
    commit(null, p => {
      const base = p.rows[rowY0] ?? defaultRow(p.designWidth);
      return { ...p, rows: { ...p.rows, [rowY0]: { ...base, kind } } };
    });
  }, [commit]);

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
    clearMarks,
    makeSocialRow,
    acceptProposed,
    clearProposed,
    detectSocial,
    addButton,
    updateCell,
    setRowKind,
    patchProject,
    undo,
    redo,
    endGesture,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
  };
}
