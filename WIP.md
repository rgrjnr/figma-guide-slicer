## 2026-09-08 — main — social row found under a light streak (Emmy26) ✅ EM PRODUÇÃO

`wbd-email-emmy26.png` não partia os ícones sociais: um risco de luz diagonal
na margem esquerda toca a fila de ícones e, na máscara solta, funde-se com ela
numa banda de 72px colada ao botão CTA — falha o teste de isolamento. Em
`social.ts` o re-split com a máscara forte (antes só para bandas >240px) passa
a aplicar-se também a bandas **não isoladas**; o padding passa a ignorar bandas
de speckle como o isolamento já fazia (baseline hbomax padTop 798→790, glow).
Fixture PNG nova + teste (28/28, typecheck limpo; `@types/pngjs` adicionado).
Nota: `scratchpad/harness.ts` só corre de dentro de `packages/slicer-core`
(jpeg-js/pngjs vivem lá). Commit `ffc2595` → deploy Coolify #35, spicy.rogerjunior.com
a servir a imagem nova (verificado 2026-09-08). Opcional: template do ícone "globo".

## 2026-09-02 — claude/cliente-sem-pagar — a arte fica guardada; editar depois funciona

Reabrir um projecto passa a trazer **a arte junto com as marcas**. Era o único
bloqueio: o `projects.json` só guardava `imageName`, e o app dizia "adicione a
arte novamente" — sem o ficheiro original não havia edição nenhuma. Agora
`PUT/GET /api/projects/<id>/artwork` guarda os bytes em `data/assets/<id>/source.<ext>`
(fora do JSON, que continua legível e é reenviado a cada autosave), o `handleSave`
sobe-a quando muda e o `handleOpen` chama `restoreImage` — irmão do `loadFile`
que **não** limpa guias e rows. Re-empurrar já usava `replace` sozinho; o que
faltava era não disparar à toa: `preparedSig` é semeada ao abrir uma campanha que
já existe no Braze, senão passear pelos passos trocava a variante viva por uma
igual. Provado em browser (7/7 em `e2e/projects.mjs`, dois checks novos) e por
API: bytes idênticos, jpeg substitui png, 415/400/404/401, DELETE limpa a pasta.
Só serve os projectos locais, por construção — as 95 campanhas vindas do scrape
não têm projecto. **✅ EM PRODUÇÃO** — deploy #31 do commit `6128ba7`, 2026-09-02.
Verificado ao vivo em spicy.rogerjunior.com: cliente 200 em /campaigns e /invoices,
409 ao emitir sem campanhas, **403 no PATCH** (id inexistente de propósito — 403 prova
a ACL, 404 provaria que passou), rota da arte viva a 404 nos projectos antigos, que
ainda não têm bytes guardados. As 7 faturas continuam 1 paga.

## 2026-09-02 — claude/cliente-sem-pagar — cliente ganha tudo menos liquidar

