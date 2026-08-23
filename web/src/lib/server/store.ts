import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptySteps, type ProjectRecord } from "@/lib/types";

/**
 * A JSON file is the database. This is a local-first tool driving one team's
 * dashboard, so a file that can be read, diffed and hand-edited is worth more
 * than a real database — and it makes "the process can be edited" literally
 * true even outside the app.
 *
 * Writes go through a temp file and a rename, which is atomic on POSIX: a crash
 * mid-write leaves the previous version intact rather than a truncated file.
 */
const DATA_DIR = process.env.STUDIO_DATA_DIR || join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "projects.json");
export const ASSETS_DIR = join(DATA_DIR, "assets");

interface Database {
  version: 1;
  projects: ProjectRecord[];
}

function empty(): Database {
  return { version: 1, projects: [] };
}

function read(): Database {
  if (!existsSync(DB_PATH)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Database;
    if (!parsed || !Array.isArray(parsed.projects)) return empty();
    return parsed;
  } catch {
    // A corrupt file should not take the app down, but it must not be
    // silently overwritten either.
    const backup = `${DB_PATH}.corrupt-${Date.now()}`;
    try {
      renameSync(DB_PATH, backup);
      console.error(`projects.json was unreadable; moved to ${backup}`);
    } catch {
      /* nothing more to do */
    }
    return empty();
  }
}

function write(db: Database): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}

export function listProjects(): ProjectRecord[] {
  return read().projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): ProjectRecord | undefined {
  return read().projects.find(p => p.id === id);
}

export function createProject(partial: Partial<ProjectRecord> = {}): ProjectRecord {
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id: randomUUID(),
    name: partial.name || `Untitled ${now.slice(0, 10)}`,
    createdAt: now,
    updatedAt: now,
    markup: {
      designWidth: 600,
      emailWidth: 600,
      guides: [],
      workArea: null,
      rows: {},
      addFooter: true,
      minGutter: 12,
      minSection: 60,
      ...partial.markup,
    },
    email: { ...partial.email },
    audience: { ...partial.audience },
    braze: { ...partial.braze },
    steps: { ...emptySteps(), ...partial.steps },
  };
  const db = read();
  db.projects.push(project);
  write(db);
  return project;
}

/**
 * Merge a patch into a project. Nested objects are merged one level deep so a
 * caller can update `braze.campaign` without having to resend `braze.segment` —
 * a whole-object replace would quietly drop links recorded by another step.
 */
export function updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord | undefined {
  const db = read();
  const index = db.projects.findIndex(p => p.id === id);
  if (index < 0) return undefined;

  const current = db.projects[index];
  const merged: ProjectRecord = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    markup: { ...current.markup, ...patch.markup },
    email: { ...current.email, ...patch.email },
    audience: { ...current.audience, ...patch.audience },
    braze: { ...current.braze, ...patch.braze },
    steps: { ...current.steps, ...patch.steps },
  };
  db.projects[index] = merged;
  write(db);
  return merged;
}

export function deleteProject(id: string): boolean {
  const db = read();
  const next = db.projects.filter(p => p.id !== id);
  if (next.length === db.projects.length) return false;
  write({ ...db, projects: next });
  return true;
}

/** Where a project's ZIP and CSV live. Kept out of the JSON to stay readable. */
export function assetDir(projectId: string): string {
  const dir = join(ASSETS_DIR, projectId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
