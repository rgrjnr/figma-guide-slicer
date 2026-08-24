// Runs every browser check against a dev server, starting one if needed.
// Usage: npm run e2e            (starts its own server on :3737)
//        BASE_URL=… npm run e2e (reuses a server you already have running)
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3737;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SUITES = ["smoke.mjs", "links.mjs", "audience.mjs", "projects.mjs", "undo.mjs", "braze-wiring.mjs", "ocr.mjs"];

async function alive() {
  try {
    return (await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await alive())) {
  console.log(`starting dev server on :${PORT}…`);
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60 && !(await alive()); i++) await sleep(1000);
  if (!(await alive())) {
    console.error("dev server never came up");
    process.exit(1);
  }
}

const run = suite =>
  new Promise(resolve => {
    console.log(`\n${"=".repeat(60)}\n${suite}\n${"=".repeat(60)}`);
    const p = spawn("node", [`e2e/${suite}`], { stdio: "inherit", env: { ...process.env, BASE_URL } });
    p.on("exit", code => resolve(code === 0));
  });

const results = [];
for (const suite of SUITES) results.push([suite, await run(suite)]);

if (server) process.kill(-server.pid);

console.log(`\n${"=".repeat(60)}`);
for (const [suite, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${suite}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
