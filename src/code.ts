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

interface SliceMeta {
  name: string;
  fileName: string;
  linkUrl: string | null;
}

interface ExportedSlice {
  fileName: string;
  pngBytes: Uint8Array;
  width: number;
  height: number;
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

function findSliceGroup(frame: FrameNode): GroupNode | null {
  for (const child of frame.children) {
    if (child.type === "GROUP" && child.name === "__EMAIL_SLICES__") {
      return child;
    }
  }
  return null;
}

function removeSliceGroup(frame: FrameNode): void {
  const group = findSliceGroup(frame);
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

// --- Resolve Slice Names from Group (if exists) ---

function resolveSliceNames(
  sliceGroup: GroupNode | null,
  regions: SliceRegion[]
): SliceMeta[] {
  return regions.map((region, i) => {
    let rawName = region.name;

    // If slice group exists, try to find matching named rectangle
    if (sliceGroup) {
      for (const child of sliceGroup.children) {
        const storedIndex = child.getPluginData("index");
        if (storedIndex === String(region.index)) {
          rawName = child.name;
          break;
        }
      }
    }

    const { cleanName, linkUrl } = parseLinkFromName(rawName);
    const fileName = sanitizeFileName(cleanName) + ".png";
    return { name: cleanName, fileName, linkUrl };
  });
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
  removeSliceGroup(frame);

  // Create actual Figma slice nodes, then group them
  const slices: SceneNode[] = [];
  for (const region of regions) {
    const slice = figma.createSlice();
    slice.name = region.name;
    slice.x = 0;
    slice.y = region.y0;
    slice.resize(frame.width, region.y1 - region.y0);
    slice.setPluginData("kind", "email-slice");
    slice.setPluginData("index", String(region.index));
    slice.setPluginData("y0", String(region.y0));
    slice.setPluginData("y1", String(region.y1));
    frame.appendChild(slice);
    slices.push(slice);
  }

  const group = figma.group(slices, frame);
  group.name = "__EMAIL_SLICES__";
  figma.ui.postMessage({ type: "slices-generated", count: regions.length });
}

// --- Clear Slices ---

function handleClearSlices(): void {
  const frame = getSelectedFrame();
  if (!frame) return;
  removeSliceGroup(frame);
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

async function handleExportHTML(): Promise<void> {
  const frame = getSelectedFrame();
  if (!frame) return;

  const regions = computeSliceRegions(frame);
  if (regions.length === 0) {
    figma.ui.postMessage({ type: "error", message: "No horizontal guides found. Generate slices first." });
    return;
  }

  // Ensure slices exist — generate them if not already present
  let sliceGroup = findSliceGroup(frame);
  if (!sliceGroup) {
    await handleGenerateSlices();
    sliceGroup = findSliceGroup(frame);
  }

  const namedSlices = resolveSliceNames(sliceGroup, regions);

  // Deduplicate file names
  const seenNames = new Map<string, number>();
  for (const s of namedSlices) {
    const count = seenNames.get(s.fileName) || 0;
    seenNames.set(s.fileName, count + 1);
    if (count > 0) {
      s.fileName = s.fileName.replace(".png", `-${count}.png`);
    }
  }

  const exportedSlices: ExportedSlice[] = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const meta = namedSlices[i];

    figma.ui.postMessage({
      type: "export-progress",
      current: i + 1,
      total: regions.length,
    });

    // Find the matching slice node from the group, or create a temporary one
    let sliceNode: SliceNode | null = null;
    if (sliceGroup) {
      for (const child of sliceGroup.children) {
        if (
          child.type === "SLICE" &&
          child.getPluginData("index") === String(region.index)
        ) {
          sliceNode = child;
          break;
        }
      }
    }

    let tempSlice = false;
    if (!sliceNode) {
      // Fallback: create a temporary slice at absolute page coordinates
      sliceNode = figma.createSlice();
      sliceNode.x = frame.absoluteTransform[0][2];
      sliceNode.y = frame.absoluteTransform[1][2] + region.y0;
      sliceNode.resize(frame.width, region.y1 - region.y0);
      tempSlice = true;
    }

    const pngBytes = await sliceNode.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: 1 },
    });

    if (tempSlice) {
      sliceNode.remove();
    }

    exportedSlices.push({
      fileName: meta.fileName,
      pngBytes,
      width: Math.round(frame.width),
      height: region.y1 - region.y0,
      linkUrl: meta.linkUrl,
    });
  }

  // Generate HTML
  const html = generateEmailHTML(exportedSlices);

  // Send to UI for ZIP packaging
  figma.ui.postMessage({
    type: "package-zip",
    html,
    images: exportedSlices.map(s => ({
      fileName: s.fileName,
      bytes: s.pngBytes,
    })),
    frameName: sanitizeFileName(frame.name),
  });
}

// --- HTML Generation ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generateEmailHTML(slices: ExportedSlice[]): string {
  const maxWidth = 600;

  const rows = slices
    .map(slice => {
      const imgTag = `<img src="images/${slice.fileName}" width="${maxWidth}" alt="" style="display:block; width:100%; max-width:${maxWidth}px; height:auto; border:0;" />`;

      const content = slice.linkUrl
        ? `<a href="${escapeHtml(slice.linkUrl)}" target="_blank" style="text-decoration:none;">${imgTag}</a>`
        : imgTag;

      return [
        "        <tr>",
        `          <td align="center" valign="top" style="padding:0; margin:0; line-height:0; font-size:0;">`,
        `            ${content}`,
        "          </td>",
        "        </tr>",
      ].join("\n");
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Email</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
  </style>
  <![endif]-->
  <style type="text/css">
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-spacing: 0; border-collapse: collapse; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" valign="top" style="padding:0;">
        <table role="presentation" width="${maxWidth}" cellpadding="0" cellspacing="0" border="0" style="max-width:${maxWidth}px; width:100%; margin:0 auto; background-color:#ffffff;">
${rows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// --- Message Handler ---

figma.ui.onmessage = async (msg: { type: string }) => {
  switch (msg.type) {
    case "generate-slices":
      await handleGenerateSlices();
      break;
    case "export-html":
      await handleExportHTML();
      break;
    case "clear-slices":
      handleClearSlices();
      break;
    case "clear-guides":
      handleClearGuides();
      break;
  }
};
