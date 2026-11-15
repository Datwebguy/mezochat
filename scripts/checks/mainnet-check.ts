// Mainnet readiness: gas price, cost estimates, relayer balance, contract reachability.
// Usage: MEZO_NETWORK=mainnet npx tsx scripts/mainnet-check.ts
import { formatEther, formatGwei, type Address } from "viem";
import { config } from "../../src/config.js";
import { publicClient, getTroveHealth } from "../../src/mezo/client.js";
import { catalog } from "../../src/mezo/market.js";
import { quoteBorrow } from "../../src/mezo/borrow.js";

const gp = await publicClient.getGasPrice();
const relayer = "0xaac79Ae10Fb0632C23A6235F99Df39A6258090c0" as Address;
console.log(`${config.chain.name} (chain ${config.chain.id}), block ${await publicClient.getBlockNumber()}`);
console.log(`gas price ${formatGwei(gp)} gwei | registry deploy (~900k gas) ≈ ${formatEther(gp * 900_000n)} BTC | handle claim (~80k) ≈ ${formatEther(gp * 80_000n)} BTC`);
console.log(`relayer ${relayer} balance: ${formatEther(await publicClient.getBalance({ address: relayer }))} BTC`);
const items = await catalog();
console.log(`Mezo Store catalog: ${items.length} items, e.g. ${items.slice(0, 2).map(i => `${i.name} ${i.priceMusd} MUSD`).join(", ")}`);
const q = await quoteBorrow(relayer, "0", "0");
console.log(`borrow: min loan ${q.minLoanMusd} MUSD, min ratio ${q.minRatio}%, BTC $${Number(q.btcPrice).toFixed(0)}, recovery mode ${q.recoveryMode}`);
console.log("trove read ok:", (await getTroveHealth(relayer)).hasTrove === false);
