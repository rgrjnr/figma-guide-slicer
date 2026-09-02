"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DesignStep } from "@/components/steps/DesignStep";
import { DetailsStep } from "@/components/steps/DetailsStep";
import { AudienceStep } from "@/components/steps/AudienceStep";
import { SendStep, type FlowStatus, type SendSettings } from "@/components/steps/SendStep";
import { ProjectBar } from "@/components/ProjectBar";
import { buildHtml, downloadBlob, packageZip, sliceProject, type ExportedCell } from "@/lib/export";
import { processEmailContent } from "@/lib/emails";
import { readAltText } from "@/lib/ocr";
import { DEFAULT_SEND_TIME, DEFAULT_TIME_ZONE, combineSendAt, defaultSendDate, stamp } from "@/lib/defaults";
import { createProject, loadProject, loadProjectArtwork, saveProject, saveProjectArtwork } from "@/lib/projects";
import type { ProjectRecord } from "@/lib/types";
import { useProject } from "@/lib/useProject";
import { FLOW_TOTALS, progressOf, type FlowProgress } from "@/lib/flowLabels";

/** The opening line of the email, for use as preview text. */
function firstSentence(alts: string[]): string {
  for (const alt of alts) {
    const text = (alt ?? "").trim();
    if (text.replace(/[^a-zA-ZÀ-ÿ]/g, "").length < 12) continue;
    return text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text;
  }
  return "";
}

/**
 * The steps follow the request, and the order is chosen so Braze never has to
 * be waited on: the audience arrives first and starts importing the moment the
 * person moves on to write the details; the draft is built while they review
 * the last step. By the end, the slow work is already done.
 */
