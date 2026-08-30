"use client";

import { useState } from "react";
import { EmailChips } from "@/components/EmailChips";
import { LaunchDialog } from "@/components/LaunchDialog";
import type { ProjectRecord } from "@/lib/types";
import { timeZones } from "@/lib/defaults";

export interface SendSettings {
  sendDate: string;
  sendTime: string;
  timeZone: string;
}

export type FlowStatus = "idle" | "running" | "done" | "failed";

interface Props {
  record: ProjectRecord | null;
  campaignName: string;
  subject: string;
  rowCount: number;
  hasImage: boolean;
  audienceCount: number;
  segmentName: string;
  testEmails: string[];
  onTestEmails: (emails: string[]) => void;
  settings: SendSettings;
  onSettings: (patch: Partial<SendSettings>) => void;
  flowState: Record<string, FlowStatus>;
  /** Determinate progress per flow: step n of total, plus what it is doing. */
  flowProgress: Record<string, { n: number; total: number; pct: number; label: string } | null>;
  onRun: (flow: "test" | "schedule", extra?: Record<string, unknown>) => void;
  /** How many addresses the last successful test went to. */
  testSentTo: number;
  lastError: string | null;
  /**
   * The launch dialog drives its own run rather than going through `onRun`,
   * because it is two runs with a human decision in between and the second one
   * carries what the first one showed. This is how the page hears about it and
   * re-reads the record afterwards.
   */
  onLaunched?: () => void;
}

const ZONES = timeZones();

/**
 * The last step is a checkpoint, not a workbench: the pipeline behind the
 * earlier steps has been importing the audience and building the draft while
 * the person worked, so what is left is the two decisions a human should make
 * — send a proof, and put it on the calendar. Everything else here is status.
 */
