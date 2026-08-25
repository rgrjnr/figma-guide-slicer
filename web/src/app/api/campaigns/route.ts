import { billableCampaigns, listCampaigns, type CampaignFilter } from "@/lib/server/campaigns";
import type { BillingState, BrazeStatus } from "@/lib/billing";

export const runtime = "nodejs";

const BILLING_STATES: BillingState[] = ["unbilled", "invoiced", "paid"];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // `?status=billable` is the cross-axis shorthand the ledger UI actually
  // wants; anything else on `status` is a literal Braze status word, which is
  // deliberately not validated against a list because Braze may ship a new one.
  if (params.get("status") === "billable") {
    return Response.json({ campaigns: billableCampaigns() });
  }

  const filter: CampaignFilter = {};
  const status = params.get("status");
  if (status) filter.brazeStatus = status as BrazeStatus;
  const billing = params.get("billing");
  if (billing) {
    // Our own axis is a closed set, so a typo here is a caller bug and gets
    // said out loud rather than returning a plausible empty list.
    if (!BILLING_STATES.includes(billing as BillingState)) {
      return Response.json({ error: `Estado de faturamento inválido: ${billing}` }, { status: 400 });
    }
    filter.billingState = billing as BillingState;
  }
  const invoiceId = params.get("invoiceId");
  if (invoiceId) filter.invoiceId = invoiceId;

  return Response.json({ campaigns: listCampaigns(filter) });
}
