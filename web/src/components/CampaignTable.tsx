"use client";

import { useState } from "react";
import { isBillable, type BillingState, type BrazeStatus, type CampaignRecord } from "@/lib/billing";

/**
 * Braze's own words, translated. The list is open-ended on purpose — the
 * scraper hands through any status word it does not recognise rather than
 * dropping the row, so an unknown one has to render as itself instead of as a
 * blank cell that looks like a bug in the ledger.
 */
const BRAZE_LABEL: Record<string, string> = {
  draft: "rascunho",
  active: "ativa",
  live: "ativa",
  scheduled: "agendada",
  paused: "pausada",
  stopped: "parada",
  completed: "concluída",
  archived: "arquivada",
  unknown: "desconhecida",
};

const BILLING_LABEL: Record<BillingState, string> = {
  unbilled: "não faturada",
  invoiced: "faturada",
  paid: "paga",
};

/**
 * The three pill tints the app already has, reused rather than extended: accent
 * for work still in flight, green for what is settled, grey for what nobody has
 * acted on yet. A campaign that is over is green on the Braze axis because
 * Braze is done with it — the money question is the other column's to answer.
 */
function brazeTint(status: BrazeStatus): string {
  if (status === "active" || status === "live" || status === "scheduled") return "running";
  if (status === "stopped" || status === "completed") return "done";
  return "idle";
}

function billingTint(state: BillingState): string {
  return state === "paid" ? "done" : state === "invoiced" ? "running" : "idle";
}

/**
 * Dates arrive from the scrape as ISO when it could parse them and as the raw
 * cell text when it could not, so anything unparseable is printed verbatim —
 * a date this app cannot read is still information the person can.
 */
function shortDate(value: string | undefined): string {
  if (!value) return "—";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleDateString("pt-BR");
}

export function CampaignTable({ campaigns }: { campaigns: CampaignRecord[] }) {
  return (
    <div className="ledger-card">
      <table className="ledger">
        <thead>
          <tr>
            <th className="ledger-thumb-col">Arte</th>
            <th>Campanha</th>
            <th>Status</th>
            <th>Criada</th>
            <th>Enviada</th>
            <th>Faturamento</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map(campaign => (
            <tr key={campaign.id} className={isBillable(campaign) ? "billable" : ""}>
              <td><Thumb campaign={campaign} /></td>
              <td className="ledger-name">
                {campaign.url
                  ? <a href={campaign.url} target="_blank" rel="noreferrer">{campaign.name}</a>
                  : campaign.name}
                {isBillable(campaign) && <span className="badge">faturável</span>}
                <span className="ledger-id mono">{campaign.id.slice(0, 8)}</span>
              </td>
              <td>
                <span className={`status-pill ${brazeTint(campaign.brazeStatus)}`}>
                  {BRAZE_LABEL[campaign.brazeStatus] ?? campaign.brazeStatus}
                </span>
              </td>
              <td className="ledger-when">{shortDate(campaign.createdAt)}</td>
              <td className="ledger-when">{shortDate(campaign.firstSentAt)}</td>
              <td>
                <span className={`status-pill ${billingTint(campaign.billing.state)}`}>
                  {BILLING_LABEL[campaign.billing.state]}
                </span>
                {campaign.billing.invoiceId && (
                  <span className="ledger-id mono">{campaign.billing.invoiceId}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Thumbnails are phase B of the plan: the record has a path under data/assets
 * but nothing serves that directory yet, so the image is attempted and the
 * placeholder takes over on error. Written this way round so the day the route
 * lands the artwork simply appears, with no second pass through this file.
 */
function Thumb({ campaign }: { campaign: CampaignRecord }) {
  const [broken, setBroken] = useState(false);
  if (!campaign.thumbnail || broken) return <span className="ledger-thumb empty">sem arte</span>;
  return (
    <img
      className="ledger-thumb"
      src={`/api/assets/${campaign.thumbnail}`}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}
