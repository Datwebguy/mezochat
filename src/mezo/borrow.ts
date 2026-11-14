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

/** Every number here is computed from the user's input plus live Mezo data (contracts, balance, gas price). */
export interface BorrowQuote {
  ok: boolean;
  error?: string;            // blocks borrowing, says exactly what is missing
  warning?: string;          // allowed, but needs the user's explicit acknowledgement
  collateralBtc: string;
  borrowMusd: string;
  // live wallet + network data
  balanceBtc: string;
  gasReserveBtc: string;     // live gas price x openTrove gas
  availableBtc: string;      // balance minus gas reserve
  btcPrice: string;
  minRatio: number;          // Mezo's MCR, or CCR in recovery mode (read from the contract)
  safeRatio: number;         // the user's own /alert threshold
  recoveryMode: boolean;
  minLoanMusd: string;       // Mezo minNetDebt (includes the fee)
  minBorrowInput: string;    // smallest amount the user can type (minNetDebt minus fee)
  maxSafeBorrowMusd: string; // most they can borrow at their safety level with the BTC entered (or all available)
  // this loan
  feeMusd: string;
  liquidationDepositMusd: string;
  totalDebtMusd: string;
  ratio: number;
  liquidationPrice: string;
  dropToLiquidation: number;
  needBtcMin: string;        // BTC needed for this loan at Mezo's minimum
  needBtcSafe: string;       // BTC needed for this loan at the user's safety level
  tx?: { to: Address; data: `0x${string}`; value: string };
}

const OPEN_TROVE_GAS = 700_000n;  // measured ~590k on testnet, plus headroom

