/** Shared between the browser and the API. No server-only imports here. */

/**
 * Braze owns this axis and every sync re-reads it. The list is open on purpose:
 * the dashboard has shipped new status words before, and a status we do not
 * recognise must still round-trip through the ledger rather than be dropped, so
 * anything unexpected lands in the catch-all string.
 */
export type BrazeStatus = "draft" | "active" | "stopped" | "paused" | "archived" | (string & {});

/** Ours, and the sync must never touch it — see the two-axis rule below. */
export type BillingState = "unbilled" | "invoiced" | "paid";

export type CampaignOrigin = "studio" | "braze";

/** R$ 150,00 per e-mail. Copied onto every invoice line at issue time. */
export const RATE_PER_EMAIL = 150;
/** Reais. Stored on every invoice so a record always says what its figures
 *  are denominated in, rather than relying on this constant never changing. */
export const CURRENCY = "BRL";

export interface CampaignBilling {
  state: BillingState;
  /** The invoice that claimed it, or null while it is still unbilled. */
  invoiceId: string | null;
}

/**
 * The fields the Braze sync is allowed to write, isolated in their own type so
 * the two axes can be kept apart by the compiler rather than by discipline.
 */
export interface SyncedFields {
  name: string;
  /** Deep link into the dashboard. */
  url?: string;
  brazeStatus: BrazeStatus;
  origin?: CampaignOrigin;
  projectId?: string;
  createdAt?: string;
  scheduledFor?: string;
  firstSentAt?: string;
  /** Relative path under data/assets, e.g. `campaigns/<id>/preview.png`. */
  thumbnail?: string;
}

/**
 * One row as the scraper found it.
 *
 * `billing?: never` is the whole point: it makes handing a full CampaignRecord
 * (or a hand-built object carrying a billing key) to `upsertFromSync` a type
 * error, so the invariant "the sync never writes billing" is enforced at the
 * call site and not by remembering to read a comment. The run-time merge
 * re-pins `billing` from the stored record as a second line of defence.
 */
export type SyncRow = SyncedFields & { id: string; billing?: never };

/**
 * The mirror ban: everything the sync owns is `never` here, so invoicing cannot
 * quietly move a campaign back to "stopped" while stamping it as invoiced.
 */
export type BillingPatch = Partial<CampaignBilling> &
  Partial<Record<keyof SyncedFields | "syncedAt" | "missingSince", never>> & {
    state: BillingState;
  };

export interface CampaignRecord extends SyncedFields {
  /** The Braze campaign id — the only stable identity, since names repeat. */
  id: string;
  origin: CampaignOrigin;
  billing: CampaignBilling;
  syncedAt?: string;
  /**
   * When a *complete* sync last failed to find it. Never set by a partial or
   * truncated scrape, and never on its own a reason to delete anything.
   */
  missingSince?: string | null;
  /**
   * The last sync found the row but could not read its status, so `brazeStatus`
   * is the previous run's value rather than today's. Kept on the record because
   * the alternative — a status that is quietly one sync out of date — is
   * indistinguishable from a fresh one on screen, and this field is what an
   * invoice dispute would be argued from.
   */
  statusUnread?: boolean;
}

export interface InvoiceLine {
  campaignId: string;
  name: string;
  createdAt?: string;
  sentAt?: string;
  qty: number;
  /** Copied, never read from RATE_PER_EMAIL at render time, so raising the
   *  price later cannot silently rewrite last quarter's invoices. */
  rate: number;
}

export type InvoiceState = "issued" | "paid";

export interface InvoiceRecord {
  /** INV-YYYYMM-NN, sequential within the month. */
  id: string;
  issuedAt: string;
  lines: InvoiceLine[];
  total: number;
  currency: string;
  state: InvoiceState;
  paidAt: string | null;
}

/** The two axes crossed: Braze says it is over, we have not charged for it. */
export function isBillable(campaign: CampaignRecord): boolean {
  return campaign.brazeStatus === "stopped" && campaign.billing.state === "unbilled";
}

/** The `YYYYMM` half of an invoice id. UTC, because every other stamp in the
 *  ledger comes from `toISOString()` and a mixed clock would misfile the last
 *  invoice of a month. */
export function invoiceMonth(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7).replace("-", "");
}

/**
 * Derived from what is already on disk rather than from a counter, because the
 * JSON file is hand-editable: a stored counter would go stale the moment
 * someone deletes a draft invoice by hand, and re-issuing an id already printed
 * on a document is worse than skipping one.
 */
export function nextInvoiceId(existingIds: readonly string[], at: Date = new Date()): string {
  const prefix = `INV-${invoiceMonth(at)}-`;
  const highest = existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => Number.parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(highest + 1).padStart(2, "0")}`;
}

export function invoiceLineFor(campaign: CampaignRecord, qty = 1, rate = RATE_PER_EMAIL): InvoiceLine {
  return {
    campaignId: campaign.id,
    name: campaign.name,
    createdAt: campaign.createdAt,
    sentAt: campaign.firstSentAt,
    qty,
    rate,
  };
}

export function invoiceTotal(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.rate, 0);
}
