"use client";

import { useCallback, useRef, useState } from "react";
import type { ProjectRecord } from "@/lib/types";

type Flow = "login" | "draft" | "replace" | "schedule" | "audience" | "refresh" | "test";

interface Props {
  /** Builds the ZIP on demand, so Braze always gets the current markup. */
  getZip: () => Promise<Blob | null>;
  csv: string;
  audienceCount: number;
  project: ProjectRecord | null;
  onProjectChanged: () => void;
  campaignName: string;
  subject: string;
  preheader: string;
}

interface LogLine {
  level: "info" | "error";
  message: string;
}

const LOCAL_ZONE = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function BrazePanel({
  getZip, csv, audienceCount, project, onProjectChanged,
  campaignName, subject, preheader,
}: Props) {
  const [sendAt, setSendAt] = useState("");
  const [timeZone, setTimeZone] = useState(LOCAL_ZONE);
  const [segment, setSegment] = useState("");
  const [localTimeDelivery, setLocalTimeDelivery] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<Flow | null>(null);
  const abort = useRef<AbortController | null>(null);

  const campaign = project?.braze.campaign;

  const run = useCallback(
    async (flow: Flow, extra: Record<string, unknown> = {}) => {
      setRunning(flow);
      setLog([{ level: "info", message: `starting ${flow}…` }]);
      const controller = new AbortController();
      abort.current = controller;

      try {
        let zipBase64: string | undefined;
        if (flow === "draft" || flow === "replace") {
          const zip = await getZip();
          if (!zip) throw new Error("Slice the email before sending it to Braze.");
          zipBase64 = await toBase64(zip);
        }

        const response = await fetch("/api/braze/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            flow,
            projectId: project?.id,
            campaignId: campaign?.id,
            campaignName, subject, preheader,
            sendAt, timeZone, segment, localTimeDelivery,
            zipBase64,
            csv: flow === "audience" ? csv : undefined,
            ...extra,
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
              // The run records its Braze links against the project; reload so
              // the panel shows them.
              onProjectChanged();
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
    [project, campaign, campaignName, subject, preheader, sendAt, timeZone, segment, localTimeDelivery, csv, getZip, onProjectChanged]
  );

  const busy = running !== null;
  const noProject = !project;

  return (
    <div className="braze">
      <p className="hint">
        Drives the Braze dashboard in a real browser. Credentials come from
        <span className="mono"> web/.env.local</span>. Nothing here sends a campaign —
        it stops at a saved draft.
      </p>

      {noProject && <p className="hint warn">Save the project first so its Braze links can be recorded.</p>}

      {campaign && (
        <div className="braze-links">
          <strong>Campaign</strong>{" "}
          {campaign.url
            ? <a href={campaign.url} target="_blank" rel="noreferrer">{campaign.name || campaign.id}</a>
            : <span className="mono">{campaign.id}</span>}
          {project?.braze.reachableUsers !== undefined && (
            <div className="dim">Reachable users: {project.braze.reachableUsers.toLocaleString()}</div>
          )}
          {project?.braze.controlGroupRemoved && <div className="dim">Control group removed</div>}
          <button className="link-btn" disabled={busy} onClick={() => run("refresh")}>
            {running === "refresh" ? "refreshing…" : "refresh from Braze"}
          </button>
        </div>
      )}

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
      <label className="stack">
        Target segment
        <input value={segment} onChange={e => setSegment(e.target.value)} placeholder="20260901.csv" />
      </label>
      <label className="check">
        <input type="checkbox" checked={localTimeDelivery} onChange={e => setLocalTimeDelivery(e.target.checked)} />
        Send in each recipient&rsquo;s own time zone
      </label>

      <div className="braze-actions">
        <button disabled={busy} onClick={() => run("login")}>
          {running === "login" ? "Signing in…" : "Test sign-in"}
        </button>
        <button disabled={busy || audienceCount === 0} onClick={() => run("audience")}>
          {running === "audience" ? "Importing…" : `Import audience (${audienceCount})`}
        </button>
        {campaign ? (
          <button className="primary" disabled={busy} onClick={() => run("replace")}>
            {running === "replace" ? "Replacing…" : "Replace artwork"}
          </button>
        ) : (
          <button className="primary" disabled={busy || !campaignName} onClick={() => run("draft")}>
            {running === "draft" ? "Building draft…" : "Create draft"}
          </button>
        )}
        <button disabled={busy || !campaign || !sendAt} onClick={() => run("schedule")}>
          {running === "schedule" ? "Scheduling…" : "Schedule"}
        </button>
      </div>

      <details className="braze-test">
        <summary>Send a test email</summary>
        <p className="hint">
          One address per line. Braze needs a subject on the variant, and this is
          the only action here that puts real mail in an inbox.
        </p>
        <textarea
          value={recipients}
          onChange={e => setRecipients(e.target.value)}
          placeholder={"you@example.com\nsomeone@example.com"}
          rows={3}
        />
        <div className="braze-actions">
          <button
            disabled={busy || !campaign || !recipients.trim()}
            onClick={() => run("test", { recipients })}
          >
            Stage only
          </button>
          <button
            className="danger"
            disabled={busy || !campaign || !recipients.trim()}
            onClick={() => {
              const list = recipients.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
              if (confirm(`Send a real test email to ${list.length} address(es)?\n\n${list.join("\n")}`)) {
                run("test", { recipients, confirmSend: true });
              }
            }}
          >
            {running === "test" ? "Sending…" : "Send test"}
          </button>
        </div>
      </details>

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
