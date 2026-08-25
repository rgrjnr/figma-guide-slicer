// Plain node:test — run with `node --test test/`. No browser, no Braze, no
// network: everything here is the ledger's state machine over a temp data dir.
//
// The modules under test are TypeScript and Node 20 cannot load .ts, so the
// test compiles them to CommonJS in a temp directory with the TypeScript that
// is already a devDependency (no new dependency, and it type-checks the files
// as a side effect). tsc does not rewrite the `@/…` path alias when it emits,
// so the require hook below maps it the way the bundler would.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = mkdtempSync(join(tmpdir(), "billing-build-"));
const DATA_DIR = mkdtempSync(join(tmpdir(), "billing-data-"));

// Read at module load by every store, so it has to be set before the require.
process.env.STUDIO_DATA_DIR = DATA_DIR;

// A config file rather than tsc flags because `paths` has no command-line
// form, and without it the `@/…` imports do not even type-check.
const TSCONFIG = join(OUT_DIR, "tsconfig.json");
writeFileSync(
  TSCONFIG,
  JSON.stringify({
    compilerOptions: {
      outDir: OUT_DIR,
      rootDir: join(WEB_ROOT, "src"),
      baseUrl: WEB_ROOT,
      paths: { "@/*": ["./src/*"] },
      module: "commonjs",
      moduleResolution: "node",
      target: "es2022",
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      // The config lives in a temp dir, so node_modules has to be pointed at.
      typeRoots: [join(WEB_ROOT, "node_modules", "@types")],
      types: ["node"],
    },
    files: [
      join(WEB_ROOT, "src", "lib", "billing.ts"),
      join(WEB_ROOT, "src", "lib", "server", "campaigns.ts"),
      join(WEB_ROOT, "src", "lib", "server", "invoices.ts"),
    ],
  }),
);

execFileSync(process.execPath, [join(WEB_ROOT, "node_modules", "typescript", "bin", "tsc"), "--project", TSCONFIG], {
  cwd: WEB_ROOT,
  stdio: "inherit",
});

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) return resolveFilename.call(this, join(OUT_DIR, request.slice(2)), ...rest);
  return resolveFilename.call(this, request, ...rest);
};

const require = createRequire(import.meta.url);
const billing = require(join(OUT_DIR, "lib", "billing.js"));
const campaigns = require(join(OUT_DIR, "lib", "server", "campaigns.js"));
const invoices = require(join(OUT_DIR, "lib", "server", "invoices.js"));

process.on("exit", () => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
});

/** Both stores read the file on every call, so emptying the dir is a full reset. */
function reset() {
  for (const name of ["campaigns.json", "invoices.json"]) {
    rmSync(join(DATA_DIR, name), { force: true });
  }
}

const row = (id, brazeStatus, extra = {}) => ({
  id,
  name: id,
  brazeStatus,
  url: `https://dashboard-03.braze.com/engagement/campaigns/${id}`,
  createdAt: "2026-08-01T10:00:00.000Z",
  firstSentAt: "2026-08-02T10:00:00.000Z",
  ...extra,
});

test("a first sync adds every row as unbilled", () => {
  reset();
  const summary = campaigns.upsertFromSync([row("a", "stopped"), row("b", "active")], { complete: true });
  assert.deepEqual(summary, { added: 2, updated: 0, missing: 0, total: 2 });
  assert.equal(campaigns.getCampaign("a").billing.state, "unbilled");
  assert.equal(campaigns.getCampaign("a").billing.invoiceId, null);
  assert.equal(campaigns.getCampaign("a").origin, "braze");
});

test("re-syncing updates the Braze axis and leaves the billing axis alone", () => {
  reset();
  campaigns.upsertFromSync([row("a", "active")]);
  campaigns.setBilling("a", { state: "invoiced", invoiceId: "INV-202608-01" });

  campaigns.upsertFromSync([row("a", "stopped", { name: "20260825" })]);
  const after = campaigns.getCampaign("a");
  assert.equal(after.brazeStatus, "stopped");
  assert.equal(after.name, "20260825");
  assert.equal(after.billing.state, "invoiced", "the sync must never un-invoice a campaign");
  assert.equal(after.billing.invoiceId, "INV-202608-01");
});

