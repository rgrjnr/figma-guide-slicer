# WIP

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
