"use client";

import type { FlowProgress } from "./flowLabels";

export interface FlowLogLine {
  level: "info" | "error";
  message: string;
}

export interface RunHandlers {
  /** Every line the flow wrote, in order, as it was written. */
  onLog?: (line: FlowLogLine) => void;
  /** The numbered narration only — the thing a progress bar can be built on. */
  onStep?: (progress: FlowProgress) => void;
}

/**
 * The structured result a flow logs as its last brace-wrapped line, or null.
 *
 * The flows print one JSON object when they have a machine-readable answer, and
 * it arrives through `onLog` like any other line — so a caller that needs the
 * numbers collects the lines and hands them here. The scan runs from the end
 * because the CLI's trailing "OK — artifacts in …" is not JSON, and neither is
 * anything the flow logged on its way there.
 */
export function flowResult<T = Record<string, unknown>>(lines: readonly string[]): T | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line) as T;
    } catch {
      // Not ours — a log line that merely happens to be brace-wrapped.
    }
  }
  return null;
}

/**
 * One Braze flow, streamed.
 *
 * `EventSource` cannot POST and the run has to carry a body, so the frames are
 * read off the response and parsed here. Frames are split on the blank line
 * that terminates them and the remainder is kept in `buffer`, because a chunk
 * boundary falls wherever the network puts it — mid-frame more often than not —
 * and parsing a half-frame silently drops a step.
 *
 * Resolves with the run's own verdict rather than throwing on it: a flow that
 * failed still logged why it failed, and the caller usually wants to show that
 * instead of an exception. It throws only when the run never started, since
 * then there is nothing in the log to show.
 */
export async function runBrazeFlow(
  body: Record<string, unknown>,
  handlers: RunHandlers = {}
): Promise<boolean> {
  const response = await fetch("/api/braze/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(detail.error || "Não foi possível iniciar.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ok = false;
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
      if (event === "log") {
        handlers.onLog?.(payload as FlowLogLine);
        // Runner steps arrive as "NN what it is doing"; that is the gauge.
        const m = /^(\d{2}) (.+)$/.exec(String(payload.message ?? "").trim());
        if (m && !/failed/.test(m[2])) handlers.onStep?.({ n: Number(m[1]), label: m[2] });
      }
      if (event === "done") {
        ok = payload.ok === true;
        // The terminal frame carries the reason the child died when the child
        // died before writing one itself, so it is folded into the log rather
        // than handed back separately — otherwise "falhou" arrives with an
        // empty log behind it and nothing to act on.
        if (!ok && payload.error) handlers.onLog?.({ level: "error", message: String(payload.error) });
      }
    }
  }
  return ok;
}
