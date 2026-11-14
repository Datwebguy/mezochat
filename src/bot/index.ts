import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { isAddress, type Address } from "viem";
import { parseOrder } from "../agent/parse.js";
import { aiParse } from "../agent/ai.js";
import { ratioGate, fmtRatio } from "../agent/safety.js";
import { labelFor, payFlow, pending, receipt, run, signButtons, type Button, type Reply } from "../commands/index.js";
import { config, web } from "../config.js";
import { txUrl } from "../mezo/client.js";
import { claimOnChain, registryEnabled } from "../mezo/registry.js";
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
Or type / to pick a command.
• activity
• recurring · cancel 1
• splits
• whois @alice
• faucet: free testnet funds
• /connect to link a new wallet`;

/** Slash commands: shown in Telegram's "/" menu. Usage is the hint sent when the command has no details. */
const COMMANDS: { command: string; description: string; usage?: string }[] = [
  { command: "balance", description: "MUSD balance and Trove ratio" },
  { command: "health", description: "Collateral, debt and ratio details" },
  { command: "send", description: "Send MUSD", usage: "/send 25 to @alice" },
  { command: "request", description: "Request MUSD", usage: "/request 40 from @bob" },
  { command: "split", description: "Split a bill", usage: "/split 120 with @alice @bob" },
  { command: "pay", description: "Ratio-gated recurring payment", usage: "/pay 800 to @landlord on the 1st if ratio > 160" },
  { command: "buy", description: "Spend via Mezo Market / Bitrefill", usage: "/buy amazon 50" },
  { command: "activity", description: "Recent receipts and actions" },
  { command: "recurring", description: "List or cancel recurring payments" },
  { command: "splits", description: "Who has paid your splits" },
  { command: "alert", description: "Set your safety threshold", usage: "/alert 160   (or /alert on, /alert off)" },
  { command: "whois", description: "Look up a @handle's wallet", usage: "/whois @alice" },
  ...(config.network === "testnet" ? [{ command: "faucet", description: "Get free testnet BTC and MUSD" }] : []),
  { command: "connect", description: "Link a different wallet" },
  { command: "help", description: "What I can do" },
  { command: "start", description: "Get started" },
];

/** "/send@MezoChat_Bot 25 to @alice" -> "send 25 to @alice"; returns a usage hint when details are missing. */
export function fromSlash(text: string): { text: string } | { usage: string } | null {
  const m = text.match(/^\/([a-z]+)(?:@\w+)?\s*(.*)$/i);
  if (!m) return null;
  const cmd = m[1].toLowerCase(), args = m[2].trim();
  const def = COMMANDS.find(c => c.command === cmd);
  if (!def) return null;
  if (def.usage && !args) return { usage: `${def.description}. Example:\n${def.usage}` };
  if (cmd === "alert") return { text: /^(on|off)$/i.test(args) ? `alerts ${args}` : `set alert ${args}` };
  return { text: `${cmd} ${args}`.trim() };
}

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
      { reply_markup: kb(signButtons(s.id, "Connect wallet")) });
  };

  bot.command("start", async ctx => {
    await ctx.reply(`Welcome to MezoChat (${config.chain.name}). Your MUSD, inside Telegram.`, { reply_markup: MENU });
    await startConnect(ctx.from!.id);
  });
  bot.command("connect", ctx => startConnect(ctx.from!.id));
  bot.command("faucet", async ctx => {
    if (config.network !== "testnet") return ctx.reply("The faucet is only for Mezo Testnet.");
    const me = store.user(ctx.from!.id);
    const addr = me?.address;
    await ctx.reply(
      "Free test funds (Mezo Testnet only, no real value)\n\n" +
      "Step 1: Testnet BTC (pays gas, used as collateral)\n" +
      "Tap \"Get testnet BTC\". On the Mezo Faucet page keep BTC selected, paste your address, tick \"Verify you are human\" and tap Request Tokens.\n\n" +
      "Step 2: Test MUSD\n" +
      "The faucet doesn't give MUSD. Tap \"Borrow test MUSD\" to open Mezo's testnet app, connect this same wallet, and borrow MUSD using your test BTC as collateral.\n" +
      (addr ? `\nYour address (tap it to copy):\n\`${addr}\`` : "\nConnect your wallet first with /connect."),
      { parse_mode: "Markdown", reply_markup: kb([{ text: "Get testnet BTC", url: "https://faucet.test.mezo.org" }, { text: "Borrow test MUSD", url: "https://testnet.mezo.org" }]) });
  });
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
      if (kind === "rcancel") {
        const r = store.removeRecurring(a, me.telegramId);
        if (!r) return ctx.editMessageText("Already cancelled.");
        store.log({ telegramId: me.telegramId, kind: "recurring_cancelled", amount: r.amount, counterparty: labelFor(r.to) });
        return ctx.reply(`✓ Cancelled: ${r.amount} MUSD → ${labelFor(r.to)} on day ${r.day}.`);
      }
      if (kind === "nudge") {
        const sp = store.getSplit(a);
        if (!sp || sp.owner !== me.telegramId) return;
        const unpaid = sp.shares.filter(x => !x.paid);
        for (const sh of unpaid) {
          const u = store.byHandle(sh.handle); if (!u) continue;
          await bot.api.sendMessage(u.telegramId, `Reminder from @${me.handle}: your share of the ${sp.total} MUSD split is ${sh.amount} MUSD.`,
            { reply_markup: kb([{ text: `Pay ${sh.amount}`, data: `splitpay:${sp.id}:${sh.handle}` }]) }).catch(() => {});
        }
        return ctx.reply(unpaid.length ? `Nudged ${unpaid.map(x => "@" + x.handle).join(", ")}.` : "Everyone has paid.");
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
      const handle = normalizeHandle(text);
      await ctx.reply(`You're @${handle}. Try "balance", or tap Help.`, { reply_markup: MENU });
      if (step.verified && registryEnabled()) {
        claimOnChain(handle, step.address as Address)
          .then(h => ctx.reply(`⛓ @${handle} is now registered on Mezo: ${txUrl(h)}`))
          .catch(e => console.error("registry claim failed", handle, (e as Error).message));
      }
      return;
    }

    const me = store.user(id);
    if (!me) return startConnect(id);
    let input = text;
    if (text.startsWith("/")) {
      const sl = fromSlash(text);
      if (!sl) return ctx.reply(HELP);
      if ("usage" in sl) return ctx.reply(sl.usage);
      input = sl.text;
    }
    let order = /^help$/i.test(input) ? null : parseOrder(input);
    if (!order) return ctx.reply(HELP);
    if (order.t === "unknown") {
      await ctx.replyWithChatAction("typing").catch(() => {});
      const ai = await aiParse(input);
      if (ai && "reply" in ai) return ctx.reply(ai.reply);
      if (ai) order = ai.order;
    }
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
      if (s.split) {
        const sp = store.markShare(s.split.id, s.split.handle);
        if (sp) {
          const left = sp.shares.filter(x => !x.paid).length;
          await bot.api.sendMessage(sp.owner, `✓ @${s.split.handle} paid their ${s.amount} MUSD share. ${left ? left + " still to pay." : "Split fully settled 🎉"}`).catch(() => {});
        }
      }
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

  const setup = async () => {
    await bot.api.setMyShortDescription("Your MUSD bank inside Telegram. Send, split, spend, with Trove safety checks.").catch(e => console.error(e));
    await bot.api.setMyDescription(
      "MezoChat is Telegram-native banking for MUSD on Mezo.\n\n" +
      "• Check your balance and live Trove health\n• Send or request MUSD by @handle\n• Split bills\n" +
      "• Recurring payments that only run if your collateral ratio is safe\n• Spend via Mezo Market\n\n" +
      "Non-custodial: you sign every payment in your own wallet. Tap Start to connect.").catch(e => console.error(e));
    return bot.api.setMyCommands(COMMANDS.map(({ command, description }) => ({ command, description }))).catch(e => console.error("setMyCommands failed", e));
  };

  return { bot, tick, hooks, setup };
}
