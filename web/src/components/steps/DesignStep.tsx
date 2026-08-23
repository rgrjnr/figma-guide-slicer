"use client";

import { useCallback, useState } from "react";
import { CanvasEditor } from "@/components/CanvasEditor";
import { LinksPanel } from "@/components/LinksPanel";
import type { ProjectApi } from "@/lib/useProject";

interface Props {
  api: ProjectApi;
  onFile: (file: File | undefined) => void;
}

/**
 * Turn the artwork into rows, and say where each one links.
 *
 * The links live beside the design rather than on top of it, and focusing one
 * scrolls the design to the row it belongs to — so which part of the email a
 * link is attached to is never in question.
 */
export function DesignStep({ api, onFile }: Props) {
  const { image, regions } = api;
  const [focusedY0, setFocusedY0] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);

  const autoDetect = useCallback(async () => {
    setDetecting(true);
    try {
      // Two passes, one button: whether a split came from a background gap or
      // from an icon row is not something worth explaining.
      api.detectSections();
      await new Promise(r => setTimeout(r, 80));
      api.acceptProposed();
      await new Promise(r => setTimeout(r, 80));
      api.detectSocial();
    } finally {
      setDetecting(false);
    }
  }, [api]);

  if (!image) {
    return (
      <div className="step-body centred">
        <label
          className="dropzone big"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
        >
          <h2>Arraste a arte do e-mail aqui</h2>
          <p className="dim">O PNG ou JPG do pedido, no tamanho original.</p>
          <input type="file" accept="image/*" hidden onChange={e => onFile(e.target.files?.[0])} />
        </label>
      </div>
    );
  }

  return (
    <div className="step-body split-view">
      <CanvasEditor
        api={api}
        tool="split"
        regions={regions}
        selectedY0={focusedY0}
        onSelectRow={setFocusedY0}
      />

      <aside className="step-side">
        <section>
          <button className="primary big-btn" onClick={autoDetect} disabled={detecting}>
            {detecting ? "Analisando…" : "Detectar linhas automaticamente"}
          </button>
          <p className="hint">
            Encontra onde o e-mail se divide e identifica a barra de redes
            sociais. Clique na arte para dividir mais, e arraste uma divisória
            para movê-la.
          </p>
          <button className="ghost" onClick={api.clearMarks} disabled={regions.length <= 1}>
            Limpar e recomeçar
          </button>
        </section>

        <section className="grow">
          <h3>Links</h3>
          <p className="hint">
            Clique em um campo para ver a parte correspondente na arte.
          </p>
          <LinksPanel
            api={api}
            regions={regions}
            focusedY0={focusedY0}
            onFocus={setFocusedY0}
          />
        </section>
      </aside>
    </div>
  );
}
