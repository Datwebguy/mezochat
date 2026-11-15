// Captures README screenshots from the real Mini App + real bot replies, against live Mezo testnet data.
// Usage: E2E_KEY=0x... npx tsx scripts/readme-shots.ts   -> docs/images/*.png
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";

process.env.PORT = "3985"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST"; process.env.MEZO_NETWORK = "testnet";
process.env.PUBLIC_URL = "https://pay.mezochat.xyz";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-shots-")), "db.json");
const KEY = process.env.E2E_KEY as `0x${string}`; if (!KEY) throw new Error("Set E2E_KEY");
const OUT = "docs/images"; mkdirSync(OUT, { recursive: true });
const { startServer } = await import("../src/web/server.js");
const { miniBundle } = await import("../src/web/mini.js");
const { createSession } = await import("../src/web/sessions.js");
const { store } = await import("../src/registry/store.js");
const { run } = await import("../src/commands/index.js");
const { parseOrder } = await import("../src/agent/parse.js");
const { privateKeyToAccount } = await import("viem/accounts");
const { chromium } = createRequire(import.meta.url)("playwright");
const me = privateKeyToAccount(KEY).address as Address;
const USER = "0x75A0C2d1Df51C07982De3Ff031E5232518676B19";

const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 7007, first_name: "Demo" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const sig = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash: sig }).toString();

let linked: { address: string; hasHandle: boolean } | null = null;
const srv = startServer({ onVerified: async (_i, a) => { linked = { address: a, hasHandle: true }; }, expectedFrom: () => me, onPaid: async () => {},
  linkedFor: () => linked, thresholdFor: () => 120 });
await miniBundle();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const url = (q = "") => `http://127.0.0.1:3985/mini${q}#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`;
const go = async (q = "") => { await p.goto(url(q)); await p.reload(); };
const shot = async (name: string) => { await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log("saved", name); };

// 1. Setup choice
await go(); await p.waitForSelector("#imp"); await shot("wallet-setup");
// 2. Import (real key) -> wallet home with real balances + loan card
await p.click("#imp"); await p.fill("#pk", KEY); await p.fill("#pin", "demo-passphrase-2026"); await p.fill("#pin2", "demo-passphrase-2026");
await p.dispatchEvent("#pin", "input"); await p.waitForTimeout(300); await shot("wallet-passphrase");
await p.click("#go"); await p.waitForSelector("#manage", { timeout: 60000 }); await p.waitForTimeout(2500); await shot("wallet-home");
// 3. Loan management (real Trove)
await p.click("#manage"); await p.waitForFunction(() => document.getElementById("state")?.textContent?.includes("Collateral"), null, { timeout: 60000 });
await p.fill("#amt", "0.005"); await p.waitForTimeout(5000); await shot("loan-manage");
// 4. Borrow screen: live quote for a wallet without a loan (real data for the user's wallet)
await p.route("**/api/borrow/quote?**", (r: any) => r.continue({ url: r.request().url().replace(/address=0x[0-9a-fA-F]{40}/, `address=${USER}`) }));
await go("?view=borrow"); await p.waitForFunction(() => document.getElementById("wallet")?.textContent?.includes("Your BTC"), null, { timeout: 60000 });
await p.fill("#debt", "1800"); await p.waitForTimeout(3500); await p.fill("#coll", "0.039"); await p.waitForTimeout(5000); await shot("borrow");
await p.unroute("**/api/borrow/quote?**");
// 5. Mezo Market catalog + buy screen
await go("?view=market"); await p.waitForSelector("#items .item", { timeout: 60000 }); await shot("market");
await p.click("#items button[data-id='1004']"); await p.waitForTimeout(6000); await shot("market-buy");
// 6. Pay screen (in-Telegram payment)
const s = createSession({ kind: "pay", telegramId: 7007, to: USER, label: "@datweb3guy", amount: "25", action: "Send", ratio: 129.2 });
await go(`?s=${s.id}`); await p.waitForSelector("#pay:not([disabled])", { timeout: 30000 }); await shot("pay");
// 7. External wallet signer page
const v = createSession({ kind: "verify", telegramId: 7007, message: "demo" });
await p.goto(`http://127.0.0.1:3985/app?s=${v.id}`); await p.waitForSelector("#open a", { timeout: 30000 }); await shot("connect-wallets");

// 8. Chat replies from the real command handlers, laid out as a conversation
store.register(7007, "datweb3guy", me, true); store.setWallet(7007, "mini");
store.register(7008, "alice", USER, true);
store.update(7007, { threshold: 120 });   // demo account set with /alert 120
const user = store.user(7007)!;
const turns: [string, string][] = [];
for (const cmd of ["balance", "send 25 to @alice", "split 90 with @alice", "buy"]) turns.push([`/${cmd.split(" ")[0]}${cmd.includes(" ") ? " " + cmd.split(" ").slice(1).join(" ") : ""}`, (await run(user, parseOrder(cmd))).text]);
const esc = (t: string) => t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const bubbles = turns.map(([q, a]) => `<div class="me">${esc(q)}</div><div class="bot">${esc(a)}</div>`).join("");
await p.setContent(`<html><body style="margin:0;background:#7fa77a;font:15px/1.4 system-ui,sans-serif">
<div style="background:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #ddd">
<img src="data:image/png;base64,${(await import("node:fs")).readFileSync("assets/logo-square.png").toString("base64")}" style="width:40px;height:40px;border-radius:50%">
<div><b>MezoChat</b><div style="color:#888;font-size:13px">bot</div></div></div>
<div style="padding:14px 12px;display:flex;flex-direction:column;gap:8px">${bubbles}</div>
<style>.me{align-self:flex-end;background:#e3fdd0;padding:8px 12px;border-radius:14px 14px 4px 14px;max-width:80%}
.bot{align-self:flex-start;background:#fff;padding:10px 12px;border-radius:14px 14px 14px 4px;max-width:86%;white-space:pre-wrap;overflow-wrap:anywhere}</style></body></html>`);
await shot("chat");
await b.close(); srv.close();
