// Live Mezo Market catalog + buy quotes. Usage: npx tsx scripts/market-quote-check.ts [buyer]
import type { Address } from "viem";
import { catalog, quoteBuy } from "../../src/mezo/market.js";

const buyer = (process.argv[2] ?? "0x75A0C2d1Df51C07982De3Ff031E5232518676B19") as Address;
console.log("Live catalog:");
for (const p of await catalog()) console.log(`  ${p.id} ${p.name}: ${p.priceMusd} MUSD | stock ${p.stock} | limit ${p.perCustomerLimit || "none"} | ${p.available ? "available" : "sold out"}`);
for (const id of [1003, 1002, 1004]) {
  const q = await quoteBuy(buyer, id);
  console.log(`\nbuy ${id} as ${buyer.slice(0, 8)}… => ${q.ok ? "OK" : "BLOCKED: " + q.error}${q.ok ? ` | steps: ${q.txs.map(t => t.label).join(" -> ")}` : ""}`);
}
