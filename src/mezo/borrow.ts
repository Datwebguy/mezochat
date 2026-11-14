import { encodeFunctionData, formatUnits, parseUnits, type Address } from "viem";
import { config } from "../config.js";
import { publicClient } from "./client.js";

const c = config.chain;
const v = (name: string, inputs: { name: string; type: string }[] = [], outputs = [{ type: "uint256" }]) =>
  ({ type: "function", name, stateMutability: "view", inputs, outputs }) as const;

const boAbi = [
  v("minNetDebt"),
  v("getBorrowingFee", [{ name: "d", type: "uint256" }]),
  { type: "function", name: "openTrove", stateMutability: "payable",
    inputs: [{ name: "_debtAmount", type: "uint256" }, { name: "_upperHint", type: "address" }, { name: "_lowerHint", type: "address" }], outputs: [] },
] as const;
const tmAbi = [v("MUSD_GAS_COMPENSATION"), v("getTroveStatus", [{ name: "b", type: "address" }], [{ type: "uint8" }])] as const;
const pfAbi = [v("fetchPrice")] as const;
const hhAbi = [{ type: "function", name: "getApproxHint", stateMutability: "view",
  inputs: [{ name: "_CR", type: "uint256" }, { name: "_numTrials", type: "uint256" }, { name: "_inputRandomSeed", type: "uint256" }],
  outputs: [{ name: "hintAddress", type: "address" }, { name: "diff", type: "uint256" }, { name: "latestRandomSeed", type: "uint256" }] }] as const;
const stAbi = [{ type: "function", name: "findInsertPosition", stateMutability: "view",
  inputs: [{ name: "_NICR", type: "uint256" }, { name: "_prevId", type: "address" }, { name: "_nextId", type: "address" }],
  outputs: [{ type: "address" }, { type: "address" }] }] as const;

export interface BorrowQuote {
  ok: boolean;
  error?: string;
  collateralBtc: string;
  borrowMusd: string;
  feeMusd: string;
  liquidationDepositMusd: string;
  totalDebtMusd: string;
  minBorrowMusd: string;
  btcPrice: string;
  ratio: number;              // collateral ratio in %, e.g. 165.2
  liquidationPrice: string;   // BTC price at which ratio hits 110%
  tx?: { to: Address; data: `0x${string}`; value: string };
}

const MCR = 110;

/** Quote and build an openTrove tx. Collateral is native BTC sent as msg.value. */
export async function quoteBorrow(borrower: Address, collateralBtc: string, borrowMusd: string): Promise<BorrowQuote> {
  const coll = parseUnits(collateralBtc || "0", 18);
  const debt = parseUnits(borrowMusd || "0", 18);
  const read = <T>(address: string, abi: any, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: address as Address, abi, functionName, args }) as Promise<T>;

  const [minNet, gasComp, price, fee, status] = await Promise.all([
    read<bigint>(c.borrowerOperations, boAbi, "minNetDebt"),
    read<bigint>(c.troveManager, tmAbi, "MUSD_GAS_COMPENSATION"),
    read<bigint>(c.priceFeed, pfAbi, "fetchPrice"),
    read<bigint>(c.borrowerOperations, boAbi, "getBorrowingFee", [debt]),
    read<number>(c.troveManager, tmAbi, "getTroveStatus", [borrower]),
  ]);
  const total = debt + fee + gasComp;
  const ratio = total > 0n ? Number((coll * price * 10000n) / (total * 10n ** 18n)) / 100 : 0;
  const liq = coll > 0n ? (total * BigInt(MCR) * 10n ** 18n) / (coll * 100n) : 0n;
  const q: BorrowQuote = {
    ok: false,
    collateralBtc, borrowMusd,
    feeMusd: formatUnits(fee, 18),
    liquidationDepositMusd: formatUnits(gasComp, 18),
    totalDebtMusd: formatUnits(total, 18),
    minBorrowMusd: formatUnits(minNet - fee > 0n ? minNet - fee : minNet, 18),
    btcPrice: formatUnits(price, 18),
    ratio,
    liquidationPrice: formatUnits(liq, 18),
  };
  if (status === 1) return { ...q, error: "This wallet already has an open Trove. Mezo allows one per wallet." };
  if (coll === 0n) return { ...q, error: "Enter how much BTC to deposit." };
  if (debt + fee < minNet) return { ...q, error: `The smallest loan is ${Number(formatUnits(minNet, 18)).toLocaleString()} MUSD (including the fee).` };
  if (ratio < MCR) return { ...q, error: `Ratio ${ratio}% is below Mezo's ${MCR}% minimum. Add BTC or borrow less.` };
  const balance = await publicClient.getBalance({ address: borrower });
  if (balance < coll) return { ...q, error: `You only have ${Number(formatUnits(balance, 18)).toFixed(6)} BTC.` };

  // Hints let SortedTroves insert the Trove cheaply. NICR = coll * 1e20 / totalDebt.
  const nicr = (coll * 10n ** 20n) / total;
  const [approx] = await read<[Address, bigint, bigint]>(c.hintHelpers, hhAbi, "getApproxHint", [nicr, 15n, 42n]);
  const [upper, lower] = await read<[Address, Address]>(c.sortedTroves, stAbi, "findInsertPosition", [nicr, approx, approx]);
  return {
    ...q, ok: true,
    tx: { to: c.borrowerOperations as Address, value: coll.toString(),
      data: encodeFunctionData({ abi: boAbi, functionName: "openTrove", args: [debt, upper, lower] }) },
  };
}
