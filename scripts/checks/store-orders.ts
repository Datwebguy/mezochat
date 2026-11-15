// Lists a wallet's orders in Mezo's Store contract. Usage: npx tsx scripts/store-orders.ts <address>
import { formatUnits, type Address } from "viem";
import { publicClient } from "../../src/mezo/client.js";
import { discoverProductIds, productInfo, storeAddress } from "../../src/mezo/market.js";
const abi = [{ type: "function", name: "getOrders", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "productId", type: "uint32" }],
  outputs: [{ type: "tuple[]", components: [{ name: "orderId", type: "uint32" }, { name: "productId", type: "uint32" }, { name: "price", type: "uint96" }] }] }] as const;
for (const p of (await discoverProductIds()).map(productInfo)) {
  const o = await publicClient.readContract({ address: storeAddress()!, abi, functionName: "getOrders", args: [process.argv[2] as Address, p.id] });
  for (const x of o) console.log(`order #${x.orderId}: product ${x.productId} (${p.name}) for ${formatUnits(x.price, 18)} MUSD`);
}
