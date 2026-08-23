// Credentials come from web/.env.local, which is gitignored. Nothing in this
// directory ever writes a secret to disk except the Playwright storageState,
// which lives in braze/.auth/ and is also gitignored.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = join(here, "..");
export const AUTH_DIR = join(here, ".auth");
export const STORAGE_STATE = join(AUTH_DIR, "state.json");
export const RECORDINGS_DIR = join(here, "recordings");
export const RUNS_DIR = join(WEB_ROOT, ".runs");

function loadEnvFile() {
  const path = join(WEB_ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvFile();

export const config = {
  url: process.env.BRAZE_URL || "",
  /**
   * The Okta org, e.g. https://wmbiz.okta.com. Only needed for the portal-first
   * path: sign into Okta, then click the Braze tile. If Braze redirects you to
   * Okta by itself, BRAZE_URL alone is enough.
   */
  oktaUrl: process.env.BRAZE_OKTA_URL || "",
  /** Accessible name of the Braze tile on the Okta dashboard. */
  appTile: process.env.BRAZE_APP_TILE || "Braze",
  /** The identity-provider button on Braze's cluster sign-in screen. */
  ssoButton: process.env.BRAZE_SSO_BUTTON || "Okta",
  email: process.env.BRAZE_EMAIL || "",
  password: process.env.BRAZE_PASSWORD || "",
  totpSecret: process.env.BRAZE_TOTP_SECRET || "",
  /** Watch the robot work. Set BRAZE_HEADLESS=1 once a flow is trusted. */
  headless: process.env.BRAZE_HEADLESS === "1",
  slowMo: Number(process.env.BRAZE_SLOWMO || 0),
};

export function requireConfig(...keys) {
  const missing = keys.filter(k => !config[k]);
  if (missing.length) {
    const names = missing.map(k => `BRAZE_${k.replace(/([A-Z])/g, "_$1").toUpperCase()}`);
    throw new Error(
      `Missing ${names.join(", ")} — copy web/.env.example to web/.env.local and fill it in.`
    );
  }
  return config;
}
