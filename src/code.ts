// ============================================================
// Guide-Based Email Slicer — Plugin Sandbox (code.ts)
// ============================================================

import {
  computeSliceRegions as coreComputeSliceRegions,
  reconcileRowBounds as coreReconcileRowBounds,
  parseLinkFromName,
  sanitizeFileName,
  dedupeFileNames,
  type SliceRegion,
  type DetectedBand as CoreDetectedBand,
} from "../packages/slicer-core/src/index";

// --- Types ---

interface ExportedSlice {
  nodeId: string;
  name: string;
  fileName: string;
  pngBytes: Uint8Array;
  width: number;
  height: number;
  absX: number;
  absY: number;
  linkUrl: string | null;
  alt: string;
}

// --- Show UI ---

figma.showUI(__html__, { width: 320, height: 460, themeColors: true });

// --- Selection Handling ---

function getSelectedFrame(): FrameNode | null {
  const sel = figma.currentPage.selection;
  if (sel.length !== 1) return null;
  const node = sel[0];
  if (node.type !== "FRAME") return null;
  return node;
}

function updateSelectionState(): void {
  const frame = getSelectedFrame();
  if (frame) {
    const guideCount = frame.guides.filter(g => g.axis === "Y").length;
    figma.ui.postMessage({
      type: "selection-changed",
      valid: true,
      frameName: frame.name,
      frameWidth: Math.round(frame.width),
      frameHeight: Math.round(frame.height),
      guideCount,
    });
  } else {
    figma.ui.postMessage({ type: "selection-changed", valid: false });
  }
}

figma.on("selectionchange", () => updateSelectionState());
updateSelectionState();

// --- Guide Parsing → Slice Regions ---

// The frame's horizontal guides are the only Figma-specific part; the maths
// lives in @slicer/core so the web app produces identical regions.
function frameGuideOffsets(frame: FrameNode): number[] {
  return frame.guides.filter(g => g.axis === "Y").map(g => g.offset);
}

function computeSliceRegions(frame: FrameNode): SliceRegion[] {
  return coreComputeSliceRegions(frameGuideOffsets(frame), frame.height);
}

// --- Slice Group Helpers ---

function findSliceGroup(): GroupNode | null {
  for (const child of figma.currentPage.children) {
    if (child.type === "GROUP" && child.name === "__EMAIL_SLICES__") {
      return child;
    }
  }
  return null;
}

function removeSliceGroup(): void {
  const group = findSliceGroup();
  if (group) group.remove();
}

// --- Read export entries from slice group ---

interface ExportEntry {
  node: SliceNode;
  name: string;
  fileName: string;
  linkUrl: string | null;
  alt: string;
}

function readExportEntries(sliceGroup: GroupNode): ExportEntry[] {
  const entries: ExportEntry[] = [];

  // Collect all slice children, sorted by absolute Y then X position
  const sliceChildren = [...sliceGroup.children]
    .filter((c): c is SliceNode => c.type === "SLICE")
    .sort((a, b) => {
      const dy = a.absoluteTransform[1][2] - b.absoluteTransform[1][2];
      if (Math.abs(dy) > 2) return dy;
      return a.absoluteTransform[0][2] - b.absoluteTransform[0][2];
    });

  for (const child of sliceChildren) {
    const { cleanName, linkUrl } = parseLinkFromName(child.name);
    const fileName = sanitizeFileName(cleanName) + ".jpg";
    entries.push({
      node: child,
      name: cleanName,
      fileName,
      linkUrl,
      alt: child.getPluginData("alt") || "",
    });
  }

  return dedupeFileNames(entries);
}

// --- Generate Slices ---

// Icon cells created by the last generate pass, so the UI can offer a link
// field per icon. Declared here because the plan is consumed while slicing.
let lastPlanNodes: { nodeId: string; platform: string | null; url: string }[] = [];

// --- Remembered links per platform ---
//
// The same social URLs recur across every email, so the last URL used for a
// platform is remembered and re-applied automatically the next time that
// platform is recognised. Stored per user via clientStorage, not in the file.

const LINK_CACHE_KEY = "social-link-cache";

let linkCache: { [platform: string]: string } = {};
let linkCacheReady: Promise<void> | null = null;

