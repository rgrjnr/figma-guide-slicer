"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DesignStep } from "@/components/steps/DesignStep";
import { DetailsStep } from "@/components/steps/DetailsStep";
import { AudienceStep } from "@/components/steps/AudienceStep";
import { SendStep, type SendSettings } from "@/components/steps/SendStep";
import { ProjectBar } from "@/components/ProjectBar";
import { buildHtml, downloadBlob, packageZip, sliceProject, type ExportedCell } from "@/lib/export";
import { processEmailContent } from "@/lib/emails";
import { readAltText } from "@/lib/ocr";
import { DEFAULT_SEND_TIME, DEFAULT_TIME_ZONE, combineSendAt, defaultSendDate, stamp } from "@/lib/defaults";
import { createProject, loadProject, saveProject } from "@/lib/projects";
import type { ProjectRecord } from "@/lib/types";
import { useProject } from "@/lib/useProject";

/** The opening line of the email, for use as preview text. */
function firstSentence(alts: string[]): string {
  for (const alt of alts) {
    const text = (alt ?? "").trim();
    // Skip logos and icon rows: a handful of characters is not a sentence.
    if (text.replace(/[^a-zA-ZÀ-ÿ]/g, "").length < 12) continue;
    return text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text;
  }
  return "";
}

const STEPS = [
  { key: "design", label: "Arte" },
  { key: "details", label: "Detalhes" },
  { key: "audience", label: "Público" },
  { key: "send", label: "Enviar ao Braze" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

export default function Page() {
  const api = useProject();
  const { project, image, regions } = api;

  const [step, setStep] = useState<StepKey>("design");
  const [record, setRecord] = useState<ProjectRecord | null>(null);
  const [dirty, setDirty] = useState(false);

  // Date-derived defaults are filled in after mount, not during render: the
  // server and the browser can compute them a moment (or a day) apart, and a
  // value that differs between the two is a hydration mismatch.
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [testEmails, setTestEmails] = useState("");
  const [audienceRaw, setAudienceRaw] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [settings, setSettings] = useState<SendSettings>({
    sendDate: "",
    sendTime: DEFAULT_SEND_TIME,
    timeZone: DEFAULT_TIME_ZONE,
  });

  useEffect(() => {
    const today = stamp();
    setCampaignName(name => name || today);
    setSegmentName(name => name || today);
    setSettings(s => (s.sendDate ? s : { ...s, sendDate: defaultSendDate() }));
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ level: "info" | "error"; message: string }[]>([]);
  const cellsRef = useRef<ExportedCell[] | null>(null);

  const audience = useMemo(() => processEmailContent(audienceRaw), [audienceRaw]);

  // Undo. Text fields keep the browser's own, which is what you expect there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === "z") { e.preventDefault(); e.shiftKey ? api.redo() : api.undo(); }
      else if (key === "y") { e.preventDefault(); api.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  useEffect(() => { setDirty(true); }, [project.guides, project.rows, project.designWidth]);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { api.setStatus("Esse arquivo não é uma imagem."); return; }
    cellsRef.current = null;
    await api.loadFile(file);
  }, [api]);

  /**
   * Slice and package on demand. Alt text is filled in by reading the artwork
   * first — it is required for accessibility and there is nothing useful for a
   * person to decide about it, so it is not worth a button of its own.
   */
  const buildZip = useCallback(async (): Promise<Blob | null> => {
    if (!image) return null;
    setBusy("draft");
    setLog(l => [...l, { level: "info", message: "recortando a arte…" }]);
    const cells = await sliceProject(project, image);

    const blank = cells.filter(c => !c.alt);
    if (blank.length) {
      setLog(l => [...l, { level: "info", message: `lendo o texto de ${blank.length} recortes…` }]);
      try {
        const found = await readAltText(blank);
        for (const cell of blank) {
          const text = found.get(cell.fileName);
          if (text) {
            cell.alt = text;
            api.updateCell(cell.rowY0, cell.cellIndex, { alt: text });
          }
        }
      } catch {
        setLog(l => [...l, { level: "info", message: "não foi possível ler o texto; seguindo sem alt" }]);
      }
    }

    cellsRef.current = cells;
    // The preview line is the first thing the artwork says, unless someone has
    // written one — there is rarely a better default and it is easy to correct.
    setPreheader(current => current || firstSentence(cells.map(c => c.alt ?? "")));
    return packageZip(buildHtml(project, cells), cells);
  }, [image, project, api]);

  const runFlow = useCallback(
    async (flow: string, extra: Record<string, unknown> = {}) => {
      setLog([{ level: "info", message: `iniciando ${flow}…` }]);
      try {
        // The manual fallback: build the ZIP and hand it over, no Braze at all.
        if (flow === "download") {
          const zip = await buildZip();
          if (!zip) throw new Error("Adicione a arte primeiro.");
          downloadBlob(zip, `${campaignName || "email"}.zip`);
          setLog(l => [...l, { level: "info", message: "baixado" }]);
          return;
        }

        // Everything is recorded against a project, so one is made on demand.
        let current = record;
        if (!current) {
          current = await createProject({ name: campaignName });
          setRecord(current);
        }

        let zipBase64: string | undefined;
        if (flow === "draft" || flow === "replace") {
          const zip = await buildZip();
          if (!zip) throw new Error("Adicione a arte primeiro.");
          const bytes = new Uint8Array(await zip.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          zipBase64 = btoa(binary);
        }
        setBusy(flow);

        const response = await fetch("/api/braze/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow,
            projectId: current.id,
            campaignId: current.braze.campaign?.id,
            campaignName, subject, preheader,
            sendAt: combineSendAt(settings.sendDate, settings.sendTime),
            timeZone: settings.timeZone,
            segment: segmentName,
            zipBase64,
            csv: flow === "audience" ? audience.csv : undefined,
            csvName: `${segmentName}.csv`,
            ...extra,
          }),
        });
        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(detail.error || "Não foi possível iniciar.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const event = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (!event || !data) continue;
            const payload = JSON.parse(data);
            if (event === "log") setLog(l => [...l, payload]);
            if (event === "done") {
              setLog(l => [...l, {
                level: payload.ok ? "info" : "error",
                message: payload.ok ? "concluído" : `falhou${payload.error ? `: ${payload.error}` : ""}`,
              }]);
              if (current) setRecord(await loadProject(current.id).catch(() => current!));
            }
          }
        }
      } catch (err) {
        setLog(l => [...l, { level: "error", message: err instanceof Error ? err.message : String(err) }]);
      } finally {
        setBusy(null);
      }
    },
    [record, campaignName, subject, preheader, settings, segmentName, audience.csv, buildZip]
  );

  const snapshot = useCallback((): Partial<ProjectRecord> => ({
    name: campaignName,
    markup: {
      imageName: project.image?.name,
      imageWidth: project.image?.width,
      imageHeight: project.image?.height,
      designWidth: project.designWidth,
      emailWidth: project.emailWidth,
      guides: project.guides,
      workArea: project.workArea,
      rows: project.rows as unknown as Record<string, unknown>,
      addFooter: project.addFooter,
      minGutter: project.minGutter,
      minSection: project.minSection,
    },
    email: { subject, preheader },
    audience: { csv: audience.csv, count: audience.valid.length, fileName: `${segmentName}.csv` },
  }), [campaignName, project, subject, preheader, audience, segmentName]);

  const handleSave = useCallback(async () => {
    try {
      const saved = record ? await saveProject(record.id, snapshot()) : await createProject(snapshot());
      setRecord(saved);
      setDirty(false);
      api.setStatus("Salvo.");
    } catch (err) {
      api.setStatus(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }, [record, snapshot, api]);

  const handleOpen = useCallback(async (id: string) => {
    try {
      const loaded = await loadProject(id);
      setRecord(loaded);
      setCampaignName(loaded.name);
      setSubject(loaded.email.subject ?? "");
      setPreheader(loaded.email.preheader ?? "");
      setAudienceRaw(loaded.audience.csv ?? "");
      if (loaded.audience.fileName) setSegmentName(loaded.audience.fileName.replace(/\.csv$/i, ""));
      api.patchProject({
        designWidth: loaded.markup.designWidth,
        emailWidth: loaded.markup.emailWidth,
        guides: loaded.markup.guides,
        workArea: loaded.markup.workArea,
        rows: loaded.markup.rows as never,
        addFooter: loaded.markup.addFooter,
      });
      setDirty(false);
      setStep("design");
      api.setStatus(image ? "Aberto." : `Aberto — adicione ${loaded.markup.imageName ?? "a arte"} novamente para ver.`);
    } catch (err) {
      api.setStatus(err instanceof Error ? err.message : "Não foi possível abrir.");
    }
  }, [api, image]);

  const index = STEPS.findIndex(s => s.key === step);
  const canAdvance = step === "design" ? !!image : true;

  return (
    <main>
      <header className="app-bar">
        <h1>Email Studio</h1>
        <ProjectBar
          project={record}
          dirty={dirty}
          onOpen={handleOpen}
          onSave={handleSave}
          onNew={() => {
            setRecord(null);
            setCampaignName(stamp());
            setSegmentName(stamp());
            setSubject(""); setPreheader(""); setTestEmails(""); setAudienceRaw("");
            cellsRef.current = null;
            setStep("design");
            api.reset();
          }}
          campaignName={campaignName}
          onCampaignName={v => { setCampaignName(v); setDirty(true); }}
        />
        <span className="spacer" />
        {image && step === "design" && (
          <span className="undo-group">
            <button className="ghost" onClick={api.undo} disabled={!api.canUndo} title="Desfazer (⌘Z)">↶</button>
            <button className="ghost" onClick={api.redo} disabled={!api.canRedo} title="Refazer (⇧⌘Z)">↷</button>
          </span>
        )}
        {busy ? <span className="busy">processando…</span> : <span className="status">{api.status}</span>}
      </header>

      <nav className="steps">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            className={`step${step === s.key ? " active" : ""}${i < index ? " done" : ""}`}
            onClick={() => setStep(s.key)}
            disabled={i > 0 && !image}
          >
            <span className="step-n">{i + 1}</span>
            {s.label}
          </button>
        ))}
      </nav>

      {step === "design" && <DesignStep api={api} onFile={onFile} />}
      {step === "details" && (
        <DetailsStep
          campaignName={campaignName}
          subject={subject}
          preheader={preheader}
          testEmails={testEmails}
          onChange={patch => {
            if (patch.campaignName !== undefined) setCampaignName(patch.campaignName);
            if (patch.subject !== undefined) setSubject(patch.subject);
            if (patch.preheader !== undefined) setPreheader(patch.preheader);
            if (patch.testEmails !== undefined) setTestEmails(patch.testEmails);
            setDirty(true);
          }}
        />
      )}
      {step === "audience" && (
        <AudienceStep
          raw={audienceRaw}
          segmentName={segmentName}
          onChange={patch => {
            if (patch.raw !== undefined) setAudienceRaw(patch.raw);
            if (patch.segmentName !== undefined) setSegmentName(patch.segmentName);
            setDirty(true);
          }}
        />
      )}
      {step === "send" && (
        <SendStep
          record={record}
          campaignName={campaignName}
          subject={subject}
          rowCount={regions.length}
          audienceCount={audience.valid.length}
          segmentName={segmentName}
          testEmails={testEmails}
          settings={settings}
          onSettings={patch => setSettings(s => ({ ...s, ...patch }))}
          busy={busy}
          onRun={runFlow}
          log={log}
        />
      )}

      <footer className="step-nav">
        <button className="ghost" onClick={() => setStep(STEPS[Math.max(0, index - 1)].key)} disabled={index === 0}>
          Voltar
        </button>
        <span className="spacer" />
        {index < STEPS.length - 1 && (
          <button className="primary" onClick={() => setStep(STEPS[index + 1].key)} disabled={!canAdvance}>
            Avançar: {STEPS[index + 1].label}
          </button>
        )}
      </footer>
    </main>
  );
}
