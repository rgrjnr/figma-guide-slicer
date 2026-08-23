"use client";

import type { ProjectRecord } from "@/lib/types";
import { timeZones } from "@/lib/defaults";

export interface SendSettings {
  /** Kept apart so each gets its native picker. */
  sendDate: string;
  sendTime: string;
  timeZone: string;
}

const ZONES = timeZones();

interface Props {
  record: ProjectRecord | null;
  campaignName: string;
  subject: string;
  rowCount: number;
  audienceCount: number;
  segmentName: string;
  testEmails: string;
  settings: SendSettings;
  onSettings: (patch: Partial<SendSettings>) => void;
  busy: string | null;
  onRun: (
    flow: "audience" | "draft" | "replace" | "schedule" | "test" | "refresh" | "download",
    extra?: Record<string, unknown>
  ) => void;
  log: { level: "info" | "error"; message: string }[];
}

/** What will happen, then the buttons that make it happen. Nothing sends. */
export function SendStep({
  record, campaignName, subject, rowCount, audienceCount, segmentName,
  testEmails, settings, onSettings, busy, onRun, log,
}: Props) {
  const campaign = record?.braze.campaign;
  const ready = Boolean(campaignName && subject && rowCount > 0);

  return (
    <div className="step-body form wide">
      <div className="form-inner">
        <div className="review">
          <Row label="Campanha" value={campaignName || <em>sem nome ainda</em>} />
          <Row label="Assunto" value={subject || <em>obrigatório para o Braze enviar</em>} bad={!subject} />
          <Row label="Arte" value={`${rowCount} linha${rowCount === 1 ? "" : "s"}`} bad={rowCount === 0} />
          <Row
            label="Público"
            value={audienceCount ? `${audienceCount.toLocaleString()} endereços como “${segmentName}”` : <em>nenhum ainda</em>}
          />
          {campaign && (
            <Row
              label="No Braze"
              value={
                <>
                  {campaign.url
                    ? <a href={campaign.url} target="_blank" rel="noreferrer">{campaign.name || campaign.id}</a>
                    : campaign.id}
                  {record?.braze.reachableUsers !== undefined && (
                    <> · {record.braze.reachableUsers.toLocaleString()} alcançáveis</>
                  )}
                  {" · "}
                  <button className="link-btn" disabled={!!busy} onClick={() => onRun("refresh")}>atualizar</button>
                </>
              }
            />
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>Enviar em</span>
            <input
              type="date"
              value={settings.sendDate}
              onChange={e => onSettings({ sendDate: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Às</span>
            <input
              type="time"
              value={settings.sendTime}
              onChange={e => onSettings({ sendTime: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Fuso horário</span>
            <select value={settings.timeZone} onChange={e => onSettings({ timeZone: e.target.value })}>
              {ZONES.common.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              {ZONES.all.length > 0 && (
                <optgroup label="All time zones">
                  {ZONES.all.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </optgroup>
              )}
            </select>
          </label>
        </div>

        <div className="send-actions">
          <button
            disabled={!!busy || audienceCount === 0}
            onClick={() => onRun("audience")}
          >
            {busy === "audience" ? "Importando…" : "1. Importar o público"}
          </button>
          <button
            className="primary"
            disabled={!!busy || !ready}
            onClick={() => onRun(campaign ? "replace" : "draft")}
          >
            {busy === "draft" || busy === "replace"
              ? "Montando…"
              : campaign ? "2. Atualizar a arte no Braze" : "2. Criar o rascunho no Braze"}
          </button>
          <button disabled={!!busy || !campaign || !settings.sendDate} onClick={() => onRun("schedule")}>
            {busy === "schedule" ? "Agendando…" : "3. Definir o agendamento"}
          </button>
          <button
            className="ghost"
            disabled={!!busy || !campaign || !testEmails.trim()}
            onClick={() => {
              const list = testEmails.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
              if (confirm(`Enviar um teste real para ${list.length} endereço(s)?\n\n${list.join("\n")}`)) {
                onRun("test", { recipients: testEmails, confirmSend: true });
              }
            }}
          >
            {busy === "test" ? "Enviando…" : "Enviar um teste"}
          </button>
        </div>

        <p className="hint">
          Tudo aqui para no rascunho. A campanha é disparada à mão no Braze,
          depois que você conferir.
        </p>

        {/* Not part of the normal path — but if Braze is down or the dashboard
            has changed under us, this is the difference between a manual upload
            and a blocked send. */}
        <details className="escape-hatch">
          <summary>Algo não funcionou?</summary>
          <p className="hint">
            Baixe o e-mail montado e suba no Braze à mão. É o mesmo ZIP que o robô
            enviaria: <span className="mono">index.html</span> mais a pasta <span className="mono">images</span>.
          </p>
          <button className="ghost" disabled={!!busy} onClick={() => onRun("download")}>
            {busy === "download" ? "Montando…" : "Baixar o arquivo"}
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

function Row({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className={`review-row${bad ? " bad" : ""}`}>
      <span className="review-label">{label}</span>
      <span className="review-value">{value}</span>
    </div>
  );
}
