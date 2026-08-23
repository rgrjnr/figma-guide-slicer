/**
 * CLI entry point for the Braze flows.
 *
 *   node braze/run.mjs login
 *   node braze/run.mjs draft --name "TEST-2026-08-23" --zip ../build.zip --subject "Hello"
 *   node braze/run.mjs audience --csv ./audience.csv
 *   node braze/run.mjs schedule --name "TEST-2026-08-23" --at "2026-09-01 09:30" --zone America/Sao_Paulo
 *
 * Nothing here ever sends a campaign. Draft and schedule only.
 */
import { runFlow } from "./runner.mjs";
import { login } from "./flows/login.mjs";
import { createEmailDraft } from "./flows/create-email-draft.mjs";
import { importAudience } from "./flows/import-audience.mjs";
import { scheduleCampaign } from "./flows/schedule-campaign.mjs";

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
      fromAddress: args.from,
      replyTo: args["reply-to"],
      zipPath: args.zip,
    }),
  audience: ctx => importAudience(ctx, { csvPath: args.csv }),
  schedule: ctx =>
    scheduleCampaign(ctx, {
      campaignName: args.name,
      sendAt: args.at,
      timeZone: args.zone,
      localTimeDelivery: args.local === "true",
    }),
};

if (!flows[command]) {
  console.error(`Usage: node braze/run.mjs <${Object.keys(flows).join("|")}> [--flag value]`);
  process.exit(1);
}

const result = await runFlow(command, flows[command]);
if (result.ok) {
  console.log(`\nOK — artifacts in ${result.dir}`);
} else {
  console.error(`\nFAILED — ${result.error}`);
  console.error(`Artifacts in ${result.dir}`);
}
process.exit(result.ok ? 0 : 1);
