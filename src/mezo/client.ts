import {
  createPublicClient, defineChain, encodeFunctionData, formatUnits, http,
  parseUnits, type Address,
} from "viem";
import { config } from "../config.js";

const c = config.chain;

export const mezoChain = defineChain({
  id: c.id,
  name: c.name,
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: c.explorer } },
});

export const publicClient = createPublicClient({ chain: mezoChain, transport: http(config.rpcUrl) });

const musdAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const troveManagerAbi = [
  { type: "function", name: "getCurrentICR", stateMutability: "view", inputs: [{ name: "b", type: "address" }, { name: "p", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTroveStatus", stateMutability: "view", inputs: [{ name: "b", type: "address" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "getTroveDebt", stateMutability: "view", inputs: [{ name: "b", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTroveColl", stateMutability: "view", inputs: [{ name: "b", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const priceFeedAbi = [
  { type: "function", name: "fetchPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const MUSD = c.musd as Address;

export interface Wallet { musd: string; btc: string }

/** MUSD plus native BTC (needed for gas). */
export async function getWallet(address: Address): Promise<Wallet> {
  const [musd, btc] = await Promise.all([
    publicClient.readContract({ address: MUSD, abi: musdAbi, functionName: "balanceOf", args: [address] }),
    publicClient.getBalance({ address }),
  ]);
  return { musd: formatUnits(musd, 18), btc: formatUnits(btc, 18) };
}

export interface TroveHealth {
  hasTrove: boolean;
  /** Collateral ratio in percent (e.g. 187.4). null when no active Trove. */
  ratio: number | null;
  collateralBtc: string;
  debtMusd: string;
  btcPrice: string;
}

export async function getBalance(address: Address): Promise<string> {
  const v = await publicClient.readContract({ address: MUSD, abi: musdAbi, functionName: "balanceOf", args: [address] });
  return formatUnits(v, 18);
}

export async function getTroveHealth(address: Address): Promise<TroveHealth> {
  const tm = c.troveManager as Address;
  const [status, price] = await Promise.all([
    publicClient.readContract({ address: tm, abi: troveManagerAbi, functionName: "getTroveStatus", args: [address] }),
    publicClient.readContract({ address: c.priceFeed as Address, abi: priceFeedAbi, functionName: "fetchPrice" }),
  ]);
  const btcPrice = formatUnits(price, 18);
  if (status !== 1) return { hasTrove: false, ratio: null, collateralBtc: "0", debtMusd: "0", btcPrice };
  const [icr, debt, coll] = await Promise.all([
    publicClient.readContract({ address: tm, abi: troveManagerAbi, functionName: "getCurrentICR", args: [address, price] }),
    publicClient.readContract({ address: tm, abi: troveManagerAbi, functionName: "getTroveDebt", args: [address] }),
    publicClient.readContract({ address: tm, abi: troveManagerAbi, functionName: "getTroveColl", args: [address] }),
  ]);
  return {
    hasTrove: true,
    ratio: Number(icr / 10n ** 14n) / 100, // 1e18 = 100% -> percent with 2 decimals
    collateralBtc: formatUnits(coll, 18),
    debtMusd: formatUnits(debt, 18),
    btcPrice,
  };
}

/** Unsigned MUSD transfer the user signs in their own wallet. The bot never holds user keys. */
export function buildTransfer(to: Address, amountMusd: string) {
  const value = parseUnits(amountMusd, 18);
  return {
    to: MUSD,
    data: encodeFunctionData({ abi: musdAbi, functionName: "transfer", args: [to, value] }),
    // EIP-681 link; most mobile wallets open it directly
    walletLink: `ethereum:${MUSD}@${c.id}/transfer?address=${to}&uint256=${value}`,
  };
}

export const txUrl = (hash: string) => `${c.explorer}/tx/${hash}`;
