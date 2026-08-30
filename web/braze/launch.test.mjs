/**
 * The launch guards, offline.
 *
 * `launchBlockers` is the only thing standing between a click and mail landing
 * in thousands of inboxes, so it is a pure function and it is tested without a
 * browser. Each case here is one of the four conditions braze/SENDING.md set
 * out before this was allowed to be automated at all.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { launchBlockers } from "./flows/launch-campaign.mjs";

const ZONE = "America/New_York";
const NOW = DateTime.fromISO("2026-08-25T12:00:00Z", { zone: "utc" });

/** A campaign that is ready to go: scheduled ahead, complete, 7509 reachable. */
const good = (extra = {}) => ({
  campaignId: "6a8ca413cca04200a49d0dc2",
  name: "20260901 WBD",
  subject: "Os destaques de setembro",
  schedule: { date: "2026/09/01", time: "9:30 am" },
  reachableUsers: 7509,
  launchEnabled: true,
  ...extra,
});

const expect = (extra = {}) => ({ name: "20260901 WBD", reachable: 7509, ...extra });

const blockers = (state, expectation = expect()) =>
  launchBlockers(state, expectation, { now: NOW, zone: ZONE });

test("a complete, scheduled, matching campaign has nothing blocking it", () => {
  assert.deepEqual(blockers(good()), []);
});

test("the audience count must match the one that was confirmed", () => {
  // The load-bearing check. A segment swapped between the dialog and the click
  // is invisible in every other signal.
  const found = blockers(good({ reachableUsers: 42_000 }));
  assert.equal(found.length, 1);
  assert.match(found[0], /7509 people were confirmed.*42000/);
});

test("a missing expectation blocks, rather than being treated as no opinion", () => {
  assert.match(blockers(good(), { name: "20260901 WBD" }).join(" "), /no expected reachable-user count/);
  assert.match(blockers(good(), { reachable: 7509 }).join(" "), /no expected campaign name/);
});

test("nobody reachable is not something to send to", () => {
  const found = blockers(good({ reachableUsers: 0 }), expect({ reachable: 0 }));
  assert.match(found.join(" "), /nobody reachable/);
});

test("the campaign has to be the one that was asked for", () => {
  const found = blockers(good({ name: "20260901 WBD (cópia)" }));
  assert.equal(found.length, 1);
  assert.match(found[0], /Braze calls this campaign/);
});

test("no designated time means Launch would send immediately, so it is refused", () => {
  assert.match(blockers(good({ schedule: null })).join(" "), /would send immediately/);
  assert.match(blockers(good({ schedule: { date: "", time: "" } })).join(" "), /would send immediately/);
});

test("a send time in the past is refused", () => {
  const found = blockers(good({ schedule: { date: "2026/08/01", time: "9:30 am" } }));
  assert.equal(found.length, 1);
  assert.match(found[0], /in the past/);
});

test("a send time that cannot be read is refused rather than guessed at", () => {
  assert.match(blockers(good({ schedule: { date: "amanhã", time: "9:30 am" } })).join(" "), /could not read the send time/);
});

test("Braze's own verdict is respected: a disabled button blocks", () => {
  // It disables Launch while anything is incomplete — a missing subject is
  // enough — and it knows things this flow does not.
  assert.match(blockers(good({ launchEnabled: false })).join(" "), /disabled/);
});

test("every reason is reported at once, not one per attempt", () => {
  const found = blockers(good({ name: "outra", reachableUsers: 10, schedule: null, launchEnabled: false }));
  assert.ok(found.length >= 4, `expected several blockers, got ${JSON.stringify(found)}`);
});

test("nothing read means nothing launched", () => {
  assert.deepEqual(launchBlockers(null), ["nothing could be read from the campaign"]);
});
