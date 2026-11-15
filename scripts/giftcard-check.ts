// End-to-end /giftcard flow against the real Bitrefill API (free test card), Telegram calls captured.
// Usage: BITREFILL_API_KEY=... npx tsx scripts/giftcard-check.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-gc-")), "db.json");
process.env.TELEGRAM_BOT_TOKEN = "123:TEST"; process.env.BITREFILL_OWNER_HANDLE = "owner_demo";
const { createBot } = await import("../src/bot/index.js");
const { store } = await import("../src/registry/store.js");
const { bot } = createBot();
const out: { method: string; text?: string; buttons?: { text: string; data: string }[] }[] = [];
bot.api.config.use(async (_prev, method, payload: any) => {
  const rows = payload?.reply_markup?.inline_keyboard ?? [];
  out.push({ method, text: payload?.text, buttons: rows.flat().filter((b: any) => b.callback_data).map((b: any) => ({ text: b.text, data: b.callback_data })) });
  return { ok: true, result: method === "answerCallbackQuery" ? true : { message_id: 1, date: 0, chat: { id: payload?.chat_id ?? 1, type: "private" }, text: "" } } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: "MezoChat", username: "MezoChat_Bot" } as any;
const from = { id: 42, is_bot: false, first_name: "Owner" };
const msg = (text: string) => bot.handleUpdate({ update_id: Date.now(), message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: "private" }, from, text,
  entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : undefined } } as any);
const tap = (data: string) => bot.handleUpdate({ update_id: Date.now(), callback_query: { id: "1", from, chat_instance: "x", data,
  message: { message_id: 5, date: 0, chat: { id: 42, type: "private" }, text: "" } } } as any);
const last = () => [...out].reverse().find(o => o.text);

store.register(42, "owner_demo", "0x75A0C2d1Df51C07982De3Ff031E5232518676B19", true);
store.register(43, "stranger", "0x00000000000000000000000000000000000Beef1", true);

await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 43, type: "private" }, from: { id: 43, is_bot: false, first_name: "S" }, text: "/giftcard amazon", entities: [{ type: "bot_command", offset: 0, length: 9 }] } } as any);
console.log("non-owner:", last()?.text);
await msg("/giftcard amazon");
console.log("search amazon:", last()?.text, "|", last()?.buttons?.slice(0, 3).map(b => b.text).join(" / "));
await msg("/giftcard test");
console.log("search test:", last()?.text, "|", last()?.buttons?.map(b => b.text).join(" / "));
await tap(last()!.buttons![0].data);
console.log("amounts:", last()?.text, "|", last()?.buttons?.map(b => b.text).join(" / "));
await tap(last()!.buttons![0].data);
console.log("confirm:", last()?.text?.replace(/\n/g, " ⏎ "));
await tap(last()!.buttons![0].data);
console.log("result:", last()?.text?.replace(/\n/g, " ⏎ "));
console.log("activity:", JSON.stringify(store.recent(42)[0]));
