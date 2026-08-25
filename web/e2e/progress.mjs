// The determinate progress path: runner steps stream in as "NN doing x", the
// rail shows a gauge with the translated label, and lands on a check. A local
// SSE server stands in for /api/braze/run, so nothing touches Braze — and the
// events arrive slowly, which is what lets the in-flight state be asserted.
import { chromium } from "playwright";
import { createServer } from "node:http";

const STEPS = [
  [400, "01 open the entry point"],
  [400, "02 open Import Users"],
  [400, "03 choose Attributes and upload the CSV"],
];
const server = createServer(async (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const [delay, message] of STEPS) {
    await new Promise(r => setTimeout(r, delay));
    res.write(`event: log\ndata: ${JSON.stringify({ level: "info", message })}\n\n`);
  }
  await new Promise(r => setTimeout(r, 400));
  res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  res.end();
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
// Same-origin as far as the page can tell; the network layer goes to the stub.
await page.route("**/api/braze/run", route => route.continue({ url: `http://127.0.0.1:${port}/` }));
// The project save that runFlow does first can hit the real store; harmless.

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await page.locator(".field textarea").first().fill("ana@wbd.com\nbruno@wbd.com");
await page.getByRole("button", { name: /Avançar/ }).click();

const results = [];
const check = (l, ok, d = "") => results.push([l, ok, d]);

// While the stub is still streaming: the gauge and the translated label.
await page.waitForSelector(".step-ring", { timeout: 8000 }).catch(() => {});
check("the rail shows a determinate ring while running",
  await page.locator(".step-ring").isVisible().catch(() => false));
await page.waitForFunction(
  () => /abrindo|enviando|importa/i.test(document.querySelector(".step-doing")?.textContent ?? ""),
  null, { timeout: 6000 }
).catch(() => {});
const doing = await page.locator(".step-doing").innerText().catch(() => "");
check("the step label is translated, not the raw English", /abrindo|enviando|importa/i.test(doing), doing);

// After the stub finishes: the check mark.
await page.waitForSelector(".steps .step-n.done", { timeout: 10000 }).catch(() => {});
check("the rail lands on a check when the flow is done",
  await page.locator(".steps .step-n.done").isVisible().catch(() => false));
check("no page errors", errors.length === 0, errors.join("; "));

console.log("");
let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
