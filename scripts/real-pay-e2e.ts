// REAL test of the in-Telegram Pay screen: creates a pay session exactly like /send does, signs it in the Mini App
// with the imported wallet, and waits for the server's on-chain Transfer check + receipt hook.
// Usage: E2E_KEY=0x... npx tsx scripts/real-pay-e2e.ts <to> <amount>
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";

process.env.PORT = "3989"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST"; process.env.MEZO_NETWORK = "testnet";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-pay-")), "db.json");
const KEY = process.env.E2E_KEY; if (!KEY) throw new Error("Set E2E_KEY");
const [to, amount] = process.argv.slice(2) as [Address, string];
const { startServer } = await import("../src/web/server.js");
const { miniBundle } = await import("../src/web/mini.js");
const { createSession } = await import("../src/web/sessions.js");
const { getWallet } = await import("../src/mezo/client.js");
const { privateKeyToAccount } = await import("viem/accounts");
const { chromium } = createRequire(import.meta.url)("playwright");
const me = privateKeyToAccount(KEY as `0x${string}`).address as Address;

const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 4242, first_name: "E2E" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const sig = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash: sig }).toString();

let paid: { ok: boolean; reason?: string; hash: string } | null = null;
const srv = startServer({ onVerified: async () => {}, expectedFrom: () => me,
  onPaid: async (_s, hash, ok, reason) => { paid = { ok, reason, hash }; } });
await miniBundle();
const before = await getWallet(to);
const s = createSession({ kind: "pay", telegramId: 4242, to, label: `${to.slice(0, 6)}…${to.slice(-4)}`, amount, action: "Send", ratio: null });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 900 } });
const open = (q: string) => p.goto(`http://127.0.0.1:3989/mini${q}#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`);
await open(""); await p.waitForSelector("#imp", { timeout: 30000 }); await p.click("#imp");
await p.fill("#pk", KEY); await p.fill("#pin", "246810"); await p.fill("#pin2", "246810"); await p.click("#go");
await p.waitForSelector("#market", { timeout: 60000 });
await open(`?s=${s.id}`); await p.waitForSelector("#pay:not([disabled])", { timeout: 30000 });
console.log("pay screen:", (await p.textContent("#sum"))!.replace(/\s+/g, " "));
await p.fill("#pin", "000000"); await p.click("#pay"); await p.waitForTimeout(2500);
console.log("wrong PIN:", await p.textContent("#msg"));
await p.fill("#pin", "246810"); await p.click("#pay");
await p.waitForSelector("text=Payment sent", { timeout: 120000 });
const end = Date.now() + 300_000; while (!paid && Date.now() < end) await new Promise(r => setTimeout(r, 2000));
console.log("server on-chain check:", JSON.stringify(paid));
const after = await getWallet(to);
console.log(`recipient MUSD: ${Number(before.musd).toFixed(2)} -> ${Number(after.musd).toFixed(2)}`);
await b.close(); srv.close();
