"use client";

import { useMemo, useState } from "react";
import { processEmailContent } from "@/lib/emails";
import { downloadBlob } from "@/lib/export";

interface Props {
  onCsvReady: (csv: string, count: number) => void;
}

export function AudiencePanel({ onCsvReady }: Props) {
  const [raw, setRaw] = useState("");
  const result = useMemo(() => processEmailContent(raw), [raw]);

  return (
    <div className="audience">
      <textarea
        value={raw}
        onChange={e => {
          setRaw(e.target.value);
          const next = processEmailContent(e.target.value);
          onCsvReady(next.csv, next.valid.length);
        }}
        placeholder="Paste addresses — commas, semicolons, newlines, or angle brackets all work."
        spellCheck={false}
      />
      {raw.trim() && (
        <p className="hint">
          <strong>{result.valid.length}</strong> unique
          {result.duplicates > 0 && <> · {result.duplicates} duplicate{result.duplicates === 1 ? "" : "s"} dropped</>}
          {result.invalid.length > 0 && (
            <> · <span className="warn">{result.invalid.length} invalid</span></>
          )}
        </p>
      )}
      {result.invalid.length > 0 && (
        <p className="hint mono invalid-list">{result.invalid.slice(0, 8).join(" ")}
          {result.invalid.length > 8 && ` +${result.invalid.length - 8} more`}</p>
      )}
      <button
        disabled={result.valid.length === 0}
        onClick={() =>
          downloadBlob(new Blob([result.csv], { type: "text/csv" }), `audience-${result.valid.length}.csv`)
        }
      >
        Download CSV ({result.valid.length})
      </button>
    </div>
  );
}
