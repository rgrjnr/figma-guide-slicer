"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flowResult, runBrazeFlow, type FlowLogLine } from "@/lib/brazeRun";
import { translateStep } from "@/lib/flowLabels";

/**
 * What the launch flow reports back. The same shape comes from the preflight
 * and from the launch itself, because they are the same read.
 */
export interface LaunchState {
  campaignId: string;
  name: string;
  subject: string | null;
  schedule: { date: string; time: string } | null;
  reachableUsers: number | null;
  launchEnabled?: boolean;
  launched?: boolean;
  blockers?: string[];
  url?: string;
}

/**
 * The last confirmation before a campaign goes out.
 *
 * The numbers here are read from Braze at the moment the dialog opens, not from
 * the local record — the local record is what we asked for, and this dialog is
 * about what Braze will actually do. Confirming passes those same numbers back
 * down, and the flow refuses to launch unless a fresh read still agrees with
 * them, so a segment that changes while the dialog is open aborts the send
 * instead of quietly delivering to a different audience.
 */
export function LaunchDialog({
  campaignId, projectId, timeZone, onClose, onLaunched,
}: {
  campaignId: string;
  /** Passed so the run records launchedAt against the project. */
  projectId: string;
  timeZone: string;
  onClose: () => void;
  onLaunched: (state: LaunchState) => void;
}) {
  const [state, setState] = useState<LaunchState | null>(null);
  const [phase, setPhase] = useState<"reading" | "ready" | "launching" | "done">("reading");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);

  /** Collects the log so the flow's JSON result can be pulled out of it. */
  const readFlow = useCallback(async (body: Record<string, unknown>) => {
    const lines: string[] = [];
    const onLog = (line: FlowLogLine) => {
      lines.push(line.message);
      // The runner narrates in English; the app does not.
      setNote(translateStep(line.message.trim().replace(/^\d{2}\s/, "")));
      if (line.level === "error") setError(line.message);
    };
    const ok = await runBrazeFlow(body, { onLog });
    return { ok, result: flowResult<LaunchState>(lines) };
  }, []);

  // The preflight runs once, on open. React 18 mounts twice in development and
  // this one drives a browser for a minute, so the guard is not optional.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { ok, result } = await readFlow({ flow: "launch", campaignId, projectId, timeZone });
        if (!result) throw new Error(ok ? "A leitura não retornou os dados da campanha." : "Não foi possível ler a campanha.");
        setState(result);
        setPhase("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("ready");
      }
    })();
  }, [campaignId, projectId, timeZone, readFlow]);

  const launch = useCallback(async () => {
    if (!state || state.reachableUsers == null) return;
    setPhase("launching");
    setError(null);
    try {
      const { ok, result } = await readFlow({
        flow: "launch",
        campaignId,
        projectId,
        timeZone,
        confirmLaunch: true,
        // The guards. These are the values on screen, which is the whole point:
        // what was confirmed is what gets verified.
        expectName: state.name,
        expectReachable: state.reachableUsers,
      });
      if (!ok || !result?.launched) {
        setPhase("ready");
        setError(current => current ?? "A campanha NÃO foi lançada.");
        return;
      }
      setPhase("done");
      onLaunched(result);
    } catch (err) {
      setPhase("ready");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state, campaignId, projectId, timeZone, readFlow, onLaunched]);

  const blockers = state?.blockers ?? [];
  const canLaunch = phase === "ready" && !!state && blockers.length === 0 && state.reachableUsers != null;

  return (
    <div className="launch-backdrop" role="dialog" aria-modal="true" aria-label="Lançar campanha">
      <div className="launch-modal">
        <h2>Lançar campanha</h2>

        {phase === "reading" && (
          <>
            <p className="hint">Lendo a campanha no Braze — isso leva cerca de um minuto.</p>
            {note && <p className="dim mono">{note}</p>}
          </>
        )}

        {state && phase !== "reading" && (
          <dl className="launch-facts">
            <dt>Pessoas alcançadas</dt>
            <dd className="launch-big">
              {state.reachableUsers == null ? "—" : state.reachableUsers.toLocaleString("pt-BR")}
            </dd>

            <dt>Assunto</dt>
            <dd>{state.subject || <em>não foi possível ler</em>}</dd>

            <dt>Envio</dt>
            <dd>
              {state.schedule?.date
                ? `${state.schedule.date}${state.schedule.time ? ` às ${state.schedule.time}` : ""}`
                : <em>sem horário definido</em>}
            </dd>

            <dt>Campanha</dt>
            <dd className="dim">{state.name}</dd>
          </dl>
        )}

        {blockers.length > 0 && (
          <div className="launch-blockers">
            <strong>Não dá para lançar:</strong>
            <ul>{blockers.map(b => <li key={b}>{b}</li>)}</ul>
          </div>
        )}

        {phase === "launching" && (
          <>
            <p className="hint">Lançando — não feche esta janela.</p>
            {note && <p className="dim mono">{note}</p>}
          </>
        )}

        {phase === "done" && <p className="success-note">✓ Campanha lançada no Braze.</p>}

        {error && <p className="error-note">{error}</p>}

        {canLaunch && (
          <p className="launch-warning">
            Isto envia de verdade para {state!.reachableUsers!.toLocaleString("pt-BR")} pessoas
            {state!.schedule?.date ? ` no horário agendado` : ""}. Não há como desfazer.
          </p>
        )}

        <div className="launch-actions">
          <button
            className="primary"
            disabled={!canLaunch}
            onClick={() => void launch()}
          >
            {phase === "launching" ? "Lançando…" : "Lançar campanha"}
          </button>
          <button className="ghost" onClick={onClose} disabled={phase === "launching"}>
            {phase === "done" ? "Fechar" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}
