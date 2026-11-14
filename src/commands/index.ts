import { isAddress, type Address } from "viem";
import { ratioGate, fmtRatio } from "../agent/safety.js";
import type { Order } from "../agent/parse.js";
import { buildTransfer, getWallet, getTroveHealth, publicClient, txUrl } from "../mezo/client.js";
import { store, normalizeHandle, type User } from "../registry/store.js";
import { config, web } from "../config.js";
import { registryReadable, resolveOnChain } from "../mezo/registry.js";
import { catalog, storeAddress } from "../mezo/market.js";
import { createSession } from "../web/sessions.js";

/** One button that opens the signer page; the page then offers MetaMask, Trust, Coinbase, OKX or any wallet browser. */
export function signButtons(sessionId: string, label: string): Button[] {
  return [{ text: label, url: `${web.publicUrl}/app?s=${sessionId}` }];
}

export interface Button { text: string; data?: string; url?: string; webApp?: string }
export interface Reply { text: string; buttons?: Button[]; notify?: { telegramId: number; text: string; buttons?: Button[] }[] }

/** Short-lived confirmations (Telegram callback data is limited to 64 bytes). */
export const pending = new Map<string, { to: Address; label: string; amount: string; owner: number }>();
const pid = () => Math.random().toString(36).slice(2, 10);

const num = (x: string) => Number(x);
const valid = (a: string) => num(a) > 0 && Number.isFinite(num(a));

export const receipt = (action: string, amount: string, who: string, ratio: number | null, tx: string) =>
  `✓ ${action}\nAmount: ${amount} MUSD\nTo/From: ${who}\nRatio at time: ${fmtRatio(ratio)}\nTx: ${tx}`;

