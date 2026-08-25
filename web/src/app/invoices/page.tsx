"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InvoiceRecord } from "@/lib/billing";
import { emailCount, formatDate, formatHays, listInvoices, markInvoicePaid } from "@/components/InvoiceLines";
import "./print.css";

/** The ledger of issued invoices, newest first — the API already sorts. */
export default function InvoicesPage() {
  // `null` is "not read yet" and `[]` is "there are none": the two look the
  // same in the DOM otherwise, and an empty state that flashes before the first
  // response reads as data loss.
  const [invoices, setInvoices] = useState<InvoiceRecord[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listInvoices().then(setInvoices).catch(() => setInvoices([]));
  }, []);

  async function pay(invoice: InvoiceRecord) {
    if (!confirm(`Marcar a fatura ${invoice.id} como paga?`)) return;
    setBusyId(invoice.id);
    setError(null);
    try {
      const paid = await markInvoicePaid(invoice.id);
      setInvoices(list => (list || []).map(item => (item.id === paid.id ? paid : item)));
    } catch {
      setError("Não foi possível marcar como paga.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main>
      <header className="app-bar">
        {/* The brand and the site links live in the layout's nav strip, so the
            bar each page owns carries the page's own title and its actions. */}
        <h1>Faturas</h1>
        <span className="spacer" />
        <Link className="inv-btn primary" href="/invoices/new">Nova fatura</Link>
      </header>

      <div className="step-body form wide">
        <div className="form-inner">
          {error && <p className="error-note">{error}</p>}

          {invoices === null && <p className="hint">Carregando…</p>}
          {invoices !== null && invoices.length === 0 && <p className="hint">Nenhuma fatura ainda.</p>}

          {invoices !== null && invoices.length > 0 && (
            <div className="review">
              {invoices.map(invoice => {
                const emails = emailCount(invoice.lines);
                const paid = invoice.state === "paid";
                return (
                  <div className="review-row inv-row" key={invoice.id}>
                    <Link className="inv-id mono" href={`/invoices/${invoice.id}`}>{invoice.id}</Link>
                    <span className="dim inv-when">{formatDate(invoice.issuedAt)}</span>
                    <span className="dim inv-count">
                      {formatHays(emails)} e-mail{emails === 1 ? "" : "s"}
                    </span>
                    <span className="spacer" />
                    <strong className="inv-amount">{formatHays(invoice.total)} {invoice.currency}</strong>
                    {/* Three tints exist and no more: accent for in flight,
                        green for settled. Issued is the "waiting on someone"
                        state, which is what the running tint means everywhere
                        else in the app. */}
                    <span className={`status-pill ${paid ? "done" : "running"}`}>{paid ? "paga" : "emitida"}</span>
                    {!paid && (
                      <button onClick={() => pay(invoice)} disabled={busyId === invoice.id}>
                        {busyId === invoice.id ? "Marcando…" : "Marcar como paga"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
