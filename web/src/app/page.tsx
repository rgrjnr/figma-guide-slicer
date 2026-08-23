"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasEditor, type Tool } from "@/components/CanvasEditor";
import { RowList } from "@/components/RowList";
import { AudiencePanel } from "@/components/AudiencePanel";
import { BrazePanel } from "@/components/BrazePanel";
import { sanitizeFileName } from "@slicer/core";
import { buildHtml, downloadBlob, packageZip, sliceProject, type ExportedCell } from "@/lib/export";
import { readAltText } from "@/lib/ocr";
import { useProject } from "@/lib/useProject";

type Step = "upload" | "markup" | "export";

export default function Page() {
  const api = useProject();
  const { project, image, regions } = api;
  const [tool, setTool] = useState<Tool>("guide");
  const [selectedY0, setSelectedY0] = useState<number | null>(null);
  const [cells, setCells] = useState<ExportedCell[] | null>(null);
  const [busy, setBusy] = useState("");
  const [audience, setAudience] = useState({ csv: "", count: 0 });
  const [tab, setTab] = useState<"rows" | "audience" | "braze">("rows");
  const fileInput = useRef<HTMLInputElement>(null);

  const step: Step = !image ? "upload" : cells ? "export" : "markup";

  // Slice previews hold object URLs; drop them when the export is replaced.
  const previous = useRef<ExportedCell[] | null>(null);
  useEffect(() => {
    if (previous.current && previous.current !== cells) {
      for (const c of previous.current) URL.revokeObjectURL(c.previewUrl);
    }
    previous.current = cells;
  }, [cells]);

  // Any markup change invalidates a previous export.
  useEffect(() => {
    setCells(null);
  }, [project.guides, project.rows, project.designWidth, project.emailWidth, project.addFooter]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        api.setStatus("That file is not an image.");
        return;
      }
      setCells(null);
      await api.loadFile(file);
    },
    [api]
  );

  const runExport = useCallback(async () => {
    if (!image) return;
    setBusy("Slicing…");
    try {
      const out = await sliceProject(project, image, (d, t) => setBusy(`Slicing ${d}/${t}…`));
      setCells(out);
      api.setStatus(`${out.length} image${out.length === 1 ? "" : "s"} ready.`);
    } catch (err) {
      api.setStatus(err instanceof Error ? err.message : "Slicing failed.");
    } finally {
      setBusy("");
    }
  }, [image, project, api]);

  const runOcr = useCallback(async () => {
    if (!cells) return;
    // OCR fills blanks; it never overwrites alt text you wrote yourself or that
    // came from platform detection (which is right where OCR does worst).
    const blank = cells.filter(c => !c.alt);
    if (blank.length === 0) {
      api.setStatus("Every slice already has alt text.");
      return;
    }
    setBusy("Loading OCR…");
    try {
      const found = await readAltText(blank, (d, t) => setBusy(`Reading text ${d}/${t}…`));
      for (const cell of blank) {
        const text = found.get(cell.fileName);
        if (text) api.updateCell(cell.rowY0, cell.cellIndex, { alt: text });
      }
      api.setStatus(`Read text from ${found.size} of ${blank.length} slices.`);
    } catch (err) {
      api.setStatus(err instanceof Error ? err.message : "OCR failed.");
    } finally {
      setBusy("");
    }
  }, [cells, api]);

  // The Braze step builds from current markup rather than a stale download.
  const getZip = useCallback(async () => {
    if (!cells) return null;
    return packageZip(buildHtml(project, cells), cells);
  }, [cells, project]);

  const downloadZip = useCallback(async () => {
    if (!cells || !project.image) return;
    setBusy("Packaging…");
    try {
      const zip = await packageZip(buildHtml(project, cells), cells);
      downloadBlob(zip, `${sanitizeFileName(project.image.name.replace(/\.[^.]+$/, ""))}.zip`);
      api.setStatus("ZIP downloaded.");
    } finally {
      setBusy("");
    }
  }, [cells, project, api]);

  return (
    <main>
      <header className="app-bar">
        <h1>Email Studio</h1>
        <nav className="steps">
          {(["upload", "markup", "export"] as Step[]).map(s => (
            <span key={s} className={`step${step === s ? " active" : ""}`}>{s}</span>
          ))}
        </nav>
        <span className="spacer" />
        {busy && <span className="busy">{busy}</span>}
        {!busy && api.status && <span className="status">{api.status}</span>}
        {image && (
          <button className="ghost" onClick={() => { setCells(null); api.reset(); }}>
            Start over
          </button>
        )}
      </header>

      {!image ? (
        <div
          className="dropzone"
          onClick={() => fileInput.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); void onFile(e.dataTransfer.files[0]); }}
        >
          <p><strong>Drop a flat email design here</strong></p>
          <p className="dim">PNG or JPG, exported from Figma at 1x. Or click to choose a file.</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={e => void onFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="workspace">
          <CanvasEditor
            api={api}
            tool={tool}
            regions={regions}
            selectedY0={selectedY0}
            onSelectRow={setSelectedY0}
          />

          <aside className="panel">
            <section>
              <h2>Tool</h2>
              <div className="tools">
                {([
                  ["guide", "Guides", "Click to add, drag to move, double-click to remove"],
                  ["work", "Work area", "Drag a range to limit where detection looks"],
                  ["button", "Button", "Drag over a CTA to make it its own linked row"],
                ] as [Tool, string, string][]).map(([t, label, hint]) => (
                  <button
                    key={t}
                    className={tool === t ? "active" : ""}
                    onClick={() => setTool(t)}
                    title={hint}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {project.workArea && (
                <p className="hint">
                  Work area y {project.workArea.y0}–{project.workArea.y1}{" "}
                  <button className="link-btn" onClick={() => api.setWorkArea(null)}>clear</button>
                </p>
              )}
            </section>

            <section>
              <h2>Detect</h2>
              <div className="field-row">
                <label>
                  Min gap
                  <input
                    type="number" min={2} max={400} value={project.minGutter}
                    onChange={e => api.patchProject({ minGutter: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Min section
                  <input
                    type="number" min={4} max={2000} value={project.minSection}
                    onChange={e => api.patchProject({ minSection: Number(e.target.value) })}
                  />
                </label>
              </div>
              <button onClick={api.detectSections}>Find sections</button>
              <button onClick={api.detectSocial}>Find social row</button>
              {project.proposedGuides.length > 0 && (
                <p className="hint">
                  {project.proposedGuides.length} proposed —{" "}
                  <button className="link-btn" onClick={() => api.acceptProposed()}>accept all</button>
                  {" · "}
                  <button className="link-btn" onClick={api.clearProposed}>discard</button>
                </p>
              )}
            </section>

            <section>
              <h2>Output</h2>
              <div className="field-row">
                <label>
                  Design width
                  <input
                    type="number" min={1} value={project.designWidth}
                    onChange={e => api.patchProject({ designWidth: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label>
                  Email width
                  <input
                    type="number" min={1} value={project.emailWidth}
                    onChange={e => api.patchProject({ emailWidth: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox" checked={project.addFooter}
                  onChange={e => api.patchProject({ addFooter: e.target.checked })}
                />
                Add footer merge tag
              </label>
              <button className="primary" onClick={runExport} disabled={!!busy}>
                {cells ? "Re-slice" : "Slice"} {regions.length} row{regions.length === 1 ? "" : "s"}
              </button>
              {cells && (
                <>
                  <button onClick={runOcr} disabled={!!busy}>Read text (OCR)</button>
                  <button className="primary" onClick={downloadZip} disabled={!!busy}>
                    Download ZIP
                  </button>
                </>
              )}
            </section>

            <section className="grow">
              <div className="tabs">
                <button className={tab === "rows" ? "active" : ""} onClick={() => setTab("rows")}>
                  Rows ({regions.length})
                </button>
                <button className={tab === "audience" ? "active" : ""} onClick={() => setTab("audience")}>
                  Audience{audience.count > 0 ? ` (${audience.count})` : ""}
                </button>
                <button className={tab === "braze" ? "active" : ""} onClick={() => setTab("braze")}>
                  Braze
                </button>
              </div>
              {tab === "rows" && (
                <RowList
                  api={api}
                  regions={regions}
                  selectedY0={selectedY0}
                  onSelectRow={setSelectedY0}
                />
              )}
              {tab === "audience" && (
                <AudiencePanel onCsvReady={(csv, count) => setAudience({ csv, count })} />
              )}
              {tab === "braze" && (
                <BrazePanel getZip={getZip} csv={audience.csv} audienceCount={audience.count} />
              )}
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
