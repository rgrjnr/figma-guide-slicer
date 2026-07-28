# WIP

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
