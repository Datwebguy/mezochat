// Browser check of the Mini App loan screen. Trove reads are redirected to a real testnet Trove owner,
// so the screen shows real Mezo data. Usage: npx tsx scripts/loan-ui-check.ts <screenshot-prefix> [owner]
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PORT = "3992"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-loan-")), "db.json");
const { startServer } = await import("../../src/web/server.js");
const { miniBundle } = await import("../../src/web/mini.js");
const { chromium } = createRequire(import.meta.url)("playwright");
const owner = process.argv[3] ?? "0x52d033E64774F31A8B7562806aA5782CbbD29382";

const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 88, first_name: "T" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash }).toString();

const srv = startServer({ onVerified: async () => {}, expectedFrom: () => null, onPaid: async () => {} });
await miniBundle();
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 1300 } });
const errs: string[] = []; p.on("pageerror", (e: Error) => errs.push(e.message));
// Swap the test wallet's address for the real Trove owner on Trove reads only
await p.route("**/api/trove/quote?**", (route: any) => route.continue({ url: route.request().url().replace(/address=0x[0-9a-fA-F]{40}/, `address=${owner}`) }));
await p.goto(`http://127.0.0.1:3992/mini#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`);
await p.waitForSelector("#new", { timeout: 30000 });
await p.click("#new"); await p.fill("#pin", "112233"); await p.fill("#pin2", "112233"); await p.click("#go");
await p.waitForSelector("#manage", { timeout: 60000 });
console.log("home shows loan card, borrow hidden:", await p.isHidden("#borrow"), "|", (await p.textContent("#loan"))!.replace(/\s+/g, " ").slice(0, 90));
await p.click("#manage"); await p.waitForTimeout(4000);
const prefix = process.argv[2] ?? "loan";
const result = async () => (await p.textContent("#result"))!.replace(/\s+/g, " ").slice(0, 150);
await p.fill("#amt", "0.001"); await p.waitForTimeout(4000);
console.log("add 0.001 BTC:", await result(), "| button enabled:", !(await p.isDisabled("#go")));
await p.screenshot({ path: `${prefix}-add.png`, fullPage: true });
await p.click("#tab-repay"); await p.waitForTimeout(3000); await p.fill("#amt", "99999999"); await p.waitForTimeout(4000);
console.log("repay too much:", await result());
await p.click("#tab-close"); await p.waitForTimeout(5000);
console.log("close:", await result(), "| button enabled:", !(await p.isDisabled("#go")));
await p.screenshot({ path: `${prefix}-close.png`, fullPage: true });
console.log("page errors:", errs.length ? errs : "none");
await b.close(); srv.close();
