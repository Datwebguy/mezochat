// Runs the built Vercel function (.vercel/output/functions/index.func/index.mjs) on a local port and checks routes.
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "123:TEST";
process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
process.env.CRON_SECRET = "cron-secret";
process.env.PUBLIC_URL = "https://pay.mezochat.xyz";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-vb-")), "db.json");
const { default: handler } = await import(new URL("../.vercel/output/functions/index.func/index.mjs", import.meta.url));
const srv = createServer(handler).listen(3988);
const base = "http://127.0.0.1:3988";
const check = async (label, path, init, expect) => {
  const r = await fetch(base + path, init); const t = await r.text();
  console.log(`${r.status === expect ? "✓" : "✗"} ${label}: ${r.status} ${t.slice(0, 90).replace(/\s+/g, " ")}`);
};
await check("health", "/health", undefined, 200);
await check("mini app page", "/mini", undefined, 200);
await check("signer page", "/app", undefined, 200);
await check("live market catalog", "/api/market/catalog", undefined, 200);
await check("borrow quote", "/api/borrow/quote?address=0x75A0C2d1Df51C07982De3Ff031E5232518676B19&coll=0.05&debt=1800", undefined, 200);
await check("webhook without secret is rejected", "/api/telegram", { method: "POST", body: "{}" }, 401);
await check("webhook with wrong secret is rejected", "/api/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "nope" } }, 401);
await check("cron runs without a secret (self rate-limited)", "/api/cron", undefined, 200);
await check("setup without secret is rejected", "/api/setup", { method: "POST" }, 401);
srv.close();