function ensureLinkCache(): Promise<void> {
  if (!linkCacheReady) {
    linkCacheReady = figma.clientStorage
      .getAsync(LINK_CACHE_KEY)
      .then(value => {
        linkCache = (value as { [k: string]: string }) || {};
      })
      .catch(() => {
        linkCache = {};
      });
  }
  return linkCacheReady;
}

async function rememberLink(platform: string, url: string): Promise<void> {
  await ensureLinkCache();
  if (url) {
    linkCache[platform] = url;
  } else {
    delete linkCache[platform];
  }
  try {
    await figma.clientStorage.setAsync(LINK_CACHE_KEY, linkCache);
  } catch (e) {
    // A failed write only costs the convenience, so it is not worth surfacing.
  }
}

// --- Detection settings ---
//
// The two thresholds that decide where section boundaries land. They live in
// the UI as number inputs; the sandbox only persists them so the inputs come
// back with the last values instead of the defaults on every launch.

const SETTINGS_KEY = "slicer-settings";

interface SlicerSettings {
  minGutter: number;
  minSection: number;
}

const DEFAULT_SETTINGS: SlicerSettings = { minGutter: 12, minSection: 60 };

async function loadSettings(): Promise<void> {
  let stored: Partial<SlicerSettings> = {};
  try {
    stored = ((await figma.clientStorage.getAsync(SETTINGS_KEY)) as Partial<SlicerSettings>) || {};
  } catch (e) {
    stored = {};
  }
  figma.ui.postMessage({
    type: "settings",
    minGutter: stored.minGutter || DEFAULT_SETTINGS.minGutter,
    minSection: stored.minSection || DEFAULT_SETTINGS.minSection,
  });
}

async function saveSettings(minGutter: number, minSection: number): Promise<void> {
  try {
    await figma.clientStorage.setAsync(SETTINGS_KEY, { minGutter, minSection });
  } catch (e) {
    // Losing the preference only costs re-typing it once.
  }
}

loadSettings();

// The detected column split applies to whichever region matches the row the
// detector settled on — so re-running "Generate Slices" reproduces the columns
// instead of flattening them back to one full-width slice.
function planForRegion(region: SliceRegion): DetectionPlan | null {
  if (!detectionPlan) return null;
  if (Math.abs(detectionPlan.y0 - region.y0) > 2) return null;
  if (Math.abs(detectionPlan.y1 - region.y1) > 2) return null;
  return detectionPlan;
}

async function handleGenerateSlices(): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  await ensureLinkCache();

  const regions = computeSliceRegions(frame);
  if (regions.length === 0) {
    figma.ui.postMessage({ type: "error", message: "Frame has no area to slice." });
    return;
  }

  const plannedTotal = regions.reduce((acc, r) => {
    const plan = planForRegion(r);
    return acc + (plan ? plan.cells.length : 1);
  }, 0);

  if (plannedTotal > 100) {
    figma.ui.postMessage({
      type: "error",
      message: `Too many slices (${plannedTotal}). Consider reducing guides.`,
    });
    return;
  }

  // Clear existing slices first
  removeSliceGroup();

  // Frame absolute position on the page
  const frameAbsX = frame.absoluteTransform[0][2];
  const frameAbsY = frame.absoluteTransform[1][2];

  // Create slice nodes at page root level using absolute coordinates
  const slices: SceneNode[] = [];
  lastPlanNodes = [];

  for (const region of regions) {
    const height = region.y1 - region.y0;

    // A row the detector split into icon columns is emitted as N side-by-side
    // slices sharing the same Y and height, which is the contract the export
    // path's row grouping already understands.
    const plan = planForRegion(region);
    if (plan) {
      plan.cells.forEach((cell: DetectedCell, col: number) => {
        const slice = figma.createSlice();
        const baseName = cell.platform
          ? `${region.name}-${cell.platform}`
          : `${region.name}-${col + 1}`;
        // A recognised platform with a remembered URL is linked immediately, so
        // the common case needs no typing at all.
        const remembered = cell.platform ? linkCache[cell.platform] || "" : "";
        slice.name = remembered ? `${baseName} (${remembered})` : baseName;
        if (cell.platform) slice.setPluginData("platform", cell.platform);
        slice.x = frameAbsX + cell.x0;
        slice.y = frameAbsY + region.y0;
        slice.resize(cell.x1 - cell.x0, height);
        slice.setPluginData("kind", "email-slice");
        slice.setPluginData("index", String(region.index));
        slice.setPluginData("y0", String(region.y0));
        slice.setPluginData("y1", String(region.y1));
        slice.setPluginData("col", String(col));
        slices.push(slice);
        if (cell.isIcon) {
          lastPlanNodes.push({ nodeId: slice.id, platform: cell.platform, url: remembered });
        }
      });
      continue;
    }

    const slice = figma.createSlice();
    slice.name = region.name;
    slice.x = frameAbsX;
    slice.y = frameAbsY + region.y0;
    slice.resize(frame.width, height);
    slice.setPluginData("kind", "email-slice");
    slice.setPluginData("index", String(region.index));
    slice.setPluginData("y0", String(region.y0));
    slice.setPluginData("y1", String(region.y1));
    slices.push(slice);
  }

  const group = figma.group(slices, figma.currentPage);
  group.name = "__EMAIL_SLICES__";

  // Carry the icon cells along so a manual re-generate re-populates the link
  // fields instead of leaving them pointing at slice nodes that no longer exist.
  figma.ui.postMessage({
    type: "slices-generated",
    count: slices.length,
    sectionGuides: lastSectionGuidesAdded,
    cells: lastPlanNodes.length > 0 ? lastPlanNodes : null,
    y0: detectionPlan ? detectionPlan.y0 : null,
    y1: detectionPlan ? detectionPlan.y1 : null,
  });
}