test("a row carrying a billing key still cannot rewrite billing", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  campaigns.setBilling("a", { state: "paid", invoiceId: "INV-202608-01" });

  // The type bans this outright; JS callers (the sync writes its rows from
  // scraped JSON) get the same answer at run time.
  campaigns.upsertFromSync([{ ...row("a", "stopped"), billing: { state: "unbilled", invoiceId: null } }]);
  assert.equal(campaigns.getCampaign("a").billing.state, "paid");
});

test("setBilling cannot move the Braze axis", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  campaigns.setBilling("a", { state: "invoiced", invoiceId: "INV-202608-01", brazeStatus: "draft", name: "hijacked" });
  const after = campaigns.getCampaign("a");
  assert.equal(after.brazeStatus, "stopped");
  assert.equal(after.name, "a");
});

test("a truncated sync is not a deletion", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped"), row("c", "active")], { complete: true });

  // Page 2 never arrived: only "a" comes back, and the run cannot claim to be
  // complete. Nothing may be dropped or flagged.
  const summary = campaigns.upsertFromSync([row("a", "stopped")]);
  assert.equal(summary.total, 3);
  assert.equal(summary.missing, 0);
  assert.ok(campaigns.getCampaign("b"), "a campaign missing from a partial scrape must survive");
  assert.equal(campaigns.getCampaign("b").missingSince, null);
});

test("a complete sync flags what it did not see but never deletes it", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")], { complete: true });
  const summary = campaigns.upsertFromSync([row("a", "stopped")], {
    complete: true,
    syncedAt: "2026-08-25T00:00:00.000Z",
  });
  assert.equal(summary.missing, 1);
  assert.equal(campaigns.getCampaign("b").missingSince, "2026-08-25T00:00:00.000Z");
  assert.equal(campaigns.listCampaigns().length, 2);

  // Seeing it again clears the flag.
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")], { complete: true });
  assert.equal(campaigns.getCampaign("b").missingSince, null);
});

test("pruning drops missing campaigns but keeps anything invoiced", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")], { complete: true });
  campaigns.setBilling("a", { state: "invoiced", invoiceId: "INV-202608-01" });
  campaigns.upsertFromSync([], { complete: true });

  const removed = campaigns.pruneMissing();
  assert.deepEqual(removed.map(c => c.id), ["b"]);
  assert.ok(campaigns.getCampaign("a"), "an invoiced campaign is never pruned");
});

test("billable is both axes at once", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "active"), row("c", "stopped"), row("d", "draft")]);
  campaigns.setBilling("c", { state: "invoiced", invoiceId: "INV-202608-01" });
  assert.deepEqual(campaigns.billableCampaigns().map(c => c.id), ["a"]);
});

test("an invoice copies the rate onto every line and totals them", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped"), row("c", "stopped")]);
  const invoice = invoices.createInvoice(["a", "b", "c"], { issuedAt: "2026-08-25T12:00:00.000Z" });

  assert.equal(invoice.id, "INV-202608-01");
  assert.equal(invoice.total, 450);
  assert.equal(invoice.currency, "hay");
  assert.equal(invoice.state, "issued");
  assert.equal(invoice.paidAt, null);
  assert.deepEqual(invoice.lines.map(l => l.rate), [150, 150, 150]);
  assert.equal(invoice.lines[0].sentAt, "2026-08-02T10:00:00.000Z");
  for (const id of ["a", "b", "c"]) {
    assert.equal(campaigns.getCampaign(id).billing.state, "invoiced");
    assert.equal(campaigns.getCampaign(id).billing.invoiceId, "INV-202608-01");
  }
});

test("qty multiplies a line and the total follows", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")]);
  const invoice = invoices.createInvoice(["a", "b"], { qty: { a: 3 } });
  assert.equal(invoice.lines.find(l => l.campaignId === "a").qty, 3);
  assert.equal(invoice.total, 600);
});

