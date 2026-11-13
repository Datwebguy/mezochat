import { isAddress, type Address } from "viem";
import { ratioGate, fmtRatio } from "../agent/safety.js";
import type { Order } from "../agent/parse.js";
import { buildTransfer, getBalance, getTroveHealth, publicClient, txUrl } from "../mezo/client.js";
import { store, normalizeHandle, type User } from "../registry/store.js";

export interface Button { text: string; data: string }
export interface Reply { text: string; buttons?: Button[]; notify?: { telegramId: number; text: string; buttons?: Button[] }[] }

/** Short-lived confirmations (Telegram callback data is limited to 64 bytes). */
export const pending = new Map<string, { to: Address; label: string; amount: string; owner: number }>();
const pid = () => Math.random().toString(36).slice(2, 10);

const num = (x: string) => Number(x);
const valid = (a: string) => num(a) > 0 && Number.isFinite(num(a));

export const receipt = (action: string, amount: string, who: string, ratio: number | null, tx: string) =>
  `✓ ${action}\nAmount: ${amount} MUSD\nTo/From: ${who}\nRatio at time: ${fmtRatio(ratio)}\nTx: ${tx}`;

/** Resolve @handle or 0x address. */
function resolve(target: string): { address: Address; label: string; user?: User } | null {
  if (isAddress(target)) return { address: target, label: `${target.slice(0, 6)}…${target.slice(-4)}` };
  const u = store.byHandle(target);
  return u ? { address: u.address as Address, label: `@${u.handle}`, user: u } : null;
}

/** Pay flow shared by send / request-pay / split-pay / recurring. Gate first, then the user signs in their wallet. */
export async function payFlow(me: User, to: Address, label: string, amount: string, kind: string, extra?: () => void): Promise<Reply> {
  const gate = await ratioGate(me);
  if (!gate.ok) {
    store.log({ telegramId: me.telegramId, kind: `${kind}_refused`, amount, counterparty: label, ratio: gate.ratio });
    return { text: `✗ Not sent. ${gate.reason}\nAdd collateral or repay debt, or lower your threshold with "set alert N".` };
  }
  const t = buildTransfer(to, amount);
  store.log({ telegramId: me.telegramId, kind, amount, counterparty: label, ratio: gate.ratio, tx: "pending signature" });
  extra?.();
  return {
    text: `${receipt(kind === "send" ? "Send" : "Payment", amount, label, gate.ratio, "pending signature")}\n\nSign it in your wallet: ${t.walletLink}\nAfter it confirms, reply: tx 0x…`,
  };
}

export async function run(me: User, order: Order): Promise<Reply> {
  switch (order.t) {
    case "balance": {
      const [bal, h] = await Promise.all([getBalance(me.address as Address), getTroveHealth(me.address as Address)]);
      const state = h.ratio === null ? "No Trove open." : h.ratio >= me.threshold ? "All clear." : "⚠ Below your threshold.";
      return { text: `MUSD balance: ${Number(bal).toFixed(2)}. Trove ratio: ${fmtRatio(h.ratio)}. ${state}` };
    }
    case "health": {
      const h = await getTroveHealth(me.address as Address);
      if (!h.hasTrove) return { text: "No active Trove for this address." };
      return { text: `Collateral: ${Number(h.collateralBtc).toFixed(6)} BTC\nDebt: ${Number(h.debtMusd).toFixed(2)} MUSD\nBTC price: $${Number(h.btcPrice).toFixed(2)}\nRatio: ${h.ratio}% (your threshold ${me.threshold}%, liquidation below 110%)` };
    }
    case "send": {
      if (!valid(order.amount)) return { text: "Enter an amount above 0." };
      const r = resolve(order.to);
      if (!r) return { text: `I don't know ${order.to}. Use a claimed @handle or a 0x address.` };
      const g = await ratioGate(me);
      if (!g.ok) return { text: `✗ ${g.reason}` };
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
      const g = await ratioGate(me);
      if (!g.ok) return { text: `✗ ${g.reason}` };
      store.log({ telegramId: me.telegramId, kind: "spend", amount: order.amount, counterparty: order.item, ratio: g.ratio, tx: "guided" });
      return { text: `Ratio ${fmtRatio(g.ratio)} is fine to spend.\nBuy ${order.item} ${order.amount}: open Mezo Market, choose the Bitrefill balance, pay ${order.amount} MUSD, then redeem on Bitrefill.\nhttps://mezo.org/market\nI can't automate this step yet, so I've logged it as guided.` };
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
