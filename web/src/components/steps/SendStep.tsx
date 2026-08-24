"use client";

import { EmailChips } from "@/components/EmailChips";
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
  onRun: (flow: "test" | "schedule" | "download", extra?: Record<string, unknown>) => void;
  log: { level: string; message: string }[];
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
  testEmails, onTestEmails, settings, onSettings, flowState, onRun, log,
}: Props) {
  const campaign = record?.braze.campaign;
  const segment = record?.braze.segment;
  const anyRunning = Object.values(flowState).some(s => s === "running");

  return (
    <div className="step-body form wide">
      <div className="form-inner">
        <div className="review">
          <StatusRow
            label="Público"
            status={flowState.audience}
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
            status={flowState.prepare}
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
            disabled={anyRunning || !campaign || testEmails.length === 0}
            onClick={() => {
              if (confirm(`Enviar um teste real para ${testEmails.length} endereço(s)?\n\n${testEmails.join("\n")}`)) {
                onRun("test", { recipients: testEmails.join("\n"), confirmSend: true });
              }
            }}
          >
            {flowState.test === "running" ? "Enviando…" : "Enviar e-mail de teste"}
          </button>
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
            disabled={anyRunning || !campaign || !settings.sendDate}
            onClick={() => onRun("schedule")}
          >
            {flowState.schedule === "running" ? "Agendando…" : "Agendar envio"}
          </button>
          <p className="hint">
            O agendamento salva como rascunho. O disparo continua sendo feito à
            mão no Braze, depois de conferir.
          </p>
        </section>

        <details className="escape-hatch">
          <summary>Algo não funcionou?</summary>
          <p className="hint">
            Baixe o e-mail montado e suba no Braze à mão. É o mesmo ZIP que o robô
            enviaria: <span className="mono">index.html</span> mais a pasta{" "}
            <span className="mono">images</span>.
          </p>
          <button className="ghost" disabled={anyRunning} onClick={() => onRun("download")}>
            {flowState.download === "running" ? "Montando…" : "Baixar o arquivo"}
          </button>
        </details>

        {log.length > 0 && (
          <pre className="braze-log">
            {log.map((line, i) => (
              <div key={i} className={line.level === "error" ? "err" : undefined}>{line.message}</div>
            ))}
          </pre>
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

function StatusRow({ label, value, status = "idle" }: {
  label: string;
  value: React.ReactNode;
  status?: FlowStatus;
}) {
  return (
    <div className={`review-row status-${status}`}>
      <span className="review-label">{label}</span>
      <span className="review-value">{value}</span>
      <span className="spacer" />
      {status !== "idle" && <span className={`status-pill ${status}`}>{STATUS_LABEL[status]}</span>}
    </div>
  );
}
