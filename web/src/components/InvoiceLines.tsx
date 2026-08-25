"use client";

import type { CampaignRecord, InvoiceLine, InvoiceRecord } from "@/lib/billing";

/**
 * The lines of an invoice, plus the thin client and the two formatters the
 * three Faturas pages share.
 *
 * The client belongs in `src/lib/invoices.ts` next to `projects.ts`, and that
 * file is not in this lane's ownership list — so it lives here rather than
 * being copy-pasted into each of the three pages. Moving it is a rename and
 * three import lines the day someone owns both files.
 */

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  return (await call<{ invoices: InvoiceRecord[] }>("/api/invoices")).invoices;
}

/** The document is frozen on the invoice; the live campaigns come along for
 *  anything the printed page wants to show that is not part of the charge. */
export async function loadInvoice(id: string): Promise<{ invoice: InvoiceRecord; campaigns: CampaignRecord[] }> {
  return call<{ invoice: InvoiceRecord; campaigns: CampaignRecord[] }>(`/api/invoices/${id}`);
}

export async function listBillableCampaigns(): Promise<CampaignRecord[]> {
  return (await call<{ campaigns: CampaignRecord[] }>("/api/campaigns?status=billable")).campaigns;
}

export async function createInvoice(campaignIds: string[], qty: Record<string, number>): Promise<InvoiceRecord> {
  return (await call<{ invoice: InvoiceRecord }>("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ campaignIds, qty }),
  })).invoice;
}

export async function markInvoicePaid(id: string): Promise<InvoiceRecord> {
  return (await call<{ invoice: InvoiceRecord }>(`/api/invoices/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "paid" }),
  })).invoice;
}

/**
 * Money never leaves the integer domain here, and that is deliberate: a hay is
 * the whole unit, the rate is 150 of them and the quantity is a count of
 * e-mails, so nothing in this app ever divides an amount and there are no cents
 * to carry. Multiplying and adding integers in a double is exact well past any
 * plausible invoice, so no float artifact can be produced by our own arithmetic.
 *
 * The rounding is the seatbelt for the other input: invoices.json is meant to
 * be hand-edited, and a `qty` typed as 1.5 would otherwise print
 * 224.99999999999997 on a document that gets sent to a client. Rounding first
 * and then formatting with no fraction digits guarantees the printed figure is
 * the same integer the reader would get by adding up the column.
 */
export function formatHays(amount: number): string {
  return Math.round(amount).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** ISO stamps come out of the store, but a scrape that could not read a date
 *  leaves the field absent — an em dash is the house's way of saying "not
 *  known", and it beats printing "Invalid Date" on an invoice. */
export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleDateString("pt-BR");
}

/** How many e-mails an invoice charges for — the quantity column, not the
 *  number of lines, because a campaign with variants can bill more than one. */
export function emailCount(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

export function InvoiceLines({
  lines,
  total,
  currency,
}: {
  lines: InvoiceLine[];
  total: number;
  currency: string;
}) {
  const emails = emailCount(lines);
  // One invoice is issued at one rate, so the summary can name it — but the
  // file is hand-editable and a mixed invoice must not claim a single price.
  const uniformRate = lines.every(line => line.rate === lines[0]?.rate) ? lines[0]?.rate : undefined;

  return (
    <>
      <table className="inv-lines">
        <thead>
          <tr>
            <th>E-mail</th>
            <th>Criado</th>
            <th>Enviado</th>
            <th className="num">Qtd.</th>
            <th className="num">Valor unitário</th>
            <th className="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line.campaignId}>
              <td>{line.name}</td>
              <td className="dim">{formatDate(line.createdAt)}</td>
              <td className="dim">{formatDate(line.sentAt)}</td>
              <td className="num">{formatHays(line.qty)}</td>
              <td className="num">{formatHays(line.rate)} {currency}</td>
              {/* The rate is read off the line, never off RATE_PER_EMAIL, so a
                  price change does not rewrite an invoice already printed. */}
              <td className="num">{formatHays(line.qty * line.rate)} {currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Outside the table on purpose: as a <tfoot> the browser repeats it at
          the bottom of every printed page, and a total that appears three times
          on a three-page invoice reads as three charges. */}
      <div className="inv-total">
        <span className="dim">
          {formatHays(emails)} e-mail{emails === 1 ? "" : "s"}
          {uniformRate !== undefined && <> · {formatHays(uniformRate)} {currency} cada</>}
        </span>
        <span className="spacer" />
        <strong>{formatHays(total)} {currency}</strong>
      </div>
    </>
  );
}
