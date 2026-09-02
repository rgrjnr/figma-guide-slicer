"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { InvoiceRecord } from "@/lib/billing";
import { InvoiceLines, formatDate, loadInvoice, markInvoicePaid } from "@/components/InvoiceLines";
import { useRole } from "@/lib/useRole";
import "../print.css";

/**
 * The printable document. There is no PDF library and there will not be one:
 * the browser's own print-to-PDF renders this page through the @media print
 * block in print.css, which is also the only place the page breaks are dealt
 * with.
 */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  // See /invoices: the client reads and prints the document, the admin settles it.
  const canSettle = useRole() === "admin";

  useEffect(() => {
    loadInvoice(id)
      .then(payload => setInvoice(payload.invoice))
      .catch(() => setMissing(true));
  }, [id]);

  async function pay() {
    if (!invoice || !confirm(`Marcar a fatura ${invoice.id} como paga?`)) return;
    setBusy(true);
    setError(null);
    try {
      setInvoice(await markInvoicePaid(invoice.id));
    } catch {
      setError("Não foi possível marcar como paga.");
    } finally {
      setBusy(false);
    }
  }

  const paid = invoice?.state === "paid";

  return (
    <main>
      <header className="app-bar">
        <h1>{invoice ? `Fatura ${invoice.id}` : "Fatura"}</h1>
        <span className="spacer" />
        <Link className="inv-btn ghost" href="/invoices">Voltar</Link>
        {invoice && (
          <>
            {/* window.print() rather than a link to a print route: the document
                on screen is already the document, so there is nothing to
                re-render and no second URL to keep in step with this one. */}
            <button onClick={() => window.print()}>Imprimir</button>
            {!paid && canSettle && (
              <button className="primary" onClick={pay} disabled={busy}>
                {busy ? "Marcando…" : "Marcar como paga"}
              </button>
            )}
          </>
        )}
      </header>

      <div className="step-body form wide">
        <div className="form-inner">
          {error && <p className="error-note inv-print-hide">{error}</p>}
          {missing && <p className="hint">Fatura não encontrada.</p>}
          {!missing && !invoice && <p className="hint">Carregando…</p>}

          {invoice && (
            <article className="inv-doc">
              <header className="inv-doc-head">
                <div>
                  <h2>Fatura {invoice.id}</h2>
                  <div className="dim">Emitida em {formatDate(invoice.issuedAt)}</div>
                  {paid && invoice.paidAt && (
                    <div className="dim">Paga em {formatDate(invoice.paidAt)}</div>
                  )}
                </div>
                <span className="spacer" />
                <span className={`status-pill ${paid ? "done" : "running"}`}>{paid ? "paga" : "emitida"}</span>
              </header>

              <InvoiceLines lines={invoice.lines} total={invoice.total} currency={invoice.currency} />
            </article>
          )}
        </div>
      </div>
    </main>
  );
}
