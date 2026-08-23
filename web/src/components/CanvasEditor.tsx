"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SliceRegion } from "@slicer/core";
import { designHeight, type Project } from "@/lib/project";
import type { ProjectApi } from "@/lib/useProject";

export type Tool = "guide" | "work" | "button";

const HANDLE_GRAB_PX = 6;

interface Props {
  api: ProjectApi;
  tool: Tool;
  regions: SliceRegion[];
  selectedY0: number | null;
  onSelectRow: (y0: number | null) => void;
}

type Drag =
  | { kind: "guide"; from: number; to: number }
  | { kind: "rect"; y0: number; y1: number }
  | null;

export function CanvasEditor({ api, tool, regions, selectedY0, onSelectRow }: Props) {
  const { project, image } = api;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const dh = designHeight(project);

  // Fit the artwork to the available width, but never blow a small image up.
  useLayoutEffect(() => {
    if (!image) return;
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const avail = el.clientWidth - 32;
      setZoom(Math.min(1, avail / project.designWidth));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [image, project.designWidth]);

  /** Pointer position → design-space Y. */
  const yAt = useCallback(
    (clientY: number, surface: HTMLElement): number => {
      const rect = surface.getBoundingClientRect();
      const y = (clientY - rect.top) / zoom;
      return Math.max(0, Math.min(dh, Math.round(y)));
    },
    [zoom, dh]
  );

  const guideNear = useCallback(
    (y: number): number | null => {
      const tol = Math.max(2, HANDLE_GRAB_PX / zoom);
      let best: number | null = null;
      let bestD = Infinity;
      for (const g of project.guides) {
        const d = Math.abs(g - y);
        if (d <= tol && d < bestD) { best = g; bestD = d; }
      }
      return best;
    },
    [project.guides, zoom]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return;
    const surface = e.currentTarget;
    const y = yAt(e.clientY, surface);
    surface.setPointerCapture(e.pointerId);

    if (tool === "guide") {
      const existing = guideNear(y);
      if (existing !== null) {
        setDrag({ kind: "guide", from: existing, to: existing });
      } else {
        api.addGuide(y);
        setDrag({ kind: "guide", from: y, to: y });
      }
      return;
    }
    setDrag({ kind: "rect", y0: y, y1: y });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return;
    const y = yAt(e.clientY, e.currentTarget);
    setHoverY(y);
    if (!drag) return;
    if (drag.kind === "guide") {
      if (y === drag.to) return;
      api.moveGuide(drag.to, y);
      setDrag({ kind: "guide", from: drag.from, to: y });
    } else {
      setDrag({ ...drag, y1: y });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // Closes the undo step even if nothing was dragged, so the next edit is
    // recorded separately.
    api.endGesture();
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.kind === "rect") {
      const y0 = Math.min(drag.y0, drag.y1);
      const y1 = Math.max(drag.y0, drag.y1);
      if (y1 - y0 >= 4) {
        if (tool === "work") api.setWorkArea({ y0, y1 });
        else api.addButton(y0, y1);
      }
    }
    setDrag(null);
  };

  // Nudge and delete the guide under the cursor without needing the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hoverY === null || !image) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const g = guideNear(hoverY);
      if (g === null) return;
      if (e.key === "Backspace" || e.key === "Delete") { api.removeGuide(g); e.preventDefault(); }
      if (e.key === "ArrowUp") { api.moveGuide(g, g - (e.shiftKey ? 10 : 1)); e.preventDefault(); }
      if (e.key === "ArrowDown") { api.moveGuide(g, g + (e.shiftKey ? 10 : 1)); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverY, guideNear, api, image]);

  if (!image || !project.image) return null;

  const px = (v: number) => `${v * zoom}px`;
  const rectDrag = drag?.kind === "rect" ? drag : null;

  return (
    <div className="editor" ref={wrapRef}>
      <div className="editor-bar">
        <span className="mono">{project.image.name}</span>
        <span className="dim">
          {project.image.width}×{project.image.height}px
          {project.designWidth !== project.image.width && ` · design ${project.designWidth}w`}
        </span>
        <span className="spacer" />
        <label className="zoom">
          Zoom
          <input
            type="range" min={10} max={200} value={Math.round(zoom * 100)}
            onChange={e => setZoom(Number(e.target.value) / 100)}
          />
          <span className="mono">{Math.round(zoom * 100)}%</span>
        </label>
      </div>

      <div className="editor-scroll">
        <div
          className={`surface tool-${tool}`}
          style={{ width: px(project.designWidth), height: px(dh) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHoverY(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={project.image.url} alt="" draggable={false} style={{ width: "100%", height: "100%" }} />

          {project.workArea && tool !== "work" && (
            <>
              <div className="dim-band" style={{ top: 0, height: px(project.workArea.y0) }} />
              <div className="dim-band" style={{ top: px(project.workArea.y1), bottom: 0 }} />
            </>
          )}

          {regions.map(r => (
            <div
              key={r.y0}
              className={`region${selectedY0 === r.y0 ? " selected" : ""}`}
              style={{ top: px(r.y0), height: px(r.y1 - r.y0) }}
              onClick={() => onSelectRow(selectedY0 === r.y0 ? null : r.y0)}
            >
              <span className="region-tag">{r.name} · {r.y1 - r.y0}px</span>
            </div>
          ))}

          {project.guides.map(g => (
            <div
              key={g}
              className="guide"
              style={{ top: px(g) }}
              onDoubleClick={e => { e.stopPropagation(); api.removeGuide(g); }}
              title={`y ${g} — double-click to remove`}
            />
          ))}

          {project.proposedGuides.map(g => (
            <div
              key={`p${g}`}
              className="guide proposed"
              style={{ top: px(g) }}
              onClick={e => { e.stopPropagation(); api.acceptProposed(g); }}
              title={`Proposed cut at y ${g} — click to accept`}
            />
          ))}

          {rectDrag && (
            <div
              className={`marquee ${tool}`}
              style={{
                top: px(Math.min(rectDrag.y0, rectDrag.y1)),
                height: px(Math.abs(rectDrag.y1 - rectDrag.y0)),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
