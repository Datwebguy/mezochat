// Browser check of the Mini App market. Quotes for the second purchase are redirected to a real testnet
// wallet that holds MUSD, so the "allowed" path shows real data. Usage: npx tsx scripts/market-ui-check.ts <prefix>
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PORT = "3991"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-mkt-")), "db.json");
const { startServer } = await import("../../src/web/server.js");
const { miniBundle } = await import("../../src/web/mini.js");
const { chromium } = createRequire(import.meta.url)("playwright");
const RICH = "0x52d033E64774F31A8B7562806aA5782CbbD29382";

const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 99, first_name: "T" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash }).toString();

const srv = startServer({ onVerified: async () => {}, expectedFrom: () => null, onPaid: async () => {} });
await miniBundle();
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 1300 } });
const errs: string[] = []; p.on("pageerror", (e: Error) => errs.push(e.message));
const prefix = process.argv[2] ?? "market";
await p.goto(`http://127.0.0.1:3991/mini#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`);
await p.waitForSelector("#new", { timeout: 30000 });
await p.click("#new"); await p.fill("#pin", "445566"); await p.fill("#pin2", "445566"); await p.click("#go");
await p.waitForSelector("#market", { timeout: 60000 }); await p.click("#market");
await p.waitForSelector("#items .item", { timeout: 30000 });
console.log("catalog rows:", await p.locator("#items .item").count(), "| buy buttons (in stock):", await p.locator("#items button[data-id]").count());
await p.screenshot({ path: `${prefix}-list.png`, fullPage: true });
await p.click("#items button[data-id='1003']"); await p.waitForTimeout(5000);
console.log("empty wallet:", (await p.textContent("#sum"))!.replace(/\s+/g, " ").slice(0, 200), "| buy enabled:", !(await p.isDisabled("#go")));
await p.route("**/api/market/quote?**", (r: any) => r.continue({ url: r.request().url().replace(/address=0x[0-9a-fA-F]{40}/, `address=${RICH}`) }));
await p.click("#back"); await p.waitForSelector("#items button[data-id='1004']"); await p.click("#items button[data-id='1004']"); await p.waitForTimeout(5000);
console.log("wallet with MUSD:", (await p.textContent("#sum"))!.replace(/\s+/g, " ").slice(0, 260), "| buy enabled:", !(await p.isDisabled("#go")));
await p.screenshot({ path: `${prefix}-buy.png`, fullPage: true });
console.log("page errors:", errs.length ? errs : "none");
await b.close(); srv.close();
