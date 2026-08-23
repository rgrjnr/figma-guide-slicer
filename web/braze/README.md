# The Braze robot

Braze has no API for what this project needs, so these flows drive the dashboard
in a real Chromium. Nothing here ever sends a campaign — the flows stop at a
saved draft or a set schedule, and the send stays a human click in Braze.

## Setup

```
cp .env.example .env.local     # in web/, gitignored
```

`BRAZE_TOTP_SECRET` is the base32 string behind your Okta authenticator entry —
what you would have typed in instead of scanning the QR code. If you only ever
scanned it, re-enrol the factor and pick "can't scan" to reveal it.

Check it works before anything else:

```
npm run braze:totp    # should match your authenticator app
```

## Record before you script

**The selectors in `selectors.mjs` are unverified.** They were written from how
the dashboard is normally laid out, not from Braze's actual DOM, and several are
probably wrong. Fixing them is the first real task:

```
npm run braze:record
```

That opens Braze with the Playwright inspector attached. Do the whole flow by
hand — Okta sign-in, create the email campaign, upload the ZIP, fill the fields,
save the draft. Two things come out of it:

- **The session**, saved to `braze/.auth/state.json`, so later runs skip login.
- **The real DOM**, which is what `selectors.mjs` should be rewritten against.

Copy the inspector's script into `recordings/` for reference, but treat it as
notes rather than code: codegen emits brittle CSS selectors, and these flows
should use `getByRole` / `getByLabel` instead. Watch particularly for iframes —
the email editor is very likely one — and for lists that virtualise, which is
what usually breaks a recording played straight back.

As you confirm each flow works, flip its entry in `VERIFIED` (top of
`selectors.mjs`) to `true`. Until then every run prints a warning.

## Running

From the app: the **Braze** tab in the right-hand panel. It posts to
`/api/braze/run`, which spawns the same CLI below and streams the log back.

From the terminal, which is where you debug:

```
npm run braze login
npm run braze draft    -- --name "TEST-2026-08-23" --zip ./build.zip --subject "Hello"
npm run braze audience -- --csv ./audience.csv
npm run braze schedule -- --name "TEST-2026-08-23" --at "2026-09-01 09:30" --zone America/Sao_Paulo
```

The browser is headed by default so you can watch and take over. Set
`BRAZE_HEADLESS=1` once a flow is trusted, and `BRAZE_SLOWMO=250` to watch one
in slow motion.

## When a run breaks

Every step screenshots into `web/.runs/<runId>/`, and a failing step also dumps
the page HTML. That is the point of the harness: when Braze changes its markup
you get a picture of the page at the moment it broke instead of a bare timeout.
Look at the last screenshot, find the control that moved, fix it in
`selectors.mjs`.

## Scheduling

`sendAt` is a wall-clock time and `timeZone` an IANA name; they are never
combined into a `Date`, which would silently pick up the runner machine's zone.
`resolveSendTime` refuses a past time or a non-IANA zone, and flags a wall-clock
time that does not exist because the clocks jump over it. This is the one piece
of the robot with real unit tests (`node --test braze/`) because getting it
wrong sends an email at 3am.

`--local true` uses Braze's own "send in each user's local time zone" option
instead of one absolute instant.
