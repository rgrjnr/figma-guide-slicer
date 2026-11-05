#!/usr/bin/env node
/**
 * Host worker for the auto-fix. The app queues failed runs on the runs volume;
 * this picks them up one at a time and lets Claude fix the code with file tools
 * only. It then checks the diff against policy.mjs, rehearses on the live page
 * without side effects, and pushes to main, which Coolify deploys. Anything it
 * cannot prove goes to a PR or to a person. It never retries the failed run.
 *
 *   node ops/autofix/worker.mjs
 *   node ops/autofix/worker.mjs --dry-run <runId> --flow audience --step "..." --base <commit>
 *
 * A dry run stops before anything leaves this machine and writes no job status.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { diffProblems, fixPrompt, rehearsalArgs } from "./policy.mjs";

const REPO = process.env.AUTOFIX_REPO || "/srv/spicy/repo";
const CONTAINER_PREFIX = process.env.AUTOFIX_CONTAINER || "xvxdk05oefmpo751rvbl230h";
const MODEL = "claude-opus-5-5";
const WORKTREES = join(homedir(), ".cache", "spicy-autofix");
const APP = "/app/web";
const QUEUE = `${APP}/.runs/.autofix`;

const POLL_MS = 15_000;
const HEARTBEAT_MS = 20_000;
const MINUTE = 60_000;

const log = message => console.log(`${new Date().toISOString()} ${message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, { cwd, input, timeout = 5 * MINUTE } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, timeout, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args[0]} exited ${code}: ${(stderr || stdout).trim().slice(-800)}`));
    });
    child.stdin.end(input ?? "");
  });
}

const git = (cwd, ...args) => run("git", args, { cwd });

/** Looked up every time, because a deploy replaces the container. */
async function container() {
  const names = await run("docker", ["ps", "--filter", `name=^${CONTAINER_PREFIX}`, "--format", "{{.Names}}"]);
  const name = names.split("\n").find(Boolean);
  if (!name) throw new Error("the app container is not running");
  return name;
}

const exec = async (args, options) => run("docker", ["exec", ...args.slice(0, -1), await container(), ...args.at(-1)], options);

async function writeQueueFile(name, content) {
  await exec(["-i", ["sh", "-c", `mkdir -p ${QUEUE} && cat > ${QUEUE}/.${name}.tmp && mv ${QUEUE}/.${name}.tmp ${QUEUE}/${name}`]], { input: content });
}

/** Status reaches the UI through this, so it rides out a deploy's restart. */
async function publish(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  log(`${job.id}: ${job.status}${job.message ? ` — ${job.message}` : ""}`);
  if (job.dryRun) return;
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeQueueFile(`${job.id}.json`, JSON.stringify(job));
    } catch (err) {
      if (attempt >= 20) throw err;
      await sleep(30_000);
    }
  }
}

