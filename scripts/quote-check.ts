// Prints live borrow quotes for a wallet. Usage: npx tsx scripts/quote-check.ts <address> [coll debt]...
import type { Address } from "viem";
import { quoteBorrow } from "../src/mezo/borrow.js";

const [addr, ...rest] = process.argv.slice(2);
const pairs = rest.length ? rest : ["0", "0", "0.033", "1800", "0.035", "1800"];
for (let i = 0; i < pairs.length; i += 2) {
  const q = await quoteBorrow(addr as Address, pairs[i], pairs[i + 1]);
  console.log(`${pairs[i]} BTC / ${pairs[i + 1]} MUSD => ${q.ok ? "OK" : "NO: " + q.error}`);
  console.log(`   ratio ${q.ratio}% | liq at $${Number(q.liquidationPrice).toFixed(0)} | BTC can drop ${q.dropToLiquidation}% | risky ${q.risky} | min ${q.minRatio}% | suggest ${JSON.stringify(q.suggestion)}`);
}
