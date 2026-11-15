// Dry-runs Trove actions (view/add/repay/close) for a real Trove owner on the configured network.
// Usage: npx tsx scripts/trove-check.ts [owner]   (no owner: uses the first Trove in SortedTroves)
import type { Address } from "viem";
import { config } from "../../src/config.js";
import { publicClient } from "../../src/mezo/client.js";
import { quoteTrove } from "../../src/mezo/trove.js";

const firstAbi = [{ type: "function", name: "getFirst", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const owner = (process.argv[2] ?? await publicClient.readContract({ address: config.chain.sortedTroves as Address, abi: firstAbi, functionName: "getFirst" })) as Address;
console.log("Trove owner:", owner);
for (const [action, amount] of [["view", "0"], ["add", "0.001"], ["add", "999"], ["repay", "0"], ["repay", "1"], ["repay", "999999"], ["close", "0"]] as const) {
  const q = await quoteTrove(owner, action, amount);
  console.log(`\n${action} ${amount} => ${q.ok ? "OK" : "BLOCKED"}${q.error ? ": " + q.error : ""}`);
  console.log(`   coll ${Number(q.collateralBtc).toFixed(6)} BTC | debt ${Number(q.debtMusd).toFixed(2)} | ratio ${q.ratio}% | MUSD bal ${Number(q.musdBalance).toFixed(2)} | max repay ${Number(q.maxRepayMusd).toFixed(2)} | close cost ${Number(q.closeCostMusd).toFixed(2)}${q.newRatio !== undefined ? ` | NEW ratio ${q.newRatio}%` : ""}`);
}
