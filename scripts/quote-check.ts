// Prints live borrow quotes for a wallet. Usage: npx tsx scripts/quote-check.ts <address> [coll debt]...
import type { Address } from "viem";
import { quoteBorrow } from "../src/mezo/borrow.js";

const [addr, ...rest] = process.argv.slice(2);
const pairs = rest.length ? rest : ["0", "0", "0", "1800", "0.033", "1800", "0.05", "1800", "0.039", "1800", "0.039", "100"];
for (let i = 0; i < pairs.length; i += 2) {
  const q = await quoteBorrow(addr as Address, pairs[i], pairs[i + 1]);
  console.log(`\n${pairs[i]} BTC / ${pairs[i + 1]} MUSD => ${q.ok ? (q.warning ? "OK with warning" : "OK") : "BLOCKED"}`);
  console.log(`   ${q.error ?? q.warning ?? "ready"}`);
  console.log(`   [live] balance ${Number(q.balanceBtc).toFixed(6)} | gas kept ${Number(q.gasReserveBtc).toFixed(6)} | available ${Number(q.availableBtc).toFixed(6)} | min ${q.minRatio}% | safe ${q.safeRatio}% | max safe ${Math.floor(Number(q.maxSafeBorrowMusd))} MUSD`);
}