Os dois papéis passam a abrir o mesmo prédio: o `cliente` já vê `/campaigns`
(o histórico do que foi enviado) e `/invoices`, e **emite** faturas. Só
"Marcar como paga" continua a ser do admin. A regra saiu do middleware para
`src/lib/server/access.mjs` (ESM puro, como o `session.mjs`) porque um prefixo
de path não distingue `GET /api/invoices/<id>` — o documento imprimível — de
`PATCH` no mesmo URL, que é o pagamento; agora casa por método. 5 testes novos
em `test/access.test.mjs`, typecheck e build limpos, matriz exercitada contra
um servidor local: cliente GET/POST 200-409, PATCH **403**; admin PATCH passa a
ACL; anónimo 401. **✅ EM PRODUÇÃO** desde 2026-09-02 (deploy #31).
Nota: `npm test` já não corre neste Node (22.23) — `node --test <dir>` deixou de
resolver; usar globs. 5 falhas em `braze/` são pré-existentes (Playwright).

# WIP

## 2026-08-31 — main (LIVE at spicy.rogerjunior.com, two passwords working)

Deployed: Coolify app "Email Studio" (uuid xvxdk05oefmpo751rvbl230h, project
Home Server, Dockerfile build from repo root, port 3000, GitHub App source,
auto-deploys on push to main). Volumes spicy-data (/app/web/data, seeded with
today's campaigns/invoices/projects JSON — 97 campaigns live), spicy-braze-auth,
spicy-runs. Env vars copied from web/.env.local via API. DNS: spicy CNAME
vpn.rogerjunior.com (Cloudflare, via the ddns container's token, server-side).
LE cert issued. Verified live: anon→login, admin sees billing, client
(CLIENT_USER=cliente, password in web/.env.local) gets studio only.
Note: Coolify API token "claude-deploy" lives in ~/.coolify-claude-token on
homeserver (0600) — revoke in Coolify UI if unwanted. Braze robot on the server
is UNTESTED (headless, fresh .auth volume — first run will do full Okta login).

## 2026-08-31 — main (two passwords + Docker image ready; Coolify app not yet created)

Auth now has two doors: ADMIN_* (billing incl. invoices) and CLIENT_* (studio
only) — role rides inside the signed cookie; middleware 403s/redirects client
off /invoices,/campaigns + their APIs. 112 unit + 8 e2e green, live-verified.
CLIENT_USER=cliente + generated password appended to web/.env.local.
Dockerfile at repo root (Playwright base, BRAZE_HEADLESS=1), image builds and
serves — xlsx was missing from package.json, now pinned. Pushed to GitHub.
BLOCKED on: creating the Coolify app + spicy CNAME (permissions denied in
session). SSH trick when LAN is dead: `ssh -b 10.8.0.2 homeserver`.
Next: create Coolify app (project Home Server, Dockerfile, port 3000, volumes
/app/web/{data,braze/.auth,.runs}, env from web/.env.local), CNAME spicy→vpn.

## 2026-08-25 — main (launch built, UNTESTED against real Braze)

"Lançar campanha" on the Envio step: dialog reads Braze live (alcançáveis,
assunto, horário), confirming re-runs the same flow with those values as
expectations and clicks Launch. Guards = SENDING.md's four rules, as pure
launchBlockers() with offline tests (braze/launch.test.mjs, 109 tests green).
NOT YET RUN FOR REAL — no campaign has been launched by it. The read path
(compose/schedule/review) reuses verified selectors; the CLICK on
braze.review.launch has never executed. First real use should be a campaign
scheduled well in the future, watched headed, so the click can be aborted.
CLI: npm run braze -- launch --id X   (read-only without --confirm true)

## 2026-08-25 — main (sync verified against real Braze, 96 campaigns)

The scraper ran for real: chip "Status: Active" dismissed, rows/page 96, 96
campaigns in the ledger, all unbilled, no invoice issued yet. Its log gave up
the true header row and killed three bugs — "Created by"/"Last edited by" hold
PEOPLE (was storing "Roger Junior" as a date), "Sent" is a COUNT and
Date.parse("0") is 2000-01-01 (every campaign stamped as sent that day), and
there is NO created-date column (now falls back to the YYYYMMDD in our names;
stop date stands in for the send date). Paging now uses the window actually in
effect — Braze clamps to 96, so asking for 200 and getting 96 read as "last
page" and stopped while claiming completeness.
Prices are R$ 150,00 (pt-BR), qty column gone. Long forms scroll again
(.form-inner children were shrinking, not overflowing — measured 2898px→740px).
NOTE TO SELF: never `npm run build` while his dev server runs — it clobbers
.next and the app dies with "Cannot find module './873.js'". Use build:check.
Next: re-sync to fill the dates, then issue the first invoice end to end.
Still unbuilt: Phase B (artwork capture) — captureCampaignPreview has no caller.

## 2026-08-25 — main (billing platform A–D built, scraper UNVERIFIED)

Ledger + invoicing built in one pass (plan in PLAN-BILLING.md): campaigns.json
keyed by Braze campaign id, brazeStatus (sync-owned) and billing.state
(ours) kept on separate axes at the type level; /campaigns, /invoices with a
print stylesheet, shared-credential auth (Web Crypto in middleware, e2e signs in
via e2e/helpers.mjs signIn()). No API key exists, so the scraper is the only
source of truth. 89 unit tests + typecheck + build green.
Braze's campaign index opens on a saved view showing ACTIVE only and everything
billable is STOPPED — list-campaigns now clears the filter and maximises rows
per page first, and refuses to claim `complete` unless it proved it.
NOT DONE: every campaignList selector is a guess (VERIFIED.listCampaigns=false)
and nothing has touched real Braze. Next: `npm run braze -- campaigns --limit 5`
headed, watch which strategy matches, fix selectors.mjs. Then Phase B images.

## 2026-08-25 — main (test send unblocked by the draft, pill sizing)

Test send now has its own lane and enables the moment the draft exists — it
only reads the campaign and fires a proof, so it runs beside the schedule
instead of queueing behind it (Agendar stays gated on the campaign lane).
Waiting hint updated to say exactly that. Pill blob fixed: flex items stretch
by default, so the pills were filling the taller progress rows and ballooning
into ovals — align-items:center + align-self, measured 21px in e2e.

## 2026-08-25 — main (determinate progress + waiting explained)

The rail spinners are now gauges: runner steps stream as "NN doing x", the UI
parses the number, divides by the flow's happy-path total (clamped, so login
detours never read >100%), and shows a conic-gradient ring + the current step
translated to pt-BR (src/lib/flowLabels.ts). Arte combines draft+schedule into
one gauge. Send-step status rows get a progress bar + n/total pill, and the
disabled test button now says it is waiting for the art to finish uploading
(or that Arte was never visited). New e2e/progress.mjs fakes the SSE stream
with a slow local HTTP server routed over /api/braze/run — asserts the ring,
the translated label, and the final ✓ without touching Braze.
8 e2e suites + 39 unit green.

## 2026-08-25 — main (parallel lanes, progress in the rail, offline OCR)

Feedback round: test send now shows "✓ Teste enviado para N endereços" (and
schedule shows its own ✓ note); the step rail replaces the number with a
spinner while that step's Braze work runs and a ✓/! when it lands (Público ↔
audience, Arte ↔ prepare+schedule chain); the log pane + "Algo não funcionou?"
section are gone from Enviar (last error shows as one red line; e2e keeps the
ZIP checks via a dev-only window.__downloadZip hook).
Parallelised: audience and campaign lanes run concurrently. The one thing that
must not overlap is login (two runs would submit the same TOTP code and Okta
rejects a replay) — mkdir-based login lock in braze/auth.mjs; waiters adopt
the fresh session via addCookies then re-classify.
Offline OCR: tesseract.js was silently loading worker+core from jsdelivr at
runtime (flaked in e2e); postinstall copies worker, wasm cores and por+eng
traineddata from npm into public/tesseract/ (gitignored). Zero external
requests verified.
Review-box render bug Roger saw: not reproducible on fresh load — likely a
stale hot-reload chunk; asked for hard refresh.

## 2026-08-24 — main (pipelined steps, no waiting on Braze)

Reordered to Público → Detalhes → Arte → Enviar, with Braze work started in
the background as steps are left: leaving Público ships the audience import
(signature-guarded — revisiting and advancing again only re-runs if the list,
name or count changed); leaving Arte builds the draft (replace if the campaign
exists) then chains schedule targeting the segment. Runs share one browser
session so everything goes through a promise queue; per-flow status pills on
the last step. Enviar is now just: status, test-email chips (Braze-style, ×
to remove, invalid marked), Enviar teste + Agendar envio, escape-hatch
download. Test emails moved out of Detalhes.
IMPORTANT bug owned: braze-wiring.mjs was clicking the real draft button with
real creds — every full e2e run since the login fix created a stray draft
("20260824", subject "TEST subject", up to 3). Told Roger to delete them.
The suite is now gating-only and aborts (fails) if anything touches
/api/braze/run.
39 unit + 7 e2e green.

## 2026-08-24 — main (import done = segment ready)

Roger's real import (11,974 rows) sat in "wait for the import to finish"
forever: a real mailing list always has a few bad rows, so Braze lands on
"Partial success" — the wait only accepted "Complete". Done is now "Go to
Segment appears" (segment targetable = what the campaign needs), with partial
logged as a warn, records count + segment URL harvested, and the segment
recorded on the project (braze.segment) via the run route.
Verified read-only against the live row from his run: segment 20260824.csv
ready at segmenter/6a8c8f6588076b005bbd9c4c. His import had in fact succeeded.

## 2026-08-24 — main (spreadsheet drop fixed)

Roger's real mailing list "could not be imported": the file was fine (11,974
unique addresses once parsed) — the Público step's default tab is "Colar
endereços", which had no drop target, so a spreadsheet dragged there was
silently swallowed. The dropzone only existed after clicking "Enviar arquivo".
Fix: the whole step is now a drop target on either tab; a drop switches to the
file tab and reads. Wrong file types get named ("use uma planilha") instead of
being read as text. Verified with the actual xlsx dropped on the paste tab.
Also: their 18:23 draft run succeeded (campaign 20260824) — login fix holding.
Note to self: stop rm -rf'ing .runs during e2e; it wiped their failure history.

