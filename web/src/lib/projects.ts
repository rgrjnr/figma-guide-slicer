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
