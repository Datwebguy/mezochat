// Usage: PRIVATE_KEY=0x... MEZO_NETWORK=testnet npx tsx scripts/deploy-registry.ts
import { readFileSync } from "node:fs";
import { createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../src/config.js";
import { mezoChain, publicClient } from "../src/mezo/client.js";

const key = process.env.PRIVATE_KEY as `0x${string}`;
if (!key) throw new Error("Set PRIVATE_KEY (the relayer that will pay gas)");
const account = privateKeyToAccount(key);
const bal = await publicClient.getBalance({ address: account.address });
console.log(`Deployer/relayer ${account.address} on ${config.chain.name}, balance ${formatEther(bal)} BTC`);
if (bal === 0n) throw new Error("Fund this address first (testnet faucet: https://faucet.test.mezo.org)");
const { abi, bytecode } = JSON.parse(readFileSync(new URL("../contracts/HandleRegistry.json", import.meta.url), "utf8"));
const wallet = createWalletClient({ account, chain: mezoChain, transport: http(config.rpcUrl) });
const hash = await wallet.deployContract({ abi, bytecode, args: [account.address] });
const rc = await publicClient.waitForTransactionReceipt({ hash });
console.log(`HandleRegistry deployed at ${rc.contractAddress}\n${config.chain.explorer}/address/${rc.contractAddress}`);
