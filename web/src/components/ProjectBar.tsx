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
        placeholder="Nome da campanha, ex. 20260901"
        title="Usado como nome da campanha no Braze e do projeto"
      />

      <button className="ghost" onClick={onSave} title={dirty ? "Alterações não salvas" : "Salvo"}>
        {project ? (dirty ? "Salvar •" : "Salvar") : "Salvar"}
      </button>
      <button className="ghost" onClick={() => setOpen(o => !o)}>Abrir</button>
      <button className="ghost" onClick={onNew}>Novo</button>

      {open && (
        <div className="project-list">
          {projects.length === 0 && <p className="hint">Nada salvo ainda.</p>}
          {projects.map(p => (
            <div key={p.id} className={`project-row${p.id === project?.id ? " current" : ""}`}>
              <button className="link-btn" onClick={() => { onOpen(p.id); setOpen(false); }}>
                {p.name}
              </button>
              <span className="dim">{p.updatedAt.slice(0, 10)}</span>
              {p.braze.campaign && <span className="badge" title="Tem campanha no Braze">braze</span>}
              <button
                className="link-btn danger"
                title="Remove só o registro local; nada é apagado no Braze"
                onClick={async () => {
                  if (!confirm(`Apagar o registro local de "${p.name}"?\n\nNada é alterado no Braze.`)) return;
                  await removeProject(p.id);
                  setProjects(await listProjects());
                }}
              >
                apagar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
