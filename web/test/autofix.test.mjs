import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueFix, failureOf, isFixable, readStatus } from "../src/lib/server/autofix.mjs";
import { diffProblems, rehearsalArgs } from "../../ops/autofix/policy.mjs";

const TIMEOUT = `   run 2026-11-05T11-44-10-002Z-audience — headless, artifacts in /x
   07 choose Attributes and upload the CSV
!! 07 choose Attributes and upload the CSV — failed: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('menuitem', { name: /^Attributes$/ })
`;
const NOW = Date.parse("2026-11-05T12:00:00Z");
const runs = () => mkdtempSync(join(tmpdir(), "autofix-"));
const input = (extra = {}) => ({ flow: "audience", output: TIMEOUT, now: NOW, ...extra });

test("a selector timeout in a flow step is fixable", () => {
  const failure = failureOf(TIMEOUT);
  assert.equal(failure.step, "choose Attributes and upload the CSV");
  assert.equal(isFixable("audience", failure), true);
});

test("launch, login and login steps are never fixable", () => {
  const failure = failureOf(TIMEOUT);
  assert.equal(isFixable("launch", failure), false);
  assert.equal(isFixable("login", failure), false);
  assert.equal(isFixable("schedule", { step: "enter password", error: "Timeout 30000ms exceeded" }), false);
});

test("failures that are not page changes are not fixable", () => {
  const failure = failureOf(`!! 06 target the "x.csv" segment — failed: The campaign is not targeting "x.csv"`);
  assert.equal(isFixable("schedule", failure), false);
  assert.equal(isFixable("audience", failureOf("!! Missing BRAZE_URL")), false);
});

test("queues a job, and only one per flow and step per day", () => {
  const dir = runs();
  assert.equal(enqueueFix(dir, input()).status, "queued");
  const second = TIMEOUT.replace("11-44-10", "11-50-00");
  assert.equal(enqueueFix(dir, input({ output: second, now: NOW + 3_600_000 })), null);
  assert.equal(enqueueFix(dir, input({ output: second, now: NOW + 25 * 3_600_000 })).status, "queued");
});

test("reports a stopped worker, so the UI cannot claim a fix is under way", () => {
  const dir = runs();
  enqueueFix(dir, input());
  assert.equal(readStatus(dir, NOW).workerAlive, false);
  mkdirSync(join(dir, ".autofix"), { recursive: true });
  writeFileSync(join(dir, ".autofix", "worker.json"), JSON.stringify({ at: new Date(NOW).toISOString() }));
  const status = readStatus(dir, NOW + 1_000);
  assert.equal(status.workerAlive, true);
  assert.equal(status.jobs.length, 1, "the heartbeat is not a job");
});

test("finished jobs drop off after half an hour; active ones stay", () => {
  const dir = runs();
  enqueueFix(dir, input());
  assert.equal(readStatus(dir, NOW + 3_600_000).jobs.length, 1);
  const done = { id: "d", flow: "x", status: "deployed", createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z" };
  writeFileSync(join(dir, ".autofix", "d.json"), JSON.stringify(done));
  assert.equal(readStatus(dir, NOW + 60_000).jobs.length, 2);
  assert.equal(readStatus(dir, NOW + 3_600_000).jobs.length, 1);
});

const SELECTOR_PATCH = `--- a/web/braze/selectors.mjs
+++ b/web/braze/selectors.mjs
-    next: p => p.getByRole("button", { name: /^Next$/ }),
+    next: p => p.getByRole("button", { name: /^Continue$/ }),
`;
const SELECTORS = ["web/braze/selectors.mjs"];

test("a selector change passes the diff guard", () => {
  assert.deepEqual(diffProblems(SELECTORS, SELECTOR_PATCH), []);
  assert.deepEqual(diffProblems(["web/braze/flows/import-audience.mjs"], SELECTOR_PATCH), []);
});

test("the guard rejects files outside the allowlist and the sending flows", () => {
  for (const file of ["web/src/app/page.tsx", "ops/autofix/policy.mjs", "web/braze/runner.mjs",
    "web/braze/flows/launch-campaign.mjs", "web/braze/flows/send-test.mjs"]) {
    assert.equal(diffProblems([file], SELECTOR_PATCH).length, 1, file);
  }
  assert.equal(diffProblems([], "").length, 1);
});

test("the guard rejects sending, exfiltration and removed safety checks", () => {
  for (const added of ["launch: p => p.getByText('x'),", "await fetch(url)", "process.env.BRAZE_PASSWORD",
    "await braze.userImport.start(p).click();", "new URL('https://evil.example')"]) {
    assert.ok(diffProblems(SELECTORS, `+${added}`).length, added);
  }
  for (const removed of ["if (rehearse) {", "await assertTargets(p, segment);", "throw new Error(`x`);"]) {
    assert.ok(diffProblems(SELECTORS, `-${removed}`).length, removed);
  }
});

test("only flows with no side effects can be rehearsed, and never with a confirm", () => {
  assert.deepEqual(rehearsalArgs({ flow: "audience" }, "/a.csv"), ["audience", "--csv", "/a.csv", "--rehearse", "true"]);
  assert.deepEqual(rehearsalArgs({ flow: "refresh", campaignId: "c" }), ["refresh", "--id", "c"]);
  for (const flow of ["draft", "replace", "schedule", "test", "details", "launch", "login"]) {
    assert.equal(rehearsalArgs({ flow, campaignId: "c" }, "/a.csv"), null, flow);
  }
});
