import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProject, updateProject } from "@/lib/server/store";
import { applyDetails, campaignsNeedingDetail, upsertFromSync } from "@/lib/server/campaigns";
import type { ProjectRecord, StepRecord } from "@/lib/types";

export const runtime = "nodejs";
// Playwright drives a real browser; a flow can take minutes.
export const maxDuration = 900;

const WEB_ROOT = process.cwd();

interface RunRequest {
  flow: "login" | "draft" | "replace" | "audience" | "schedule" | "refresh" | "test" | "campaigns" | "details";
  /** When given, the run's outcome is recorded against this project. */
  projectId?: string;
  campaignId?: string;
  segment?: string;
  recipients?: string;
  confirmSend?: boolean;
  campaignName?: string;
  subject?: string;
  preheader?: string;
  fromAddress?: string;
  replyTo?: string;
  sendAt?: string;
  timeZone?: string;
  localTimeDelivery?: boolean;
  /** base64 ZIP built by the app, written to a temp file for Playwright. */
  zipBase64?: string;
  csv?: string;
  /** Braze names the segment after the file, so the name matters. */
  csvName?: string;
  /** Campaign sync: cap the scrape, and keep only one normalised status. */
  limit?: number;
  status?: string;
  /** Details: re-read every campaign, including ones already read. */
  force?: boolean;
}

function argsFor(body: RunRequest, dir: string): string[] {
  const push = (out: string[], flag: string, value?: string) => {
    if (value) out.push(flag, value);
    return out;
  };

  switch (body.flow) {
    case "login":
      return ["login"];
    case "refresh": {
      if (!body.campaignId) throw new Error("Nothing to refresh — this project has no campaign yet.");
      return ["refresh", "--id", body.campaignId];
    }
    case "test": {
      if (!body.campaignId) throw new Error("Nothing to test — this project has no campaign yet.");
      if (!body.recipients) throw new Error("Give at least one address to send the test to.");
      const out = ["test", "--id", body.campaignId, "--to", body.recipients];
      // Sending real mail is opt-in, all the way down to the CLI flag.
      if (body.confirmSend) out.push("--confirm", "true");
      return out;
    }
    case "replace": {
      if (!body.campaignId) throw new Error("Nothing to replace — this project has no campaign yet.");
      if (!body.zipBase64) throw new Error("No build to upload — slice the email first.");
      const zipPath = join(dir, "build.zip");
      writeFileSync(zipPath, Buffer.from(body.zipBase64, "base64"));
      const out = ["replace", "--id", body.campaignId, "--zip", zipPath];
      push(out, "--subject", body.subject);
      push(out, "--preheader", body.preheader);
      return out;
    }
    case "draft": {
      if (!body.zipBase64) throw new Error("No build to upload — slice the email first.");
      const zipPath = join(dir, "build.zip");
      writeFileSync(zipPath, Buffer.from(body.zipBase64, "base64"));
      const out = ["draft", "--zip", zipPath];
      push(out, "--name", body.campaignName);
      push(out, "--subject", body.subject);
      push(out, "--preheader", body.preheader);
      push(out, "--from", body.fromAddress);
      push(out, "--reply-to", body.replyTo);
      return out;
    }
    case "campaigns": {
      const out = ["campaigns"];
      push(out, "--limit", body.limit ? String(body.limit) : undefined);
      push(out, "--status", body.status);
      return out;
    }
    /**
     * The index has no send-date column, so the date has to be read off each
     * campaign's own page. Which campaigns those are is decided HERE, from the
     * ledger, rather than by the browser flow: the rule is "anything stopped
     * whose date we have already read is finished and never re-read", and it
     * belongs next to the data it is asked about.
     */
    case "details": {
      const pending = campaignsNeedingDetail({ limit: body.limit ?? 0, force: Boolean(body.force) });
      if (!pending.length) throw new Error("Todas as campanhas já têm data de envio.");
      return ["details", "--ids", pending.map(c => c.id).join(",")];
    }
    case "audience": {
      if (!body.csv) throw new Error("No audience CSV — add addresses first.");
      // The file name becomes the segment name in Braze, so it is not incidental.
      const safe = (body.csvName || "audience.csv").replace(/[^\w.@ -]+/g, "-");
      const csvPath = join(dir, safe.endsWith(".csv") ? safe : `${safe}.csv`);
      writeFileSync(csvPath, body.csv, "utf8");
      return ["audience", "--csv", csvPath];
    }
    case "schedule": {
      if (!body.campaignId) throw new Error("Nothing to schedule — create the draft first.");
      const out = ["schedule", "--id", body.campaignId];
      push(out, "--at", body.sendAt);
      push(out, "--zone", body.timeZone);
      push(out, "--segment", body.segment);
      if (body.localTimeDelivery) out.push("--local", "true");
      return out;
    }
    default:
      throw new Error(`Unknown flow "${body.flow}"`);
  }
}

