import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENCY,
  RATE_PER_EMAIL,
  invoiceLineFor,
  invoiceTotal,
  isBillable,
  nextInvoiceId,
  type InvoiceRecord,
} from "@/lib/billing";
import { getCampaign, setBilling } from "@/lib/server/campaigns";

/** Same store shape as projects.json and campaigns.json — see store.ts. */
const DATA_DIR = process.env.STUDIO_DATA_DIR || join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "invoices.json");

interface Database {
  version: 1;
  invoices: InvoiceRecord[];
}

function empty(): Database {
  return { version: 1, invoices: [] };
}

function read(): Database {
  if (!existsSync(DB_PATH)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Database;
    if (!parsed || !Array.isArray(parsed.invoices)) return empty();
    return parsed;
  } catch {
    // Moved aside, never overwritten: these are documents that have been sent.
    const backup = `${DB_PATH}.corrupt-${Date.now()}`;
    try {
      renameSync(DB_PATH, backup);
      console.error(`invoices.json was unreadable; moved to ${backup}`);
    } catch {
      /* nothing more to do */
    }
    return empty();
  }
}

function write(db: Database): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}

/** Thrown for every refusal, so the route can answer 409 instead of 500. */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

export function listInvoices(): InvoiceRecord[] {
  return read().invoices.sort((a, b) => b.id.localeCompare(a.id));
}

export function getInvoice(id: string): InvoiceRecord | undefined {
  return read().invoices.find(i => i.id === id);
}

export interface CreateInvoiceOptions {
  issuedAt?: string;
  /** Overrides the 150/email default; whatever it is gets copied onto lines. */
  rate?: number;
  /** Per-campaign override, for the campaign that was really several emails. */
  qty?: Record<string, number>;
}

/**
 * Issue an invoice for a set of campaigns.
 *
 * Every guard runs before anything is written, because half an invoice is
 * worse than none: a campaign that is already on another invoice, or that Braze
 * still has running, stops the whole call rather than being skipped, so the
 * caller finds out instead of quietly billing less than it asked for.
 */
export function createInvoice(campaignIds: readonly string[], options: CreateInvoiceOptions = {}): InvoiceRecord {
  if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
    throw new BillingError("Uma fatura precisa de pelo menos uma campanha");
  }
  if (new Set(campaignIds).size !== campaignIds.length) {
    throw new BillingError("A mesma campanha foi enviada duas vezes na fatura");
  }

  // qty and rate arrive from a request body. The UI floors qty at 1, but the
  // UI is not the only caller a route has: `{"qty":{"x":0}}` would issue a line
  // for nothing while still stamping the campaign as invoiced — billed zero and
  // permanently out of the billable set — and a non-numeric rate would print
  // "NaN hays" on a document sent to a client.
  const rate = options.rate === undefined ? RATE_PER_EMAIL : options.rate;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new BillingError(`Valor por e-mail inválido: ${String(options.rate)}`);
  }
  for (const [id, qty] of Object.entries(options.qty ?? {})) {
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new BillingError(`Quantidade inválida para a campanha ${id}: ${String(qty)}`);
    }
  }

  // Second lock on double-billing. The first is the campaign's own billing
  // state, but that lives in the other file and a ledger restored from backup,
  // hand-edited, or rebuilt by a sync after a corrupt read can disagree with
  // the invoices. The invoices are the document that was actually sent, so
  // where the two disagree, they win.
  const alreadyInvoiced = new Map<string, string>();
  for (const invoice of read().invoices) {
    for (const line of invoice.lines) alreadyInvoiced.set(line.campaignId, invoice.id);
  }

  const campaigns = campaignIds.map(id => {
    const on = alreadyInvoiced.get(id);
    if (on) throw new BillingError(`Campanha ${id} já está na fatura ${on}`);
    return id;
  }).map(id => {
    const campaign = getCampaign(id);
    if (!campaign) throw new BillingError(`Campanha ${id} não está no catálogo`);
    if (campaign.billing.state !== "unbilled") {
      throw new BillingError(
        `Campanha ${campaign.name} já foi faturada (${campaign.billing.invoiceId || campaign.billing.state})`,
      );
    }
    if (!isBillable(campaign)) {
      throw new BillingError(`Campanha ${campaign.name} ainda não está parada no Braze`);
    }
    return campaign;
  });

  const lines = campaigns.map(c => invoiceLineFor(c, options.qty?.[c.id] ?? 1, rate));
  const db = read();
  const issuedAt = options.issuedAt || new Date().toISOString();
  const invoice: InvoiceRecord = {
    id: nextInvoiceId(db.invoices.map(i => i.id), new Date(issuedAt)),
    issuedAt,
    lines,
    total: invoiceTotal(lines),
    currency: CURRENCY,
    state: "issued",
    paidAt: null,
  };

  // The invoice record goes to disk BEFORE the campaigns are stamped. The two
  // writes cannot be made atomic across two files, so the order is chosen for
  // the crash in the middle: an invoice whose campaigns are still unbilled is
  // visible, re-issuable and obviously wrong, whereas campaigns stamped with an
  // invoice id that was never written are silently unbillable forever and there
  // is nothing on screen to point at.
  db.invoices.push(invoice);
  write(db);

  for (const campaign of campaigns) {
    setBilling(campaign.id, { state: "invoiced", invoiceId: invoice.id });
  }

  return invoice;
}

/** Marks the invoice paid and cascades to the campaigns it claimed. */
export function markPaid(id: string, at?: string): InvoiceRecord | undefined {
  const db = read();
  const index = db.invoices.findIndex(i => i.id === id);
  if (index < 0) return undefined;

  const current = db.invoices[index];
  if (current.state === "paid") return current;

  const paid: InvoiceRecord = { ...current, state: "paid", paidAt: at || new Date().toISOString() };
  db.invoices[index] = paid;
  write(db);

  for (const line of paid.lines) {
    setBilling(line.campaignId, { state: "paid", invoiceId: paid.id });
  }
  return paid;
}
