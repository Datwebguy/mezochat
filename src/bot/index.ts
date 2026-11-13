import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { isAddress, type Address } from "viem";
import { parseOrder } from "../agent/parse.js";
import { ratioGate, fmtRatio } from "../agent/safety.js";
import { payFlow, pending, receipt, run, signButtons, type Button, type Reply } from "../commands/index.js";
import { config, web } from "../config.js";
import { txUrl } from "../mezo/client.js";
import { store, normalizeHandle } from "../registry/store.js";
import { createSession, verifyMessage, type Session } from "../web/sessions.js";
import type { WebHooks } from "../web/server.js";

type Step = { s: "address" } | { s: "handle"; address: string; verified: boolean };
const onboarding = new Map<number, Step>();

const MENU = new Keyboard().text("Balance").text("Health").row().text("Activity").text("Help").resized().persistent();
const HELP = `Things you can say:
• balance / health
• send 25 to @alice
• request 40 from @bob
• split 120 with @alice @bob
• pay 800 to @landlord on the 1st if ratio > 160
• buy amazon 50
• set alert 160 · alerts on/off
• activity
• /connect to link a new wallet`;

const kb = (bs?: Button[]) => {
  if (!bs?.length) return undefined;
  const k = new InlineKeyboard();
  for (const b of bs) b.url ? k.url(b.text, b.url) : k.text(b.text, b.data!);
  return k;
};

