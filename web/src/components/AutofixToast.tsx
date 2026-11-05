"use client";

import { useEffect, useState } from "react";
import { translateStep } from "@/lib/flowLabels";
import type { AutofixJob, AutofixStatus } from "@/lib/server/autofix.mjs";

const POLL_MS = 10_000;

const LABEL: Record<AutofixStatus, string> = {
  queued: "Na fila",
  fixing: "Corrigindo",
  testing: "Testando",
  deploying: "Publicando",
  deployed: "Publicado",
  review: "Precisa de revisão",
  failed: "Precisa do Roger",
};

const DETAIL: Record<AutofixStatus, string> = {
  queued: "O Claude vai tentar corrigir esta falha automaticamente.",
  fixing: "O Claude está lendo o erro e corrigindo o código.",
  testing: "O Claude está testando a correção no Braze, sem importar nem enviar nada.",
  deploying: "A correção passou no teste e está sendo publicada.",
  deployed: "Correção publicada. Pode tentar de novo.",
  review: "O Claude propôs uma correção, mas ela não pode ser testada sem alterar o Braze. O Roger precisa revisar.",
  failed: "O Claude não conseguiu corrigir sozinho. Avise o Roger.",
};

const PILL: Record<AutofixStatus, string> = {
  queued: "running", fixing: "running", testing: "running", deploying: "running",
  deployed: "done", review: "failed", failed: "failed",
};

const isActive = (status: AutofixStatus) => PILL[status] === "running";

/** Mounted in the layout, because a flow can fail while any page is open. */
export function AutofixToast() {
  const [jobs, setJobs] = useState<AutofixJob[]>([]);
  const [workerAlive, setWorkerAlive] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/braze/autofix", { cache: "no-store" });
        if (!response.ok || stopped) return; // Signed out: nothing to show.
        const status = await response.json();
        setJobs(status.jobs);
        setWorkerAlive(status.workerAlive);
      } catch {
        /* A deploy restarts the app; the next poll catches up. */
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const visible = jobs.filter(job => !dismissed.includes(job.id));
  if (visible.length === 0) return null;

  return (
    <div className="autofix-toasts" role="status">
      {visible.map(job => {
        const stalled = isActive(job.status) && !workerAlive;
        const pill = stalled ? "failed" : PILL[job.status];
        return (
          <div key={job.id} className="autofix-toast">
            <div className="autofix-head">
              <strong>Falha em “{translateStep(job.step)}”</strong>
              <span className={`status-pill ${pill}`}>{stalled ? "Parado" : LABEL[job.status]}</span>
              {!isActive(job.status) && (
                <button
                  className="autofix-close"
                  aria-label="Fechar"
                  onClick={() => setDismissed(ids => [...ids, job.id])}
                >
                  ×
                </button>
              )}
            </div>
            <p>
              {stalled
                ? "A correção automática está fora do ar, então ninguém está cuidando desta falha. Avise o Roger."
                : DETAIL[job.status]}
            </p>
            {job.pr && <a href={job.pr} target="_blank" rel="noreferrer">Ver a correção proposta</a>}
          </div>
        );
      })}
    </div>
  );
}
