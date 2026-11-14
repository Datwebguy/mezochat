import { readFileSync } from "node:fs";
import { createWalletClient, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, registry } from "../config.js";
import { mezoChain, publicClient } from "./client.js";

const { abi } = JSON.parse(readFileSync(new URL("../../contracts/HandleRegistry.json", import.meta.url), "utf8"));

export const registryEnabled = () => !!registry.address && !!registry.relayerKey;
/** Reads only need the contract address. */
export const registryReadable = () => !!registry.address;

/** Relayer writes handle -> owner on-chain after the bot verified wallet ownership by signature. */
export async function claimOnChain(handle: string, owner: Address): Promise<Hash> {
  const account = privateKeyToAccount(registry.relayerKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: mezoChain, transport: http(config.rpcUrl) });
  return wallet.writeContract({ address: registry.address as Address, abi, functionName: "claimFor", args: [handle, owner] });
}

export async function resolveOnChain(handle: string): Promise<Address | null> {
  if (!registry.address) return null;
  const a = await publicClient.readContract({ address: registry.address as Address, abi, functionName: "resolve", args: [handle] }) as Address;
  return /^0x0{40}$/.test(a) ? null : a;
}