export function createBot() {
  const bot = new Bot(config.botToken);

  const send = async (chatId: number, r: Reply) => {
    await bot.api.sendMessage(chatId, r.text, { reply_markup: kb(r.buttons) });
    for (const n of r.notify ?? []) await bot.api.sendMessage(n.telegramId, n.text, { reply_markup: kb(n.buttons) }).catch(() => {});
  };

  const startConnect = async (id: number) => {
    if (!web.publicUrl) {
      onboarding.set(id, { s: "address" });
      return bot.api.sendMessage(id, "Send your Mezo wallet address (0x…). I only read balances and Trove health; I never hold your keys.");
    }
    const s = createSession({ kind: "verify", telegramId: id, message: verifyMessage(id) });
    onboarding.set(id, { s: "address" });
    return bot.api.sendMessage(id,
      "Connect your wallet: tap below and sign a free message to prove it's yours. I never hold your keys.\nOr paste an address (0x…) for read-only use.",
      { reply_markup: kb(signButtons(s.id, "Connect in MetaMask")) });
  };

  bot.command("start", async ctx => {
    await ctx.reply(`Welcome to MezoChat (${config.chain.name}). Your MUSD, inside Telegram.`, { reply_markup: MENU });
    await startConnect(ctx.from!.id);
  });
  bot.command("connect", ctx => startConnect(ctx.from!.id));
  bot.command("help", ctx => ctx.reply(HELP, { reply_markup: MENU }));

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
        await ctx.editMessageReplyMarkup();
        return send(ctx.chat!.id, await payFlow(me, p.to, p.label, p.amount, "send"));
      }
      if (kind === "reqpay" || kind === "reqno") {
        const r = store.getRequest(a);
        if (!r || r.status !== "open" || r.to !== me.telegramId) return ctx.editMessageText("Request no longer open.");
        store.setRequest(a, kind === "reqpay" ? "paid" : "declined");
        if (kind === "reqno") {
          await bot.api.sendMessage(r.from, `@${me.handle} declined your request for ${r.amount} MUSD.`).catch(() => {});
          return ctx.editMessageText("Declined.");
        }
        const owner = store.allUsers().find(u => u.telegramId === r.from)!;
        return send(ctx.chat!.id, await payFlow(me, owner.address as Address, `@${owner.handle}`, r.amount, "send"));
      }
      if (kind === "splitpay") {
        const sp = store.getSplit(a);
        const share = sp?.shares.find(x => x.handle === normalizeHandle(b));
        if (!sp || !share || share.paid || store.byHandle(b)?.telegramId !== me.telegramId) return ctx.editMessageText("Share not payable.");
        const owner = store.allUsers().find(u => u.telegramId === sp.owner)!;
        return send(ctx.chat!.id, await payFlow(me, owner.address as Address, `@${owner.handle}`, share.amount, "split", { id: a, handle: b }));
      }
    } catch (e) { return ctx.reply(`Something went wrong reading the chain: ${(e as Error).message}`); }
  });

  bot.on("message:text", async ctx => {
    const id = ctx.from.id;
    const text = ctx.message.text.trim();
    const step = onboarding.get(id);

    if (step?.s === "address" && isAddress(text)) {
      const existing = store.user(id);
      if (existing) { store.setAddress(id, text, false); onboarding.delete(id); return ctx.reply("Address updated (read-only, not verified)."); }
      onboarding.set(id, { s: "handle", address: text, verified: false });
      return ctx.reply("Now claim a @handle (3-32 letters, numbers, underscore).");
    }
    if (step?.s === "handle") {
      const res = store.register(id, text, step.address, step.verified);
      if (!res.ok) return ctx.reply(res.reason);
      onboarding.delete(id);
      return ctx.reply(`You're @${normalizeHandle(text)}. Try "balance", or tap Help.`, { reply_markup: MENU });
    }

    const me = store.user(id);
    if (!me) return startConnect(id);
    const order = /^help$/i.test(text) ? null : parseOrder(text);
    if (!order) return ctx.reply(HELP);
    try { await send(ctx.chat.id, await run(me, order)); }
    catch (e) { await ctx.reply(`Couldn't reach Mezo right now: ${(e as Error).message}`); }
  });

  bot.catch(err => console.error("bot error", err.error));

  const hooks: WebHooks = {
    async onVerified(telegramId, address) {
      const u = store.user(telegramId);
      if (u) { store.setAddress(telegramId, address, true); onboarding.delete(telegramId); await bot.api.sendMessage(telegramId, `✓ Wallet ${address} linked and verified.`); return; }
      onboarding.set(telegramId, { s: "handle", address, verified: true });
      await bot.api.sendMessage(telegramId, `✓ Wallet ${address} verified.\nNow claim a @handle (3-32 letters, numbers, underscore).`);
    },
    expectedFrom(telegramId) { return (store.user(telegramId)?.address as Address) ?? null; },
    async onPaid(s: Extract<Session, { kind: "pay" }>, hash, ok, reason) {
      if (!ok) { await bot.api.sendMessage(s.telegramId, `✗ ${s.action} of ${s.amount} MUSD to ${s.label} did not go through: ${reason}\n${txUrl(hash)}`); return; }
      const me = store.user(s.telegramId)!;
      store.log({ telegramId: s.telegramId, kind: s.action.toLowerCase().replace(/ /g, "_"), amount: s.amount, counterparty: s.label, ratio: s.ratio, tx: hash });
      if (s.split) store.markShare(s.split.id, s.split.handle);
      await bot.api.sendMessage(s.telegramId, `${receipt(s.action, s.amount, s.label, s.ratio, hash)}\n${txUrl(hash)}`);
      const recipient = store.allUsers().find(u => u.address.toLowerCase() === s.to.toLowerCase());
      if (recipient && recipient.telegramId !== s.telegramId)
        await bot.api.sendMessage(recipient.telegramId, `✓ Received ${s.amount} MUSD from @${me.handle}.\n${txUrl(hash)}`).catch(() => {});
    },
  };

  /** Daily check for ratio-gated recurring payments, plus low-ratio alerts. */
  const tick = async () => {
    const now = new Date(); const today = now.toISOString().slice(0, 10);
    for (const r of store.allRecurring()) {
      if (r.day !== now.getUTCDate() || r.lastRun === today) continue;
      const me = store.user(r.owner); if (!me) continue;
      try {
        const g = await ratioGate({ ...me, threshold: r.minRatio });
        store.markRan(r.id, today);
        if (!g.ok) { await bot.api.sendMessage(me.telegramId, `Skipped recurring ${r.amount} MUSD. Ratio ${fmtRatio(g.ratio)} is below ${r.minRatio}%.`); continue; }
        const label = store.allUsers().find(u => u.address.toLowerCase() === r.to.toLowerCase())?.handle;
        const reply = await payFlow(me, r.to as Address, label ? `@${label}` : `${r.to.slice(0, 6)}…${r.to.slice(-4)}`, r.amount, "recurring");
        await send(me.telegramId, { ...reply, text: `Recurring payment due.\n${reply.text}` });
      } catch (e) { console.error("recurring failed", r.id, e); }
    }
    for (const u of store.allUsers().filter(x => x.alerts)) {
      try {
        const g = await ratioGate(u);
        if (!g.ok) await bot.api.sendMessage(u.telegramId, `⚠ ${g.reason}`);
        else if (g.ratio !== null && g.ratio < 120) await bot.api.sendMessage(u.telegramId, `🚨 Ratio ${g.ratio}% is close to liquidation (110%). Add collateral or repay now.`);
      } catch { /* RPC hiccup; try next tick */ }
    }
  };

  const setup = () => bot.api.setMyCommands([
    { command: "start", description: "Connect wallet and claim a handle" },
    { command: "connect", description: "Link a different wallet" },
    { command: "help", description: "What I can do" },
  ]).catch(e => console.error("setMyCommands failed", e));

  return { bot, tick, hooks, setup };
}