test("the rate on an issued invoice survives a later price change", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")]);
  const old = invoices.createInvoice(["a"], { issuedAt: "2026-08-25T12:00:00.000Z" });
  const raised = invoices.createInvoice(["b"], { rate: 200, issuedAt: "2026-08-25T12:00:00.000Z" });
  assert.equal(invoices.getInvoice(old.id).lines[0].rate, 150);
  assert.equal(raised.total, 200);
});

test("invoicing the same campaign twice is refused, and refused before anything is written", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")]);
  invoices.createInvoice(["a"]);

  // Either guard may speak first — the campaign's own billing state, or the
  // cross-check against the invoices themselves. What matters is the refusal.
  assert.throws(() => invoices.createInvoice(["b", "a"]), /já (foi faturada|está na fatura)/);
  assert.equal(invoices.listInvoices().length, 1, "the refused invoice must not have been written");
  assert.equal(campaigns.getCampaign("b").billing.state, "unbilled", "no campaign may be stamped by a refused call");
});

test("a campaign that is not stopped cannot be invoiced", () => {
  reset();
  campaigns.upsertFromSync([row("a", "active")]);
  assert.throws(() => invoices.createInvoice(["a"]), /ainda não está parada/);
});

test("an empty, duplicated or unknown selection is refused", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  assert.throws(() => invoices.createInvoice([]), /pelo menos uma campanha/);
  assert.throws(() => invoices.createInvoice(["a", "a"]), /duas vezes/);
  assert.throws(() => invoices.createInvoice(["nope"]), /não está no catálogo/);
});

test("invoice ids run sequentially inside a month and restart in the next one", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped"), row("c", "stopped")]);
  assert.equal(invoices.createInvoice(["a"], { issuedAt: "2026-08-01T00:00:00.000Z" }).id, "INV-202608-01");
  assert.equal(invoices.createInvoice(["b"], { issuedAt: "2026-08-31T23:00:00.000Z" }).id, "INV-202608-02");
  assert.equal(invoices.createInvoice(["c"], { issuedAt: "2026-09-01T00:00:00.000Z" }).id, "INV-202609-01");
});

test("the next id is read off disk, so a hand-edited file still sequences", () => {
  reset();
  // The file is meant to be hand-editable; an id that was already printed on a
  // document must never come back around.
  writeFileSync(
    join(DATA_DIR, "invoices.json"),
    JSON.stringify({ version: 1, invoices: [{ id: "INV-202608-07", lines: [], total: 0 }] }, null, 2),
  );
  campaigns.upsertFromSync([row("a", "stopped")]);
  assert.equal(invoices.createInvoice(["a"], { issuedAt: "2026-08-25T12:00:00.000Z" }).id, "INV-202608-08");
});

test("marking paid cascades to the campaigns and is idempotent", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "stopped")]);
  const invoice = invoices.createInvoice(["a", "b"]);

  const paid = invoices.markPaid(invoice.id, "2026-09-10T09:00:00.000Z");
  assert.equal(paid.state, "paid");
  assert.equal(paid.paidAt, "2026-09-10T09:00:00.000Z");
  assert.equal(campaigns.getCampaign("a").billing.state, "paid");
  assert.equal(campaigns.getCampaign("b").billing.invoiceId, invoice.id);

  const again = invoices.markPaid(invoice.id, "2026-10-01T00:00:00.000Z");
  assert.equal(again.paidAt, "2026-09-10T09:00:00.000Z", "paying twice must not move the date");
  assert.equal(invoices.markPaid("INV-000000-01"), undefined);
});

test("a paid campaign is not billable again and a later sync leaves it paid", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  invoices.markPaid(invoices.createInvoice(["a"]).id);
  campaigns.upsertFromSync([row("a", "stopped")], { complete: true });
  assert.equal(campaigns.getCampaign("a").billing.state, "paid");
  assert.deepEqual(campaigns.billableCampaigns(), []);
});

test("the sync does not blank fields it could not read, and keeps studio origin", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped", { origin: "studio", projectId: "d6441e6b" })]);
  campaigns.upsertFromSync([{ id: "a", name: "a", brazeStatus: "stopped", firstSentAt: undefined }]);

  const after = campaigns.getCampaign("a");
  assert.equal(after.firstSentAt, "2026-08-02T10:00:00.000Z");
  assert.equal(after.origin, "studio");
  assert.equal(after.projectId, "d6441e6b");
});

