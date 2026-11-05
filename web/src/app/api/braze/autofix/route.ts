import { join } from "node:path";
import { readStatus } from "@/lib/server/autofix.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(readStatus(join(process.cwd(), ".runs")));
}
