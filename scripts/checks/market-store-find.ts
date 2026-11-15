// Finds the Mezo Store contract: the address in the Market bundle that answers getProductDetails(1001..1007).
import { readFileSync } from "node:fs";
import { formatUnits, type Address } from "viem";
import { publicClient } from "../../src/mezo/client.js";
const abi = [{ type: "function", name: "getProductDetails", stateMutability: "view", inputs: [{ name: "productId", type: "uint32" }],
  outputs: [{ type: "tuple", components: [{ name: "price", type: "uint96" }, { name: "stock", type: "uint16" }, { name: "perCustomerLimit", type: "uint8" }] }] }] as const;
const all = readFileSync(process.argv[2], "utf8");
const addrs = [...new Set([...all.matchAll(/0x[0-9a-fA-F]{40}/g)].map(m => m[0]))];
console.log("candidate addresses:", addrs.length);
for (const a of addrs) {
  try {
    const code = await publicClient.getCode({ address: a as Address }); if (!code || code === "0x") continue;
    const d = await publicClient.readContract({ address: a as Address, abi, functionName: "getProductDetails", args: [1001] });
    console.log("STORE FOUND:", a);
    for (const id of [1001, 1002, 1003, 1004, 1005, 1006, 1007]) {
      const p = await publicClient.readContract({ address: a as Address, abi, functionName: "getProductDetails", args: [id] });
      console.log(`  product ${id}: price ${formatUnits(p.price, 18)} MUSD | stock ${p.stock} | per-customer limit ${p.perCustomerLimit}`);
    }
    break;
  } catch { /* not the store */ }
}
