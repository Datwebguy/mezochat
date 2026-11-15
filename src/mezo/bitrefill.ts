// Bitrefill API (https://docs.bitrefill.com): buy gift cards and receive the redemption code directly.
// Purchases are paid from the MezoChat operator's Bitrefill balance, so access is limited to the owner
// (BITREFILL_OWNER_HANDLE) with a daily USD limit (BITREFILL_DAILY_USD). The free test card is always allowed.
import { formatUnits, type Address } from "viem";
import { config } from "../config.js";
import { publicClient } from "./client.js";

const BASE = "https://api.bitrefill.com/v2";
export const TEST_PRODUCT = "test-gift-card-code";
export const bitrefill = {
  key: () => process.env.BITREFILL_API_KEY ?? "",
  ownerHandle: () => (process.env.BITREFILL_OWNER_HANDLE ?? "").replace(/^@/, "").toLowerCase(),
  dailyUsd: () => Number(process.env.BITREFILL_DAILY_USD ?? "10"),
  enabled: () => !!process.env.BITREFILL_API_KEY,
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(25_000),
    headers: { authorization: `Bearer ${bitrefill.key()}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({})) as { data?: T; message?: string; error_code?: string };
  if (!r.ok || j.error_code) throw new Error(j.message || `Bitrefill error ${r.status}`);
  return j.data as T;
}

export interface GiftPackage { id: string; value: string; priceSats: number }
export interface GiftProduct { id: string; name: string; country: string; currency: string; inStock: boolean; packages: GiftPackage[] }

const toProduct = (p: any): GiftProduct => ({
  id: p.id, name: p.name, country: p.country_code ?? "", currency: p.currency ?? "", inStock: p.in_stock !== false,
  packages: (p.packages ?? []).map((k: any) => ({ id: k.id ?? k.package_id, value: String(k.value), priceSats: Number(k.price ?? 0) })),
});

export async function searchGiftCards(q: string, limit = 6): Promise<GiftProduct[]> {
  const rows = await call<any[]>(`/products/search?q=${encodeURIComponent(q)}&limit=${limit * 2}`);
  // Prefer in-stock cards with fixed amounts
  const region = (process.env.BITREFILL_COUNTRY ?? "US").toUpperCase();
  const score = (p: GiftProduct) => (p.country === region ? 100 : 0) + (p.currency === "USD" ? 10 : 0) + Math.min(p.packages.length, 9);
  return rows.map(toProduct).filter(p => p.inStock).sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export async function giftCard(id: string): Promise<GiftProduct> {
  return toProduct(await call<any>(`/products/${encodeURIComponent(id)}`));
}

export async function balance() {
  return call<{ balance: number; currency: string; balances: { currency: string; balance: number }[] }>("/accounts/balance");
}

/** USD value of a Bitrefill package price (in satoshis), using Mezo's live BTC price. */
export async function satsToUsd(sats: number): Promise<number> {
  const pfAbi = [{ type: "function", name: "fetchPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
  const price = await publicClient.readContract({ address: config.chain.priceFeed as Address, abi: pfAbi, functionName: "fetchPrice" });
  return (sats / 1e8) * Number(formatUnits(price, 18));
}

export interface Redemption { code: string; instructions?: string; other?: string; orderId: string; invoiceId: string }

/** Buys one package from the Bitrefill balance and waits for the redemption code. */
export async function buyGiftCard(productId: string, packageId: string): Promise<Redemption> {
  const inv = await call<any>("/invoices", { method: "POST",
    body: JSON.stringify({ products: [{ product_id: productId, package_id: packageId, quantity: 1 }], payment_method: "balance", auto_pay: true }) });
  const orderId = inv?.orders?.[0]?.id;
  if (!orderId) throw new Error(`Bitrefill didn't create an order (status ${inv?.status ?? "unknown"}).`);
  for (let i = 0; i < 12; i++) {
    const o = await call<any>(`/orders/${orderId}`);
    if (o?.redemption_info?.code || o?.redemption_info?.link)
      return { code: o.redemption_info.code ?? o.redemption_info.link, instructions: o.redemption_info.instructions, other: o.redemption_info.other, orderId, invoiceId: inv.id };
    await new Promise(r => setTimeout(r, 2500));
  }
  throw new Error(`Order ${orderId} is still processing. Check it on bitrefill.com under Orders.`);
}