/**
 * Runs a Braze flow in a child process and streams its output back as SSE.
 * The child is a plain node script so the same flows run from the CLI, which is
 * how they get debugged when Braze changes its DOM.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;

  let args: string[];
  const dir = mkdtempSync(join(tmpdir(), "braze-run-"));
  try {
    args = argsFor(body, dir);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const child = spawn("node", ["braze/run.mjs", ...args], {
        cwd: WEB_ROOT,
        env: process.env,
      });

      // Kept so the flow's structured result can be parsed out at the end.
      let output = "";
      const relay = (chunk: Buffer, level: "info" | "error") => {
        output += chunk.toString();
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) send("log", { level, message: line.trimEnd() });
        }
      };
      child.stdout.on("data", c => relay(c, "info"));
      child.stderr.on("data", c => relay(c, "error"));

      child.on("error", err => {
        send("done", { ok: false, error: err.message });
        controller.close();
      });
      child.on("close", code => {
        const ok = code === 0;
        // The campaign sync belongs to no project — it is the whole workspace —
        // so it writes to the ledger instead, and before the done event, so the
        // UI's refresh on done always reads post-write state.
        if (body.flow === "details" && ok) {
          try {
            const written = recordDetails(output);
            send("log", { level: "info", message: `  ${written} data(s) de envio gravada(s)` });
          } catch (err) {
            send("log", { level: "error", message: `não foi possível gravar as datas: ${String(err)}` });
          }
        }
        if (body.flow === "campaigns" && ok) {
          try {
            const written = recordCampaigns(output, Boolean(body.status || body.limit));
            send("log", { level: "info", message: `  ${written} campanhas gravadas no catálogo` });
          } catch (err) {
            send("log", { level: "error", message: `não foi possível gravar o catálogo: ${String(err)}` });
          }
        }
        // Record the outcome against the project so the links survive the run.
        if (body.projectId) {
          try {
            recordRun(body, ok, output);
          } catch (err) {
            send("log", { level: "error", message: `could not save to the project: ${String(err)}` });
          }
        }
        send("done", { ok, code });
        controller.close();
      });

      request.signal.addEventListener("abort", () => child.kill("SIGTERM"));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}


/**
 * The campaign sync's result, out of the one JSON line the flow logs. Nothing
 * else crosses the process boundary: `runFlow`'s return value stays in the
 * child, so the log line is the transport.
 *
 * The upsert only ever touches the Braze-owned half of a record — PLAN-BILLING
 * keeps `billing` on a separate axis precisely so a re-sync cannot overwrite
 * "invoiced" with "stopped" and bill the same campaign twice.
 */
function recordCampaigns(output: string, filtered: boolean): number {
  const json = output.split("\n").map(l => l.trim()).reverse().find(l => l.startsWith("{") && l.endsWith("}"));
  if (!json) throw new Error("a sincronização não reportou nenhuma campanha");

  const result = JSON.parse(json) as {
    campaigns?: ScrapedCampaign[];
    stopped?: string;
    syncedAt?: string;
    /** False when Braze's own saved filter could not be proven cleared. */
    unfiltered?: boolean;
    filterNote?: string;
    pageSize?: number | null;
  };
  if (!Array.isArray(result.campaigns)) throw new Error("a sincronização não reportou nenhuma campanha");

  // Only the fields the ledger owns are handed over. The scrape also carries
  // the raw status word and the row's original cells, which are diagnostics for
  // the run log, not something to bury in a file meant to be hand-edited.
  const rows = result.campaigns.map(c => ({
    id: c.id,
    name: c.name,
    url: c.url,
    brazeStatus: c.brazeStatus,
    createdAt: c.createdAt ?? undefined,
    scheduledFor: c.scheduledFor ?? undefined,
    firstSentAt: c.firstSentAt ?? undefined,
  }));

  // A scrape that could not read the status column reads every row as
  // "unknown", and every one of those rows is a campaign that stops looking
  // billable. One or two unknowns are a genuinely new Braze status word; a
  // whole page of them means we read the wrong column, and the right response
  // is to write nothing and say so, because a sync that half-lands is harder to
  // notice than one that fails.
  const unknown = rows.filter(r => !r.brazeStatus || r.brazeStatus === "unknown").length;
  if (rows.length && unknown > rows.length / 2) {
    throw new Error(
      `a sincronização não conseguiu ler o status de ${unknown} de ${rows.length} campanhas — ` +
        `nada foi gravado. A tabela do Braze provavelmente mudou.`,
    );
  }

  // "Complete" is a claim about the whole workspace, and it is what lets the
  // store flag records it stopped seeing — so it is made only when the flow
  // says it walked to the end of an unfiltered, uncapped list.
  //
  // An empty result can never make that claim. "single page" is reported both
  // when the list genuinely has one page and when no paging control matched,
  // and with the selectors still unverified the second is the likelier of the
  // two: zero rows plus "single page" would otherwise flag the entire ledger
  // as missing on the strength of a scrape that found nothing at all.
  //
  // It also requires the flow to have cleared Braze's OWN filter. The campaign
  // index opens on a saved view that lists active campaigns only, and a sync
  // that read that view has seen a slice of the workspace, not the workspace.
  const complete = !filtered && rows.length > 0 && result.unfiltered === true &&
    (result.stopped === "end of list" || result.stopped === "single page" ||
      result.stopped === "no further page");
  const summary = upsertFromSync(rows, { complete, syncedAt: result.syncedAt });
  if (summary.missing) {
    console.warn(`sync: ${summary.missing} campanha(s) não apareceram mais no Braze`);
  }
  return rows.length;
}