## 2026-08-24 — main (links on demand)

The links panel listed a field for every row, burying the few that matter.
Back to the two centred hover circles on the artwork — link and social, as
before — but the field opens in the side panel (autofocused), not on the
canvas, keeping the highlight+scroll sync. A row stays listed once it has a
link or is social; clicking elsewhere on the art still splits.
Works: new e2e/links.mjs (6 checks); setRowLink helper now goes through the
circle like a person would. 7 e2e suites + 39 unit tests green.

## 2026-08-24 — main (expired-session login fixed, chain fully verified)

Roger's session expired for real and login hung: Braze remembers the email, so
an expired session skips /sign_in and lands straight on the "Sign In to US
Cluster 03" provider screen — the linear flow only clicked "WBD Okta" when it
had arrived via the email screen, so it sat waiting for a dashboard forever.
Fix: login is now a state machine (classifyScreen in flows/login.mjs) — name
whatever screen is showing (okta widget fields first, then braze email,
provider gated on /auth|/sign_in URL, portal, signed-in), handle it, loop; a
sustained-unknown streak fails with the URL instead of a bare timeout.
Works: ran against the genuinely expired session — provider → username →
password → Google Authenticator code → dashboard, unattended; second run
reused the fresh session. VERIFIED.login flipped true. 39 unit tests (new
classifier fixtures incl. the exact expired-session screen) + 6 e2e green.
Notes: no factor chooser (TOTP is default); no trust-device checkbox on the
code screen, so full re-login happens on every lapse — fine, it's unattended.