/** "@alice" if the address belongs to a user, else a short 0x label. */
export function labelFor(address: string) {
  const u = store.allUsers().find(x => x.address.toLowerCase() === address.toLowerCase());
  return u ? `@${u.handle}` : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Handle known only to the on-chain registry (e.g. claimed directly on the contract). */
async function resolveChainOnly(target: string) {
  if (isAddress(target) || !registryReadable()) return null;
  const a = await resolveOnChain(normalizeHandle(target)).catch(() => null);
  return a ? { address: a, label: `@${normalizeHandle(target)}` } : null;
}

/** Resolve @handle or 0x address. */
function resolve(target: string): { address: Address; label: string; user?: User } | null {
  if (isAddress(target)) return { address: target, label: `${target.slice(0, 6)}…${target.slice(-4)}` };
  const u = store.byHandle(target);
  return u ? { address: u.address as Address, label: `@${u.handle}`, user: u } : null;
}

/** Pay flow shared by send / request-pay / split-pay / recurring. Gate first, then the user signs in their wallet. */
export async function payFlow(me: User, to: Address, label: string, amount: string, kind: string, split?: { id: string; handle: string }): Promise<Reply> {
  const gate = await ratioGate(me);
  if (!gate.ok) {
    store.log({ telegramId: me.telegramId, kind: `${kind}_refused`, amount, counterparty: label, ratio: gate.ratio });
    return { text: `✗ Not sent. ${gate.reason}\nAdd collateral or repay debt, or lower your threshold with "set alert N".` };
  }
  const action = kind === "send" ? "Send" : kind === "split" ? "Split share" : kind === "recurring" ? "Recurring payment" : "Payment";
  if (web.publicUrl) {
    const s = createSession({ kind: "pay", telegramId: me.telegramId, to, label, amount, action, ratio: gate.ratio, split });
    const buttons: Button[] = me.wallet === "mini"
      ? [{ text: `Pay ${amount} MUSD`, webApp: `${web.publicUrl}/mini?s=${s.id}` }]
      : signButtons(s.id, `Sign ${amount} MUSD`);
    return { text: `${action}: ${amount} MUSD → ${label}\nRatio ${fmtRatio(gate.ratio)} ✓\n${me.wallet === "mini" ? "Tap to confirm with your PIN" : "Tap to sign in your wallet"}. I'll post the receipt when it confirms.`, buttons };
  }
  // Fallback when no public URL is configured: EIP-681 link + manual tx hash.
  const t = buildTransfer(to, amount);
  store.log({ telegramId: me.telegramId, kind, amount, counterparty: label, ratio: gate.ratio, tx: "pending signature" });
  if (split) store.markShare(split.id, split.handle);
  return { text: `${receipt(action, amount, label, gate.ratio, "pending signature")}\n\nSign it in your wallet: ${t.walletLink}\nAfter it confirms, reply: tx 0x…` };
}

export async function run(me: User, order: Order): Promise<Reply> {
  switch (order.t) {
    case "balance": {
      const [w, h] = await Promise.all([getWallet(me.address as Address), getTroveHealth(me.address as Address)]);
      const state = h.ratio === null ? "No Trove open." : h.ratio >= me.threshold ? "All clear." : "⚠ Below your threshold.";
      const num = (x: string, d: number) => Number(x).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) });
      const lines = [
        `Your Mezo wallet (${config.chain.name})`,
        ``,
        `💵 MUSD: ${num(w.musd, 2)}`,
        `₿ BTC: ${num(w.btc, 6)}${Number(w.btc) === 0 ? "  ⚠ needed for gas (/faucet)" : "  (gas)"}`,
        ...(w.mezo !== null ? [`Ⓜ MEZO: ${num(w.mezo, 2)}`] : []),
        ``,
        `Trove ratio: ${fmtRatio(h.ratio)}. ${state}`,
      ];
      return { text: lines.join("\n") };
    }
    case "health": {
      const h = await getTroveHealth(me.address as Address);
      if (!h.hasTrove) return { text: "No active Trove for this address." };
      return { text: `Collateral: ${Number(h.collateralBtc).toFixed(6)} BTC\nDebt: ${Number(h.debtMusd).toFixed(2)} MUSD\nBTC price: $${Number(h.btcPrice).toFixed(2)}\nRatio: ${h.ratio}% (your threshold ${me.threshold}%, liquidation below 110%)` };
    }
    case "send": {
      if (!valid(order.amount)) return { text: "Enter an amount above 0." };
      const r = resolve(order.to) ?? await resolveChainOnly(order.to);
      if (!r) return { text: `I can't find ${order.to}. Send to a MezoChat @username or a 0x wallet address.` };
      const [g, w] = await Promise.all([ratioGate(me), getWallet(me.address as Address)]);
      if (!g.ok) return { text: `✗ ${g.reason}` };
      if (Number(w.musd) < num(order.amount)) return { text: `✗ Not enough MUSD. You have ${Number(w.musd).toFixed(2)} MUSD and tried to send ${order.amount}.` };
      if (Number(w.btc) === 0) return { text: "✗ You need a little BTC for gas before you can send. On testnet, use /faucet." };
      const id = pid();
      pending.set(id, { to: r.address, label: r.label, amount: order.amount, owner: me.telegramId });
      return { text: `Confirm send ${order.amount} MUSD to ${r.label} (${r.address})? Current ratio ${fmtRatio(g.ratio)}.`,
        buttons: [{ text: "Confirm", data: `send:${id}` }, { text: "Cancel", data: "cancel" }] };
    }
    case "request": {
      const r = resolve(order.from);
      if (!r?.user) return { text: "I can only request from a claimed @handle." };
      const req = store.addRequest({ from: me.telegramId, to: r.user.telegramId, amount: order.amount });
      store.log({ telegramId: me.telegramId, kind: "request", amount: order.amount, counterparty: r.label });
      return { text: `Requested ${order.amount} MUSD from ${r.label}.`,
        notify: [{ telegramId: r.user.telegramId, text: `@${me.handle} requests ${order.amount} MUSD.`,
          buttons: [{ text: "Pay", data: `reqpay:${req.id}` }, { text: "Decline", data: `reqno:${req.id}` }] }] };
    }
    case "split": {
      const people = order.with.map(normalizeHandle);
      const missing = people.filter(p => !store.byHandle(p));
      if (missing.length) return { text: `Not on MezoChat yet: ${missing.map(m => "@" + m).join(", ")}` };
      const each = (num(order.amount) / (people.length + 1)).toFixed(2);
      const sp = store.addSplit({ owner: me.telegramId, total: order.amount, shares: people.map(handle => ({ handle, amount: each, paid: false })) });
      store.log({ telegramId: me.telegramId, kind: "split", amount: order.amount, counterparty: people.map(p => "@" + p).join(" ") });
      return { text: `Split ${order.amount} MUSD ${people.length + 1} ways: ${each} each. Requests sent.`,
        notify: people.map(p => ({ telegramId: store.byHandle(p)!.telegramId, text: `@${me.handle} split a bill: your share is ${each} MUSD.`,
          buttons: [{ text: `Pay ${each}`, data: `splitpay:${sp.id}:${p}` }] })) };
    }
    case "recurring": {
      const r = resolve(order.to);
      if (!r) return { text: `I don't know ${order.to}.` };
      if (order.day < 1 || order.day > 28) return { text: "Pick a day between 1 and 28." };
      store.addRecurring({ owner: me.telegramId, to: r.address, amount: order.amount, day: order.day, minRatio: order.minRatio });
      return { text: `Recurring set. On day ${order.day} each month I'll check your Trove ratio. If it's above ${order.minRatio}% I'll prompt you to sign ${order.amount} MUSD to ${r.label}. If not, I'll alert you and skip.` };
    }
    case "spend": {
      // Live Mezo Market catalog from the Store contract; buying happens in the Mini App wallet.
      const items = storeAddress() ? await catalog() : [];
      const marketUrl = config.network === "testnet" ? "https://testnet.mezo.org/market" : "https://mezo.org/market";
      if (!items.length) return { text: `Mezo Market isn't connected on ${config.chain.name} in MezoChat yet. You can shop at ${marketUrl} (on a computer; Mezo's site doesn't support phones yet).` };
      const g = await ratioGate(me);
      const list = items.map(p => `${p.available ? "•" : "×"} ${p.name}: ${Number(p.priceMusd).toLocaleString("en-US")} MUSD${p.available ? ` (${p.stock} left)` : " (sold out)"}`).join("\n");
      const head = `🛍 Mezo Market (live from Mezo's Store contract)\n${list}\n\nYour ratio: ${fmtRatio(g.ratio)}${g.ok ? "" : `\n✗ ${g.reason} Spending is blocked until it's back above your level.`}`;
      if (me.wallet === "mini" && web.publicUrl)
        return { text: `${head}\n\nTap to pick an item and pay with your PIN.`, buttons: [{ text: "Open Mezo Market", webApp: `${web.publicUrl}/mini?view=market` }] };
      return { text: `${head}\n\nBuying inside Telegram needs the MezoChat wallet (/wallet, then import yours). With an external wallet, buy at ${marketUrl} on a computer.` };
    }
    case "recurringList": {
      const rs = store.recurringOf(me.telegramId);
      if (!rs.length) return { text: 'No recurring payments. Set one with:\n/pay 800 to @landlord on the 1st if ratio > 160' };
      return { text: "Your recurring payments:\n" + rs.map((r, i) => `${i + 1}. ${r.amount} MUSD → ${labelFor(r.to)} on day ${r.day}, only if ratio > ${r.minRatio}%${r.lastRun ? ` (last ${r.lastRun})` : ""}`).join("\n"),
        buttons: rs.map((r, i) => ({ text: `Cancel #${i + 1}`, data: `rcancel:${r.id}` })) };
    }
    case "recurringCancel": {
      const r = store.recurringOf(me.telegramId)[order.n - 1];
      if (!r) return { text: `No recurring payment #${order.n}. Send /recurring to see the list.` };
      store.removeRecurring(r.id, me.telegramId);
      store.log({ telegramId: me.telegramId, kind: "recurring_cancelled", amount: r.amount, counterparty: labelFor(r.to) });
      return { text: `✓ Cancelled: ${r.amount} MUSD → ${labelFor(r.to)} on day ${r.day}.` };
    }
    case "splits": {
      const sp = store.splitsOf(me.telegramId);
      if (!sp.length) return { text: "No splits yet. Try /split 120 with @alice @bob" };
      const lines = sp.map(x => {
        const paid = x.shares.filter(s => s.paid).length;
        return `${x.total} MUSD · ${paid}/${x.shares.length} paid\n` + x.shares.map(s => `   ${s.paid ? "✓" : "…"} @${s.handle} ${s.amount}`).join("\n");
      });
      const open = sp.filter(x => x.shares.some(s => !s.paid));
      return { text: lines.join("\n\n"), buttons: open.map(x => ({ text: `Nudge (${x.total} split)`, data: `nudge:${x.id}` })) };
    }
    case "whois": {
      const h = normalizeHandle(order.who);
      const u = store.byHandle(h);
      const chain = registryReadable() ? await resolveOnChain(h).catch(() => null) : null;
      if (!u && !chain) return { text: `@${h} isn't registered.` };
      const addr = u?.address ?? chain!;
      const onChain = chain ? (chain.toLowerCase() === addr.toLowerCase() ? "⛓ registered on Mezo ✓" : "⚠ on-chain owner differs") : "not on-chain yet";
      return { text: `@${h}\nWallet: ${addr}\n${u?.verified ? "✓ wallet ownership verified" : "address not verified"}\n${onChain}` };
    }
    case "activity": {
      const items = store.recent(me.telegramId);
      if (!items.length) return { text: "No activity in the last 7 days." };
      return { text: items.map(a => `${new Date(a.ts).toISOString().slice(0, 10)} ${a.kind}${a.amount ? " " + a.amount + " MUSD" : ""}${a.counterparty ? " " + a.counterparty : ""}`).join("\n") };
    }
    case "alerts": {
      if (order.threshold) { store.update(me.telegramId, { threshold: order.threshold }); return { text: `Safety threshold set to ${order.threshold}%. Spends below it will be refused.` }; }
      store.update(me.telegramId, { alerts: !!order.on }); return { text: `Alerts ${order.on ? "on" : "off"}.` };
    }
    case "tx": {
      try {
        const rc = await publicClient.getTransactionReceipt({ hash: order.hash as `0x${string}` });
        store.log({ telegramId: me.telegramId, kind: "confirmed", tx: order.hash });
        return { text: `${rc.status === "success" ? "✓ Confirmed" : "✗ Failed"} on-chain: ${txUrl(order.hash)}` };
      } catch { return { text: "I can't find that transaction yet. Try again in a minute." }; }
    }
    default:
      return { text: 'I didn\'t get that. Try: balance, health, send 25 to @alice, request 40 from @bob, split 120 with @alice @bob, pay 800 to @landlord on the 1st if ratio > 160, buy amazon 50, activity.' };
  }
}