/**
 * Pull the details run's result off its output and write the dates into the
 * ledger. Same reverse-scan as the sync: the flow logs its result as one JSON
 * line, and the CLI's trailing "OK — artifacts in ..." is not JSON.
 */
function recordDetails(output: string): number {
  const json = output.split("\n").map(l => l.trim()).reverse().find(l => l.startsWith("{") && l.endsWith("}"));
  if (!json) throw new Error("a leitura das datas não reportou nada");

  const result = JSON.parse(json) as { campaigns?: { id: string; sentAt?: string | null }[] };
  if (!Array.isArray(result.campaigns)) throw new Error("a leitura das datas não reportou nada");
  return applyDetails(result.campaigns);
}

/** One record as braze/flows/list-campaigns.mjs reports it. */
interface ScrapedCampaign {
  id: string;
  name: string;
  url: string;
  brazeStatus: string;
  createdAt: string | null;
  scheduledFor: string | null;
  firstSentAt: string | null;
}

/** The step each flow advances, for the project's progress record. */
const STEP_FOR: Partial<Record<RunRequest["flow"], keyof ProjectRecord["steps"]>> = {
  draft: "draft",
  replace: "draft",
  schedule: "schedule",
  audience: "import",
};

/**
 * Pull whatever the flow reported out of its log and merge it into the project.
 * The flows print a JSON object for machine-readable results (refresh does);
 * everything else is recovered from the lines they log.
 */
function recordRun(body: RunRequest, ok: boolean, output: string): void {
  const projectId = body.projectId!;
  if (!getProject(projectId)) return;

  const step = STEP_FOR[body.flow];
  const record: StepRecord = {
    status: ok ? "done" : "failed",
    at: new Date().toISOString(),
    runId: output.match(/run (\S+) —/)?.[1],
    ...(ok ? {} : { error: output.trim().split("\n").slice(-1)[0]?.slice(0, 300) }),
  };

  const patch: Partial<ProjectRecord> = step ? { steps: { [step]: record } as never } : {};
  const braze: ProjectRecord["braze"] = {};

  const campaignId = output.match(/campaign ([0-9a-f]{24})/)?.[1] || body.campaignId;
  const campaignUrl = output.match(/(https:\/\/[^\s]*\/engagement\/campaigns\/[^\s]+)/)?.[1];
  if (campaignId) {
    braze.campaign = {
      id: campaignId,
      name: body.campaignName || "",
      url: campaignUrl || "",
      checkedAt: new Date().toISOString(),
    };
  }

  // The audience flow reports the segment it produced; that link is what the
  // campaign targets, so it is worth keeping on the record.
  const segment = output.match(/segment "([^"]+)" is ready(?: — (\S+))?/);
  if (segment) {
    braze.segment = {
      id: segment[2]?.match(/[0-9a-f]{24}/)?.[0] ?? segment[1],
      name: segment[1],
      url: segment[2] ?? "",
      checkedAt: new Date().toISOString(),
    };
  }

  const reachable = output.match(/Reachable users: ([\d,]+)/)?.[1];
  if (reachable) braze.reachableUsers = Number(reachable.replace(/,/g, ""));
  if (/control group removed/i.test(output)) braze.controlGroupRemoved = true;

  // refresh prints one JSON line; prefer it over anything scraped.
  const json = output.split("\n").map(l => l.trim()).reverse().find(l => l.startsWith("{") && l.endsWith("}"));
  if (json) {
    try {
      const live = JSON.parse(json) as Record<string, unknown>;
      if (typeof live.reachableUsers === "number") braze.reachableUsers = live.reachableUsers;
      if (typeof live.controlGroupPresent === "boolean") braze.controlGroupRemoved = !live.controlGroupPresent;
      if (typeof live.url === "string" && braze.campaign) braze.campaign.url = live.url;
      if (typeof live.name === "string" && braze.campaign) braze.campaign.name = live.name;
    } catch {
      /* the last brace-wrapped line was not ours */
    }
  }

  if (Object.keys(braze).length) patch.braze = braze;
  updateProject(projectId, patch);
}
