"use client";

import type { SliceRegion } from "@slicer/core";
import { PLATFORM_URLS, normalizeUrl } from "@slicer/core";
import type { ProjectApi } from "@/lib/useProject";

interface Props {
  api: ProjectApi;
  regions: SliceRegion[];
  /** The row the canvas should highlight and scroll to. */
  focusedY0: number | null;
  onFocus: (y0: number | null) => void;
}

const KIND_LABEL: Record<string, string> = {
  image: "Imagem",
  button: "Botão",
  social: "Redes sociais",
};

/**
 * Every row's links, in one list beside the design.
 *
 * Focusing a field points the canvas at the row it belongs to, so there is
 * never a question of which part of the email a link is being attached to —
 * which is the thing that is easy to get wrong when the two are separate.
 */
export function LinksPanel({ api, regions, focusedY0, onFocus }: Props) {
  return (
    <div className="links-panel">
      {regions.map((region, index) => {
        const row = api.rowFor(region.y0);
        const focused = focusedY0 === region.y0;
        return (
          <div
            key={region.y0}
            className={`link-row${focused ? " focused" : ""}`}
            onMouseEnter={() => onFocus(region.y0)}
          >
            <header>
              <span className="link-row-n">{index + 1}</span>
              <span className="link-row-kind">{KIND_LABEL[row.kind] ?? row.kind}</span>
              <span className="spacer" />
              <button
                className={`link-btn${row.kind === "social" ? " on" : ""}`}
                title="Marcar esta linha como barra de redes sociais"
                onClick={() => api.makeSocialRow(region.y0)}
              >
                {row.kind === "social" ? "é social" : "é social?"}
              </button>
            </header>

            {row.cells.map((cell, i) => (
              <div className="link-field" key={i}>
                {row.cells.length > 1 && (
                  <input
                    className="platform"
                    value={cell.platform ?? ""}
                    placeholder="rede"
                    onFocus={() => onFocus(region.y0)}
                    onChange={e => api.updateCell(region.y0, i, { platform: e.target.value.trim() || null })}
                  />
                )}
                <input
                  className="url"
                  value={cell.link}
                  placeholder={
                    (cell.platform && PLATFORM_URLS[cell.platform]) || "Colar o link desta parte"
                  }
                  onFocus={() => onFocus(region.y0)}
                  onChange={e => api.updateCell(region.y0, i, { link: e.target.value })}
                  onBlur={e => api.updateCell(region.y0, i, { link: normalizeUrl(e.target.value) })}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