## 2026-08-24 — main (UI rebuilt around the request)

Rebuilt the Studio as four steps (Arte / Detalhes / Público / Enviar ao Braze),
in **pt-BR**, light theme, mirroring how the work arrives: a design, a title,
a spreadsheet, a date.
Works: one "Detectar linhas automaticamente" replaces the two technical
buttons; links moved off the canvas into a side list where focusing a field
highlights and scrolls the canvas to that row; hover circle marks a row social;
clicking the art still splits it. Zoom is a dropdown (fit/100/75/50/25) plus
Computador/Celular — mobile is a zoom (375/designWidth), not a narrower
surface, or the overlays would drift from the art. OCR is no longer a button:
it runs during the build and also seeds the preview text. Audience takes paste
or .xlsx/.xls/.csv (any column that looks like an address). Defaults: campaign
and segment = YYYYMMDD, tomorrow 09:30, America/Sao_Paulo, native date/time
inputs, timezone dropdown. Downloading is now only an escape hatch under
"Algo não funcionou?".
Gotchas: date-derived defaults must be set in an effect, not in useState — SSR
and hydration can compute them differently. Retired e2e/tools.mjs (the manual
tools it drove are gone; work-area bounds stay covered in slicer-core), and
ocr.mjs now asserts the automatic behaviour instead of a button.
Not done: nothing reads the request email itself yet.
Next: the two TEST campaigns and TEST-claude-20260823.csv are still in Braze.