test("a row with no id is a caller bug and throws", () => {
  reset();
  assert.throws(() => campaigns.upsertFromSync([{ name: "x", brazeStatus: "stopped" }]), /no campaign id/);
});

// The ledger fails closed, which is the opposite of what projects.json does.
// An empty ledger reads to the next sync as "nothing was ever invoiced", and
// everything already paid for comes back billable.
test("a corrupt ledger refuses to be read, and is left on disk untouched", () => {
  reset();
  const path = join(DATA_DIR, "campaigns.json");
  writeFileSync(path, "{ this is not json");
  assert.throws(() => campaigns.listCampaigns(), /não pôde ser lido/);
  assert.throws(() => campaigns.upsertFromSync([row("a", "stopped")]), /não pôde ser lido/);
  assert.equal(readFileSync(path, "utf8"), "{ this is not json");
});

test("a sync that could not read the status keeps the status it had", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  campaigns.upsertFromSync([{ id: "a", name: "a", brazeStatus: "unknown" }]);

  const after = campaigns.getCampaign("a");
  assert.equal(after.brazeStatus, "stopped", "an unreadable status must not un-bill a campaign");
  assert.equal(after.statusUnread, true);
  assert.equal(campaigns.billableCampaigns().length, 1);
});

test("a sync that could not read the name keeps the name it had", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped", { name: "20260825" })]);
  campaigns.upsertFromSync([{ id: "a", name: "", brazeStatus: "stopped" }]);
  assert.equal(campaigns.getCampaign("a").name, "20260825");
});

test("an empty scrape never flags the ledger as missing", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped"), row("b", "active")]);
  // What the route now refuses to call complete: zero rows back.
  const summary = campaigns.upsertFromSync([], { complete: false });
  assert.equal(summary.missing, 0);
  assert.equal(campaigns.getCampaign("a").missingSince, null);
});

test("a campaign already on an invoice cannot be billed again, whatever the ledger says", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  const first = invoices.createInvoice(["a"]);
  // The ledger disagreeing with the invoices is exactly the restored-backup and
  // hand-edit case; the document that was sent has to win.
  campaigns.upsertFromSync([row("a", "stopped")]);
  const record = campaigns.getCampaign("a");
  assert.equal(record.billing.state, "invoiced");
  assert.throws(() => invoices.createInvoice(["a"]), new RegExp(`já está na fatura ${first.id}`));
});

test("qty and rate off a request body are validated before anything is written", () => {
  reset();
  campaigns.upsertFromSync([row("a", "stopped")]);
  assert.throws(() => invoices.createInvoice(["a"], { qty: { a: 0 } }), /Quantidade inválida/);
  assert.throws(() => invoices.createInvoice(["a"], { rate: 0 }), /Valor por e-mail inválido/);
  assert.throws(() => invoices.createInvoice(["a"], { rate: NaN }), /Valor por e-mail inválido/);
  // Nothing was written on the way to any of those.
  assert.deepEqual(invoices.listInvoices(), []);
  assert.equal(campaigns.getCampaign("a").billing.state, "unbilled");
});

test("the pure helpers stand on their own", () => {
  assert.equal(billing.invoiceMonth(new Date("2026-08-25T00:00:00.000Z")), "202608");
  assert.equal(billing.nextInvoiceId([], new Date("2026-08-25T00:00:00.000Z")), "INV-202608-01");
  assert.equal(
    billing.nextInvoiceId(["INV-202607-09", "INV-202608-01"], new Date("2026-08-25T00:00:00.000Z")),
    "INV-202608-02",
  );
  assert.equal(billing.invoiceTotal([{ qty: 2, rate: 150 }, { qty: 1, rate: 150 }]), 450);
  assert.equal(billing.isBillable({ brazeStatus: "stopped", billing: { state: "unbilled" } }), true);
  assert.equal(billing.isBillable({ brazeStatus: "stopped", billing: { state: "invoiced" } }), false);
  assert.equal(billing.isBillable({ brazeStatus: "active", billing: { state: "unbilled" } }), false);
});
