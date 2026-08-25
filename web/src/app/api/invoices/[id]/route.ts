import { getInvoice, markPaid } from "@/lib/server/invoices";
import { listCampaigns } from "@/lib/server/campaigns";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const invoice = getInvoice(id);
  if (!invoice) return Response.json({ error: "Fatura não encontrada" }, { status: 404 });
  // The printable page wants the thumbnails and the live Braze status, which
  // live on the campaign and deliberately not on the frozen invoice line.
  return Response.json({ invoice, campaigns: listCampaigns({ invoiceId: id }) });
}

/** The only transition a client may ask for is issued -> paid. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { state?: string; paidAt?: string };

  if (body.state !== "paid") {
    return Response.json({ error: 'Só é possível marcar a fatura como "paid"' }, { status: 400 });
  }

  const invoice = markPaid(id, body.paidAt);
  if (!invoice) return Response.json({ error: "Fatura não encontrada" }, { status: 404 });
  return Response.json({ invoice });
}
