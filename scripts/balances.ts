// Prints BTC and MUSD balances for addresses. Usage: npx tsx scripts/balances.ts <addr>...
import { formatEther, type Address } from "viem";
import { getWallet } from "../src/mezo/client.js";
for (const a of process.argv.slice(2)) {
  const w = await getWallet(a as Address);
  console.log(`${a}: BTC ${Number(w.btc).toFixed(6)} | MUSD ${Number(w.musd).toFixed(2)}`);
}
void formatEther;
