/**
 * Step 3a: drive Braze once by hand and capture what actually happens.
 *
 *   npm run braze:record
 *
 * Opens Braze in a Chromium with the Playwright inspector attached. Do the whole
 * flow you want automated — sign in through Okta, create the email campaign,
 * upload the ZIP, fill the fields, save the draft. The inspector writes a script
 * as you go; copy it into braze/recordings/ when you are done.
 *
 * Two things are captured that matter more than the generated code:
 *   - the session, into braze/.auth/state.json, so later runs skip the login;
 *   - the real DOM, so the flows can be written against selectors that exist
 *     rather than ones we guessed at.
 *
 * The generated selectors are a starting point, not the answer. Codegen emits
 * brittle CSS; the flows should prefer getByRole/getByLabel. Watch especially
 * for iframes (the email editor is almost certainly one) and for lists that
 * virtualise, which is what breaks naive recordings.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { AUTH_DIR, RECORDINGS_DIR, STORAGE_STATE, config, requireConfig } from "./config.mjs";
import { totp, totpTimeRemaining } from "./auth.mjs";

try {
  requireConfig("url");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
mkdirSync(AUTH_DIR, { recursive: true });
mkdirSync(RECORDINGS_DIR, { recursive: true });

console.log(`
Recording a Braze session
─────────────────────────
  target        ${config.url}
  session -> ${STORAGE_STATE}
  put the script you copy out of the inspector in braze/recordings/
`);

if (config.totpSecret) {
  try {
    const code = await totp();
    console.log(`  Okta code     ${code}  (valid ${totpTimeRemaining()}s — run \`npm run braze:totp\` for a fresh one)\n`);
  } catch (err) {
    console.log(`  Okta code     unavailable: ${err.message}\n`);
  }
} else {
  console.log("  BRAZE_TOTP_SECRET is not set, so you will need your authenticator app.\n");
}

const child = spawn(
  "npx",
  ["playwright", "codegen", `--save-storage=${STORAGE_STATE}`, "--target=javascript", config.url],
  { stdio: "inherit" }
);
child.on("exit", code => {
  if (code === 0) console.log(`\nSession saved to ${STORAGE_STATE}. It is gitignored.`);
  process.exit(code ?? 0);
});
