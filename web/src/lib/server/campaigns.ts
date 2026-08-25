import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  isBillable,
  type BillingPatch,
  type BillingState,
  type BrazeStatus,
  type CampaignRecord,
  type SyncRow,
} from "@/lib/billing";

/**
 * The campaign ledger: every email that exists in Braze, whether or not this
 * app built it. Same store shape as projects.json — a JSON file, written
 * through a temp file and a rename so a crash mid-write leaves the previous
 * version intact, and pretty-printed because the file is meant to be read,
 * diffed and hand-edited.
 *
 * DATA_DIR is shared with store.ts so the e2e harness's STUDIO_DATA_DIR
 * override moves both stores at once.
 */
const DATA_DIR = process.env.STUDIO_DATA_DIR || join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "campaigns.json");
const ASSETS_DIR = join(DATA_DIR, "assets");

interface Database {
  version: 1;
  campaigns: CampaignRecord[];
}

/**
 * Thrown when the ledger is on disk but unreadable. Separate from BillingError
 * so a route can tell "you asked for something invalid" (400) apart from "the
 * ledger is damaged, refuse everything until a human looks" (500).
 */
export class LedgerUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerUnreadable";
  }
}

function empty(): Database {
  return { version: 1, campaigns: [] };
}

function read(): Database {
  if (!existsSync(DB_PATH)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Database;
    if (!parsed || !Array.isArray(parsed.campaigns)) return empty();
    return parsed;
  } catch {
    // This store fails CLOSED, unlike projects.json, and the difference is
    // money. Moving the file aside and carrying on with an empty ledger reads
    // to the next sync as "nothing has ever been invoiced": every campaign
    // comes back unbilled, "Nova fatura" ticks them all, and the client is
    // billed a second time for emails already paid for. A file left in place
    // and a loud failure can be fixed by hand; a second invoice cannot be
    // unsent.
    throw new LedgerUnreadable(
      `campaigns.json não pôde ser lido e foi deixado como está (${DB_PATH}). ` +
        `Corrija o arquivo à mão antes de sincronizar ou faturar.`,
    );
  }
}

function write(db: Database): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}

export interface CampaignFilter {
  brazeStatus?: BrazeStatus;
  billingState?: BillingState;
  /** Both axes at once: stopped and unbilled. */
  billable?: boolean;
  invoiceId?: string;
}

export function listCampaigns(filter: CampaignFilter = {}): CampaignRecord[] {
  return read()
    .campaigns.filter(c => {
      if (filter.brazeStatus && c.brazeStatus !== filter.brazeStatus) return false;
      if (filter.billingState && c.billing.state !== filter.billingState) return false;
      if (filter.invoiceId && c.billing.invoiceId !== filter.invoiceId) return false;
      if (filter.billable && !isBillable(c)) return false;
      return true;
    })
    .sort((a, b) => (b.firstSentAt || b.createdAt || "").localeCompare(a.firstSentAt || a.createdAt || ""));
}

export function getCampaign(id: string): CampaignRecord | undefined {
  return read().campaigns.find(c => c.id === id);
}

/** Stopped and unbilled — the set an invoice may be drawn from. */
export function billableCampaigns(): CampaignRecord[] {
  return listCampaigns({ billable: true });
}

export interface SyncSummary {
  added: number;
  updated: number;
  /** Known campaigns a *complete* sync did not see. Always zero otherwise. */
  missing: number;
  total: number;
}

export interface SyncOptions {
  /**
   * True only when the scraper reached the last page and is certain the rows
   * are the entire workspace. Anything else — a first page, an aborted run, a
   * status-filtered scrape — must leave this false.
   */
  complete?: boolean;
  syncedAt?: string;
}

/**
 * Merge a scraped list into the ledger.
 *
 * Absence is never a deletion. A campaign sitting on page 2 of a scrape that
 * timed out looks exactly like a campaign that was archived out of Braze, and
 * getting that wrong would drop a record we have already invoiced against, so
 * this function only ever adds and updates. A sync that knows it saw everything
 * can say so with `complete`, and then the campaigns it missed are *flagged*
 * with `missingSince` — still not removed. `pruneMissing` is the only path to
 * an actual delete, and it refuses anything that has been billed.
 *
 * `SyncRow` bans a `billing` key at the type level; the merge below re-pins
 * `billing` from the stored record anyway, so even a JS caller cannot use this
 * to un-invoice a campaign.
 */
