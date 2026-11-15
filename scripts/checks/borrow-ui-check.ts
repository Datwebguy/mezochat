// Browser check of the Mini App borrow screen: empty start, live wallet data, clear messages per case.
// Usage: npx tsx scripts/borrow-ui-check.ts <screenshot-prefix>
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PORT = "3993"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-ui-")), "db.json");
const { startServer } = await import("../../src/web/server.js");
const { miniBundle } = await import("../../src/web/mini.js");
const { chromium } = createRequire(import.meta.url)("playwright");

const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 77, first_name: "T" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash }).toString();

const srv = startServer({ onVerified: async () => {}, expectedFrom: () => null, onPaid: async () => {}, thresholdFor: () => 160 });
await miniBundle();
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 1400 } });
const errs: string[] = []; p.on("pageerror", (e: Error) => errs.push(e.message));
await p.goto(`http://127.0.0.1:3993/mini#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`);
await p.waitForSelector("#new", { timeout: 30000 });
await p.click("#new"); await p.fill("#pin", "135790"); await p.fill("#pin2", "135790"); await p.click("#go");
await p.waitForSelector("#borrow", { timeout: 60000 }); await p.click("#borrow");
await p.waitForFunction(() => document.getElementById("wallet")?.textContent?.includes("Your BTC"), null, { timeout: 30000 });
const prefix = process.argv[2] ?? "borrow";
console.log("boxes start empty:", (await p.inputValue("#coll")) === "" && (await p.inputValue("#debt")) === "");
console.log("uses your /alert level (160):", (await p.textContent("#wallet"))!.includes("160%"));
const step = async (debt: string, coll: string, label: string) => {
  await p.fill("#debt", debt); await p.fill("#coll", coll); await p.waitForTimeout(3500);
  const msg = (await p.textContent("#quote"))!.match(/(Enter|Minimum|Insufficient|Not enough|✓)[^]*$/)?.[0] ?? "";
  console.log(`${label}: ${msg.replace(/\s+/g, " ").slice(0, 170)} | borrow enabled=${!(await p.isDisabled("#go"))}`);
};
await step("", "", "empty");
await step("100", "", "100 MUSD");
await step("1800", "", "1800 MUSD, no BTC");
await step("1800", "0.04", "1800 MUSD, 0.04 BTC (wallet is empty)");
await p.screenshot({ path: `${prefix}.png`, fullPage: true });
console.log("page errors:", errs.length ? errs : "none");
await b.close(); srv.close();
