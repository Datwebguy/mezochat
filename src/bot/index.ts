import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { isAddress, type Address } from "viem";
import { parseOrder } from "../agent/parse.js";
import { aiParse } from "../agent/ai.js";
import { ratioGate, fmtRatio } from "../agent/safety.js";
import { labelFor, payFlow, pending, receipt, run, signButtons, type Button, type Reply } from "../commands/index.js";
import { config, web } from "../config.js";
import { getTroveHealth, publicClient, txUrl } from "../mezo/client.js";
import { claimOnChain, registryEnabled } from "../mezo/registry.js";
import { store, normalizeHandle } from "../registry/store.js";
import { createSession, verifyMessage, type Session } from "../web/sessions.js";
import type { WebHooks } from "../web/server.js";

type Step = { s: "address" } | { s: "handle"; address: string; verified: boolean; wallet?: "mini" | "external" };
const onboarding = new Map<number, Step>();

const MENU = new Keyboard().text("Balance").text("Health").row().text("Activity").text("Help").resized().persistent();
const HELP = `Things you can say:
• balance: your Mezo wallet (MUSD, BTC, MEZO)
• health: Trove collateral and ratio
• send 25 to @alice  (or to a 0x address)
• request 40 from @bob
• split 120 with @alice @bob
• pay 800 to @landlord on the 1st if ratio > 160
• buy amazon 50
• set alert 160 · alerts on/off
Or type / to pick a command.
• activity
• recurring · cancel 1
• splits
• wallet / borrow: your wallet and MUSD loans, inside Telegram
• whois @alice
• faucet: free testnet funds
• /connect to link a new wallet`;

/** Slash commands: shown in Telegram's "/" menu. Usage is the hint sent when the command has no details. */
const COMMANDS: { command: string; description: string; usage?: string }[] = [
  { command: "wallet", description: "Your MezoChat wallet inside Telegram" },
  { command: "borrow", description: "Borrow MUSD against BTC, inside Telegram" },
  { command: "balance", description: "Your Mezo wallet: MUSD, BTC, MEZO + Trove ratio" },
  { command: "health", description: "Your Mezo Trove: collateral, debt, ratio" },
  { command: "send", description: "Send MUSD on Mezo to a @username or 0x address", usage: "/send 25 to @alice\n/send 25 to 0x1234…abcd" },
  { command: "request", description: "Request MUSD on Mezo from a @username", usage: "/request 40 from @bob" },
  { command: "split", description: "Split a bill in MUSD on Mezo", usage: "/split 120 with @alice @bob" },
  { command: "pay", description: "Recurring MUSD payment, gated by your Mezo Trove ratio", usage: "/pay 800 to @landlord on the 1st if ratio > 160" },
  { command: "buy", description: "Spend MUSD via Mezo Market / Bitrefill", usage: "/buy amazon 50" },
  { command: "activity", description: "Recent receipts and actions" },
  { command: "recurring", description: "List or cancel recurring payments" },
  { command: "splits", description: "Who has paid your splits" },
  { command: "alert", description: "Set your Mezo Trove safety threshold", usage: "/alert 160   (or /alert on, /alert off)" },
  { command: "whois", description: "Look up a @handle's Mezo wallet", usage: "/whois @alice" },
  ...(config.network === "testnet" ? [{ command: "faucet", description: "Free Mezo testnet BTC and MEZO, and how to get MUSD" }] : []),
  { command: "connect", description: "Link a different Mezo wallet" },
  { command: "help", description: "What I can do" },
  { command: "start", description: "Get started with MezoChat" },
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
  for (const b of bs) b.webApp ? k.webApp(b.text, b.webApp) : b.url ? k.url(b.text, b.url) : k.text(b.text, b.data!);
  return k;
};