// --- Frame Analysis (sections + social icons) ---
//
// The sandbox has no canvas / image decoder, so pixel analysis happens in the UI
// iframe. Flow: we export the whole frame here, post the bytes to the UI
// ("analyze-frame"), the UI replies ("frame-analysis") with whatever it was
// asked for — the section boundaries it found and/or the social icon band plus
// the column split inside it — and we reconcile that against the frame's
// existing guides before slicing.
//
// Section detection only runs on a frame with no horizontal guides at all: the
// moment you have placed guides yourself, they are the answer and nothing is
// proposed on top of them.
//
// Icon-band guides are not a prerequisite either: if the frame has none — or
// none that bracket the band tightly — we add the two the band needs. If the
// user already placed guides close to the band, theirs win.

const DETECT_SCALE = 1;

interface DetectedCell {
  x0: number;
  x1: number;
  isIcon: boolean;
  platform: string | null;
}

interface DetectedBand {
  found: boolean;
  top: number;
  bottom: number;
  padTop: number;
  padBottom: number;
  cells: DetectedCell[];
}

interface DetectionPlan {
  y0: number;
  y1: number;
  cells: DetectedCell[];
}

let detectionPlan: DetectionPlan | null = null;

// Guides the last analysis pass proposed, reported alongside the slice count so
// the status line can say where the boundaries came from.
let lastSectionGuidesAdded = 0;

async function requestFrameAnalysis(
  detectSections: boolean,
  detectSocial: boolean
): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  figma.ui.postMessage({ type: "detect-progress", message: "Rendering frame..." });

  // Same throwaway-slice trick as the export path: a slice inside a group does
  // not capture the frame content beneath it.
  const temp = figma.createSlice();
  temp.x = frame.absoluteTransform[0][2];
  temp.y = frame.absoluteTransform[1][2];
  temp.resize(frame.width, frame.height);

  const bytes = await temp.exportAsync({
    format: "JPG",
    constraint: { type: "SCALE", value: DETECT_SCALE },
  });

  temp.remove();

  figma.ui.postMessage({
    type: "analyze-frame",
    bytes,
    scale: DETECT_SCALE,
    frameWidth: Math.round(frame.width),
    frameHeight: Math.round(frame.height),
    detectSections,
    detectSocial,
  });
}

// Append the guides that are not already there, and report how many were new.
// `frame.guides` is immutable in place, so this builds a fresh array and assigns.
function applyGuideOffsets(frame: FrameNode, offsets: number[]): number {
  const frameH = Math.round(frame.height);
  const existing = new Set(
    frame.guides.filter(g => g.axis === "Y").map(g => Math.round(g.offset))
  );
  const nextGuides = [...frame.guides];
  let added = 0;

  for (const raw of offsets) {
    const y = Math.round(raw);
    if (y > 0 && y < frameH && !existing.has(y)) {
      nextGuides.push({ axis: "Y", offset: y });
      existing.add(y);
      added++;
    }
  }

  if (added > 0) frame.guides = nextGuides;
  return added;
}

