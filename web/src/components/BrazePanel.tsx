"use client";

import { useCallback, useRef, useState } from "react";

type Flow = "login" | "draft" | "audience" | "schedule";

interface Props {
  /** Builds the ZIP on demand, so the Braze step always ships current markup. */
  getZip: () => Promise<Blob | null>;
  csv: string;
  audienceCount: number;
}

interface LogLine {
  level: "info" | "error";
  message: string;
}

const LOCAL_ZONE = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

export function BrazePanel({ getZip, csv, audienceCount }: Props) {
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [timeZone, setTimeZone] = useState(LOCAL_ZONE);
  const [localTimeDelivery, setLocalTimeDelivery] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<Flow | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (flow: Flow) => {
      setRunning(flow);
      setLog([{ level: "info", message: `starting ${flow}…` }]);

      const controller = new AbortController();
      abort.current = controller;

      try {
        let zipBase64: string | undefined;
        if (flow === "draft") {
          const zip = await getZip();
          if (!zip) throw new Error("Slice the email before sending it to Braze.");
          const buffer = await zip.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          zipBase64 = btoa(binary);
        }

        const response = await fetch("/api/braze/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            flow, campaignName, subject, preheader, sendAt, timeZone, localTimeDelivery,
            zipBase64, csv: flow === "audience" ? csv : undefined,
          }),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(detail.error || "The run could not be started.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const event = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (!event || !data) continue;
            const payload = JSON.parse(data);
            if (event === "log") setLog(l => [...l, payload]);
            if (event === "done") {
              setLog(l => [...l, {
                level: payload.ok ? "info" : "error",
                message: payload.ok ? "finished" : `failed${payload.error ? `: ${payload.error}` : ""}`,
              }]);
            }
          }
        }
      } catch (err) {
        setLog(l => [...l, { level: "error", message: err instanceof Error ? err.message : String(err) }]);
      } finally {
        setRunning(null);
        abort.current = null;
      }
    },
    [campaignName, subject, preheader, sendAt, timeZone, localTimeDelivery, csv, getZip]
  );

  const busy = running !== null;

  return (
    <div className="braze">
      <p className="hint">
        Drives the Braze dashboard in a real browser. Credentials come from
        <span className="mono"> web/.env.local</span>. Nothing here ever sends —
        it stops at a saved draft or a schedule.
      </p>

      <label className="stack">
        Campaign name
        <input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="TEST-2026-08-23" />
      </label>
      <label className="stack">
        Subject
        <input value={subject} onChange={e => setSubject(e.target.value)} />
      </label>
      <label className="stack">
        Preheader
        <input value={preheader} onChange={e => setPreheader(e.target.value)} />
      </label>

      <div className="field-row">
        <label>
          Send at (local to the zone)
          <input value={sendAt} onChange={e => setSendAt(e.target.value)} placeholder="2026-09-01 09:30" />
        </label>
        <label>
          Time zone
          <input value={timeZone} onChange={e => setTimeZone(e.target.value)} placeholder="America/Sao_Paulo" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={localTimeDelivery} onChange={e => setLocalTimeDelivery(e.target.checked)} />
        Send in each recipient&rsquo;s own time zone
      </label>

      <div className="braze-actions">
        <button disabled={busy} onClick={() => run("login")}>
          {running === "login" ? "Signing in…" : "Test sign-in"}
        </button>
        <button className="primary" disabled={busy || !campaignName} onClick={() => run("draft")}>
          {running === "draft" ? "Building draft…" : "Create draft"}
        </button>
        <button disabled={busy || audienceCount === 0} onClick={() => run("audience")}>
          {running === "audience" ? "Importing…" : `Import audience (${audienceCount})`}
        </button>
        <button disabled={busy || !campaignName || !sendAt} onClick={() => run("schedule")}>
          {running === "schedule" ? "Scheduling…" : "Schedule"}
        </button>
      </div>

      {log.length > 0 && (
        <pre className="braze-log">
          {log.map((line, i) => (
            <div key={i} className={line.level === "error" ? "err" : undefined}>{line.message}</div>
          ))}
        </pre>
      )}
    </div>
  );
}
