"use client";

import { useEffect, useState } from "react";
import { listProjects, removeProject } from "@/lib/projects";
import type { ProjectRecord } from "@/lib/types";

interface Props {
  project: ProjectRecord | null;
  dirty: boolean;
  onOpen: (id: string) => void;
  onSave: () => void;
  onNew: () => void;
  campaignName: string;
  onCampaignName: (value: string) => void;
}

export function ProjectBar({ project, dirty, onOpen, onSave, onNew, campaignName, onCampaignName }: Props) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) listProjects().then(setProjects).catch(() => setProjects([]));
  }, [open, project?.updatedAt]);

  return (
    <div className="project-bar">
      <input
        className="campaign-name"
        value={campaignName}
        onChange={e => onCampaignName(e.target.value)}
        placeholder="Campaign name, e.g. 20260901"
        title="Used as the Braze campaign name and the project name"
      />

      <button className="ghost" onClick={onSave} title={dirty ? "Unsaved changes" : "Saved"}>
        {project ? (dirty ? "Save •" : "Save") : "Save"}
      </button>
      <button className="ghost" onClick={() => setOpen(o => !o)}>Open</button>
      <button className="ghost" onClick={onNew}>New</button>

      {open && (
        <div className="project-list">
          {projects.length === 0 && <p className="hint">Nothing saved yet.</p>}
          {projects.map(p => (
            <div key={p.id} className={`project-row${p.id === project?.id ? " current" : ""}`}>
              <button className="link-btn" onClick={() => { onOpen(p.id); setOpen(false); }}>
                {p.name}
              </button>
              <span className="dim">{p.updatedAt.slice(0, 10)}</span>
              {p.braze.campaign && <span className="badge" title="Has a Braze campaign">braze</span>}
              <button
                className="link-btn danger"
                title="Removes the local record only; anything in Braze is left alone"
                onClick={async () => {
                  if (!confirm(`Delete the local record for "${p.name}"?\n\nNothing in Braze is touched.`)) return;
                  await removeProject(p.id);
                  setProjects(await listProjects());
                }}
              >
                delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
