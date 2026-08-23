import { createProject, listProjects } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json({ project: createProject(body) }, { status: 201 });
}