export function SendStep({
  record, campaignName, subject, rowCount, hasImage, audienceCount, segmentName,
  testEmails, onTestEmails, settings, onSettings, flowState, flowProgress, onRun, testSentTo, lastError,
  onLaunched,
}: Props) {
  const campaign = record?.braze.campaign;
  const segment = record?.braze.segment;
  // The campaign exists the moment the draft lands, which is all a test needs —
  // the schedule still running is no reason to hold the proof back.
  const campaignBusy = flowState.prepare === "running" || flowState.schedule === "running";
  const [launching, setLaunching] = useState(false);

  return (
    <div className="step-body form wide">
      <div className="form-inner">
        <div className="review">
          <StatusRow
            label="Público"
            status={flowState.audience}
            progress={flowState.audience === "running" ? flowProgress.audience : null}
            value={
              audienceCount === 0 ? <em>nenhum endereço ainda</em> : (
                <>
                  {audienceCount.toLocaleString()} endereços como “{segmentName}”
                  {segment?.url && <> · <a href={segment.url} target="_blank" rel="noreferrer">ver no Braze</a></>}
                </>
              )
            }
          />
          <StatusRow
            label="Campanha"
            status={
              flowState.prepare === "running" || flowState.schedule === "running" ? "running"
              : flowState.prepare === "failed" || flowState.schedule === "failed" ? "failed"
              : flowState.schedule === "done" ? "done"
              : flowState.prepare
            }
            progress={
              flowState.prepare === "running" ? flowProgress.prepare
              : flowState.schedule === "running" ? flowProgress.schedule
              : null
            }
            value={
              !hasImage ? <em>a arte ainda não foi adicionada</em>
              : !subject ? <em>falta o assunto (etapa Detalhes)</em>
              : campaign ? (
                <>
                  {campaign.url
                    ? <a href={campaign.url} target="_blank" rel="noreferrer">{campaign.name || campaignName}</a>
                    : campaignName}
                  {record?.braze.reachableUsers !== undefined &&
                    <> · {record.braze.reachableUsers.toLocaleString()} alcançáveis</>}
                </>
              ) : <>{campaignName} · {rowCount} linha{rowCount === 1 ? "" : "s"}</>
            }
          />
        </div>

        <section className="send-block">
          <h3>E-mail de teste</h3>
          <p className="hint">Separado por vírgula ou quebra de linha; clique no × para remover.</p>
          <EmailChips
            emails={testEmails}
            onChange={onTestEmails}
            placeholder="voce@wbd.com, alguem@wbd.com…"
          />
          <button
            className="primary"
            disabled={flowState.test === "running" || !campaign || testEmails.length === 0}
            onClick={() => {
              if (confirm(`Enviar um teste real para ${testEmails.length} endereço(s)?\n\n${testEmails.join("\n")}`)) {
                onRun("test", { recipients: testEmails.join("\n"), confirmSend: true });
              }
            }}
          >
            {flowState.test === "running" ? "Enviando…" : "Enviar e-mail de teste"}
          </button>
          {!campaign && (
            <p className="hint">
              {campaignBusy
                ? "Aguardando a arte terminar de subir no Braze — o teste libera assim que o rascunho existir, mesmo com o agendamento ainda em andamento."
                : "A campanha ainda não foi criada — passe pela etapa Arte primeiro."}
            </p>
          )}
          {flowState.test === "done" && testSentTo > 0 && (
            <p className="success-note">
              ✓ Teste enviado para {testSentTo} endereço{testSentTo === 1 ? "" : "s"} — confira a caixa de entrada.
            </p>
          )}
        </section>

        <section className="send-block">
          <h3>Agendamento</h3>
          <div className="field-row">
            <label className="field">
              <span>Enviar em</span>
              <input type="date" value={settings.sendDate} onChange={e => onSettings({ sendDate: e.target.value })} />
            </label>
            <label className="field">
              <span>Às</span>
              <input type="time" value={settings.sendTime} onChange={e => onSettings({ sendTime: e.target.value })} />
            </label>
            <label className="field">
              <span>Fuso horário</span>
              <select value={settings.timeZone} onChange={e => onSettings({ timeZone: e.target.value })}>
                {ZONES.common.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                {ZONES.all.length > 0 && (
                  <optgroup label="Todos os fusos">
                    {ZONES.all.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
          <button
            className="primary"
            disabled={campaignBusy || !campaign || !settings.sendDate}
            onClick={() => onRun("schedule")}
          >
            {flowState.schedule === "running" ? "Agendando…" : "Agendar envio"}
          </button>
          {flowState.schedule === "done" && (
            <p className="success-note">✓ Agendado.</p>
          )}
        </section>

        <section className="send-block">
          <h3>Lançar</h3>
          {record?.braze.launchedAt ? (
            <p className="success-note">
              ✓ Campanha lançada em {new Date(record.braze.launchedAt).toLocaleString("pt-BR")}.
            </p>
          ) : (
            <>
              <p className="hint">
                Abre a conferência final — quantas pessoas serão alcançadas, o assunto e o horário,
                lidos do Braze na hora. O envio só acontece depois que você confirmar.
              </p>
              <button
                className="primary"
                disabled={!campaign || campaignBusy}
                onClick={() => setLaunching(true)}
              >
                Lançar campanha
              </button>
              {!campaign && <p className="hint">A campanha ainda não foi criada.</p>}
            </>
          )}
        </section>


        {lastError && <p className="error-note">{lastError}</p>}

        {launching && campaign && record && (
          <LaunchDialog
            campaignId={campaign.id}
            projectId={record.id}
            timeZone={settings.timeZone}
            onClose={() => setLaunching(false)}
            onLaunched={() => {
              setLaunching(false);
              onLaunched?.();
            }}
          />
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<FlowStatus, string> = {
  idle: "",
  running: "processando…",
  done: "pronto",
  failed: "falhou",
};

function StatusRow({ label, value, status = "idle", progress }: {
  label: string;
  value: React.ReactNode;
  status?: FlowStatus;
  progress?: { n: number; total: number; pct: number; label: string } | null;
}) {
  return (
    <div className={`review-row status-${status}`}>
      <span className="review-label">{label}</span>
      <span className="review-value">
        {value}
        {status === "running" && progress && (
          <span className="review-doing">
            <span className="review-bar"><span style={{ width: `${progress.pct}%` }} /></span>
            {progress.n}/{progress.total} · {progress.label}
          </span>
        )}
      </span>
      <span className="spacer" />
      {status !== "idle" && (
        <span className={`status-pill ${status}`}>
          {status === "running" && progress ? `${progress.n}/${progress.total}` : STATUS_LABEL[status]}
        </span>
      )}
    </div>
  );
}
