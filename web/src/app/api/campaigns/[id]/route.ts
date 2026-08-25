import { getCampaign } from "@/lib/server/campaigns";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) return Response.json({ error: "Campanha não encontrada" }, { status: 404 });
  return Response.json({ campaign });
}

/*
 * There is deliberately no PATCH here.
 *
 * A free-form billing-state endpoint has no legitimate caller — invoicing moves
 * a campaign to "invoiced" and paying an invoice moves it to "paid", both of
 * them through the invoice, which is the document the state is *about*. What it
 * does have is a way to set a paid campaign back to "unbilled" while it is
 * still a line on an issued invoice, which puts it back in "Faturáveis" to be
 * billed a second time. Corrections belong in the JSON, by hand, where they
 * leave a diff.
 */
