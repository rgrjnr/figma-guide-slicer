import { BillingError, createInvoice, listInvoices } from "@/lib/server/invoices";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ invoices: listInvoices() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    campaignIds?: string[];
    rate?: number;
    qty?: Record<string, number>;
  };

  try {
    const invoice = createInvoice(body.campaignIds || [], { rate: body.rate, qty: body.qty });
    return Response.json({ invoice }, { status: 201 });
  } catch (err) {
    // Every refusal here is a rule the caller broke — an already-invoiced
    // campaign, a campaign Braze still has running — so it is a 409 with the
    // message shown to the user, not a 500.
    if (err instanceof BillingError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
