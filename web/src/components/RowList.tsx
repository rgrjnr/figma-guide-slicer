"use client";

import type { SliceRegion } from "@slicer/core";
import { PLATFORM_URLS } from "@slicer/core";
import { normalizeUrl } from "@slicer/core";
import type { RowKind } from "@/lib/project";
import type { ProjectApi } from "@/lib/useProject";

const KIND_LABEL: Record<RowKind, string> = {
  image: "Image",
  button: "Button",
  social: "Social",
};

interface Props {
  api: ProjectApi;
  regions: SliceRegion[];
  selectedY0: number | null;
  onSelectRow: (y0: number | null) => void;
}

export function RowList({ api, regions, selectedY0, onSelectRow }: Props) {
  if (regions.length === 0) return null;

  return (
    <div className="rows">
      {regions.map(region => {
        const row = api.rowFor(region.y0);
        const multi = row.cells.length > 1;
        return (
          <div
            key={region.y0}
            className={`row-card${selectedY0 === region.y0 ? " selected" : ""}`}
            onMouseEnter={() => onSelectRow(region.y0)}
            onMouseLeave={() => onSelectRow(null)}
          >
            <header>
              <strong className="mono">{region.name}</strong>
              <span className="dim">
                y {region.y0}–{region.y1} · {region.y1 - region.y0}px
              </span>
              <span className="spacer" />
              <select
                value={row.kind}
                onChange={e => api.setRowKind(region.y0, e.target.value as RowKind)}
                aria-label={`${region.name} type`}
              >
                {(Object.keys(KIND_LABEL) as RowKind[]).map(k => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </header>

            {row.cells.map((cell, i) => (
              <div className="cell" key={i}>
                {multi && (
                  <input
                    className="platform"
                    value={cell.platform ?? ""}
                    placeholder="—"
                    title="Platform name. Used for the file name and the remembered link."
                    onChange={e =>
                      api.updateCell(region.y0, i, { platform: e.target.value.trim() || null })
                    }
                  />
                )}
                <input
                  className="link"
                  value={cell.link}
                  placeholder={
                    (cell.platform && PLATFORM_URLS[cell.platform]) || "https://… (optional link)"
                  }
                  onChange={e => api.updateCell(region.y0, i, { link: e.target.value })}
                  onBlur={e => api.updateCell(region.y0, i, { link: normalizeUrl(e.target.value) })}
                />
                <input
                  className="alt"
                  value={cell.alt}
                  placeholder="Alt text"
                  onChange={e => api.updateCell(region.y0, i, { alt: e.target.value })}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
