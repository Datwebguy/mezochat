import { encodeFunctionData, formatUnits, type Address } from "viem";
import { config } from "../config.js";
import { MUSD, getTroveHealth, publicClient } from "./client.js";

/**
 * Mezo Market purchases go through Mezo's on-chain Store contract: approve MUSD, then order(productId).
 * Prices, stock and per-customer limits are read live from the contract. Only the product names/labels
 * below come from Mezo Market's own catalog (the contract stores numbers, not names).
 */
export const STORE: Record<string, Address | undefined> = {
  testnet: "0xBaeB52D7f812b7C2D109aAe7e50d1BabF2759fcE",   // confirmed on-chain (answers getProductDetails)
  mainnet: (process.env.MEZO_STORE_ADDRESS as Address) || undefined, // not confirmed yet: set when known
};
export const storeAddress = () => STORE[config.network];

export interface ProductInfo { id: number; name: string; kind: "gift-card" | "hardware"; redeem: string }
export const PRODUCTS: ProductInfo[] = [
  { id: 1003, name: "Bitrefill gift card", kind: "gift-card", redeem: "Bitrefill (bitrefill.com/redeem)" },
  { id: 1004, name: "Bitrefill gift card", kind: "gift-card", redeem: "Bitrefill (bitrefill.com/redeem)" },
  { id: 1005, name: "Bitrefill gift card", kind: "gift-card", redeem: "Bitrefill (bitrefill.com/redeem)" },
  { id: 1006, name: "Bitrefill gift card", kind: "gift-card", redeem: "Bitrefill (bitrefill.com/redeem)" },
  { id: 1007, name: "Bitrefill gift card", kind: "gift-card", redeem: "Bitrefill (bitrefill.com/redeem)" },
  { id: 1001, name: "Ledger Nano X (Mezo Edition)", kind: "hardware", redeem: "Ledger.com" },
  { id: 1002, name: "Ledger Stax (Mezo Edition)", kind: "hardware", redeem: "Ledger.com" },
];

const storeAbi = [
  { type: "function", name: "getProductDetails", stateMutability: "view", inputs: [{ name: "productId", type: "uint32" }],
    outputs: [{ type: "tuple", components: [{ name: "price", type: "uint96" }, { name: "stock", type: "uint16" }, { name: "perCustomerLimit", type: "uint8" }] }] },
  { type: "function", name: "getOrders", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "productId", type: "uint32" }],
    outputs: [{ type: "tuple[]", components: [{ name: "orderId", type: "uint32" }, { name: "productId", type: "uint32" }, { name: "price", type: "uint96" }] }] },
  { type: "function", name: "order", stateMutability: "nonpayable", inputs: [{ name: "productId", type: "uint32" }], outputs: [] },
] as const;
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export interface CatalogItem extends ProductInfo { priceMusd: string; stock: number; perCustomerLimit: number; available: boolean }

/** Live catalog: every price and stock number comes from the Store contract. */
export async function catalog(): Promise<CatalogItem[]> {
  const store = storeAddress(); if (!store) return [];
  const rows = await Promise.all(PRODUCTS.map(async p => {
    const d = await publicClient.readContract({ address: store, abi: storeAbi, functionName: "getProductDetails", args: [p.id] });
    return { ...p, priceMusd: formatUnits(d.price, 18), stock: Number(d.stock), perCustomerLimit: Number(d.perCustomerLimit), available: d.price > 0n && d.stock > 0 };
  }));
  return rows;
}

export interface BuyQuote {
  ok: boolean;
  error?: string;
  product?: CatalogItem;
  musdBalance: string;
  ratio: number | null;
  threshold: number;
  needsApproval: boolean;
  txs: { label: string; to: Address; data: `0x${string}`; value: string }[];   // sign in order
}

/** Checks stock, per-customer limit, MUSD balance and the Trove safety gate, then builds approve + order. */
export async function quoteBuy(buyer: Address, productId: number, threshold = config.defaultThreshold): Promise<BuyQuote> {
  const store = storeAddress();
  const base = { musdBalance: "0", ratio: null as number | null, threshold, needsApproval: false, txs: [] as BuyQuote["txs"] };
  if (!store) return { ok: false, error: "Mezo Market isn't available on this network in MezoChat yet.", ...base };
  const info = PRODUCTS.find(p => p.id === productId);
  if (!info) return { ok: false, error: "Unknown product.", ...base };
  const [d, bal, allowance, orders, health] = await Promise.all([
    publicClient.readContract({ address: store, abi: storeAbi, functionName: "getProductDetails", args: [productId] }),
    publicClient.readContract({ address: MUSD, abi: erc20, functionName: "balanceOf", args: [buyer] }),
    publicClient.readContract({ address: MUSD, abi: erc20, functionName: "allowance", args: [buyer, store] }),
    publicClient.readContract({ address: store, abi: storeAbi, functionName: "getOrders", args: [buyer, productId] }),
    getTroveHealth(buyer),
  ]);
  const product: CatalogItem = { ...info, priceMusd: formatUnits(d.price, 18), stock: Number(d.stock), perCustomerLimit: Number(d.perCustomerLimit), available: d.price > 0n && d.stock > 0 };
  const q = { ...base, product, musdBalance: formatUnits(bal, 18), ratio: health.ratio };
  const M = (w: bigint) => Number(formatUnits(w, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const fail = (error: string): BuyQuote => ({ ok: false, error, ...q });
  if (d.price === 0n) return fail("This product isn't for sale right now.");
  if (d.stock === 0) return fail(`${info.name} (${M(d.price)} MUSD) is sold out.`);
  if (d.perCustomerLimit > 0 && orders.length >= d.perCustomerLimit) return fail(`You've reached the limit of ${d.perCustomerLimit} per customer for this item.`);
  if (bal < d.price) return fail(`Insufficient MUSD. This costs ${M(d.price)} MUSD; you have ${M(bal)}. You need ${M(d.price - bal)} more.`);
  if (health.ratio !== null && health.ratio < threshold)
    return fail(`Your Trove ratio is ${health.ratio}%, below your ${threshold}% safety level, so spending is blocked. Add BTC to your loan (/loan) or lower your level with /alert.`);

  const needsApproval = allowance < d.price;
  const txs: BuyQuote["txs"] = [];
  if (needsApproval) txs.push({ label: `Allow Mezo Store to take ${M(d.price)} MUSD`, to: MUSD, value: "0",
    data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [store, d.price] }) });
  txs.push({ label: `Buy ${info.name} for ${M(d.price)} MUSD`, to: store, value: "0",
    data: encodeFunctionData({ abi: storeAbi, functionName: "order", args: [productId] }) });
  // Dry-run: the order can only be simulated once the allowance exists; otherwise simulate the approval.
  try { await publicClient.call({ account: buyer, to: txs[0].to, data: txs[0].data }); }
  catch (e) { return fail(`Mezo would reject this: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`); }
  return { ok: true, ...q, needsApproval, txs };
}
