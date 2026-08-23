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
scanned it, re-enrol the factor and pick "can't scan" to reveal it. Only the
secret itself, not the whole `otpauth://` URL; spaces, dashes and lower case are
all fine.

Check it works before anything else:

```
npm run braze:totp    # should match your authenticator app
```

Okta issues 80-bit secrets (16 base32 characters). RFC 4226 says a secret MUST
be at least 128 bits and otplib enforces that, so the guardrail is lowered to
match what Okta actually hands out — see the note in `auth.mjs`. The generator
is checked both against the RFC reference vectors and against a second
implementation written from the RFC with node's own crypto.

## The sign-in chain

Verified by loading each page and reading its DOM — no password was ever
submitted. Getting into Braze takes four screens, not one:

1. `dashboard-03.braze.com/sign_in` — email address, then Continue.
   `input[name="email"]`, submit is `<input type="submit" value="Continue">`.
2. `/auth?cluster_name=…` — "Sign In to US Cluster 03", one button per identity
   provider. WBD's is labelled **"WBD Okta"**; `BRAZE_SSO_BUTTON` matches it by
   name. This screen is client-rendered from the previous step's state and comes
   back blank on a direct GET, so its selector is read off a screenshot rather
   than the DOM — the one part of the chain still worth confirming.
3. `ssobiz.wbd.com` — the Okta widget (below). Braze SAML-redirects here, per
   the AuthnRequest it sends: issuer `braze_dashboard`, destination
   `ssobiz.wbd.com/app/braze/…/sso/saml`, callback
   `dashboard-03.braze.com/auth/saml/callback`.
4. Back to the Braze dashboard.

**WBD has two Okta domains and neither can be detected by hostname.**
`ssobiz.wbd.com` is the IdP Braze uses; `wmbiz.okta.com` is the end-user app
portal. The first does not end in `okta.com` at all. So the flow recognises Okta
by its sign-in widget rather than its URL, which also means it keeps working if
the vanity domain changes.

Braze does **not** redirect to Okta on its own, which is what the flow originally
assumed. Steps 1 and 2 are Braze's, not Okta's.

## What is known about the sign-in

The org is **Okta Identity Engine**, not Classic, and it is identifier-first:
username -> Next -> password -> second factor. This was read off the real
`wmbiz.okta.com` widget (loading the public page and inspecting the DOM; nothing
was submitted), so the identifier screen's selectors are correct:

- the username field is `input[name="identifier"]`, labelled "Username";
- the submit is an `<input type="submit" value="Next">`, not a `<button>`;
- element ids are generated per render (`input28`, `form20`) — never select on
  them.

One OIE trap is already handled: **the password field and the one-time code
field share the name `credentials.passcode`**, on different screens. They are
told apart by type — the password is `type=password`, the code is not.

The URL you shared redirects to `/enduser/callback`, which is the Okta app-tile
portal — a second way in, separate from the chain above. The flow supports both:
it starts at `BRAZE_URL`, and if it ends up on the Okta portal rather than in
Braze it clicks the tile named by `BRAZE_APP_TILE` (default "Braze") and follows
it into the new tab.

The widget on both domains is byte-for-byte the same, so one set of selectors
covers them.

The flow is **screen-driven, not order-driven**: each pass looks at which field
is actually on the page and handles that one. Orgs vary — some ask for the
factor before the password, some skip the password, some open straight on the
code field — and a fixed sequence breaks on all of them.

Still unverified: the password and factor screens. If this org only offers a
push notification rather than a code, the flow says so explicitly and you can
approve it on your phone while it waits.

## Record before you script

**The Braze selectors in `selectors.mjs` are unverified.** They were written
from how the dashboard is normally laid out, not from Braze's actual DOM, and
several are probably wrong. Fixing them is the first real task:

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

## Fixing a selector

`npm run braze:probe -- <url>` loads a page with the stored session and prints
its real inputs, buttons, labels, tabs and iframes, then screenshots it. It
reads the DOM only — nothing is typed or submitted. This is how the Okta screen
above was verified, and it is the quickest way to fix anything that has moved.

It flags iframes specifically, because an iframe is the usual reason a
selector that looks right finds nothing: the control is in a separate document
and needs `page.frameLocator(...)`. Expect the Braze email editor to be one.

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