async function readJobs() {
  const out = await exec([["sh", "-c", `cd ${QUEUE} 2>/dev/null && for f in *.json; do [ "$f" = worker.json ] || { [ -f "$f" ] && cat "$f" && echo; }; done; true`]]);
  return out.split("\n").filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

async function fetchArtifacts(job, dir) {
  const runDir = `${APP}/.runs/${job.id}`;
  const names = (await exec([["ls", runDir]])).split("\n").filter(name => name === "run.jsonl" || /FAILED\.(html|png)$/.test(name));
  for (const name of names) await run("docker", ["cp", `${await container()}:${runDir}/${name}`, join(dir, name)]);
}

async function askClaude(job, cwd, artifacts) {
  const tools = "Read,Edit,Glob,Grep";
  // File tools and no MCP servers: page content reaches this session, so it gets
  // no shell, no network and none of the connectors on this account.
  const out = await run("claude", [
    "-p", fixPrompt(job, artifacts),
    "--model", MODEL,
    "--tools", tools,
    "--allowedTools", tools,
    "--permission-mode", "acceptEdits",
    "--add-dir", artifacts,
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "project",
    "--no-session-persistence",
    "--output-format", "json",
  ], { cwd, timeout: 15 * MINUTE });
  return String(JSON.parse(out).result ?? "").trim();
}

/** The worktree's flows, in a throwaway folder in the container, on the live page. */
async function rehearse(job, cwd) {
  const dir = `${APP}/.runs/.autofix-rehearse/${job.id}`;
  const csv = `${dir}/autofix-rehearsal.csv`;
  const args = rehearsalArgs(job, csv);
  const name = await container();
  await exec([["mkdir", "-p", dir]]);
  try {
    const tar = await new Promise((resolve, reject) => {
      const chunks = [];
      const child = spawn("tar", ["-C", join(cwd, "web"), "--exclude=.auth", "--exclude=recordings", "-cf", "-", "braze"]);
      child.stdout.on("data", chunk => chunks.push(chunk));
      child.on("error", reject);
      child.on("close", code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`tar exited ${code}`))));
    });
    await run("docker", ["exec", "-i", name, "tar", "-C", dir, "-xf", "-"], { input: tar });
    await exec([["ln", "-s", `${APP}/braze/.auth`, `${dir}/braze/.auth`]]);
    await exec(["-i", ["sh", "-c", `cat > ${csv}`]], { input: "email,external_id\nrehearsal@example.invalid,rehearsal@example.invalid\n" });
    return await run("docker", ["exec", "-w", dir, name, "node", "braze/run.mjs", ...args], { timeout: 6 * MINUTE });
  } finally {
    await exec([["rm", "-rf", dir]]).catch(err => log(`could not clean ${dir}: ${err.message}`));
  }
}

async function openPr(job, cwd, branch, why) {
  await git(cwd, "push", "-u", "origin", branch);
  const body = `The auto-fix proposed this for a failed \`${job.flow}\` run but did not deploy it.\n\n` +
    `**Failed step:** ${job.step}\n**Why it needs a person:** ${why}\n**Claude's note:** ${job.message ?? ""}\n\n` +
    `🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
  const out = await run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `Auto-fix: ${job.flow} — ${job.step}`, "--body", body], { cwd });
  return out.trim().split("\n").pop();
}

async function waitForIdleApp() {
  const deadline = Date.now() + 30 * MINUTE;
  while (Date.now() < deadline) {
    const procs = await exec([["ps", "-eo", "args"]]);
    if (!procs.includes("braze/run.mjs")) return;
    await sleep(30_000);
  }
  throw new Error("a flow was still running after 30 minutes, so deploying would have killed it");
}

async function waitForDeploy(sha) {
  const deadline = Date.now() + 15 * MINUTE;
  while (Date.now() < deadline) {
    const images = await run("docker", ["ps", "--filter", `name=^${CONTAINER_PREFIX}`, "--format", "{{.Image}}"]);
    if (images.includes(sha)) return true;
    await sleep(20_000);
  }
  return false;
}

async function ship(job, cwd, note) {
  await git(cwd, "fetch", "origin", "main");
  await git(cwd, "rebase", "origin/main");
  const wip = join(cwd, "WIP.md");
  const entry = `## ${new Date().toISOString().slice(0, 10)} — main — auto-fix: ${job.flow}, "${job.step}"\n\n` +
    `${note}\nRehearsed on the live page, then pushed by ops/autofix/worker.mjs. Run: ${job.id}.\n` +
    `**Next step:** retry the failed flow in the app.\n\n`;
  writeFileSync(wip, entry + readFileSync(wip, "utf8"));
  await git(cwd, "add", "WIP.md");
  await git(cwd, "commit", "--amend", "--no-edit");
  const sha = (await git(cwd, "rev-parse", "HEAD")).trim();
  await git(cwd, "push", "origin", "HEAD:main");
  return sha;
}

