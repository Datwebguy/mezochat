// Finds the Mezo Store contract on the configured network by searching for its OrderPlaced event,
// then reads the live products from it. Usage: MEZO_NETWORK=mainnet npx tsx scripts/find-store.ts
import { formatUnits, keccak256, toHex, type Address } from "viem";
import { config } from "../src/config.js";
import { publicClient } from "../src/mezo/client.js";

const topic = keccak256(toHex("OrderPlaced(uint32,address,uint32,uint96)"));
console.log(`${config.chain.name}: searching for OrderPlaced (${topic.slice(0, 10)}…)`);

// Sanity check on testnet: our own purchase (Store order #609) must contain this event.
if (config.network === "testnet") {
  const rc = await publicClient.getTransactionReceipt({ hash: "0x15095f35288455690aceae7a3e65a3f8816c90f8f2afa0dda8c274bd4cf83ec4" });
  const hit = rc.logs.find(l => l.topics[0] === topic);
  console.log("testnet order #609 emitted OrderPlaced from:", hit?.address);
}

const head = await publicClient.getBlockNumber();
const found = new Map<string, number>();
let step = 50_000n;
for (let to = head; to > 0n && found.size === 0; ) {
  const from = to > step ? to - step + 1n : 0n;
  try {
    const logs = await publicClient.request({ method: "eth_getLogs", params: [{ fromBlock: toHex(from), toBlock: toHex(to), topics: [topic] }] }) as { address: string }[];
    for (const l of logs) found.set(l.address.toLowerCase(), (found.get(l.address.toLowerCase()) ?? 0) + 1);
    if (logs.length) console.log(`blocks ${from}-${to}: ${logs.length} OrderPlaced events`);
    to = from - 1n;
  } catch (e) {
    if (step > 2_000n) { step /= 2n; continue; }       // RPC range limit: narrow the window
    throw e;
  }
  if (head - to > 6_000_000n) break;                    // searched far enough back
}
const abi = [{ type: "function", name: "getProductDetails", stateMutability: "view", inputs: [{ name: "p", type: "uint32" }],
  outputs: [{ type: "tuple", components: [{ name: "price", type: "uint96" }, { name: "stock", type: "uint16" }, { name: "perCustomerLimit", type: "uint8" }] }] }] as const;
for (const [addr, n] of found) {
  console.log(`\nSTORE: ${addr} (${n} recent orders)`);
  for (const id of [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]) {
    try {
      const p = await publicClient.readContract({ address: addr as Address, abi, functionName: "getProductDetails", args: [id] });
      if (p.price > 0n) console.log(`  product ${id}: ${formatUnits(p.price, 18)} MUSD | stock ${p.stock} | limit ${p.perCustomerLimit}`);
    } catch { /* not listed */ }
  }
}
if (!found.size) console.log("No OrderPlaced events found in the searched range.");
