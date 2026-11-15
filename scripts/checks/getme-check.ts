// Compares Telegram getMe via plain fetch vs grammY (unbundled), with timeouts.
import { Bot } from "grammy";
const token = process.env.TELEGRAM_BOT_TOKEN!;
const t = (ms: number) => AbortSignal.timeout(ms);
let s = Date.now();
try { const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: t(15000) }); console.log("plain fetch:", r.status, "in", Date.now() - s, "ms"); }
catch (e) { console.log("plain fetch failed:", (e as Error).message); }
s = Date.now();
const bot = new Bot(token);
await Promise.race([bot.init().then(() => console.log("grammY init: ok @" + bot.botInfo.username, "in", Date.now() - s, "ms")),
  new Promise(r => setTimeout(() => { console.log("grammY init: still hanging after 15s"); r(null); }, 15000))]);
process.exit(0);
