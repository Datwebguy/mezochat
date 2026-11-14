// REAL end-to-end test on Mezo testnet through the actual Mini App UI (sends real testnet transactions).
// Imports a funded test wallet, then: borrow MUSD -> buy on Mezo Market -> add BTC -> repay MUSD.
// Usage: E2E_KEY=0x... npx tsx scripts/real-e2e.ts <screenshot-prefix>
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hash } from "viem";

process.env.PORT = "3990"; process.env.TELEGRAM_BOT_TOKEN = "123:TEST"; process.env.MEZO_NETWORK = "testnet";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-e2e-")), "db.json");
const KEY = process.env.E2E_KEY; if (!KEY) throw new Error("Set E2E_KEY");
const { startServer } = await import("../src/web/server.js");
const { miniBundle } = await import("../src/web/mini.js");
const { publicClient, getWallet, getTroveHealth } = await import("../src/mezo/client.js");
const { privateKeyToAccount } = await import("viem/accounts");
const { chromium } = createRequire(import.meta.url)("playwright");
const me = privateKeyToAccount(KEY as `0x${string}`).address as Address;
const prefix = process.argv[2] ?? "e2e";

const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 4242, first_name: "E2E" }) };
const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
const sig = createHmac("sha256", createHmac("sha256", "WebAppData").update("123:TEST").digest()).update(dcs).digest("hex");
const initData = new URLSearchParams({ ...fields, hash: sig }).toString();

const events: string[] = [];
const confirm = async (label: string, hash: Hash) => {
  const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  events.push(`${label}: ${rc.status} ${hash}`); console.log(`   on-chain ${label}: ${rc.status} (${hash})`);
};
const srv = startServer({
  onVerified: async (_id, a, w) => { console.log(`   linked ${a} as ${w}`); },
  expectedFrom: () => me, onPaid: async () => {}, thresholdFor: () => 120,
  onBorrowed: async (_id, h) => confirm("borrow", h),
  onMarketTx: async (_id, h) => confirm("market order", h),
  onTroveTx: async (_id, h, a) => confirm(`loan ${a}`, h),
});
await miniBundle();
const state = async (tag: string) => { const w = await getWallet(me); const t = await getTroveHealth(me);
  console.log(`[${tag}] BTC ${Number(w.btc).toFixed(6)} | MUSD ${Number(w.musd).toFixed(2)} | Trove ${t.hasTrove ? `${Number(t.collateralBtc).toFixed(6)} BTC / ${Number(t.debtMusd).toFixed(2)} MUSD @ ${t.ratio}%` : "none"}`); };
const waitFor = async (pred: () => boolean, ms = 300_000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await new Promise(r => setTimeout(r, 2000)); if (!pred()) throw new Error("timed out"); };

const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 1400 } });
const errs: string[] = []; p.on("pageerror", (e: Error) => errs.push(e.message));
const open = async (view = "") => { await p.goto(`http://127.0.0.1:3990/mini${view}#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`); };
const PIN = "246810";
try {
  await state("start");
  console.log("1) Import wallet");
  await open(); await p.waitForSelector("#imp", { timeout: 30000 }); await p.click("#imp");
  await p.fill("#pk", KEY); await p.fill("#pin", PIN); await p.fill("#pin2", PIN); await p.click("#go");
  await p.waitForSelector("#market", { timeout: 60000 });

  const t0 = await getTroveHealth(me);
  if (!t0.hasTrove) {
    console.log("2) Borrow MUSD (real openTrove)");
    await open("?view=borrow"); await p.waitForFunction(() => document.getElementById("wallet")?.textContent?.includes("Your BTC"), null, { timeout: 60000 });
    await p.fill("#debt", "1800"); await p.waitForTimeout(3000); await p.click("#fillSafe"); await p.waitForTimeout(5000);
    if (await p.isVisible("#ackrow")) await p.check("#ack");
    console.log("   quote:", (await p.textContent("#quote"))!.replace(/\s+/g, " ").slice(0, 220));
    await p.screenshot({ path: `${prefix}-1-borrow.png`, fullPage: true });
    if (await p.isDisabled("#go")) throw new Error("Borrow button disabled: " + (await p.textContent("#quote")));
    await p.fill("#pin", PIN); await p.click("#go");
    await p.waitForSelector("text=Borrow submitted", { timeout: 120000 });
    await waitFor(() => events.some(e => e.startsWith("borrow")));
    await state("after borrow");
  } else console.log("2) Trove already open, skipping borrow");

  console.log("3) Add BTC to the loan");
  await open("?view=loan"); await p.waitForFunction(() => document.getElementById("state")?.textContent?.includes("Collateral"), null, { timeout: 60000 });
  await p.fill("#amt", "0.003"); await p.waitForTimeout(5000);
  console.log("   preview:", (await p.textContent("#result"))!.replace(/\s+/g, " ").slice(0, 160));
  await p.fill("#pin", PIN); await p.click("#go"); await p.waitForSelector("text=Submitted", { timeout: 120000 });
  await waitFor(() => events.some(e => e.startsWith("loan add")));

  console.log("4) Buy a Bitrefill gift card on Mezo Market (approve + order)");
  await open("?view=market"); await p.waitForSelector("#items button[data-id]", { timeout: 60000 });
  await p.click("#items button[data-id='1003']"); await p.waitForTimeout(6000);
  console.log("   quote:", (await p.textContent("#sum"))!.replace(/\s+/g, " ").slice(0, 220));
  await p.screenshot({ path: `${prefix}-2-buy.png`, fullPage: true });
  if (await p.isDisabled("#go")) throw new Error("Buy disabled");
  await p.fill("#pin", PIN); await p.click("#go");
  await p.waitForSelector("text=Order sent", { timeout: 300000 });
  await waitFor(() => events.some(e => e.startsWith("market order")));
  await state("after purchase");

  console.log("5) Repay 1 MUSD");
  await open("?view=loan"); await p.waitForFunction(() => document.getElementById("state")?.textContent?.includes("Collateral"), null, { timeout: 60000 });
  await p.click("#tab-repay"); await p.waitForSelector("#amt"); await p.fill("#amt", "1"); await p.waitForTimeout(5000);
  console.log("   preview:", (await p.textContent("#result"))!.replace(/\s+/g, " ").slice(0, 160));
  await p.screenshot({ path: `${prefix}-3-repay.png`, fullPage: true });
  if (await p.isDisabled("#go")) console.log("   repay blocked:", await p.textContent("#result"));
  else { await p.fill("#pin", PIN); await p.click("#go"); await p.waitForSelector("text=Submitted", { timeout: 120000 }); await waitFor(() => events.some(e => e.startsWith("loan repay"))); }
  await state("end");
} catch (e) {
  console.log("FAILED:", (e as Error).message);
  await p.screenshot({ path: `${prefix}-failed.png`, fullPage: true });
  console.log("on screen:", (await p.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
} finally {
  console.log("\nTransactions:\n" + events.map(e => "  " + e).join("\n"));
  console.log("page errors:", errs.length ? errs : "none");
  await b.close(); srv.close();
}