async function processJob(job, base = "origin/main") {
  const worktree = join(WORKTREES, job.id);
  const branch = `claude/autofix-${job.id.slice(0, 19).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${job.flow}`;
  const artifacts = mkdtempSync(join(tmpdir(), "spicy-autofix-"));
  mkdirSync(WORKTREES, { recursive: true });

  try {
    await publish(job, { status: "fixing" });
    await git(REPO, "fetch", "origin", "main");
    await git(REPO, "worktree", "add", "-b", branch, worktree, base);
    await fetchArtifacts(job, artifacts);

    const note = await askClaude(job, worktree, artifacts);
    job.message = note.slice(0, 500);

    const files = (await git(worktree, "status", "--porcelain")).split("\n").filter(Boolean).map(line => line.slice(3));
    const patch = await git(worktree, "diff");
    if (files.length === 0) return await publish(job, { status: "failed" });
    const problems = diffProblems(files, patch);
    if (problems.length) return await publish(job, { status: "failed", message: `Rejected: ${problems.join("; ")}`.slice(0, 500) });

    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-m", `Auto-fix ${job.flow}: ${job.step}\n\n${note}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
    if (job.dryRun) log(`diff:\n${patch}`);

    if (!rehearsalArgs(job, "x")) {
      if (job.dryRun) return log("dry run: this flow cannot be rehearsed, would open a PR");
      return await publish(job, { status: "review", pr: await openPr(job, worktree, branch, "this flow cannot be run without changing Braze") });
    }

    await publish(job, { status: "testing" });
    symlinkSync(join(REPO, "web", "node_modules"), join(worktree, "web", "node_modules"));
    await run("node", ["--test", "braze/launch.test.mjs", "braze/schedule.test.mjs"], { cwd: join(worktree, "web") });
    try {
      const output = await rehearse(job, worktree);
      log(`rehearsal output:\n${output}`);
    } catch (err) {
      const why = `the rehearsal failed: ${err.message}`.slice(0, 400);
      if (job.dryRun) return log(`dry run: ${why}`);
      return await publish(job, { status: "failed", pr: await openPr(job, worktree, branch, why) });
    }
    if (job.dryRun) return log("dry run: rehearsal passed, would push to main");

    await publish(job, { status: "deploying" });
    await waitForIdleApp();
    const sha = await ship(job, worktree, note);
    const live = await waitForDeploy(sha);
    await publish(job, live
      ? { status: "deployed", commit: sha }
      : { status: "failed", commit: sha, message: `Pushed ${sha}, but the new version did not go live within 15 minutes.` });
  } catch (err) {
    log(`${job.id}: ${err.stack || err}`);
    if (job.dryRun) throw err;
    await publish(job, { status: "failed", message: String(err.message).slice(0, 500) });
  } finally {
    rmSync(artifacts, { recursive: true, force: true });
    if (existsSync(worktree)) await git(REPO, "worktree", "remove", "--force", worktree).catch(err => log(err.message));
    await git(REPO, "branch", "-D", branch).catch(() => {});
  }
}

async function main() {
  // Whatever was in progress died with the last worker; do not leave it claiming otherwise.
  for (const job of await readJobs()) {
    if (["fixing", "testing", "deploying"].includes(job.status)) {
      await publish(job, { status: "failed", message: "The auto-fix worker restarted during this job." });
    }
  }
  const beat = () => writeQueueFile("worker.json", JSON.stringify({ at: new Date().toISOString() })).catch(err => log(`heartbeat: ${err.message}`));
  void beat();
  setInterval(beat, HEARTBEAT_MS);

  for (;;) {
    try {
      const queued = (await readJobs()).filter(job => job.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (queued[0]) await processJob(queued[0]);
    } catch (err) {
      log(`poll: ${err.message}`);
    }
    await sleep(POLL_MS);
  }
}

const { values } = parseArgs({
  options: { "dry-run": { type: "string" }, flow: { type: "string" }, step: { type: "string" }, error: { type: "string" }, base: { type: "string" } },
});

if (values["dry-run"]) {
  await processJob({
    id: values["dry-run"], flow: values.flow, step: values.step, error: values.error ?? "", campaignId: null, dryRun: true,
  }, values.base ?? "origin/main");
} else {
  await main();
}
