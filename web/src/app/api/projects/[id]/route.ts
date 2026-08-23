import { deleteProject, getProject, updateProject } from "@/lib/server/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return Response.json({ error: "No such project" }, { status: 404 });
  return Response.json({ project });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => ({}));
  const project = updateProject(id, patch);
  if (!project) return Response.json({ error: "No such project" }, { status: 404 });
  return Response.json({ project });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  // Only the local record goes; anything in Braze is left alone deliberately.
  if (!deleteProject(id)) return Response.json({ error: "No such project" }, { status: 404 });
  return Response.json({ ok: true });
}
