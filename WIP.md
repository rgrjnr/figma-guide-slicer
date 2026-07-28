# WIP

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
