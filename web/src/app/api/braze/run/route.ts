import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
// Playwright drives a real browser; a flow can take minutes.
export const maxDuration = 900;

const WEB_ROOT = process.cwd();

interface RunRequest {
  flow: "login" | "draft" | "audience" | "schedule";
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
      const out = ["schedule"];
      push(out, "--name", body.campaignName);
      push(out, "--at", body.sendAt);
      push(out, "--zone", body.timeZone);
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

      const relay = (chunk: Buffer, level: "info" | "error") => {
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
        send("done", { ok: code === 0, code });
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
