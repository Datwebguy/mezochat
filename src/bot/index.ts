import { Bot, InlineKeyboard } from "grammy";
import { isAddress, type Address } from "viem";
import { parseOrder } from "../agent/parse.js";
import { ratioGate, fmtRatio } from "../agent/safety.js";
import { payFlow, pending, run, type Reply } from "../commands/index.js";
import { config } from "../config.js";
import { store, normalizeHandle } from "../registry/store.js";

type Step = { s: "address" } | { s: "handle"; address: string };
const onboarding = new Map<number, Step>();

const kb = (r: Reply["buttons"]) => (r ? new InlineKeyboard().row(...r.map(b => InlineKeyboard.text(b.text, b.data))) : undefined);

export function createBot() {
  const bot = new Bot(config.botToken);

  const send = async (chatId: number, r: Reply) => {
    await bot.api.sendMessage(chatId, r.text, { reply_markup: kb(r.buttons) });
    for (const n of r.notify ?? []) await bot.api.sendMessage(n.telegramId, n.text, { reply_markup: kb(n.buttons) }).catch(() => {});
  };

  bot.command("start", async ctx => {
    onboarding.set(ctx.from!.id, { s: "address" });
    await ctx.reply(`Welcome to MezoChat (${config.chain.name}).\nSend your Mezo wallet address (0x…). I only read balances and Trove health; I never hold your keys.`);
  });

  bot.on("callback_query:data", async ctx => {
    const me = store.user(ctx.from.id);
    const [kind, a, b] = ctx.callbackQuery.data.split(":");
    await ctx.answerCallbackQuery();
    if (!me || kind === "cancel") return ctx.editMessageText("Cancelled.");
    try {
      if (kind === "send") {
        const p = pending.get(a);
        if (!p || p.owner !== me.telegramId) return ctx.editMessageText("That confirmation expired.");
        pending.delete(a);
        return send(ctx.chat!.id, await payFlow(me, p.to, p.label, p.amount, "send"));
      }
      if (kind === "reqpay" || kind === "reqno") {
        const r = store.getRequest(a);
        if (!r || r.status !== "open" || r.to !== me.telegramId) return ctx.editMessageText("Request no longer open.");
        store.setRequest(a, kind === "reqpay" ? "paid" : "declined");
        if (kind === "reqno") return ctx.editMessageText("Declined.");
        const owner = [...store.allUsers()].find(u => u.telegramId === r.from)!;
        return send(ctx.chat!.id, await payFlow(me, owner.address as Address, `@${owner.handle}`, r.amount, "send"));
      }
      if (kind === "splitpay") {
        const sp = store.getSplit(a);
        const share = sp?.shares.find(x => x.handle === normalizeHandle(b));
        if (!sp || !share || share.paid || store.byHandle(b)?.telegramId !== me.telegramId) return ctx.editMessageText("Share not payable.");
        const owner = store.allUsers().find(u => u.telegramId === sp.owner)!;
        return send(ctx.chat!.id, await payFlow(me, owner.address as Address, `@${owner.handle}`, share.amount, "split", () => store.markShare(a, b)));
      }
    } catch (e) { return ctx.reply(`Something went wrong reading the chain: ${(e as Error).message}`); }
  });

  bot.on("message:text", async ctx => {
    const id = ctx.from.id;
    const text = ctx.message.text.trim();
    const step = onboarding.get(id);

    if (step?.s === "address") {
      if (!isAddress(text)) return ctx.reply("That doesn't look like a wallet address. Send a 0x… address.");
      onboarding.set(id, { s: "handle", address: text });
      return ctx.reply("Now claim a @handle (3-32 letters, numbers, underscore).");
    }
    if (step?.s === "handle") {
      const res = store.register(id, text, step.address);
      if (!res.ok) return ctx.reply(res.reason);
      onboarding.delete(id);
      return ctx.reply(`You're @${normalizeHandle(text)}. Try: balance, send 25 to @alice, split 120 with @alice @bob, activity.`);
    }

    const me = store.user(id);
    if (!me) return ctx.reply("Run /start to connect your wallet and claim a handle.");
    try { await send(ctx.chat.id, await run(me, parseOrder(text))); }
    catch (e) { await ctx.reply(`Couldn't reach Mezo right now: ${(e as Error).message}`); }
  });

  /** Daily check for ratio-gated recurring payments, plus low-ratio alerts. */
  const tick = async () => {
    const now = new Date(); const today = now.toISOString().slice(0, 10);
    for (const r of store.allRecurring()) {
      if (r.day !== now.getUTCDate() || r.lastRun === today) continue;
      const me = store.allUsers().find(u => u.telegramId === r.owner); if (!me) continue;
      try {
        const g = await ratioGate({ ...me, threshold: r.minRatio });
        store.markRan(r.id, today);
        if (!g.ok) { await bot.api.sendMessage(me.telegramId, `Skipped recurring ${r.amount} MUSD. Ratio ${fmtRatio(g.ratio)} is below ${r.minRatio}%.`); continue; }
        const reply = await payFlow(me, r.to as Address, `${r.to.slice(0, 6)}…${r.to.slice(-4)}`, r.amount, "recurring");
        await bot.api.sendMessage(me.telegramId, `Recurring payment due.\n${reply.text}`);
      } catch (e) { console.error("recurring failed", r.id, e); }
    }
    for (const u of store.allUsers().filter(x => x.alerts)) {
      try {
        const g = await ratioGate(u);
        if (!g.ok) await bot.api.sendMessage(u.telegramId, `⚠ ${g.reason}`);
      } catch { /* RPC hiccup; try next tick */ }
    }
  };
  return { bot, tick };
}