export function upsertFromSync(rows: readonly SyncRow[], options: SyncOptions = {}): SyncSummary {
  if (!Array.isArray(rows)) throw new Error("upsertFromSync needs an array of rows");

  const at = options.syncedAt || new Date().toISOString();
  const db = read();
  const byId = new Map(db.campaigns.map(c => [c.id, c]));
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const row of rows) {
    if (!row || !row.id) throw new Error("upsertFromSync got a row with no campaign id");
    seen.add(row.id);
    const current = byId.get(row.id);

    if (!current) {
      byId.set(row.id, {
        ...stripUndefined(row),
        id: row.id,
        name: row.name || row.id,
        brazeStatus: row.brazeStatus || "unknown",
        origin: row.origin || "braze",
        billing: { state: "unbilled", invoiceId: null },
        syncedAt: at,
        missingSince: null,
      });
      added += 1;
      continue;
    }

    // Undefined fields are stripped first: a scrape that could not read the
    // sent date must leave the date we already had, not blank it.
    //
    // Status and name get a second guard on top of that, because both can come
    // back *present but empty* rather than undefined when the table's markup
    // moves under us — an unmatched status column yields "unknown" for every
    // row, and a row whose link has no text yields "". Letting either land
    // would overwrite good data with the artefact of a broken scrape, and for
    // the status that means a stopped campaign silently stops being billable.
    // Keeping the stored value costs a stale field; taking the new one costs an
    // invoice.
    const statusUnread = !row.brazeStatus || row.brazeStatus === "unknown";
    byId.set(row.id, {
      ...current,
      ...stripUndefined(row),
      id: current.id,
      brazeStatus: statusUnread && current.brazeStatus !== "unknown" ? current.brazeStatus : row.brazeStatus,
      statusUnread: statusUnread || undefined,
      name: row.name || current.name,
      // A campaign built by the studio stays "studio" forever, even though the
      // sync finds it again from the Braze side and would call it "braze".
      origin: current.origin || row.origin || "braze",
      projectId: current.projectId || row.projectId,
      billing: current.billing,
      syncedAt: at,
      missingSince: null,
    });
    updated += 1;
  }

  let missing = 0;
  if (options.complete) {
    for (const campaign of byId.values()) {
      if (seen.has(campaign.id)) continue;
      missing += 1;
      // Keep the first date it went missing: it is how long it has been gone
      // that decides whether it is worth pruning, not the last sync's clock.
      if (!campaign.missingSince) byId.set(campaign.id, { ...campaign, missingSince: at });
    }
  }

  const campaigns = [...byId.values()];
  write({ ...db, version: 1, campaigns });
  return { added, updated, missing, total: campaigns.length };
}

/**
 * Drop campaigns a complete sync stopped seeing. Anything that has been
 * invoiced or paid is kept whatever Braze says: the invoice references it by
 * id, and a printable document with a dangling line is not a document.
 */
export function pruneMissing(): CampaignRecord[] {
  const db = read();
  const removed = db.campaigns.filter(c => c.missingSince && c.billing.state === "unbilled");
  if (!removed.length) return [];
  const keep = new Set(removed.map(c => c.id));
  write({ ...db, campaigns: db.campaigns.filter(c => !keep.has(c.id)) });
  return removed;
}

/**
 * The other axis. `BillingPatch` types every synced field as `never`, so this
 * function cannot be handed a brazeStatus even by accident, and the merge
 * re-pins the synced fields from the stored record for the same reason
 * `upsertFromSync` re-pins billing.
 */
export function setBilling(id: string, patch: BillingPatch): CampaignRecord | undefined {
  const db = read();
  const index = db.campaigns.findIndex(c => c.id === id);
  if (index < 0) return undefined;

  const current = db.campaigns[index];
  const merged: CampaignRecord = {
    ...current,
    billing: {
      state: patch.state,
      invoiceId: patch.invoiceId === undefined ? current.billing.invoiceId : patch.invoiceId,
    },
  };
  db.campaigns[index] = merged;
  write(db);
  return merged;
}

/** Where a campaign's preview PNG lives. Mirrors assetDir() in store.ts. */
export function campaignAssetDir(campaignId: string): string {
  const dir = join(ASSETS_DIR, "campaigns", campaignId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
