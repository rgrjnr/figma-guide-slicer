"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CURRENCY, RATE_PER_EMAIL, type CampaignRecord } from "@/lib/billing";
import { createInvoice, formatDate, formatHays, listBillableCampaigns } from "@/components/InvoiceLines";
import "../print.css";

/**
 * Everything Braze has stopped and we have not charged for, ticked by default,
 * with the total moving as boxes are unticked.
 *
 * Issuing is a two-step on purpose: it stamps the campaigns as faturadas and
 * there is no undo anywhere in this UI, so the button that does it is never the
 * button the cursor already happens to be over.
 */
export default function NewInvoicePage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRecord[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBillableCampaigns()
      .then(list => {
        setCampaigns(list);
        setPicked(new Set(list.map(campaign => campaign.id)));
      })
      .catch(() => setCampaigns([]));
  }, []);

  function toggle(id: string) {
    setPicked(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    // Any change to the selection invalidates the figure that was confirmed.
    setConfirming(false);
  }

  function setQuantity(id: string, raw: string) {
    const parsed = Number.parseInt(raw, 10);
    // An empty or half-typed field must not become NaN and poison the total;
    // one is the floor because a line charging for nothing is not a line.
    setQty(current => ({ ...current, [id]: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 }));
    setConfirming(false);
  }

  const selected = (campaigns || []).filter(campaign => picked.has(campaign.id));
  const emails = selected.reduce((sum, campaign) => sum + (qty[campaign.id] ?? 1), 0);
  // Integers throughout — see the note on formatHays. The figure shown here is
  // the same multiplication the server does when it freezes the lines.
  const total = emails * RATE_PER_EMAIL;

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await createInvoice(
        selected.map(campaign => campaign.id),
        Object.fromEntries(selected.map(campaign => [campaign.id, qty[campaign.id] ?? 1])),
      );
      router.push(`/invoices/${invoice.id}`);
    } catch (err) {
      // A 409 is a rule the selection broke, worded for the reader by the API.
      setError(err instanceof Error ? err.message : "Não foi possível gerar a fatura.");
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="app-bar">
        <h1>Nova fatura</h1>
        <span className="spacer" />
        <Link className="inv-btn ghost" href="/invoices">Voltar</Link>
      </header>

      <div className="step-body form wide">
        <div className="form-inner">
          {error && <p className="error-note">{error}</p>}

          {campaigns === null && <p className="hint">Carregando…</p>}

          {campaigns !== null && campaigns.length === 0 && (
            <p className="hint">
              Nenhuma campanha para faturar. Uma campanha entra nesta lista quando o Braze a marca como parada e
              ela ainda não foi faturada.
            </p>
          )}

          {campaigns !== null && campaigns.length > 0 && (
            <>
              <div className="review">
                {campaigns.map(campaign => {
                  const on = picked.has(campaign.id);
                  return (
                    // The row is one big <label> so the whole line toggles, and
                    // the quantity field can live inside it because a click
                    // landing on interactive content is not forwarded to the
                    // label's control — typing a number does not untick the box.
                    <label className={`inv-pick${on ? "" : " off"}`} key={campaign.id}>
                      <input type="checkbox" checked={on} onChange={() => toggle(campaign.id)} />
                      <span className="inv-pick-name">
                        <strong>{campaign.name}</strong>
                        <small>
                          criado {formatDate(campaign.createdAt)} · enviado {formatDate(campaign.firstSentAt)}
                        </small>
                      </span>
                      <span className="spacer" />
                      <input
                        className="inv-pick-qty"
                        type="number"
                        min={1}
                        value={qty[campaign.id] ?? 1}
                        disabled={!on}
                        onChange={e => setQuantity(campaign.id, e.target.value)}
                      />
                      <span className="dim">
                        {formatHays((qty[campaign.id] ?? 1) * RATE_PER_EMAIL)} {CURRENCY}
                      </span>
                    </label>
                  );
                })}

                <div className="inv-sum">
                  <span className="dim">
                    {formatHays(selected.length)} campanha{selected.length === 1 ? "" : "s"} ·{" "}
                    {formatHays(emails)} e-mail{emails === 1 ? "" : "s"} · {formatHays(RATE_PER_EMAIL)}{" "}
                    {CURRENCY} cada
                  </span>
                  <span className="spacer" />
                  <strong>{formatHays(total)} {CURRENCY}</strong>
                </div>
              </div>

              <p className="hint">
                A quantidade é o número de e-mails cobrados na campanha — deixe em 1 quando houve uma única peça.
              </p>

              {!confirming && (
                <div className="inv-actions">
                  <button className="primary big-btn" disabled={selected.length === 0} onClick={() => setConfirming(true)}>
                    Gerar fatura
                  </button>
                </div>
              )}

              {confirming && (
                <div className="inv-confirm">
                  <p>
                    Gerar a fatura de {formatHays(total)} {CURRENCY} com {formatHays(selected.length)} campanha
                    {selected.length === 1 ? "" : "s"}.
                  </p>
                  <p className="dim">
                    Não há como desfazer por aqui: as campanhas passam a contar como faturadas e saem desta lista.
                    Para reverter é preciso editar os arquivos de dados à mão.
                  </p>
                  <div className="inv-confirm-actions">
                    <button className="primary" onClick={issue} disabled={busy}>
                      {busy ? "Gerando…" : "Confirmar e gerar"}
                    </button>
                    <button className="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
