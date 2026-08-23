import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProject, updateProject } from "@/lib/server/store";
import type { ProjectRecord, StepRecord } from "@/lib/types";

export const runtime = "nodejs";
// Playwright drives a real browser; a flow can take minutes.
export const maxDuration = 900;

const WEB_ROOT = process.cwd();

interface RunRequest {
  flow: "login" | "draft" | "replace" | "audience" | "schedule" | "refresh" | "test";
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
    case "audience": {
      if (!body.csv) throw new Error("No audience CSV — add addresses first.");
      const csvPath = join(dir, "audience.csv");
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