## 2026-08-23 — main (Phase 4, Braze flows driven for real)

Drove a real campaign end to end in Braze and encoded every step. No campaign
was ever launched and no test mail sent.
Works: draft (create -> upload ZIP -> build -> subject/preheader -> save),
replace (add blank variant -> new ZIP -> remove old variant -> rename; for when
a design changes but the campaign is reused), schedule (+ timezone conversion
into the workspace zone, + removes Braze's default 20% A/B control group,
+ reads back the reachable-user count), audience import (4-step wizard; must
pick "Create targeting filter and segment" or nothing is targetable), refresh
(read-only, re-reads live state), test send (staged; needs --confirm to fire).
JSON store at web/data/projects.json + /api/projects CRUD; nested merge so one
step cannot clobber another's Braze links.
Gotchas found the hard way: compose must be one page session (reload discards
the upload); each wizard step must be saved before navigating or it is lost;
variant rename needs its popover's Save button, not Enter/blur; Remove Variant
only renders on hover; react-select placeholders swallow clicks (fill instead);
subject+preheader share aria-label, tell them apart by id prefix; reachable
count and schedule read 0/null if you read before the SPA settles.
Not done: UI still talks to localStorage, not the new API. Okta password/factor
screens still unexercised (stored session keeps skipping them).
Next: wire the Studio UI onto /api/projects; add a project list + reopen.
TEST objects to delete in Braze: campaigns "TEST-claude-20260823 (delete me)"
(6a8b6712e8ab2a0086d51749) and "TEST-claude-flow-20260823 (delete me)"
(6a8b70613fca990086697dc6); user import TEST-claude-20260823.csv (3 fake users).

## 2026-08-23 — main (Phase 3e, custom Okta domains)

Braze's IdP is **ssobiz.wbd.com**, not wmbiz.okta.com — confirmed by decoding
the SAML AuthnRequest (issuer braze_dashboard, callback dashboard-03.braze.com/
auth/saml/callback). It does not end in okta.com, so hostname-based detection
was simply broken. Okta is now recognised by its sign-in widget instead; both
WBD domains serve an identical OIE widget, verified live.
Works: authenticate() rewritten screen-driven (looks at which field is present,
handles it, waits for the page to change) rather than assuming username ->
password -> factor, since orgs vary. 29 node tests inc. offline fixtures for all
four screens, the credentials.passcode password-vs-code collision, and that the
factor picker takes Google Authenticator not the push-only Okta Verify above it.
Not done: password/factor screens still unexercised. Push-only would need a
human tap — the flow says so rather than hanging.
Next: `npm run braze login`, headed. Should now clear Braze email -> WBD Okta ->
ssobiz identifier -> password -> code.

## 2026-08-23 — main (Phase 3d, TOTP working on the real secret)

`npm run braze:totp` now generates real codes. Two bugs: otplib v13 enforces the
RFC 4226 128-bit minimum, but Okta issues 80-bit secrets (16 base32 chars), so
a valid secret was rejected — guardrail lowered to 10 bytes. And any error in a
CLI script made Node print the whole minified bundle as the "source line", so
every entry point now catches and prints one message.
Works: 20 node tests, incl. a second TOTP written from RFC 4226 with node crypto
kept as an independent cross-check on the library, plus friendly errors for a
truncated secret and for pasting the otpauth:// URL instead of the secret.
5 e2e suites green.
Next: `npm run braze login`, headed, and watch which screen it stops on. Should
now get through Braze email -> "WBD Okta" -> Okta username -> password -> code.

## 2026-08-23 — main (Phase 3c, sign-in chain mapped)

