# Plan — from Email Studio to a billing platform

Status: **proposed, nothing built yet** (2026-08-25).

The app today is a single-page studio: one project at a time, `data/projects.json`
as the store, Playwright driving Braze for import/draft/schedule/test. What is
being added is a second half — a ledger of every email campaign in Braze, with
local copies of the artwork, and an invoicing UI on top of it.

## The one correction to the spec

"Once the campaign is stopped it is billable, then the status changes from
stopped to invoiced, then to paid" folds two independent things into one field.
Braze owns draft/active/stopped, and every sync re-reads it; we own
unbilled/invoiced/paid. If they share a field the next sync overwrites
"invoiced" with "stopped" and the campaign gets billed twice.

So: two axes on every record.

- `brazeStatus` — synced, never written by us: `draft | active | stopped | ...`
- `billing.state` — ours, never written by the sync: `unbilled | invoiced | paid`

Billable = `brazeStatus === "stopped" && billing.state === "unbilled"`.

## Data model

A new file next to the existing one, `data/campaigns.json`, same shape of store
(atomic temp-file + rename, hand-editable). Keyed by the Braze campaign id,
which is the only stable identity — names repeat, ours are all `YYYYMMDD`.

```jsonc
{
  "id": "6a8d6a61...",          // Braze campaign id = primary key
  "name": "20260825",
  "url": "https://dashboard-03.braze.com/engagement/campaigns/...",
  "origin": "studio" | "braze", // built here, or found by the sync
  "projectId": "d6441e6b-...",  // set when it came from the studio
  "brazeStatus": "stopped",
  "createdAt": "...",
  "scheduledFor": "...",
  "firstSentAt": "...",
  "thumbnail": "campaigns/6a8d.../preview.png",  // under data/assets
  "billing": { "state": "unbilled", "invoiceId": null },
  "syncedAt": "..."
}
```

`ProjectRecord` stays what it is — a design being built. It gains nothing but a
campaign id it already effectively has (`braze.campaign.id`). A campaign record
is the billable artifact; a project is the work that produced one. Keeping them
separate is what lets the ledger also hold the ~N campaigns that were never
touched by this app.

Invoices live in `data/invoices.json`:

```jsonc
{
  "id": "INV-202608-01",
  "issuedAt": "...",
  "lines": [{ "campaignId": "...", "name": "...", "createdAt": "...",
              "sentAt": "...", "qty": 1, "rate": 150 }],
  "total": 450,
  "currency": "hay",
  "state": "issued" | "paid",
  "paidAt": null
}
```

The rate is copied onto the line, not read from a constant at render time, so
raising the price later does not silently rewrite last quarter's invoices.

## Phase A — the ledger and the sync

New flow `braze/flows/list-campaigns.mjs`, in the same shape as the others:
login, `paths.campaigns(group)`, read the campaign table (name, status column,
id off the row link, dates), page through to the end. Exposed as a new
`flow: "campaigns"` on `/api/braze/run` so it reuses the existing spawn + SSE
+ login-lock machinery, and writes into `campaigns.json` — upserting by id,
touching `brazeStatus`/dates/`syncedAt` only, never `billing`.

Then `/campaigns`: a table with thumbnail, name, status pill, created, sent,
billing state, and a filter. Read-only in this phase, plus a "Sincronizar"
button that streams the run's progress the way the send step already does.

**Settled: there is no REST API key** — Roger cannot mint one. The dashboard is
the only source of truth, `campaigns.json` is a cache, and it is refreshed on
demand from the UI. That makes the scraper load-bearing rather than a
convenience, and it is why the sync is written to fail loudly and partially
rather than to guess.

The trap found while building it: the campaign index does not open unfiltered.
It opens on the workspace's saved view, which lists **Active** campaigns only —
and everything billable is **Stopped**. A sync that accepts the default view
records the one set of campaigns that can never be invoiced and reports success.
The flow therefore clears the filter and maximises rows per page before reading
a single row, and reports `unfiltered` so the route can refuse to treat a
possibly-filtered read as a complete view of the workspace.

## Phase B — keeping the artwork

Nothing is saved locally today. `assetDir()` exists in `store.ts` and has no
callers; the ZIP is built in the browser, posted as base64 and written to a temp
dir that Playwright reads and the OS eventually deletes.

- Studio-built: on build, persist the flat source PNG and the sliced ZIP into
  `data/assets/<projectId>/`. Small change, immediate payoff — it also makes
  "reopen an old project" real.
- Braze-only: during the sync's per-campaign pass, screenshot the message
  preview on the compose step into `data/assets/campaigns/<id>/preview.png`.
  Not pixel-perfect, but it is a thumbnail and an invoice attachment.

## Phase C — the lock on the door

`.env.local` gains `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET`. A `/login`
page posts to `/api/auth`, which compares in constant time and sets an httpOnly,
sameSite=lax cookie holding `user|expiry|HMAC-SHA256`. `middleware.ts` verifies
the signature (Web Crypto works on the edge runtime) and lets `/login` and
`/api/auth` through.

This is a lock, not a security system — single shared credential, no user
management, as asked. Two things it costs: the password must not be one reused
elsewhere, and **the e2e suites all go through the front door**, so they need a
way in (an `AUTH_DISABLED=1` for the test server, or a seeded cookie in the
Playwright context). Cheaper to decide now than to discover across 8 suites.

## Phase D — invoicing

`/invoices` lists them; "Nova fatura" shows every billable campaign with a
checkbox, defaulting to all. Generating writes the invoice record, then stamps
each selected campaign with `billing.state = "invoiced"` and the invoice id, in
that order, so a crash leaves an invoice with no campaigns rather than campaigns
pointing at an invoice that does not exist.

`/invoices/<id>` renders the printable document — every email with its name,
created and sent dates, qty, 150 hays each, and the total. Print-to-PDF from the
browser, with a print stylesheet; no PDF library. Marking paid is one button that
sets `state`/`paidAt` on the invoice and cascades to its campaigns.

Open question worth answering before D: a campaign with several variants — one
email or several? Assumed one line per campaign at 150, with the qty editable on
the line.

## Order

A → B → C → D. A is the load-bearing one: until the ledger exists and the
statuses are real, everything downstream is guesswork.
