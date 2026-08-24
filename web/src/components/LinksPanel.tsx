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
 * The links, in one list beside the design — but only for rows someone has
 * pointed at. Listing a field for every image row buried the handful that
 * matter under twenty that never will, so a row appears here when its circle
 * button on the artwork is clicked, and stays once it has a link or is social.
 *
 * Focusing a field still points the canvas at its row, so which part of the
 * email a link is attached to is never in question.
 */
export function LinksPanel({ api, regions, focusedY0, onFocus }: Props) {
  const shown = regions
    .map((region, index) => ({ region, index, row: api.rowFor(region.y0) }))
    .filter(({ region, row }) =>
      region.y0 === focusedY0 || row.kind !== "image" || row.cells.some(c => c.link)
    );

  if (shown.length === 0) {
    return (
      <p className="hint">
        Passe o mouse sobre uma linha na arte e use o botão de link ou o de
        redes sociais.
      </p>
    );
  }

  return (
    <div className="links-panel">
      {shown.map(({ region, index, row }) => {
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
                  autoFocus={focused && i === 0}
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
