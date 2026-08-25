"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RATE_PER_EMAIL, type CampaignRecord } from "@/lib/billing";
import { createInvoice, formatCount, formatDate, formatMoney, listBillableCampaigns } from "@/components/InvoiceLines";
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

  // One campaign is one e-mail at one price; there is no quantity to enter.
  // Integers throughout — see the note on formatMoney. This is the same
  // multiplication the server does when it freezes the lines.
  const selected = (campaigns || []).filter(campaign => picked.has(campaign.id));
  const total = selected.length * RATE_PER_EMAIL;

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await createInvoice(selected.map(campaign => campaign.id));
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
              Nenhuma campanha para faturar. Uma campanha entra nesta lista quando o envio termina no Braze e
              ela ainda não foi faturada.
            </p>
          )}

          {campaigns !== null && campaigns.length > 0 && (
            <>
              <div className="review">
                {campaigns.map(campaign => {
                  const on = picked.has(campaign.id);
                  return (
                    // The row is one big <label> so the whole line toggles.
                    <label className={`inv-pick${on ? "" : " off"}`} key={campaign.id}>
                      <input type="checkbox" checked={on} onChange={() => toggle(campaign.id)} />
                      <span className="inv-pick-name">
                        <strong>{campaign.name}</strong>
                        <small>
                          criado {formatDate(campaign.createdAt)} · enviado {formatDate(campaign.firstSentAt)}
                        </small>
                      </span>
                      <span className="spacer" />
                      <span className="dim">{formatMoney(RATE_PER_EMAIL)}</span>
                    </label>
                  );
                })}

                <div className="inv-sum">
                  <span className="dim">
                    {formatCount(selected.length)} campanha{selected.length === 1 ? "" : "s"} ·{" "}
                    {formatMoney(RATE_PER_EMAIL)} cada
                  </span>
                  <span className="spacer" />
                  <strong>{formatMoney(total)}</strong>
                </div>
              </div>

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
                    Gerar a fatura de {formatMoney(total)} com {formatCount(selected.length)} campanha
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
