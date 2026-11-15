// Checks handle restore + protection against the live on-chain registry, with Telegram calls captured (not sent).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-rs-")), "db.json");
process.env.TELEGRAM_BOT_TOKEN = "123:TEST"; process.env.MEZO_NETWORK = "testnet";
process.env.REGISTRY_ADDRESS ??= "0xd5c172f90799670de5f05b7506f13d977eccc6b5";
const { createBot } = await import("../../src/bot/index.js");
const { store } = await import("../../src/registry/store.js");
const { bot, hooks } = createBot();
const sent: string[] = [];
bot.api.config.use(async (_prev, method, payload: any) => {     // capture instead of calling Telegram
  if (method === "sendMessage") sent.push(`[to ${payload.chat_id}] ${payload.text}`);
  return { ok: true, result: { message_id: 1, date: 0, chat: { id: payload?.chat_id ?? 0, type: "private" } } } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: "MezoChat", username: "MezoChat_Bot" } as any;
const msg = (from: number, text: string) => bot.handleUpdate({ update_id: Math.floor(Math.random() * 1e9),
  message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: from, type: "private" }, from: { id: from, is_bot: false, first_name: "U" }, text } } as any);

console.log("A) returning user links 0x75A0… (holds @datweb3guy on-chain):");
await hooks.onVerified(111, "0x75A0C2d1Df51C07982De3Ff031E5232518676B19" as any, "mini");
console.log("   ", sent.at(-1)); console.log("    store says:", store.user(111)?.handle);

console.log("B) someone else links a new wallet and tries to claim @datweb3guy:");
await hooks.onVerified(222, "0x00000000000000000000000000000000000Beef1" as any, "mini");
await msg(222, "datweb3guy");
console.log("   ", sent.at(-1));
await msg(222, "fresh_name_42");
console.log("   ", sent.slice(-2).join(" | "));

console.log("C) unlinked user types /balance:");
await msg(333, "/balance");
console.log("   ", sent.slice(-2)[0]);