export async function quoteBorrow(borrower: Address, collateralBtc: string, borrowMusd: string, safeRatio = config.defaultThreshold): Promise<BorrowQuote> {
  const coll = parseUnits(collateralBtc || "0", 18);
  const debt = parseUnits(borrowMusd || "0", 18);
  const read = <T>(address: string, abi: any, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: address as Address, abi, functionName, args }) as Promise<T>;

  const [minNet, gasComp, price, fee, unitFee, status, mcrW, ccrW, balance, gasPrice] = await Promise.all([
    read<bigint>(c.borrowerOperations, boAbi, "minNetDebt"),
    read<bigint>(c.troveManager, tmAbi, "MUSD_GAS_COMPENSATION"),
    read<bigint>(c.priceFeed, pfAbi, "fetchPrice"),
    read<bigint>(c.borrowerOperations, boAbi, "getBorrowingFee", [debt]),
    read<bigint>(c.borrowerOperations, boAbi, "getBorrowingFee", [10n ** 18n]),   // fee per 1 MUSD
    read<number>(c.troveManager, tmAbi, "getTroveStatus", [borrower]),
    read<bigint>(c.troveManager, tmAbi, "MCR"),
    read<bigint>(c.troveManager, tmAbi, "CCR"),
    publicClient.getBalance({ address: borrower }),
    publicClient.getGasPrice(),
  ]);
  const recoveryMode = await read<boolean>(c.troveManager, tmAbi, "checkRecoveryMode", [price]);
  const E18 = 10n ** 18n;
  const pct = (w: bigint) => Number(w / 10n ** 14n) / 100;            // 1.1e18 -> 110
  const minW = recoveryMode ? ccrW : mcrW;
  const minRatio = pct(minW);
  const safe = Math.max(safeRatio, minRatio);
  const safeW = BigInt(Math.round(safe * 100)) * 10n ** 14n;
  const gasReserve = gasPrice * OPEN_TROVE_GAS * 2n;                  // 2x: price swings + one follow-up tx
  const available = balance > gasReserve ? balance - gasReserve : 0n;

  const total = debt + fee + gasComp;
  const ratio = total > 0n && coll > 0n ? Number((coll * price * 10000n) / (total * E18)) / 100 : 0;
  const liq = coll > 0n ? (total * minW) / coll : 0n;
  const drop = liq > 0n && price > liq ? Number(((price - liq) * 10000n) / price) / 100 : 0;
  const needFor = (w: bigint) => (total * w + price - 1n) / price;    // BTC so that coll*price/total >= w
  const needMin = debt > 0n ? needFor(minW) : 0n;
  const needSafe = debt > 0n ? needFor(safeW) : 0n;
  // Max borrow at the safety level for the BTC entered (or everything available), net of fee
  const base = coll > 0n ? coll : available;
  const grossMax = (base * price) / safeW;
  const maxSafe = grossMax > gasComp ? ((grossMax - gasComp) * E18) / (E18 + unitFee) : 0n;
  const minInput = (minNet * E18 + (E18 + unitFee) - 1n) / (E18 + unitFee);

  const B = (w: bigint, d = 4) => (w > 0n && Number(formatUnits(w, 18)) < 10 ** -d ? `<${(10 ** -d).toFixed(d)}` : Number(formatUnits(w, 18)).toFixed(d));
  const M = (w: bigint) => Math.floor(Number(formatUnits(w, 18))).toLocaleString("en-US");
  const q: BorrowQuote = {
    ok: false, collateralBtc, borrowMusd,
    balanceBtc: formatUnits(balance, 18), gasReserveBtc: formatUnits(gasReserve, 18), availableBtc: formatUnits(available, 18),
    btcPrice: formatUnits(price, 18), minRatio, safeRatio: safe, recoveryMode,
    minLoanMusd: formatUnits(minNet, 18), minBorrowInput: String(Math.ceil(Number(formatUnits(minInput, 18)))),
    maxSafeBorrowMusd: formatUnits(maxSafe, 18),
    feeMusd: formatUnits(fee, 18), liquidationDepositMusd: formatUnits(gasComp, 18), totalDebtMusd: formatUnits(total, 18),
    ratio, liquidationPrice: formatUnits(liq, 18), dropToLiquidation: drop,
    needBtcMin: formatUnits(needMin, 18), needBtcSafe: formatUnits(needSafe, 18),
  };
  const fail = (error: string): BorrowQuote => ({ ...q, error });
  if (status === 1) return fail("This wallet already has an open Trove. Mezo allows one per wallet.");
  if (debt === 0n) return fail(`Enter how much MUSD to borrow. Mezo's minimum is ${M(minNet)} MUSD including the fee.`);
  if (debt + fee < minNet) return fail(`Minimum loan is ${M(minNet)} MUSD including the fee. Enter at least ${q.minBorrowInput} MUSD.`);
  if (coll === 0n) return fail(`Enter BTC to deposit. For ${M(debt)} MUSD you need at least ${B(needMin)} BTC (Mezo minimum ${minRatio}%), or ${B(needSafe)} BTC to stay at your ${safe}% safety level.`);
  if (coll > available) return fail(`Insufficient BTC. You entered ${B(coll, 6)} BTC but can deposit up to ${B(available, 6)} (you have ${B(balance, 6)}; ${B(gasReserve, 6)} is kept for gas).`);
  if (coll < needMin) return fail(`Not enough collateral. For ${M(debt)} MUSD you need at least ${B(needMin)} BTC (Mezo minimum ${minRatio}%${recoveryMode ? ", recovery mode" : ""}). You entered ${B(coll)}.`);
  const warning = coll < needSafe
    ? `This is below your ${safe}% safety level. If BTC drops ${drop}% (to $${Number(formatUnits(liq, 18)).toFixed(0)}) your BTC can be liquidated. ${B(needSafe)} BTC would keep you safe${needSafe > available ? ` (you can deposit up to ${B(available)})` : ""}.`
    : undefined;

  const nicr = (coll * 10n ** 20n) / total;     // NICR hint for SortedTroves
  const [approx] = await read<[Address, bigint, bigint]>(c.hintHelpers, hhAbi, "getApproxHint", [nicr, 15n, 42n]);
  const [upper, lower] = await read<[Address, Address]>(c.sortedTroves, stAbi, "findInsertPosition", [nicr, approx, approx]);
  const tx = { to: c.borrowerOperations as Address, value: coll.toString(),
    data: encodeFunctionData({ abi: boAbi, functionName: "openTrove", args: [debt, upper, lower] }) };
  try { await publicClient.call({ account: borrower, to: tx.to, data: tx.data, value: coll }); }   // dry-run on the real contract
  catch (e) { return fail(`Mezo would reject this: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`); }
  return { ...q, ok: true, warning, tx };
}
