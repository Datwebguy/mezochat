// Vercel function entry. Every request: load data -> handle -> save data -> run queued background jobs.
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { config, web } from "./config.js";
import { createBot } from "./bot/index.js";
import { createHandler } from "./web/server.js";
import { withStore } from "./registry/store.js";
import { drainBackground, setServerless } from "./runtime.js";

setServerless(true);
const { bot, tick, hooks, setup } = createBot();
const handle = createHandler(hooks);
let ready: Promise<void> | null = null;
const init = () => (ready ??= bot.init());           // fetches the bot's own info once per instance

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function readBody(req: IncomingMessage) { let raw = ""; for await (const c of req) raw += c; return raw; }
const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  try {
    if (path === "/api/telegram" && req.method === "POST") {
      // Telegram sends the secret we registered with setWebhook; anything else is rejected.
      if (!safeEq(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""), process.env.TELEGRAM_WEBHOOK_SECRET ?? "\0")) return send(res, 401, { error: "unauthorized" });
      const update = JSON.parse(await readBody(req));
      await init();
      await withStore(() => bot.handleUpdate(update));
      send(res, 200, { ok: true });
    } else if (path === "/api/cron") {
      // Vercel Cron sends "Authorization: Bearer $CRON_SECRET"
      if (!safeEq(String(req.headers.authorization ?? ""), `Bearer ${process.env.CRON_SECRET ?? "\0"}`)) return send(res, 401, { error: "unauthorized" });
      const t = Date.now(); const dbg = (m: string) => process.env.DEBUG_TIMING && console.log(`[cron] ${m} +${Date.now() - t}ms`);
      dbg("start"); await init(); dbg("init done");
      await withStore(tick); dbg("tick done");
      send(res, 200, { ok: true });
    } else if (path === "/api/setup" && req.method === "POST") {
      // One-time: point Telegram at this deployment and set commands/menu. Protected by the cron secret.
      if (!safeEq(String(req.headers.authorization ?? ""), `Bearer ${process.env.CRON_SECRET ?? "\0"}`)) return send(res, 401, { error: "unauthorized" });
      await init();
      await bot.api.setWebhook(`${web.publicUrl}/api/telegram`, {
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: false,
      });
      await setup();
      send(res, 200, { ok: true, webhook: `${web.publicUrl}/api/telegram`, network: config.network });
    } else {
      await withStore(() => handle(req, res));
    }
  } catch (e) {
    console.error("request failed", path, e);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  } finally {
    waitUntil(drainBackground());   // tx confirmations etc. run after the response, with fresh data
  }
}
