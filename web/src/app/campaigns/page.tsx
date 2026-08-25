"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CampaignTable } from "@/components/CampaignTable";
import { isBillable, type CampaignRecord } from "@/lib/billing";
import { runBrazeFlow, type FlowLogLine } from "@/lib/brazeRun";
import { progressOf, type FlowProgress } from "@/lib/flowLabels";

/**
 * The ledger. Its job is to answer one question — what has been sent and not
 * yet charged for — so "Faturáveis" is what it opens on, and the two axes of
 * PLAN-BILLING (Braze's status, our billing state) get a column each rather
 * than being folded into one.
 */
type Filter = "billable" | "all" | "stopped" | "active" | "draft" | "invoiced" | "paid";

const FILTERS: { key: Filter; label: string; match: (c: CampaignRecord) => boolean }[] = [
  { key: "billable", label: "Faturáveis", match: isBillable },
  { key: "all", label: "Todas", match: () => true },
  // Braze's "stopped" and "active" said the way the work is talked about: an
  // email that has gone out, and one still going out.
  { key: "stopped", label: "Enviadas", match: c => c.brazeStatus === "stopped" },
  { key: "active", label: "Enviando", match: c => c.brazeStatus === "active" },
  { key: "draft", label: "Rascunhos", match: c => c.brazeStatus === "draft" },
  { key: "invoiced", label: "Faturadas", match: c => c.billing.state === "invoiced" },
  { key: "paid", label: "Pagas", match: c => c.billing.state === "paid" },
];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRecord[] | null>(null);
  const [filter, setFilter] = useState<Filter>("billable");
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<FlowProgress | null>(null);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-rendered on a timer so "atualizado há 4 min" ages while the page is
  // left open — a stale cache silently driving an invoice is the expensive
  // failure mode, and a number frozen at load time hides exactly that.
  const [now, setNow] = useState(() => Date.now());
  const running = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/campaigns");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || response.statusText);
      setCampaigns(body.campaigns as CampaignRecord[]);
    } catch {
      // An empty ledger and a ledger that could not be read look the same on
      // screen, so the cold-cache copy below has to cover both.
      setCampaigns([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Both dashboard reads go through here. The button is disabled while one
   * runs, but a double-click lands both events before React re-renders; the
   * flag is what actually holds the line.
   */
  const run = useCallback(async (body: Record<string, unknown>, failure: string) => {
    if (running.current) return;
    running.current = true;
    setSyncing(true);
    setError(null);
    setProgress({ n: 0, label: "iniciando…" });
    setLastLine(null);
    try {
      const onLog = (line: FlowLogLine) => {
        setLastLine(line.message);
        if (line.level === "error") setError(line.message);
      };
      const ok = await runBrazeFlow(body, { onLog, onStep: setProgress });
      if (!ok) setError(current => current ?? failure);
      // Reloaded either way: a run that died halfway still wrote everything it
      // managed to read, and those rows are better than the ones on screen.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      running.current = false;
      setSyncing(false);
      setProgress(null);
    }
  }, [load]);

  // Deliberately uncapped and unfiltered: the run route only counts a sync as
  // complete — and only then lets the store flag campaigns that have
  // disappeared from the dashboard — when neither limit nor status was passed.
  // A faster partial sync would quietly cost that.
  const sync = useCallback(() => run({ flow: "campaigns" }, "A sincronização falhou."), [run]);

  /**
   * The index has no send-date column, so the date is read off each campaign's
   * own page — one navigation each, minutes for a whole workspace. Its own
   * button rather than part of Sincronizar: the list refresh stays quick, and
   * this is only worth doing when dates are actually missing.
   */
  const fillDates = useCallback(
    () => run({ flow: "details" }, "Não foi possível ler as datas de envio."),
    [run],
  );

  /**
   * Mirrors campaignsNeedingDetail on the server: a stopped campaign already
   * read is finished, and drafts and archived ones have no send date to find.
   * Only ever used to label the button — the server decides what actually runs.
   */
  const missingDates = useMemo(
    () =>
      (campaigns ?? []).filter(
        c =>
          !(c.detailAt && c.brazeStatus === "stopped") &&
          c.brazeStatus !== "draft" &&
          c.brazeStatus !== "archived",
      ).length,
    [campaigns],
  );

  const counts = useMemo(() => {
    const list = campaigns ?? [];
    return Object.fromEntries(FILTERS.map(f => [f.key, list.filter(f.match).length])) as Record<Filter, number>;
  }, [campaigns]);

  const shown = useMemo(() => {
    const match = FILTERS.find(f => f.key === filter)!.match;
    return (campaigns ?? []).filter(match);
  }, [campaigns, filter]);

  const age = useMemo(() => cacheAge(campaigns, now), [campaigns, now]);
  const bar = progressOf("campaigns", progress ?? undefined);

  return (
    <main>
      <header className="app-bar">
        <h1>Campanhas</h1>
        {campaigns !== null && (
          <span className={age.stale ? "cache-age warn" : "cache-age"} title={age.title}>
            {age.text}
          </span>
        )}
        <span className="spacer" />
        {syncing && bar && (
          <span className="sync-doing">
            <span className="review-bar"><span style={{ width: `${bar.pct}%` }} /></span>
            {bar.n}/{bar.total} · {bar.label}
          </span>
        )}
        {missingDates > 0 && (
          <button className="ghost" onClick={() => void fillDates()} disabled={syncing} title="Abre cada campanha para ler a data de envio">
            Buscar datas ({missingDates})
          </button>
        )}
        <button className="primary" onClick={() => void sync()} disabled={syncing}>
          {syncing ? "Sincronizando…" : "Sincronizar"}
        </button>
      </header>

      <div className="ledger-body">
        <div className="ledger-inner">
          <div className="ledger-filters">
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={filter === f.key ? "active" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}<span className="count">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {syncing && (
            <p className="hint">
              A leitura do painel leva alguns minutos e roda em segundo plano — a página segue
              utilizável, e a lista se atualiza sozinha quando terminar.
              {lastLine && <> · {lastLine}</>}
            </p>
          )}
          {error && <p className="error-note">{error}</p>}

          {campaigns === null ? (
            <p className="hint">Lendo…</p>
          ) : campaigns.length === 0 ? (
            <p className="hint">
              Nenhuma campanha no catálogo ainda. Use Sincronizar para ler o painel do Braze.
            </p>
          ) : shown.length === 0 ? (
            <p className="hint">
              {filter === "billable"
                ? "Nenhuma campanha faturável — tudo que foi parado já está em uma fatura."
                : "Nenhuma campanha com esse filtro."}
            </p>
          ) : (
            <CampaignTable campaigns={shown} />
          )}
        </div>
      </div>
    </main>
  );
}

/** Anything older than this is called out: a day-old cache can be a campaign
 *  that stopped yesterday and is about to be left off an invoice. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How old the catalogue is, from the newest `syncedAt` on it. Records the
 * studio created itself have no `syncedAt` at all, so an empty result means
 * "never read from Braze" rather than "just now" — which is the whole point of
 * showing it.
 */
function cacheAge(campaigns: CampaignRecord[] | null, now: number): { text: string; title?: string; stale: boolean } {
  const newest = (campaigns ?? [])
    .map(c => c.syncedAt)
    .filter((at): at is string => !!at)
    .reduce((max, at) => (at > max ? at : max), "");
  if (!newest) return { text: "nunca sincronizado", stale: true };

  const at = new Date(newest);
  const ms = now - at.getTime();
  const minutes = Math.floor(ms / 60_000);
  const text =
    minutes < 1 ? "atualizado agora"
    : minutes < 60 ? `atualizado há ${minutes} min`
    : minutes < 60 * 24 ? `atualizado há ${Math.floor(minutes / 60)} h`
    : `atualizado há ${Math.floor(minutes / 1440)} dia${Math.floor(minutes / 1440) === 1 ? "" : "s"}`;
  return { text, title: at.toLocaleString("pt-BR"), stale: ms > STALE_AFTER_MS };
}
