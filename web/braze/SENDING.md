# Sending

**One flow in this project sends a campaign: `launch`.** Every other flow stops
at a saved draft with the schedule and audience set.

`launch` was added on 2026-08-25, at Roger's request, and it implements the
conditions this file already set out for automating the send — they are in
`launchBlockers` in `braze/flows/launch-campaign.mjs`, as a pure function with
its own offline tests in `braze/launch.test.mjs`. The decision is still a human
one: the flow reads the campaign, a person is shown the audience size, subject
and send time, and only an explicit confirmation carries those numbers back
down for the flow to verify before it clicks.

## What was verified

A real campaign was driven end to end on 2026-08-23 against
`dashboard-03.braze.com`, workspace *WMforBrands Brazil*: composed from a ZIP,
subject and preheader set, scheduled, targeted at a segment, saved as a draft.
`Launch Campaign` was deliberately never clicked.

## The send step

On the campaign's **Review Summary** step (`…&page=4`), the bottom bar has two
buttons: `Save Draft` and `Launch Campaign`.

`Launch Campaign` is greyed out until the campaign is complete — a missing
subject line alone is enough to keep it disabled, and Braze shows a "Fix issue"
link on the compose step. Once everything is filled in it becomes enabled, and
it is the only control that commits the campaign.

What it does depends on the delivery settings already saved:

| Schedule step setting | Effect of Launch Campaign |
|---|---|
| Send as soon as Campaign is launched | Sends **immediately** to the whole target segment. |
| Send at a designated time | Schedules it; Braze sends unattended at that time. |
| Intelligent Timing | Schedules per user, at each one's predicted best time. |

So on a campaign this project has prepared, launching schedules the send rather
than firing it — but that is a property of the saved settings, not of the
button. Check the Review page says what you expect before clicking.

## Doing it by hand

1. `npm run braze draft …` and `npm run braze schedule …`, or open the draft
   from the campaigns list.
2. Open the campaign and go to **5 Review Summary**.
3. Check the four cards — Messages, Delivery, Target Audience, Conversion
   Events — and the "Reachable users is N" banner. That count is the number of
   people who will receive it.
4. Use **Preview and test** on the compose step to send yourself a proof first.
5. Click **Launch Campaign**.

## Doing it from the app

The **Lançar campanha** button on the Envio step opens a dialog that reads the
campaign live — reachable users, subject, send date — and confirming it runs the
same flow again with those values as expectations.

    npm run braze -- launch --id <campaignId>                    # read only
    npm run braze -- launch --id <campaignId> --confirm true \
      --expect-name "20260901 WBD" --expect-reachable 7509       # sends

Without `--confirm true` nothing is clicked. With it, and without the two
`--expect-*` values, the flow refuses: the guards are not optional, because
their whole purpose is comparing against numbers a person actually looked at.

## The conditions it enforces

These were written before the flow existed; it implements them literally.
Anything that clicks that button must at minimum:

- refuse to run unless the campaign's schedule is a designated future time;
- read back the reachable-user count and require it to match an expected value
  passed in by the caller, so a mis-targeted segment cannot go out unnoticed;
- refuse on any campaign whose name does not match the one asked for;
- log the resolved send time in both the workspace zone and UTC before acting.

The audience count is the load-bearing check. A wrong segment is the failure
that actually costs something, and it is invisible in every other signal.