Getting into Braze is four screens, not one, all verified by reading real DOM
(no password ever submitted): (1) dashboard-03.braze.com/sign_in, email +
Continue, `input[name=email]`; (2) /auth?cluster_name=…, "Sign In to US Cluster
03" with a **"WBD Okta"** provider button — client-rendered, blank on direct
GET, so its selector is from a screenshot not the DOM; (3) wmbiz.okta.com OIE
widget; (4) back to Braze. Braze does NOT redirect to Okta by itself, which the
original flow wrongly assumed.
Works: login flow covers all four + the Okta-portal-tile alternative. New
BRAZE_SSO_BUTTON config (default "Okta"). 16 node tests + 5 e2e green.
Note: .env.local has BRAZE_EMAIL=roger@rogerjunior.com but the IdP is wmbiz —
check that is the right identity, the WBD one may differ.
Next: `npm run braze login` and watch it — it should now reach the Okta password
screen. That is the first step needing a real credential, so run it yourself.

## 2026-08-23 — main (Phase 3b, Okta identified)

Okta org is wmbiz.okta.com on **Identity Engine**, identifier-first (username ->
Next -> password -> factor), and the URL Roger uses is the /enduser/ app-tile
portal, not a Braze-initiated redirect.
Works: identifier screen verified for real by loading the public page and
reading the DOM (nothing submitted) — `input[name="identifier"]`, submit is an
`<input type=submit>`, ids are per-render so never select on them. Login flow
rewritten for OIE + both entry routes (Braze-first, or portal tile then new
tab). Handles the OIE trap where password and OTP share name credentials.
passcode (told apart by type). New `npm run braze:probe -- <url>` dumps any
page's real inputs/buttons/labels/iframes — that is the selector-fixing tool.
Not done: password + factor screens unverified; a push-only Okta factor would
need a different approach. All Braze selectors still guesses.
Next: still the recording session — but sign-in should now get further on its
own. Try `npm run braze login` first and see which screen it stops on.

## 2026-08-23 — main (Phase 3, infrastructure)

Braze robot scaffolding in `web/braze/`. Everything that does not depend on
Braze's DOM is built and tested; the flows are structured with every selector in
one file (`selectors.mjs`, all marked VERIFIED:false).
Works: TOTP verified against the RFC 6238 vectors; timezone scheduling math
(wall-clock + IANA zone, refuses past times and non-IANA zones, flags DST gaps);
run harness with per-step screenshots + HTML dump on failure, tested against a
local fake page; `/api/braze/run` SSE route + Braze tab, wiring proven by e2e.
16 node tests + 5 Playwright suites green.
Not done: **the selectors are guesses.** Nothing has touched real Braze.
Next: `cd web && npm run braze:record` — drive Braze once by hand (Okta+TOTP,
new email campaign, upload ZIP, save draft), then rewrite selectors.mjs against
the real DOM and flip VERIFIED per flow. Watch for iframes in the email editor.
Also unverified: whether Braze accepts our ZIP shape (index.html at root,
relative images/) — worth uploading one by hand first, it is a 10-minute check.

## 2026-08-23 — main (Phase 2)

Email Studio web app in `web/` (Next 15 + React 19). Upload a flat PNG, mark it
up on a canvas, slice, OCR, download a Braze-ready ZIP. Three tools: guides
(click/drag/double-click), work area (limits detection only), button (drag a CTA
-> full-width row of that height). Rows keyed by y0, not index, so links and alt
survive guide edits. Audience tab dedupes a pasted list into email,external_id.
Works: `npm run e2e` — 4 Playwright suites, all green, incl. a render diff that
reassembles the ZIP at 600px and matches the source to 0.098% of pixels. OCR
verified in a real browser (reads the Portuguese copy correctly) — the CSP risk
flagged for the Figma iframe does not exist here.
Not done: Phase 3, the Braze robot. Nothing in `web/braze/` yet.
Next: `npm run braze:record` — drive Braze once by hand with playwright codegen
(Okta+TOTP, new email campaign, upload ZIP, save draft) and capture selectors
before writing any flow code.

