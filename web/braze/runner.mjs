/**
 * Runs a flow against Braze with enough logging that a break is diagnosable.
 *
 * Braze's DOM will change; that is the standing maintenance cost of driving a
 * dashboard instead of an API. So every step screenshots and every run keeps
 * its log: when a selector goes stale you get a picture of the page at the
 * moment it happened, rather than a bare timeout.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, config, requireConfig } from "./config.mjs";
import { contextOptions, saveSession } from "./auth.mjs";

export class RunContext {
  constructor(page, dir, onEvent) {
    this.page = page;
    this.dir = dir;
    this.onEvent = onEvent;
    this.stepIndex = 0;
  }

  log(message, level = "info") {
    const line = { at: new Date().toISOString(), level, message };
    appendFileSync(join(this.dir, "run.jsonl"), JSON.stringify(line) + "\n");
    console.log(`${level === "error" ? "!!" : "  "} ${message}`);
    this.onEvent?.(line);
  }

  /**
   * Wrap each meaningful action. The screenshot is taken after the step, so a
   * failing step leaves the page exactly as the flow last saw it.
   */
  async step(name, fn) {
    const index = String(++this.stepIndex).padStart(2, "0");
    this.log(`${index} ${name}`);
    try {
      const result = await fn(this.page);
      await this.shot(`${index}-${slug(name)}`);
      return result;
    } catch (err) {
      await this.shot(`${index}-${slug(name)}-FAILED`);
      writeFileSync(join(this.dir, `${index}-${slug(name)}-FAILED.html`), await this.page.content());
      this.log(`${index} ${name} — failed: ${err.message}`, "error");
      throw err;
    }
  }

  async shot(name) {
    try {
      await this.page.screenshot({ path: join(this.dir, `${name}.png`), fullPage: false });
    } catch {
      // A screenshot failure must never mask the real error.
    }
  }
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * @param {string} name  used for the run directory
 * @param {(ctx: RunContext) => Promise<any>} flow
 */
export async function runFlow(name, flow, { onEvent, runId } = {}) {
  const id = runId || `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(name)}`;
  const dir = join(RUNS_DIR, id);

  // Setup failures (missing config, no browser installed) are ordinary results,
  // not crashes — the caller is a UI streaming this back to a person.
  let browser, context, page, ctx;
  try {
    requireConfig("url");
    mkdirSync(dir, { recursive: true });
    browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMo });
    context = await browser.newContext(contextOptions({ viewport: { width: 1600, height: 1000 } }));
    page = await context.newPage();
    ctx = new RunContext(page, dir, onEvent);
  } catch (err) {
    const line = { at: new Date().toISOString(), level: "error", message: err.message };
    console.error(`!! ${err.message}`);
    onEvent?.(line);
    if (browser) await browser.close().catch(() => {});
    return { ok: false, runId: id, dir, error: err.message };
  }

  ctx.log(`run ${id} — ${config.headless ? "headless" : "headed"}, artifacts in ${dir}`);
  page.on("pageerror", e => ctx.log(`page error: ${e.message}`, "error"));

  try {
    const result = await flow(ctx);
    // Refresh the stored session on every success, so it stays warm.
    await saveSession(context);
    ctx.log("done");
    return { ok: true, runId: id, dir, result };
  } catch (err) {
    ctx.log(err.stack || String(err), "error");
    return { ok: false, runId: id, dir, error: err.message };
  } finally {
    // Leave a headed browser open on failure so you can look at it.
    if (config.headless) await browser.close();
    else setTimeout(() => browser.close().catch(() => {}), 60_000).unref?.();
  }
}