// Section guides land first so the icon-band reconciliation can snap to them —
// a proposed boundary that already brackets the icon row is exactly the "your
// guides win" case reconcileRowBounds is looking for.
async function applyFrameAnalysis(
  sections: number[] | undefined,
  band: DetectedBand | undefined
): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  lastSectionGuidesAdded = sections && sections.length > 0
    ? applyGuideOffsets(frame, sections)
    : 0;

  if (band) {
    await applyDetectedBand(band);
  } else {
    detectionPlan = null;
    await handleGenerateSlices();
  }

  updateSelectionState();
}

// Decide the row bounds for a detected icon band. Reads the frame's guides;
// the decision itself lives in @slicer/core.
function reconcileRowBounds(
  frame: FrameNode,
  band: DetectedBand
): { y0: number; y1: number; usedExistingGuides: boolean } {
  return coreReconcileRowBounds(frameGuideOffsets(frame), frame.height, band as CoreDetectedBand);
}

async function applyDetectedBand(band: DetectedBand): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  if (!band.found || band.cells.length < 2) {
    // Nothing found is not a failure to slice — fall through to plain rows.
    detectionPlan = null;
    await handleGenerateSlices();
    figma.ui.postMessage({ type: "detect-result", found: false });
    return;
  }

  const { y0, y1, usedExistingGuides } = reconcileRowBounds(frame, band);

  if (y1 - y0 < 2) {
    figma.ui.postMessage({ type: "error", message: "Detected icon row is too thin to slice." });
    return;
  }

  // Add whatever guides the row needs that are not already there.
  const addedGuides = applyGuideOffsets(frame, [y0, y1]);

  detectionPlan = { y0, y1, cells: band.cells };

  await handleGenerateSlices();
  updateSelectionState();

  figma.ui.postMessage({
    type: "detect-result",
    found: true,
    usedExistingGuides,
    addedGuides,
    y0,
    y1,
    cells: lastPlanNodes,
  });
}

async function handleSetSliceLink(nodeId: string, url: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== "SLICE") return;

  // Reuse the export-side parser so the name always round-trips cleanly.
  const { cleanName } = parseLinkFromName(node.name);
  const trimmed = url.trim();
  node.name = trimmed ? `${cleanName} (${trimmed})` : cleanName;

  const platform = node.getPluginData("platform");
  if (platform) await rememberLink(platform, trimmed);
}

// --- Clear Slices ---

function handleClearSlices(): void {
  removeSliceGroup();
  figma.ui.postMessage({ type: "slices-cleared" });
}

// --- Clear Guides ---

function handleClearGuides(): void {
  const frame = getSelectedFrame();
  if (!frame) return;
  // The column plan is keyed to guide positions, so it dies with the guides.
  detectionPlan = null;
  frame.guides = frame.guides.filter(g => g.axis !== "Y");
  figma.ui.postMessage({ type: "guides-cleared" });
  updateSelectionState();
}

// --- Slice Image Collection ---
//
// Rendering every slice is the shared prefix of both "Export HTML" and
// "Read text (OCR)", so it lives here and both entry points call it.

