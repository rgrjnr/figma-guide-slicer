"use client";

import { useMemo, useRef, useState } from "react";
import { processEmailContent, readSpreadsheet } from "@/lib/emails";

interface Props {
  raw: string;
  segmentName: string;
  onChange: (patch: { raw?: string; segmentName?: string }) => void;
}

type Source = "paste" | "file";

/**
 * The list arrives as a spreadsheet attached to the request, or occasionally
 * pasted into it. Both land in the same box, so what happens next is the same
 * either way and there is one thing to check before moving on.
 */
export function AudienceStep({ raw, segmentName, onChange }: Props) {
  const [source, setSource] = useState<Source>("paste");
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const result = useMemo(() => processEmailContent(raw), [raw]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    // A design dragged to the wrong step should say so, not be read as text.
    if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) {
      setSource("file");
      setFileName(`${file.name} — use uma planilha (.xlsx, .xls ou .csv)`);
      return;
    }
    // Reading happens on the file tab either way, so what arrived is visible.
    setSource("file");
    setReading(true);
    setFileName(file.name);
    try {
      const text = /\.(xlsx|xls)$/i.test(file.name)
        ? await readSpreadsheet(file)
        : await file.text();
      onChange({ raw: text });
    } catch {
      onChange({ raw: "" });
      setFileName(`${file.name} — não foi possível ler`);
    } finally {
      setReading(false);
    }
  };

  return (
    // The whole step is a drop target. The spreadsheet arrives by drag more
    // often than not, and the person dragging it has no reason to know a
    // particular tab has to be open first — dropping it on the paste tab used
    // to be silently swallowed, which read as "the file cannot be imported".
    <div
      className="step-body form"
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); void readFile(e.dataTransfer.files[0]); }}
    >
      <div className="form-inner">
        <div className="source-toggle">
          <button className={source === "paste" ? "active" : ""} onClick={() => setSource("paste")}>
            Colar endereços
          </button>
          <button className={source === "file" ? "active" : ""} onClick={() => setSource("file")}>
            Enviar arquivo
          </button>
        </div>

        {source === "paste" ? (
          <label className="field">
            <span>Endereços</span>
            <textarea
              value={raw}
              onChange={e => onChange({ raw: e.target.value })}
              placeholder={"Cole aqui — vírgula, ponto e vírgula ou quebra de linha funcionam."}
              rows={10}
              spellCheck={false}
            />
          </label>
        ) : (
          <label
            className="dropzone"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); void readFile(e.dataTransfer.files[0]); }}
            onClick={() => fileInput.current?.click()}
          >
            <p><strong>{reading ? "Lendo…" : fileName || "Arraste a planilha aqui"}</strong></p>
            <p className="dim">
              .xlsx, .xls ou .csv — qualquer coluna com e-mails é reconhecida.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              hidden
              onChange={e => void readFile(e.target.files?.[0])}
            />
          </label>
        )}

        {raw.trim() && (
          <p className="summary">
            <strong>{result.valid.length.toLocaleString()}</strong> endereços únicos
            {result.duplicates > 0 && <> · {result.duplicates} repetido{result.duplicates === 1 ? "" : "s"} removido{result.duplicates === 1 ? "" : "s"}</>}
            {result.invalid.length > 0 && <> · <span className="warn">{result.invalid.length} ignorado{result.invalid.length === 1 ? "" : "s"}</span></>}
          </p>
        )}
        {result.invalid.length > 0 && (
          <p className="hint mono">
            Ignorados: {result.invalid.slice(0, 6).join(" ")}
            {result.invalid.length > 6 && ` +${result.invalid.length - 6}`}
          </p>
        )}

        <label className="field">
          <span>Nome do público no Braze</span>
          <input value={segmentName} onChange={e => onChange({ segmentName: e.target.value })} />
          <small>O Braze nomeia o público a partir do arquivo importado.</small>
        </label>
      </div>
    </div>
  );
}
