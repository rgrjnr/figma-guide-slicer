// ============================================================
// Guide-Based Email Slicer — Plugin Sandbox (code.ts)
// ============================================================

// --- Types ---

interface SliceRegion {
  index: number;
  y0: number;
  y1: number;
  name: string;
}

interface ExportedSlice {
  fileName: string;
  pngBytes: Uint8Array;
  width: number;
  height: number;
  absX: number;
  absY: number;
  linkUrl: string | null;
}

// --- Show UI ---

figma.showUI(__html__, { width: 320, height: 380, themeColors: true });

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

function computeSliceRegions(frame: FrameNode): SliceRegion[] {
  const horizontalGuides = frame.guides.filter(g => g.axis === "Y");
  if (horizontalGuides.length === 0) return [];

  let positions = horizontalGuides
    .map(g => Math.round(g.offset))
    .filter(y => y > 0 && y < Math.round(frame.height));

  positions = [...new Set(positions)];
  positions.sort((a, b) => a - b);

  const frameH = Math.round(frame.height);
  const boundaries = [0, ...positions, frameH];
  const regions: SliceRegion[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const y0 = boundaries[i];
    const y1 = boundaries[i + 1];
    if (y1 <= y0) continue;
    regions.push({
      index: i,
      y0,
      y1,
      name: `slice-${String(i + 1).padStart(3, "0")}`,
    });
  }

  return regions;
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

// --- Name & Link Parsing ---

function parseLinkFromName(name: string): { cleanName: string; linkUrl: string | null } {
  const match = name.match(/\(([^)]+)\)\s*$/);
  if (match) {
    const url = match[1].trim();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const cleanName = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
      return { cleanName, linkUrl: url };
    }
  }
  return { cleanName: name, linkUrl: null };
}

function sanitizeFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "slice"
  );
}

// --- Read export entries from slice group ---

interface ExportEntry {
  node: SliceNode;
  name: string;
  fileName: string;
  linkUrl: string | null;
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
    entries.push({ node: child, name: cleanName, fileName, linkUrl });
  }

  // Deduplicate file names
  const seenNames = new Map<string, number>();
  for (const entry of entries) {
    const count = seenNames.get(entry.fileName) || 0;
    seenNames.set(entry.fileName, count + 1);
    if (count > 0) {
      entry.fileName = entry.fileName.replace(".jpg", `-${count}.jpg`);
    }
  }

  return entries;
}

// --- Generate Slices ---

async function handleGenerateSlices(): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  const regions = computeSliceRegions(frame);
  if (regions.length === 0) {
    figma.ui.postMessage({ type: "error", message: "No horizontal guides found in the selected frame." });
    return;
  }

  if (regions.length > 100) {
    figma.ui.postMessage({
      type: "error",
      message: `Too many slices (${regions.length}). Consider reducing guides.`,
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
  for (const region of regions) {
    const slice = figma.createSlice();
    slice.name = region.name;
    slice.x = frameAbsX;
    slice.y = frameAbsY + region.y0;
    slice.resize(frame.width, region.y1 - region.y0);
    slice.setPluginData("kind", "email-slice");
    slice.setPluginData("index", String(region.index));
    slice.setPluginData("y0", String(region.y0));
    slice.setPluginData("y1", String(region.y1));
    slices.push(slice);
  }

  const group = figma.group(slices, figma.currentPage);
  group.name = "__EMAIL_SLICES__";
  figma.ui.postMessage({ type: "slices-generated", count: regions.length });
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
  frame.guides = frame.guides.filter(g => g.axis !== "Y");
  figma.ui.postMessage({ type: "guides-cleared" });
  updateSelectionState();
}

// --- Export HTML ---

async function handleExportHTML(addFooter: boolean): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  // Ensure slices exist — generate from guides if not already present
  let sliceGroup = findSliceGroup();
  if (!sliceGroup) {
    await handleGenerateSlices();
    sliceGroup = findSliceGroup();
  }

  if (!sliceGroup) {
    figma.ui.postMessage({ type: "error", message: "No slices found. Add horizontal guides and generate slices first." });
    return;
  }

  // Read all slice entries directly from the group (respects renames/custom names)
  const entries = readExportEntries(sliceGroup);
  if (entries.length === 0) {
    figma.ui.postMessage({ type: "error", message: "No slice nodes found in __EMAIL_SLICES__ group." });
    return;
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
      fileName: entry.fileName,
      pngBytes: imgBytes,
      width: Math.round(w),
      height: Math.round(h),
      absX,
      absY,
      linkUrl: entry.linkUrl,
    });
  }

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
    })),
    frameName: sanitizeFileName(frame.name),
  });
}

// --- Message Handler ---

figma.ui.onmessage = async (msg: { type: string; addFooter?: boolean }) => {
  switch (msg.type) {
    case "generate-slices":
      await handleGenerateSlices();
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
