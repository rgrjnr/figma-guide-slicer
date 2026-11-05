/**
 * The app's half of the auto-fix: decide whether a failed run is worth fixing,
 * queue it, and read back how it is going. The host worker in ops/autofix does
 * the fixing and writes status into the same JSON files, which live on the runs
 * volume so they survive the deploy a fix causes.
 *
 * Plain ESM so `node --test` can import it without a compile step.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = ".autofix";
const HEARTBEAT = "worker.json";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORKER_ALIVE_MS = 90_000;
/** Long enough to read the outcome, short enough not to haunt the next campaign. */
const SHOW_FINISHED_MS = 30 * 60 * 1000;

const ACTIVE = new Set(["queued", "fixing", "testing", "deploying"]);

/** Launch is the send, and repeated login attempts can lock the account. */
const NEVER_FIX = new Set(["launch", "login"]);
const LOGIN_STEP =
  /^(open the entry point|wait for the login|enter the email|enter username|enter password|enter the one-time code|choose the .* identity provider|choose the code authenticator)/;
/** What a stale selector looks like. Bad data and Braze's own errors do not match. */
const PAGE_CHANGED = /Timeout \d+ms exceeded|waiting for (locator|getBy)/;

/** The step that failed, from the runner's "NN step — failed: why" log line. */
export function failureOf(output) {
  const lines = String(output ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/(\d{2}) (.+?) — failed: (.*)$/);
    if (match) {
      return { step: match[2], error: lines.slice(i, i + 3).join(" ").replace(/^\W+/, "").slice(0, 500), why: match[3] };
    }
  }
  return null;
}

export function isFixable(flow, failure) {
  if (!failure || NEVER_FIX.has(flow) || LOGIN_STEP.test(failure.step)) return false;
  return PAGE_CHANGED.test(failure.error);
}

function readJobs(runsDir) {
  const dir = join(runsDir, DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith(".json") && name !== HEARTBEAT)
    .flatMap(name => {
      try {
        return [JSON.parse(readFileSync(join(dir, name), "utf8"))];
      } catch {
        return []; // Caught mid-write; the next poll reads it.
      }
    });
}

/**
 * Queue a fix for a failed run, or return null when it should not get one. One
 * job per flow and step per day: if a fix did not hold, a person needs to look,
 * and retrying would just deploy guesses in a loop.
 */
export function enqueueFix(runsDir, { flow, output, campaignId, now = Date.now() }) {
  const failure = failureOf(output);
  if (!isFixable(flow, failure)) return null;
  const runId = String(output).match(/run (\S+) —/)?.[1];
  if (!runId) return null;

  const recent = readJobs(runsDir).some(
    job => job.flow === flow && job.step === failure.step && now - Date.parse(job.createdAt) < COOLDOWN_MS
  );
  if (recent) return null;

  const at = new Date(now).toISOString();
  const job = {
    id: runId, flow, step: failure.step, error: failure.error, campaignId: campaignId ?? null,
    status: "queued", createdAt: at, updatedAt: at,
  };
  mkdirSync(join(runsDir, DIR), { recursive: true });
  writeFileSync(join(runsDir, DIR, `${runId}.json`), JSON.stringify(job));
  return job;
}

/** What the UI shows: anything active, plus outcomes from the last half hour. */
export function readStatus(runsDir, now = Date.now()) {
  let heartbeat = 0;
  try {
    heartbeat = Date.parse(JSON.parse(readFileSync(join(runsDir, DIR, HEARTBEAT), "utf8")).at);
  } catch {
    /* never started */
  }
  const jobs = readJobs(runsDir)
    .filter(job => ACTIVE.has(job.status) || now - Date.parse(job.updatedAt) < SHOW_FINISHED_MS)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { workerAlive: now - heartbeat < WORKER_ALIVE_MS, jobs };
}