export function createBot() {
  const bot = new Bot(config.botToken);

  const send = async (chatId: number, r: Reply) => {
    await bot.api.sendMessage(chatId, r.text, { reply_markup: kb(r.buttons) });
    for (const n of r.notify ?? []) await bot.api.sendMessage(n.telegramId, n.text, { reply_markup: kb(n.buttons) }).catch(() => {});
  };

  const miniUrl = (q = "") => `${web.publicUrl}/mini${q}`;
  const startConnect = async (id: number) => {
    if (!web.publicUrl) {
      onboarding.set(id, { s: "address" });
      return bot.api.sendMessage(id, "Send your Mezo wallet address (0x…). I only read balances and Trove health; I never hold your keys.");
    }
    const s = createSession({ kind: "verify", telegramId: id, message: verifyMessage(id) });
    onboarding.set(id, { s: "address" });
    return bot.api.sendMessage(id,
      "Set up your wallet:\n\n" +
      "• Wallet in Telegram: create a new one, or import yours with its private key. Everything happens here, and your key is encrypted with your PIN; MezoChat never sees it.\n" +
      "• Connect existing wallet: keep your key in MetaMask, Trust, OKX and others, and sign in that app.\n\n" +
      "Or paste an address (0x…) for read-only use.",
      { reply_markup: new InlineKeyboard().webApp("✨ Create or import wallet in Telegram", miniUrl()).row().webApp("Connect existing wallet", `${web.publicUrl}/app?s=${s.id}`) });
  };

  bot.command("start", async ctx => {
    await ctx.reply(`Welcome to MezoChat (${config.chain.name}). Your MUSD, inside Telegram.`, { reply_markup: MENU });
    await startConnect(ctx.from!.id);
  });
  bot.command("connect", ctx => startConnect(ctx.from!.id));
  bot.command("wallet", ctx => web.publicUrl
    ? ctx.reply("Open your MezoChat wallet:", { reply_markup: new InlineKeyboard().webApp("Open wallet", miniUrl()) })
    : ctx.reply("The in-Telegram wallet isn't enabled on this server."));
  bot.command("borrow", ctx => web.publicUrl
    ? ctx.reply("Borrow MUSD against your BTC, right here. You'll see the ratio, fee and liquidation price before you confirm with your PIN.",
        { reply_markup: new InlineKeyboard().webApp("Borrow MUSD", miniUrl("?view=borrow")) })
    : ctx.reply("Borrowing in Telegram isn't enabled on this server."));
  bot.command("faucet", async ctx => {
    if (config.network !== "testnet") return ctx.reply("The faucet is only for Mezo Testnet.");
    const me = store.user(ctx.from!.id);
    const addr = me?.address;
    await ctx.reply(
      "Free test funds (Mezo Testnet only, no real value)\n\n" +
      "Step 1: Testnet BTC (pays gas, used as collateral)\n" +
      "Tap \"Get testnet BTC\". On the Mezo Faucet page keep BTC selected (switch to MEZO for MEZO tokens), paste your address, tick \"Verify you are human\" and tap Request Tokens.\n\n" +
      "Step 2: Test MUSD\n" +
      "The faucet doesn't give MUSD. Tap \"Borrow test MUSD\" to open the Borrow page on testnet.mezo.org (check the address bar says testnet, NOT mezo.org), connect this same wallet, and borrow MUSD using your test BTC as collateral.\n" +
      (addr ? `\nYour address (tap it to copy):\n\`${addr}\`` : "\nConnect your wallet first with /connect."),
      { parse_mode: "Markdown", reply_markup: kb([{ text: "Get testnet BTC", url: "https://faucet.test.mezo.org" }, { text: "Borrow test MUSD", url: "https://testnet.mezo.org/borrow" }]) });
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
      store.setWallet(id, step.wallet ?? "external");
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
    store.setTgUsername(id, ctx.from.username);
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
    async onVerified(telegramId, address, wallet = "external") {
      const u = store.user(telegramId);
      const kind = wallet === "mini" ? "MezoChat wallet" : "Wallet";
      if (u) { store.setAddress(telegramId, address, true, wallet); onboarding.delete(telegramId); await bot.api.sendMessage(telegramId, `✓ ${kind} ${address} linked and verified.`); return; }
      onboarding.set(telegramId, { s: "handle", address, verified: true, wallet });
      await bot.api.sendMessage(telegramId, `✓ ${kind} ${address} ${wallet === "mini" ? "created" : "verified"}.\nNow claim a @handle (3-32 letters, numbers, underscore).`);
    },
    async onBorrowed(telegramId, hash, coll, debt) {
      await bot.api.sendMessage(telegramId, `⏳ Borrow submitted: ${debt} MUSD against ${coll} BTC. Waiting for confirmation…`).catch(() => {});
      try {
        const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 10 * 60_000 });
        if (rc.status !== "success") throw new Error("Transaction reverted");
        const h = await getTroveHealth(rc.from);
        store.log({ telegramId, kind: "borrow", amount: debt, counterparty: `${coll} BTC collateral`, ratio: h.ratio, tx: hash });
        await bot.api.sendMessage(telegramId, `✓ Borrowed ${debt} MUSD\nCollateral: ${coll} BTC\nTrove ratio: ${fmtRatio(h.ratio)}\nTx: ${txUrl(hash)}`);
        if (h.ratio !== null && h.ratio < (store.user(telegramId)?.threshold ?? 150))
          await bot.api.sendMessage(telegramId, `Heads up: your ratio is below your ${store.user(telegramId)?.threshold}% safety threshold, so sends will be blocked. Add BTC, or lower it with /alert ${Math.floor(h.ratio) - 2}.`);
      } catch (e) { await bot.api.sendMessage(telegramId, `✗ Borrow didn't go through: ${(e as Error).message}\n${txUrl(hash)}`); }
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
    if (web.publicUrl) await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Wallet", web_app: { url: `${web.publicUrl}/mini` } } }).catch(e => console.error("menu button", e));
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
