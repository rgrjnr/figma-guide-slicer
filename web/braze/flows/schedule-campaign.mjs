import { braze, warnIfUnverified } from "../selectors.mjs";
import { resolveSendTime, inZone } from "../schedule.mjs";
import { login } from "./login.mjs";

/**
 * Schedule an existing draft.
 *
 * `sendAt` is a wall-clock time and `timeZone` an IANA name; they are never
 * combined into a bare Date, which would silently pick up the runner machine's
 * zone. `localTimeDelivery` sends at that wall-clock time in each recipient's
 * own zone instead of one absolute instant.
 */
export async function scheduleCampaign(ctx, { campaignName, sendAt, timeZone, localTimeDelivery = false }) {
  if (!campaignName) throw new Error("scheduleCampaign needs the campaign name");

  const when = resolveSendTime(sendAt, timeZone);
  ctx.log(`scheduling for ${when.describe()}`);
  ctx.log(`  = ${inZone(when, "UTC")} UTC · ${inZone(when, Intl.DateTimeFormat().resolvedOptions().timeZone)} here`);
  if (when.skippedByDst) {
    ctx.log(
      `${sendAt} does not exist in ${timeZone} — the clocks jump over it. Braze will be set to ${when.time}.`,
      "warn"
    );
  }

  warnIfUnverified(ctx, "scheduleCampaign");
  await login(ctx);

  await ctx.step(`open "${campaignName}"`, async p => {
    await braze.campaigns.nav(p).click();
    await braze.campaigns.search(p).fill(campaignName);
    await braze.campaigns.byName(p, campaignName).click();
    await p.waitForLoadState("networkidle");
  });

  await ctx.step("open the delivery schedule", async p => {
    await braze.schedule.tab(p).click();
    await braze.schedule.scheduledOption(p).check();
  });

  await ctx.step(`set ${when.date} ${when.time} ${when.zone}`, async p => {
    await braze.schedule.date(p).fill(when.date);
    await braze.schedule.time(p).fill(when.time);

    if (localTimeDelivery) {
      await braze.schedule.localTimeDelivery(p).check();
    } else {
      const zone = braze.schedule.timeZone(p);
      // Usually a searchable select rather than a text field.
      await zone.click();
      await zone.fill(when.zone).catch(async () => {
        await p.getByRole("option", { name: when.zone }).first().click();
      });
    }
  });

  // The dashboard restating the time is the only real confirmation that the
  // form was understood, so it is read back rather than assumed.
  const shown = await ctx.step("read back what Braze will send", async p => {
    const region = braze.schedule.tab(p).locator("xpath=ancestor::*[self::section or self::div][1]");
    return (await region.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  });
  ctx.log(`Braze shows: ${shown}`);

  await ctx.step("confirm the schedule", async p => {
    await braze.schedule.confirm(p).click();
  });

  return { scheduledFor: when.iso, utc: when.utc, zone: when.zone, localTimeDelivery, shown };
}
