"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SliceRegion } from "@slicer/core";
import { designHeight } from "@/lib/project";
import type { ProjectApi } from "@/lib/useProject";

export type Tool = "split" | "focus" | "link";

const HANDLE_GRAB_PX = 6;

interface Props {
  api: ProjectApi;
  tool: Tool;
  regions: SliceRegion[];
  /** Highlighted and scrolled into view; driven by the links panel. */
  selectedY0: number | null;
  onSelectRow: (y0: number | null) => void;
}

/** Widths an email is actually read at, rather than arbitrary zoom steps. */
const PREVIEW_WIDTHS = { desktop: 0, mobile: 375 } as const;
type Preview = keyof typeof PREVIEW_WIDTHS;

const ZOOM_STEPS = [1, 0.75, 0.5, 0.25];

type Drag =
  | { kind: "guide"; from: number; to: number }
  | { kind: "rect"; y0: number; y1: number }
  | null;

export function CanvasEditor({ api, tool, regions, selectedY0, onSelectRow }: Props) {
  const { project, image } = api;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [preview, setPreview] = useState<Preview>("desktop");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const dh = designHeight(project);

  /**
   * Mobile is a zoom, not a narrower canvas: everything overlaid on the design
   * is positioned in design coordinates, so scaling the whole surface keeps the
   * splits and the artwork in step. Rendering at 375px is what a phone client
   * does to a 600px email.
   */
  useLayoutEffect(() => {
    if (!image) return;
    if (preview === "mobile") {
      setZoom(PREVIEW_WIDTHS.mobile / project.designWidth);
      return;
    }
    if (!fit) return;
    const apply = () => {
      const el = wrapRef.current;
      if (!el) return;
      setZoom(Math.min(1, (el.clientWidth - 32) / project.designWidth));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [image, fit, preview, project.designWidth]);

  // Follow the links panel: bring the row being edited into view.
  useEffect(() => {
    if (selectedY0 === null) return;
    const region = regions.find(r => r.y0 === selectedY0);
    const box = scrollRef.current;
    if (!region || !box) return;
    const top = region.y0 * zoom;
    const bottom = region.y1 * zoom;
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2 + (bottom - top) / 2), behavior: "smooth" });
    }
  }, [selectedY0, regions, zoom]);

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

    if (tool === "split") {
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
        if (tool === "focus") api.setWorkArea({ y0, y1 });
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

        <div className="preview-toggle">
          {(["desktop", "mobile"] as Preview[]).map(mode => (
            <button
              key={mode}
              className={preview === mode ? "active" : ""}
              onClick={() => setPreview(mode)}
              title={mode === "desktop" ? "Ver como no computador" : "Ver como no celular"}
            >
              {mode === "desktop" ? "Computador" : "Celular"}
            </button>
          ))}
        </div>

        <select
          className="zoom-select"
          value={preview === "mobile" ? "mobile" : fit ? "fit" : String(zoom)}
          onChange={e => {
            setPreview("desktop");
            if (e.target.value === "fit") { setFit(true); return; }
            setFit(false);
            setZoom(Number(e.target.value));
          }}
        >
          {preview === "mobile" && <option value="mobile">Celular (375px)</option>}
          <option value="fit">Ajustar à tela</option>
          {ZOOM_STEPS.map(z => (
            <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
          ))}
        </select>
      </div>

      <div className="editor-scroll" ref={scrollRef}>
        <div
          className={`surface tool-${tool}${preview === "mobile" ? " mobile" : ""}`}
          style={{ width: px(project.designWidth), height: px(dh) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHoverY(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={project.image.url} alt="" draggable={false} style={{ width: "100%", height: "100%" }} />

          {project.workArea && tool !== "focus" && (
            <>
              <div className="dim-band" style={{ top: 0, height: px(project.workArea.y0) }} />
              <div className="dim-band" style={{ top: px(project.workArea.y1), bottom: 0 }} />
            </>
          )}

          {regions.map(r => {
            const row = api.rowFor(r.y0);
            const linked = row.cells.some(c => c.link);
            return (
              <div
                key={r.y0}
                className={`region${selectedY0 === r.y0 ? " selected" : ""}${linked ? " linked" : ""}`}
                style={{ top: px(r.y0), height: px(r.y1 - r.y0) }}

              >
                <span className="region-tag">
                  {row.kind === "social" ? "social" : row.kind === "button" ? "link" : "image"} · {r.y1 - r.y0}px
                </span>

                {/* Centred, so there is still plenty of row left to click on if
                    what you actually want is to split it further. */}
                <div className="row-actions">
                  <button
                    className={`round${row.kind === "social" ? " on" : ""}`}
                    title="Esta linha é uma barra de redes sociais"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      api.makeSocialRow(r.y0);
                      onSelectRow(r.y0);
                    }}
                  >
                    <SocialIcon />
                  </button>
                </div>
              </div>
            );
          })}



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

/** Small inline glyphs; an icon font would be a dependency for two shapes. */
function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2.46-2.46a2.5 2.5 0 0 0-3.54-3.54L7.9 4.56M9.5 6.5a2.5 2.5 0 0 0-3.54 0L3.5 8.96a2.5 2.5 0 0 0 3.54 3.54l1.04-1.04"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  );
}

function SocialIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.9" fill="currentColor" />
      <circle cx="8" cy="8" r="1.9" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.9" fill="currentColor" />
    </svg>
  );
}
