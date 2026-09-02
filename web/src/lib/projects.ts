"use client";

import type { ProjectRecord } from "./types";

/** Thin client over /api/projects. The JSON file behind it is the database. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return (await call<{ projects: ProjectRecord[] }>("/api/projects")).projects;
}

export async function loadProject(id: string): Promise<ProjectRecord> {
  return (await call<{ project: ProjectRecord }>(`/api/projects/${id}`)).project;
}

export async function createProject(patch: Partial<ProjectRecord>): Promise<ProjectRecord> {
  return (await call<{ project: ProjectRecord }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(patch),
  })).project;
}

export async function saveProject(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord> {
  return (await call<{ project: ProjectRecord }>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })).project;
}

export async function removeProject(id: string): Promise<void> {
  await call(`/api/projects/${id}`, { method: "DELETE" });
}

/**
 * The source artwork does not go through `call` — it is bytes, not JSON, in
 * both directions. Sent as the raw body with the file's own content type, which
 * is what the route reads to decide the extension.
 */
export async function saveProjectArtwork(id: string, file: Blob): Promise<ProjectRecord> {
  const response = await fetch(`/api/projects/${id}/artwork`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || response.statusText);
  return (body as { project: ProjectRecord }).project;
}

/**
 * The artwork back, or `null` when the project has none — which is every
 * project saved before it was stored, and is a normal answer rather than an
 * error. Anything else (a 401 from an expired session, a 500) does throw, so a
 * signed-out user is not told their design was lost.
 */
export async function loadProjectArtwork(id: string): Promise<Blob | null> {
  const response = await fetch(`/api/projects/${id}/artwork`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(response.statusText);
  return response.blob();
}
