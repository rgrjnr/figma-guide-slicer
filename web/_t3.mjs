import { chromium } from "playwright";
import { config } from "./braze/config.mjs";
import { contextOptions } from "./braze/auth.mjs";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext(contextOptions({ viewport: { width: 1600, height: 1400 } }));
const page = await ctx.newPage();
const base = config.url.replace(/\/$/, "");
await page.goto(`${base}/engagement/campaigns/6a8b6712e8ab2a0086d51749/60106fe73d519f17d1749fd6?locale=en&page=0`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(14000);
await page.getByRole("button", { name: /^Preview and test$/i }).first().click();
await page.waitForTimeout(5000);
await page.getByRole("tab", { name: /^Test Send$/i }).first().click();
await page.waitForTimeout(4000);

const input = page.locator('input[id^="test-send-recipient-input-"]').first();
const btn = page.getByRole("button", { name: /^Send Test$/i }).first();
console.log("send enabled before:", await btn.isEnabled());

// Roger described pasting addresses separated by line breaks; test that a
// newline commits an entry the way Enter does.
await input.fill("roger@rogerjunior.com");
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);

const chips = await page.evaluate(() => [...document.querySelectorAll('[class*="multi-value"],[class*="chip"],[class*="tag"]')].map(e=>e.innerText.trim()).filter(Boolean).slice(0,6));
console.log("chips after Enter:", JSON.stringify(chips));
console.log("send enabled after:", await btn.isEnabled());
await page.screenshot({ path: "/tmp/test-send-filled.png", fullPage: true });
await browser.close();
