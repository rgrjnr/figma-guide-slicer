# Email Studio

Turns a flat email design into an email-safe HTML build (`index.html` + `images/`)
ready to upload to Braze, and prepares the audience CSV that goes with it.

The slicing algorithms live in `../packages/slicer-core` and are shared with the
Figma plugin in `../src`, so the two cannot drift apart.

## Running

```
npm install
npm run dev          # http://localhost:3000
npm run e2e          # browser checks, starts its own server on :3737
npm run typecheck
```

## The workflow

1. **Upload** a flat PNG/JPG of the email, exported at 1x.
2. **Mark up** with three tools:
   - *Guides* — click to add, drag to move, double-click or Backspace to remove.
     `Find sections` proposes cuts through the background gaps between cards;
     accept them individually or all at once.
   - *Work area* — drag a vertical range to restrict where the detectors look.
     It never affects the export, only detection.
   - *Button* — drag over a CTA. Only the vertical extent is used: you get a
     full-width row exactly that tall, ready for a link.

   `Find social row` locates the icon bar, splits it into one cell per icon, and
   names the platforms it recognises. Links you enter are remembered per platform
   and pre-filled next time.
3. **Slice**, optionally run OCR to fill alt text, then **Download ZIP**.

`Design width` is the width the artwork was drawn at. It defaults to the image's
own width — scale 1, which is what the detector thresholds are tuned for. Set it
to 600 for a @2x export of a 600px design and detection compensates.

## Notes

- Only linkedin, facebook and instagram have glyph templates. Anything else is
  detected as an icon but left unnamed; type the platform into the cell yourself.
- OCR only fills empty alt fields, so it never overwrites your own text.
- Settings and remembered social links persist in `localStorage`, under the same
  two keys the Figma plugin used in `clientStorage`.
