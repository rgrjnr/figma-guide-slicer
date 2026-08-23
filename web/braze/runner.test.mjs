// Exercises the run harness against a local page. Braze's own DOM is not needed
// to prove that steps are logged, screenshots land, and a failure leaves the
// artifacts you need to diagnose it.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { runFlow } from "./runner.mjs";

const PAGE = `<!doctype html><title>Fake</title>
  <nav><a href="#">Campaigns</a></nav>
  <button id="go">Save as Draft</button>
  <p id="out"></p>
  <script>go.onclick = () => out.textContent = "Draft saved";</script>`;

const server = createServer((_, res) => res.end(PAGE)).listen(0);
const port = server.address().port;

config.url = `http://localhost:${port}/`;
config.headless = true;

const runs = [];
test.after(() => {
  server.close();
  for (const dir of runs) rmSync(dir, { recursive: true, force: true });
});

const files = dir => readdirSync(dir);
const logLines = dir =>
  readFileSync(join(dir, "run.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));

test("a successful run logs each step and screenshots it", async () => {
  const events = [];
  const result = await runFlow(
    "happy",
    async ctx => {
      await ctx.step("open the page", p => p.goto(config.url));
      await ctx.step("click save", p => p.click("#go"));
      return ctx.step("read the confirmation", p => p.textContent("#out"));
    },
    { onEvent: e => events.push(e) }
  );
  runs.push(result.dir);

  assert.equal(result.ok, true);
  assert.equal(result.result, "Draft saved");

  const shots = files(result.dir).filter(f => f.endsWith(".png"));
  assert.deepEqual(shots.sort(), ["01-open-the-page.png", "02-click-save.png", "03-read-the-confirmation.png"]);

  const log = logLines(result.dir);
  assert.ok(log.some(l => l.message === "01 open the page"));
  assert.ok(log.some(l => l.message === "done"));
  assert.ok(events.length >= log.length - 1, "progress events are streamed to the caller");
});

test("a failing step leaves a screenshot and the page HTML", async () => {
  const result = await runFlow("sad", async ctx => {
    await ctx.step("open the page", p => p.goto(config.url));
    await ctx.step("click something that is not there", p =>
      p.click("#missing", { timeout: 1_000 })
    );
  });
  runs.push(result.dir);

  assert.equal(result.ok, false);
  assert.match(result.error, /#missing/);

  const names = files(result.dir);
  assert.ok(names.includes("02-click-something-that-is-not-there-FAILED.png"));
  assert.ok(names.includes("02-click-something-that-is-not-there-FAILED.html"));
  // The captured HTML is the real page, so you can see what was actually there.
  assert.match(readFileSync(join(result.dir, "02-click-something-that-is-not-there-FAILED.html"), "utf8"), /Save as Draft/);

  const errors = logLines(result.dir).filter(l => l.level === "error");
  assert.ok(errors.length > 0, "the failure is recorded at error level");
});

test("a run failure is returned, not thrown", async () => {
  const result = await runFlow("throws", async () => {
    throw new Error("boom");
  });
  runs.push(result.dir);
  assert.equal(result.ok, false);
  assert.equal(result.error, "boom");
});
