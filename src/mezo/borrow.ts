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
const tmAbi = [v("MUSD_GAS_COMPENSATION"), v("MCR"), v("CCR"), v("getTroveStatus", [{ name: "b", type: "address" }], [{ type: "uint8" }]),
  v("checkRecoveryMode", [{ name: "p", type: "uint256" }], [{ type: "bool" }])] as const;
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
  liquidationPrice: string;   // BTC price at which the ratio hits Mezo's minimum
  dropToLiquidation: number;  // % BTC can fall before liquidation
  minRatio: number;           // Mezo's minimum right now (MCR, or CCR in recovery mode)
  safeRatio: number;          // below this we require an explicit risk acknowledgement
  recoveryMode: boolean;
  risky: boolean;
  suggestion?: { collateralBtc: string; borrowMusd: string; note?: string };
  tx?: { to: Address; data: `0x${string}`; value: string };
}

export const SAFE_RATIO = 150;
const GAS_RESERVE = 10n ** 15n; // keep 0.001 BTC for gas

/** Quote and build an openTrove tx. Collateral is native BTC sent as msg.value. */
export async function quoteBorrow(borrower: Address, collateralBtc: string, borrowMusd: string): Promise<BorrowQuote> {
  const coll = parseUnits(collateralBtc || "0", 18);
  const debt = parseUnits(borrowMusd || "0", 18);
  const read = <T>(address: string, abi: any, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: address as Address, abi, functionName, args }) as Promise<T>;

  const [minNet, gasComp, price, fee, status, mcrW, ccrW, balance] = await Promise.all([
    read<bigint>(c.borrowerOperations, boAbi, "minNetDebt"),
    read<bigint>(c.troveManager, tmAbi, "MUSD_GAS_COMPENSATION"),
    read<bigint>(c.priceFeed, pfAbi, "fetchPrice"),
    read<bigint>(c.borrowerOperations, boAbi, "getBorrowingFee", [debt]),
    read<number>(c.troveManager, tmAbi, "getTroveStatus", [borrower]),
    read<bigint>(c.troveManager, tmAbi, "MCR"),
    read<bigint>(c.troveManager, tmAbi, "CCR"),
    publicClient.getBalance({ address: borrower }),
  ]);
  const recoveryMode = await read<boolean>(c.troveManager, tmAbi, "checkRecoveryMode", [price]);
  const pct = (w: bigint) => Number(w / 10n ** 14n) / 100;   // 1.1e18 -> 110
  const minRatio = recoveryMode ? pct(ccrW) : pct(mcrW);
  const safeRatio = Math.max(SAFE_RATIO, minRatio + 10);
  const total = debt + fee + gasComp;
  const ratio = total > 0n ? Number((coll * price * 10000n) / (total * 10n ** 18n)) / 100 : 0;
  const minW = recoveryMode ? ccrW : mcrW;
  const liq = coll > 0n ? (total * minW) / coll : 0n;
  const dropToLiquidation = liq > 0n && price > liq ? Number(((price - liq) * 10000n) / price) / 100 : 0;

  // Suggest: deposit everything except a gas reserve, borrow what keeps the ratio at the safe level.
  const sColl = balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n;
  const feeRate = debt > 0n ? Number(fee * 10n ** 6n / debt) / 1e6 : 0.001;
  const sDebtNum = (Number(formatUnits(sColl * price / 10n ** 18n, 18)) * 100 / safeRatio - Number(formatUnits(gasComp, 18))) / (1 + feeRate);
  const minDebtNum = Math.ceil(Number(formatUnits(minNet, 18)) / (1 + feeRate));
  // BTC needed so the smallest loan sits at the safe ratio: (minNet + gasComp) * safe% / price
  const safeCollForMin = ((minNet + gasComp) * BigInt(Math.round(safeRatio * 100)) * 10n ** 18n) / (price * 10000n) + GAS_RESERVE;
  const suggestion = sDebtNum >= minDebtNum
    ? { collateralBtc: Number(formatUnits(sColl, 18)).toFixed(6), borrowMusd: String(Math.floor(sDebtNum)) }
    : { collateralBtc: Number(formatUnits(sColl, 18)).toFixed(6), borrowMusd: String(minDebtNum),
        note: `Mezo's smallest loan is ${Number(formatUnits(minNet, 18)).toLocaleString("en-US")} MUSD including the fee (borrow ${minDebtNum.toLocaleString("en-US")}). To borrow it at a safe ${safeRatio}% you need about ${Number(formatUnits(safeCollForMin, 18)).toFixed(4)} BTC; you have ${Number(formatUnits(balance, 18)).toFixed(4)}.` };

  const q: BorrowQuote = {
    ok: false,
    collateralBtc, borrowMusd,
    feeMusd: formatUnits(fee, 18),
    liquidationDepositMusd: formatUnits(gasComp, 18),
    totalDebtMusd: formatUnits(total, 18),
    minBorrowMusd: formatUnits(minNet, 18),
    btcPrice: formatUnits(price, 18),
    ratio, liquidationPrice: formatUnits(liq, 18), dropToLiquidation,
    minRatio, safeRatio, recoveryMode, risky: ratio < safeRatio, suggestion,
  };
  if (status === 1) return { ...q, error: "This wallet already has an open Trove. Mezo allows one per wallet." };
  if (coll === 0n) return { ...q, error: "Enter how much BTC to deposit." };
  if (debt + fee < minNet) return { ...q, error: `The smallest loan is ${Number(formatUnits(minNet, 18)).toLocaleString()} MUSD (including the fee).` };
  if (ratio < minRatio) return { ...q, error: `Ratio ${ratio}% is below Mezo's ${minRatio}% minimum${recoveryMode ? " (Mezo is in recovery mode)" : ""}. Add BTC or borrow less.` };
  if (balance < coll + GAS_RESERVE) return { ...q, error: `You have ${Number(formatUnits(balance, 18)).toFixed(6)} BTC. Keep about 0.001 BTC for gas.` };

  // Hints let SortedTroves insert the Trove cheaply. NICR = coll * 1e20 / totalDebt.
  const nicr = (coll * 10n ** 20n) / total;
  const [approx] = await read<[Address, bigint, bigint]>(c.hintHelpers, hhAbi, "getApproxHint", [nicr, 15n, 42n]);
  const [upper, lower] = await read<[Address, Address]>(c.sortedTroves, stAbi, "findInsertPosition", [nicr, approx, approx]);
  const tx = { to: c.borrowerOperations as Address, value: coll.toString(),
    data: encodeFunctionData({ abi: boAbi, functionName: "openTrove", args: [debt, upper, lower] }) };
  // Dry-run against the real contract so the user never signs something that would revert.
  try { await publicClient.call({ account: borrower, to: tx.to, data: tx.data, value: coll }); }
  catch (e) { return { ...q, error: `Mezo would reject this: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}` }; }
  return { ...q, ok: true, tx };
}
