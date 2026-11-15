// Tries getProductDetails(1001) on each address given (one per line in a file).
import { readFileSync } from "node:fs";
import { formatUnits, type Address } from "viem";
import { publicClient } from "../../src/mezo/client.js";
const abi = [{ type: "function", name: "getProductDetails", stateMutability: "view", inputs: [{ name: "productId", type: "uint32" }],
  outputs: [{ type: "tuple", components: [{ name: "price", type: "uint96" }, { name: "stock", type: "uint16" }, { name: "perCustomerLimit", type: "uint8" }] }] }] as const;
for (const a of readFileSync(process.argv[2], "utf8").split(/\s+/).filter(Boolean)) {
  try {
    await publicClient.readContract({ address: a as Address, abi, functionName: "getProductDetails", args: [1001] });
    console.log("STORE:", a);
    for (const id of [1001, 1002, 1003, 1004, 1005, 1006, 1007]) {
      const p = await publicClient.readContract({ address: a as Address, abi, functionName: "getProductDetails", args: [id] });
      console.log(`  ${id}: ${formatUnits(p.price, 18)} MUSD | stock ${p.stock} | limit ${p.perCustomerLimit}`);
    }
  } catch (e: any) { console.log("no:", a, (e.shortMessage ?? e.message).slice(0, 60)); }
}