async function collectSliceImages(): Promise<ExportedSlice[] | null> {
  // Ensure slices exist — generate from guides if not already present
  let sliceGroup = findSliceGroup();
  if (!sliceGroup) {
    await handleGenerateSlices();
    sliceGroup = findSliceGroup();
  }

  if (!sliceGroup) {
    figma.ui.postMessage({ type: "error", message: "No slices found. Add horizontal guides and generate slices first." });
    return null;
  }

  // Read all slice entries directly from the group (respects renames/custom names)
  const entries = readExportEntries(sliceGroup);
  if (entries.length === 0) {
    figma.ui.postMessage({ type: "error", message: "No slice nodes found in __EMAIL_SLICES__ group." });
    return null;
  }

  const exportedSlices: ExportedSlice[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    figma.ui.postMessage({
      type: "export-progress",
      current: i + 1,
      total: entries.length,
    });

    // Create a standalone temp slice at the same absolute position (not inside any group)
    // so exportAsync correctly captures the frame content beneath it
    const absX = entry.node.absoluteTransform[0][2];
    const absY = entry.node.absoluteTransform[1][2];
    const w = entry.node.width;
    const h = entry.node.height;

    const tempSlice = figma.createSlice();
    tempSlice.x = absX;
    tempSlice.y = absY;
    tempSlice.resize(w, h);

    const imgBytes = await tempSlice.exportAsync({
      format: "JPG",
      constraint: { type: "SCALE", value: 1 },
    });

    tempSlice.remove();

    exportedSlices.push({
      nodeId: entry.node.id,
      name: entry.name,
      fileName: entry.fileName,
      pngBytes: imgBytes,
      width: Math.round(w),
      height: Math.round(h),
      absX,
      absY,
      linkUrl: entry.linkUrl,
      alt: entry.alt,
    });
  }

  return exportedSlices;
}

// --- Export HTML ---

async function handleExportHTML(addFooter: boolean): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  const exportedSlices = await collectSliceImages();
  if (!exportedSlices) return;

  // Send slice data to UI for color extraction, HTML generation, and ZIP packaging
  figma.ui.postMessage({
    type: "package-zip",
    addFooter,
    slices: exportedSlices.map(s => ({
      fileName: s.fileName,
      bytes: s.pngBytes,
      width: s.width,
      height: s.height,
      absX: s.absX,
      absY: s.absY,
      linkUrl: s.linkUrl,
      alt: s.alt,
    })),
    frameName: sanitizeFileName(frame.name),
  });
}

// --- OCR ---
//
// The sandbox only supplies the pixels; recognition itself runs in the UI
// iframe, which is the only side with a canvas and network access.

async function handleOcrSlices(): Promise<void> {
  const exportedSlices = await collectSliceImages();
  if (!exportedSlices) return;

  figma.ui.postMessage({
    type: "slice-images",
    slices: exportedSlices.map(s => ({
      nodeId: s.nodeId,
      name: s.name,
      fileName: s.fileName,
      bytes: s.pngBytes,
      height: s.height,
      alt: s.alt,
    })),
  });
}

async function handleSetSliceAlt(nodeId: string, alt: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== "SLICE") return;
  node.setPluginData("alt", alt.trim());
}

// --- Message Handler ---

interface UIMessage {
  type: string;
  addFooter?: boolean;
  detectSocial?: boolean;
  band?: DetectedBand;
  sections?: number[];
  nodeId?: string;
  url?: string;
  alt?: string;
  minGutter?: number;
  minSection?: number;
}

figma.ui.onmessage = async (msg: UIMessage) => {
  switch (msg.type) {
    case "generate-slices": {
      const frame = getSelectedFrame();
      if (!frame) break;

      // A frame you have already put guides on is answered; only a bare frame
      // gets boundaries proposed for it.
      const detectSections = frame.guides.filter(g => g.axis === "Y").length === 0;
      const detectSocial = !!msg.detectSocial;

      if (detectSections || detectSocial) {
        // Analysis needs a round trip through the UI for pixel work; it calls
        // back into handleGenerateSlices once it has an answer.
        await requestFrameAnalysis(detectSections, detectSocial);
      } else {
        detectionPlan = null;
        lastSectionGuidesAdded = 0;
        await handleGenerateSlices();
      }
      break;
    }
    case "frame-analysis":
      await applyFrameAnalysis(msg.sections, msg.band);
      break;
    case "set-slice-link":
      if (msg.nodeId) await handleSetSliceLink(msg.nodeId, msg.url || "");
      break;
    case "set-slice-alt":
      if (msg.nodeId) await handleSetSliceAlt(msg.nodeId, msg.alt || "");
      break;
    case "set-settings":
      await saveSettings(
        msg.minGutter || DEFAULT_SETTINGS.minGutter,
        msg.minSection || DEFAULT_SETTINGS.minSection
      );
      break;
    case "ocr-slices":
      await handleOcrSlices();
      break;
    case "export-html":
      await handleExportHTML(msg.addFooter !== false);
      break;
    case "clear-slices":
      handleClearSlices();
      break;
    case "clear-guides":
      handleClearGuides();
      break;
  }
};
