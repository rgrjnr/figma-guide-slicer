# WIP

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