const STEPS = [
  { key: "audience", label: "Público" },
  { key: "details", label: "Detalhes" },
  { key: "design", label: "Arte" },
  { key: "send", label: "Enviar ao Braze" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

/**
 * What "this design has already been pushed to Braze" means: everything that
 * would change the ZIP, the sending info or the schedule, and nothing else.
 *
 * A named function because two callers have to agree on it exactly — the one
 * that decides whether leaving Arte should run a flow, and the one that opens a
 * saved campaign and seeds it, so reopening a campaign and clicking through
 * without editing anything does not replace its message in Braze with an
 * identical one.
 */
function prepareSignature(fields: {
  guides: number[];
  rows: unknown;
  subject: string;
  preheader: string;
  designWidth: number;
  emailWidth: number;
  addFooter: boolean;
  campaignName: string;
  segmentName: string;
  sendAt: string;
  zone: string;
}): string {
  return JSON.stringify(fields);
}

export default function Page() {
  const api = useProject();
  const { project, image, regions } = api;

  const [step, setStep] = useState<StepKey>("audience");
  const [record, setRecord] = useState<ProjectRecord | null>(null);
  const recordRef = useRef<ProjectRecord | null>(null);
  recordRef.current = record;
  const [dirty, setDirty] = useState(false);

  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [testEmails, setTestEmails] = useState<string[]>([]);
  const [audienceRaw, setAudienceRaw] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [settings, setSettings] = useState<SendSettings>({
    sendDate: "",
    sendTime: DEFAULT_SEND_TIME,
    timeZone: DEFAULT_TIME_ZONE,
  });

  const [flowState, setFlowState] = useState<Record<string, FlowStatus>>({});
  // Which numbered step each flow is on, parsed from its own narration.
  const [flowProgress, setFlowProgress] = useState<Record<string, FlowProgress & { flow: string }>>({});
  const [testSentTo, setTestSentTo] = useState(0);
  const [log, setLog] = useState<{ level: "info" | "error"; message: string }[]>([]);
  const cellsRef = useRef<ExportedCell[] | null>(null);
  /**
   * Two lanes, because the two slow jobs are independent: the audience import
   * can grind through its wizard while the draft is being built. What must
   * never overlap is *login* — two runs submitting the same TOTP code — and
   * that is serialised server-side by a lock in braze/auth.mjs, not here.
   */
  const lanesRef = useRef<Record<string, Promise<unknown>>>({
    audience: Promise.resolve(),
    campaign: Promise.resolve(),
    // Test sends only read the campaign and fire a proof — they never save it —
    // so they can run beside the schedule instead of queueing behind it.
    test: Promise.resolve(),
  });
  // What was last shipped, so revisiting a step and moving on again only
  // re-runs Braze when something actually changed.
  const importedSig = useRef("");
  const preparedSig = useRef("");

  const audience = useMemo(() => processEmailContent(audienceRaw), [audienceRaw]);

  // Date-derived defaults are filled after mount: the server and the browser
  // can compute "today" differently, and that is a hydration mismatch.
  useEffect(() => {
    const today = stamp();
    setCampaignName(name => name || today);
    setSegmentName(name => name || today);
    setSettings(s => (s.sendDate ? s : { ...s, sendDate: defaultSendDate() }));
  }, []);

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

  // The visible download button is gone from the UI, but the ZIP-shape e2e
  // checks are the strongest ones there are; dev builds keep a hook for them.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as { __downloadZip?: () => void }).__downloadZip = () => void runFlow("download");
  });

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { api.setStatus("Esse arquivo não é uma imagem."); return; }
    cellsRef.current = null;
    await api.loadFile(file);
  }, [api]);

  const setFlow = useCallback((flow: string, status: FlowStatus) => {
    setFlowState(s => ({ ...s, [flow]: status }));
  }, []);

  const buildZip = useCallback(async (): Promise<Blob | null> => {
    if (!image) return null;
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
    setPreheader(current => current || firstSentence(cells.map(c => c.alt ?? "")));
    return packageZip(buildHtml(project, cells), cells);
  }, [image, project, api]);

  /** One Braze flow, streamed. Status lands in flowState under `statusKey`. */
  const runFlow = useCallback(
    async (flow: string, extra: Record<string, unknown> = {}, statusKey = flow) => {
      setFlow(statusKey, "running");
      setFlowProgress(fp => ({ ...fp, [statusKey]: { n: 0, label: "iniciando…", flow } }));
      setLog(l => [...l, { level: "info", message: `iniciando ${flow}…` }]);
      try {
        if (flow === "test") setTestSentTo(0);
        if (flow === "download") {
          const zip = await buildZip();
          if (!zip) throw new Error("Adicione a arte primeiro.");
          downloadBlob(zip, `${campaignName || "email"}.zip`);
          setFlow(statusKey, "done");
          setLog(l => [...l, { level: "info", message: "baixado" }]);
          return;
        }

        let current = recordRef.current;
        if (!current) {
          current = await createProject({ name: campaignName });
          setRecord(current);
          recordRef.current = current;
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
            segment: segmentName ? `${segmentName}.csv` : undefined,
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
        let ok = false;
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
            if (event === "log") {
              setLog(l => [...l, payload]);
              // Runner steps arrive as "NN what it is doing"; that is the gauge.
              const m = /^(\d{2}) (.+)$/.exec(String(payload.message ?? "").trim());
              if (m && !/failed/.test(m[2])) {
                setFlowProgress(fp => ({ ...fp, [statusKey]: { n: Number(m[1]), label: m[2], flow } }));
              }
            }
            if (event === "done") {
              ok = payload.ok;
              setLog(l => [...l, {
                level: payload.ok ? "info" : "error",
                message: payload.ok ? `${flow}: concluído` : `${flow}: falhou${payload.error ? ` — ${payload.error}` : ""}`,
              }]);
              const fresh = await loadProject(current.id).catch(() => current);
              setRecord(fresh);
              recordRef.current = fresh;
            }
          }
        }
        setFlow(statusKey, ok ? "done" : "failed");
        if (ok && flow === "test") {
          setTestSentTo(String(extra.recipients ?? "").split(/[\n,;]+/).filter(Boolean).length);
        }
        if (!ok) throw new Error(`${flow} falhou`);
      } catch (err) {
        setFlow(statusKey, "failed");
        setLog(l => [...l, { level: "error", message: err instanceof Error ? err.message : String(err) }]);
        throw err;
      }
    },
    [campaignName, subject, preheader, settings, segmentName, audience.csv, buildZip, setFlow]
  );

  /** Queue work on a lane; failures stay in the log, not the lane. */
  const enqueue = useCallback((lane: "audience" | "campaign" | "test", work: () => Promise<unknown>) => {
    lanesRef.current[lane] = lanesRef.current[lane].then(work).catch(() => {});
  }, []);

  /** Leaving Público: ship the list, unless the same list already went. */
  const startImportIfNeeded = useCallback(() => {
    if (audience.valid.length === 0) return;
    const sig = `${segmentName}:${audience.valid.length}:${audience.csv.length}`;
    if (importedSig.current === sig) return;
    importedSig.current = sig;
    enqueue("audience", () => runFlow("audience"));
  }, [audience, segmentName, enqueue, runFlow]);

  /** Leaving Arte: build the draft and hook it to the audience, in the background. */
  const startPrepareIfNeeded = useCallback(() => {
    if (!image || !subject) return;
    const sig = prepareSignature({
      guides: project.guides, rows: project.rows, subject, preheader,
      designWidth: project.designWidth, emailWidth: project.emailWidth,
      addFooter: project.addFooter, campaignName, segmentName,
      sendAt: combineSendAt(settings.sendDate, settings.sendTime), zone: settings.timeZone,
    });
    if (preparedSig.current === sig) return;
    preparedSig.current = sig;
    enqueue("campaign", async () => {
      await runFlow(recordRef.current?.braze.campaign ? "replace" : "draft", {}, "prepare");
      // Targeting and delivery time live on the campaign, so this is what
      // "connected to the audience" means; it saves a draft, nothing sends.
      await runFlow("schedule");
    });
  }, [image, subject, preheader, project, campaignName, segmentName, settings, enqueue, runFlow]);

  const advanceFrom = useCallback((from: StepKey) => {
    if (from === "audience") startImportIfNeeded();
    if (from === "design") startPrepareIfNeeded();
  }, [startImportIfNeeded, startPrepareIfNeeded]);

  const goToStep = useCallback((next: StepKey) => {
    setStep(current => {
      if (next !== current) advanceFrom(current);
      return next;
    });
  }, [advanceFrom]);

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
      let saved = record ? await saveProject(record.id, snapshot()) : await createProject(snapshot());

      /**
       * The artwork goes up with the first save that has one, and again
       * whenever a different file has been dropped in — compared by name and by
       * size, because those are what a project record can hold; the bytes
       * themselves are never on both sides at once to diff.
       *
       * It is a second request rather than part of the JSON so that an autosave
       * of the guides does not re-send several megabytes. If it fails the save
       * itself still stands, and the message says which half is missing.
       */
      const artwork = project.image;
      const changed =
        artwork && (saved.markup.imageFile === undefined || saved.markup.imageName !== artwork.name);
      if (artwork && changed) {
        api.setStatus("Salvando a arte…");
        saved = await saveProjectArtwork(saved.id, artwork.blob);
      }

      setRecord(saved);
      recordRef.current = saved;
      setDirty(false);
      api.setStatus("Salvo.");
    } catch (err) {
      api.setStatus(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }, [record, snapshot, project.image, api]);

  const handleOpen = useCallback(async (id: string) => {
    try {
      const loaded = await loadProject(id);
      setRecord(loaded);
      recordRef.current = loaded;
      setCampaignName(loaded.name);
      setSubject(loaded.email.subject ?? "");
      setPreheader(loaded.email.preheader ?? "");
      setAudienceRaw(loaded.audience.csv ?? "");
      const segment = loaded.audience.fileName
        ? loaded.audience.fileName.replace(/\.csv$/i, "")
        : segmentName;
      if (loaded.audience.fileName) setSegmentName(segment);

      /**
       * A campaign that already exists in Braze is reopened to be *changed*, so
       * the state it is being opened at counts as already pushed. Without this,
       * merely walking through the steps would fire `replace` — a several-minute
       * browser run that swaps the live variant for an identical one, and that
       * removes the old variant to do it.
       *
       * Only when there is a campaign: a project saved but never drafted still
       * has to be able to produce its draft by being walked through, which is
       * the only way that ever happens.
       */
      if (loaded.braze.campaign) {
        preparedSig.current = prepareSignature({
          guides: loaded.markup.guides,
          rows: loaded.markup.rows,
          subject: loaded.email.subject ?? "",
          preheader: loaded.email.preheader ?? "",
          designWidth: loaded.markup.designWidth,
          emailWidth: loaded.markup.emailWidth,
          addFooter: loaded.markup.addFooter,
          campaignName: loaded.name,
          segmentName: segment,
          sendAt: combineSendAt(settings.sendDate, settings.sendTime),
          zone: settings.timeZone,
        });
      }

      api.patchProject({
        designWidth: loaded.markup.designWidth,
        emailWidth: loaded.markup.emailWidth,
        guides: loaded.markup.guides,
        workArea: loaded.markup.workArea,
        rows: loaded.markup.rows as never,
        addFooter: loaded.markup.addFooter,
      });
      /**
       * The marks are meaningless without the art they were drawn on, so the
       * art comes back with them. `restoreImage`, not `loadFile`: the latter
       * treats a new image as a new piece of work and would reset everything
       * that was just restored above.
       *
       * A project saved before artwork was stored answers `null`, and then the
       * old instruction still applies — the file only ever existed on the
       * machine that uploaded it.
       */
      let restored = false;
      try {
        const artwork = await loadProjectArtwork(id);
        if (artwork) {
          await api.restoreImage(artwork, loaded.markup.imageName ?? "arte");
          restored = true;
        }
      } catch {
        // The record opened; only its artwork did not. Fall through to the
        // message below, which asks for the file — the same position as a
        // project that never had one stored.
      }

      setDirty(false);
      setStep("audience");
      api.setStatus(
        restored || image
          ? "Aberto."
          : `Aberto — adicione ${loaded.markup.imageName ?? "a arte"} novamente para ver.`,
      );
    } catch (err) {
      api.setStatus(err instanceof Error ? err.message : "Não foi possível abrir.");
    }
    // `segmentName` and `settings` are read for the signature above, so they
    // belong here — a stale `settings` would seed a signature the next check
    // could never match, and the guard would stop guarding.
  }, [api, image, segmentName, settings]);

  const index = STEPS.findIndex(s => s.key === step);
  const anyRunning = Object.values(flowState).some(s => s === "running");

  // What the step rail shows in place of each number: the Braze work that step
  // set in motion. Arte owns the draft+schedule chain, so it stays "running"
  // in the gap between the two.
  // Combined gauge for Arte, whose work is two flows back to back.
  const designProgress = (() => {
    const prep = flowProgress.prepare;
    const sched = flowProgress.schedule;
    const prepTotal = FLOW_TOTALS[prep?.flow ?? "draft"] ?? 8;
    const schedTotal = FLOW_TOTALS.schedule;
    const total = prepTotal + schedTotal;
    if (flowState.schedule === "running" && sched) {
      const p = progressOf("schedule", sched);
      return p ? { n: prepTotal + p.n, total, pct: Math.round(((prepTotal + p.n) / total) * 100), label: p.label } : null;
    }
    if (flowState.prepare === "running" && prep) {
      const p = progressOf(prep.flow, prep);
      return p ? { n: p.n, total, pct: Math.round((p.n / total) * 100), label: p.label } : null;
    }
    if (flowState.prepare === "done" && flowState.schedule !== "done") {
      return { n: prepTotal, total, pct: Math.round((prepTotal / total) * 100), label: "preparando o agendamento" };
    }
    return null;
  })();

  const railProgress: Partial<Record<StepKey, { pct: number; label: string } | null>> = {
    audience: flowState.audience === "running"
      ? progressOf("audience", flowProgress.audience)
      : null,
    design: designProgress,
  };

  const railStatus: Partial<Record<StepKey, FlowStatus>> = {
    audience: flowState.audience,
    design:
      flowState.prepare === "running" || flowState.schedule === "running" ? "running"
      : flowState.prepare === "failed" || flowState.schedule === "failed" ? "failed"
      : flowState.schedule === "done" ? "done"
      : flowState.prepare === "done" ? "running"
      : undefined,
  };

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
            recordRef.current = null;
            const today = stamp();
            setCampaignName(today);
            setSegmentName(today);
            setSubject(""); setPreheader(""); setTestEmails([]); setAudienceRaw("");
            setFlowState({});
            setFlowProgress({});
            setTestSentTo(0);
            setLog([]);
            importedSig.current = "";
            preparedSig.current = "";
            cellsRef.current = null;
            setStep("audience");
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
        {anyRunning ? <span className="busy">processando no Braze…</span> : <span className="status">{api.status}</span>}
      </header>

      <nav className="steps">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            className={`step${step === s.key ? " active" : ""}${i < index ? " done" : ""}`}
            onClick={() => goToStep(s.key)}
          >
            <span
              className={`step-n${railStatus[s.key] ? ` ${railStatus[s.key]}` : ""}`}
              title={railProgress[s.key]?.label}
            >
              {railStatus[s.key] === "running" ? (
                railProgress[s.key] ? (
                  <span className="step-ring" style={{ "--p": `${railProgress[s.key]!.pct}%` } as React.CSSProperties} />
                ) : <span className="step-spin" />
              ) : railStatus[s.key] === "done" ? "✓"
                : railStatus[s.key] === "failed" ? "!"
                : i + 1}
            </span>
            {s.label}
            {railStatus[s.key] === "running" && railProgress[s.key] && (
              <span className="step-doing">{railProgress[s.key]!.label}</span>
            )}
          </button>
        ))}
      </nav>

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
      {step === "details" && (
        <DetailsStep
          campaignName={campaignName}
          subject={subject}
          preheader={preheader}
          onChange={patch => {
            if (patch.campaignName !== undefined) setCampaignName(patch.campaignName);
            if (patch.subject !== undefined) setSubject(patch.subject);
            if (patch.preheader !== undefined) setPreheader(patch.preheader);
            setDirty(true);
          }}
        />
      )}
      {step === "design" && <DesignStep api={api} onFile={onFile} />}
      {step === "send" && (
        <SendStep
          record={record}
          campaignName={campaignName}
          subject={subject}
          rowCount={regions.length}
          hasImage={!!image}
          audienceCount={audience.valid.length}
          segmentName={segmentName}
          testEmails={testEmails}
          onTestEmails={setTestEmails}
          settings={settings}
          onSettings={patch => setSettings(s => ({ ...s, ...patch }))}
          flowState={flowState}
          onRun={(flow, extra) => enqueue(flow === "test" ? "test" : "campaign", () => runFlow(flow, extra))}
          flowProgress={Object.fromEntries(
            Object.entries(flowProgress).map(([k, v]) => [k, progressOf(v.flow, v)])
          )}
          testSentTo={testSentTo}
          lastError={[...log].reverse().find(l => l.level === "error")?.message ?? null}
          onLaunched={() => {
            // The launch writes launchedAt server-side; re-read so the step
            // shows it instead of offering to launch again.
            if (record) void loadProject(record.id).then(setRecord).catch(() => {});
          }}
        />
      )}

      <footer className="step-nav">
        <button className="ghost" onClick={() => goToStep(STEPS[Math.max(0, index - 1)].key)} disabled={index === 0}>
          Voltar
        </button>
        <span className="spacer" />
        {index < STEPS.length - 1 && (
          <button className="primary" onClick={() => goToStep(STEPS[index + 1].key)}>
            Avançar: {STEPS[index + 1].label}
          </button>
        )}
      </footer>
    </main>
  );
}
