/**
 * CLI entry point for the Braze flows.
 *
 *   node braze/run.mjs login
 *   node braze/run.mjs draft --name "TEST-2026-08-23" --zip ../build.zip --subject "Hello"
 *   node braze/run.mjs replace  --id <campaignId> --zip ../new-build.zip --subject "..."
 *   node braze/run.mjs test     --id <campaignId> --to "a@x.com,b@x.com" [--confirm true]
 *   node braze/run.mjs audience --csv ./20260901.csv
 *   node braze/run.mjs schedule --id <campaignId> --at "2026-09-01 09:30" \
 *                               --zone America/Sao_Paulo --segment 20260901.csv
 *
 * Nothing here ever sends a campaign. Draft and schedule only.
 */
import { runFlow } from "./runner.mjs";
import { login } from "./flows/login.mjs";
import { createEmailDraft } from "./flows/create-email-draft.mjs";
import { importAudience } from "./flows/import-audience.mjs";
import { scheduleCampaign } from "./flows/schedule-campaign.mjs";
import { replaceMessage } from "./flows/replace-message.mjs";
import { refreshCampaign } from "./flows/refresh.mjs";
import { sendTest } from "./flows/send-test.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i].startsWith("--")) continue;
  args[rest[i].slice(2)] = rest[i + 1];
}

const flows = {
  login: ctx => login(ctx),
  draft: ctx =>
    createEmailDraft(ctx, {
      name: args.name,
      subject: args.subject,
      preheader: args.preheader,
      zipPath: args.zip,
    }),
  /** Swap the artwork on a campaign that already exists. */
  replace: ctx =>
    replaceMessage(ctx, {
      campaignId: args.id,
      zipPath: args.zip,
      subject: args.subject,
      preheader: args.preheader,
    }),
  /**
   * Puts real mail in a real inbox, so it needs --confirm true. Without it the
   * test is staged and left unsent.
   */
  test: ctx =>
    sendTest(ctx, {
      campaignId: args.id,
      recipients: args.to,
      confirm: args.confirm === "true",
    }),
  /** Read-only: re-read what Braze actually has, for the local record. */
  refresh: ctx => refreshCampaign(ctx, { campaignId: args.id }),
  audience: ctx =>
    importAudience(ctx, { csvPath: args.csv, createSegment: args["no-segment"] !== "true" }),
  schedule: ctx =>
    scheduleCampaign(ctx, {
      campaignId: args.id,
      sendAt: args.at,
      timeZone: args.zone,
      segment: args.segment,
      localTimeDelivery: args.local === "true",
    }),
};

if (!flows[command]) {
  console.error(`Usage: node braze/run.mjs <${Object.keys(flows).join("|")}> [--flag value]`);
  process.exit(1);
}

let result;
try {
  result = await runFlow(command, flows[command]);
} catch (err) {
  // runFlow returns failures rather than throwing, so anything reaching here is
  // a bug in the flow itself. Print the message, not the minified bundle.
  console.error(`\nFAILED — ${err.message}`);
  process.exit(1);
}

if (result.ok) {
  console.log(`\nOK — artifacts in ${result.dir}`);
} else {
  console.error(`\nFAILED — ${result.error}`);
  console.error(`Artifacts in ${result.dir}`);
}
process.exit(result.ok ? 0 : 1);