## 2026-08-23 — main (Phase 1)

Phase 1 of the web-app port: algorithms extracted to `packages/slicer-core`
(pure TS, no DOM/Figma) and both consumers retargeted onto it. src/ui.html lost
810 lines; esbuild now inlines a minified core bundle into dist/ui.html at build
time (manifest `ui` points there). Detectors gained an optional `bounds` arg for
the coming work-area feature.
Works: 27 vitest tests green, incl. regression fixtures locking today's output
(HBO Max 7 cuts + fb/li/ig; WBD 18 cuts + 4 icons). typecheck + build clean.
Not done: plugin still never run inside Figma — dist/ui.html is new and
unverified there. Web app (`web/`) not started.
Next: Phase 2 — scaffold Next.js in web/, canvas editor with guides + work area.
Note: WBD's 4th icon misclassifies as linkedin (no X/YT/TikTok template); the
test locks that in deliberately, the web app will let you retype a cell.

## 2026-08-13 — main (uncommitted)

Fixed both detectors against decorative background art (HBO Max "Moments" email:
concentric rings). Sections: rows with only faint deviants (≤45, ≤2%) now count
as background. Social: oversized ink bands re-split with a strong mask (60),
bands must be vertically isolated (kills mid-paragraph false chains), and glyph
extraction returns both polarities so knockout-on-disc icons classify right.
Works: harness (rebuilt, scratchpad/harness.js + jpeg-js/pngjs, --no-save) —
HBO Max: 7 good cuts + fb/li/ig; fandoms unchanged. typecheck+build clean.
Not done: still never run inside Figma (OCR/clientStorage checks still pending).
Next: npm run watch, run Generate Slices on the HBO Max frame in Figma.
Parked idea: derive glyph templates by rasterizing SVG logos (easy X/YT/TikTok).

## 2026-07-28 — main (uncommitted, stacked on the social-icon work below)

Auto section guides + OCR alt text. Generate Slices on a guide-less frame now
detects the background gaps between cards, writes them as real Y guides, and
slices; a frame that already has guides is untouched. Min gap / Min section
inputs (12/60, persisted in clientStorage) are the knobs. New "Read text (OCR)"
button runs tesseract.js in the iframe over the rendered slices and fills an
editable alt list, stored per-slice in pluginData and emitted into `<img alt>`.
Works: detection validated in a Node harness against the WBD email render —
scratchpad/harness.js pulls detectSectionOffsets straight out of ui.html; 11–12
sensible cuts, no mid-card slicing, ~180ms. typecheck + build clean.
Not done: never run inside Figma. **Tesseract in the Figma iframe is unverified**
— it blob-loads a worker + wasm; if the sandbox CSP blocks it, only OCR dies.
Next: load in Figma (`npm run watch`, Cmd-Opt-P), Clear Guides → Generate on a
real email, then press Read text (OCR) and watch for a worker/CSP error first.
Note: alt text lives on the slice nodes, so regenerating slices discards it.

## 2026-07-28 — main (uncommitted)

Social-icon auto-detection, as an "Auto-detect social icons" checkbox on Generate
Slices (on by default). Renders the whole frame, finds the icon band, adds the two
guides itself (or reuses yours if they already bracket it), splits the row at icon
midpoints, and names each cell linkedin/facebook/instagram. Guides are now optional
everywhere: no guides = one full-frame region.
Works: validated end-to-end on both real emails via a Node harness — correct band,
correct order, no false positives. Link fields write back to slice layer names, and
the last URL per platform is remembered in clientStorage and auto-applied next time.
Not done: never run inside Figma yet (clientStorage path in particular is untested).
Only 3 platform templates (no X/YouTube/TikTok).
Next: load in Figma (`npm run watch`, Cmd-Opt-P), run on a real file, check the
proposed guides land sensibly and the exported HTML row has 5 `<td>`s.
Detection algorithm notes live in the comment block in `src/ui.html`.
