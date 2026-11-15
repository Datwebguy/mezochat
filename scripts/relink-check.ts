// Reproduces "wallet saved in Telegram but bot doesn't know it": create a wallet, wipe the server's link, reopen.
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PORT = "3986"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-rl-")), "db.json");
const { startServer } = await import("../src/web/server.js");
const { miniBundle } = await import("../src/web/mini.js");
const { chromium } = createRequire(import.meta.url)("playwright");
const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5555, first_name: "T" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash }).toString();

let linked: { address: string; hasHandle: boolean } | null = null;
const srv = startServer({ onVerified: async (_id, a) => { linked = { address: a, hasHandle: false }; }, expectedFrom: () => null, onPaid: async () => {},
  linkedFor: () => linked });
await miniBundle();
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 900 } });
const open = async () => { await p.goto(`http://127.0.0.1:3986/mini#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`); await p.reload(); };
await open(); await p.waitForSelector("#new", { timeout: 30000 });
await p.click("#new"); await p.fill("#pin", "135791"); await p.fill("#pin2", "135791"); await p.click("#go");
await p.waitForSelector("#market", { timeout: 60000 });
const addr = linked!.address; console.log("1) created + linked:", addr);
linked = null;                                     // server forgets the link (like the move to Vercel)
await open(); await p.waitForSelector("text=Reconnect your wallet", { timeout: 30000 });
console.log("2) reopened with unknown link -> shows:", (await p.textContent("h1"))?.trim());
await p.fill("#pin", "000000"); await p.click("#go"); await p.waitForTimeout(2500);
console.log("3) wrong PIN:", await p.textContent("#msg"));
await p.fill("#pin", "135791"); await p.click("#go"); await p.waitForSelector("#market", { timeout: 30000 });
console.log("4) right PIN relinked same wallet:", (linked as any)?.address === addr);
await open(); await p.waitForSelector("#market", { timeout: 30000 });
console.log("5) reopen after relink goes straight to wallet: true");
await b.close(); srv.close();
