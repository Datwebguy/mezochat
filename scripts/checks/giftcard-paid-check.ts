// Paid gift card flow (mainnet mode) with the real Bitrefill API; Telegram calls captured.
// Usage: BITREFILL_API_KEY=... npx tsx scripts/giftcard-paid-check.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-gp-")), "db.json");
process.env.TELEGRAM_BOT_TOKEN = "123:TEST"; process.env.PUBLIC_URL = "https://pay.mezochat.xyz";
process.env.GIFT_PAID = "1"; process.env.GIFT_TREASURY = "0x75A0C2d1Df51C07982De3Ff031E5232518676B19"; process.env.BITREFILL_OWNER_HANDLE = "operator";
const { createBot } = await import("../../src/bot/index.js");
const { store } = await import("../../src/registry/store.js");
const { bot, hooks } = createBot();
const out: { text?: string; buttons: { text: string; data?: string; url?: string }[] }[] = [];
bot.api.config.use(async (_prev, method, payload: any) => {
  if (payload?.text) out.push({ text: payload.text, buttons: (payload?.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => ({ text: b.text, data: b.callback_data, url: b.web_app?.url ?? b.url })) });
  return { ok: true, result: method === "answerCallbackQuery" ? true : { message_id: 1, date: 0, chat: { id: payload?.chat_id ?? 1, type: "private" }, text: "" } } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: "MezoChat", username: "MezoChat_Bot" } as any;
const from = { id: 77, is_bot: false, first_name: "Buyer" };
const msg = (text: string) => bot.handleUpdate({ update_id: Date.now(), message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 77, type: "private" }, from, text,
  entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } } as any);
const tap = (data: string) => bot.handleUpdate({ update_id: Date.now(), callback_query: { id: "1", from, chat_instance: "x", data, message: { message_id: 5, date: 0, chat: { id: 77, type: "private" }, text: "" } } } as any);
const last = () => out.at(-1)!;

store.register(77, "buyer", "0x00000000000000000000000000000000000Beef1", true); store.setWallet(77, "mini");
store.register(78, "operator", "0x75A0C2d1Df51C07982De3Ff031E5232518676B19", true);

console.log("1) any user can search in paid mode:");
await msg("/giftcard netflix"); console.log("  ", last().text, "|", last().buttons.slice(0, 2).map(b => b.text).join(" / "));
await tap(last().buttons[0].data!); console.log("   amounts:", last().buttons.map(b => b.text).join(" / "));
await tap(last().buttons[0].data!); console.log("   price:", last().text?.replace(/\n/g, " ⏎ "), "|", last().buttons.map(b => b.text).join(" / "));
await tap(last().buttons[0].data!); console.log("   with empty Bitrefill balance:", last().text);

console.log("2) payment confirmed on-chain -> card bought and code delivered (free test card):");
await hooks.onPaid({ id: "s1", kind: "pay", telegramId: 77, to: "0x75A0C2d1Df51C07982De3Ff031E5232518676B19", label: "MezoChat gift cards", amount: "10.20",
  action: "Gift card", ratio: null, created: Date.now(), gift: { productId: "test-gift-card-code", packageId: "test-gift-card-code<&>10", name: "Test Gift Card Code", value: "10", currency: "USD" } },
  "0x" + "ab".repeat(32) as any, true);
console.log("   receipt:", out.at(-2)?.text?.split("\n")[0]);
console.log("   code msg:", last().text?.replace(/\n/g, " ⏎ ").slice(0, 120));
console.log("   activity:", store.recent(77).map(a => a.kind).join(", "));
