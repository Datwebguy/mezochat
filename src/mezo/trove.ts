import { encodeFunctionData, formatUnits, parseUnits, type Address } from "viem";
import { config } from "../config.js";
import { MUSD, publicClient } from "./client.js";

const c = config.chain;
const v = (name: string, inputs: { name: string; type: string }[] = [], outputs = [{ type: "uint256" }]) =>
  ({ type: "function", name, stateMutability: "view", inputs, outputs }) as const;
const addr = (name: string) => ({ name, type: "address" });

const boAbi = [
  v("minNetDebt"),
  { type: "function", name: "addColl", stateMutability: "payable", inputs: [addr("_upperHint"), addr("_lowerHint")], outputs: [] },
  { type: "function", name: "repayMUSD", stateMutability: "nonpayable", inputs: [{ name: "_amount", type: "uint256" }, addr("_upperHint"), addr("_lowerHint")], outputs: [] },
  { type: "function", name: "closeTrove", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;
const tmAbi = [v("MUSD_GAS_COMPENSATION"), v("MCR"), v("CCR"),
  v("getTroveStatus", [addr("b")], [{ type: "uint8" }]), v("getTroveDebt", [addr("b")]), v("getTroveColl", [addr("b")]),
  v("checkRecoveryMode", [{ name: "p", type: "uint256" }], [{ type: "bool" }])] as const;
const pfAbi = [v("fetchPrice")] as const;
const erc20 = [v("balanceOf", [addr("a")])] as const;
const hhAbi = [{ type: "function", name: "getApproxHint", stateMutability: "view",
  inputs: [{ name: "_CR", type: "uint256" }, { name: "_numTrials", type: "uint256" }, { name: "_inputRandomSeed", type: "uint256" }],
  outputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }] }] as const;
const stAbi = [{ type: "function", name: "findInsertPosition", stateMutability: "view",
  inputs: [{ name: "_NICR", type: "uint256" }, addr("_prevId"), addr("_nextId")], outputs: [{ type: "address" }, { type: "address" }] }] as const;

export type TroveAction = "view" | "add" | "repay" | "close";

/** Live Trove state plus a ready-to-sign tx for the chosen action. Every number comes from Mezo or the user's input. */
export interface TroveQuote {
  ok: boolean;
  error?: string;
  hasTrove: boolean;
  action: TroveAction;
  amount: string;
  // live state
  collateralBtc: string;
  debtMusd: string;              // total debt incl. interest and the 200 MUSD deposit
  musdBalance: string;
  btcBalance: string;
  btcPrice: string;
  ratio: number;
  minRatio: number;
  recoveryMode: boolean;
  liquidationPrice: string;
  // limits for this wallet right now
  maxRepayMusd: string;          // repay more than this and the loan would fall under Mezo's minimum: close instead
  closeCostMusd: string;         // MUSD needed to close (debt minus the refundable deposit)
  // after the action
  newRatio?: number;
  newDebtMusd?: string;
  newCollateralBtc?: string;
  newLiquidationPrice?: string;
  tx?: { to: Address; data: `0x${string}`; value: string };
}

const read = <T>(address: string, abi: any, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: address as Address, abi, functionName, args }) as Promise<T>;

async function hints(coll: bigint, debt: bigint): Promise<[Address, Address]> {
  const nicr = (coll * 10n ** 20n) / debt;
  const [approx] = await read<[Address, bigint, bigint]>(c.hintHelpers, hhAbi, "getApproxHint", [nicr, 15n, 42n]);
  return read<[Address, Address]>(c.sortedTroves, stAbi, "findInsertPosition", [nicr, approx, approx]);
}

export async function quoteTrove(owner: Address, action: TroveAction, amount = "0"): Promise<TroveQuote> {
  const [status, price, minNet, gasComp, mcrW, ccrW, coll, debt, musdBal, btcBal] = await Promise.all([
    read<number>(c.troveManager, tmAbi, "getTroveStatus", [owner]),
    read<bigint>(c.priceFeed, pfAbi, "fetchPrice"),
    read<bigint>(c.borrowerOperations, boAbi, "minNetDebt"),
    read<bigint>(c.troveManager, tmAbi, "MUSD_GAS_COMPENSATION"),
    read<bigint>(c.troveManager, tmAbi, "MCR"),
    read<bigint>(c.troveManager, tmAbi, "CCR"),
    read<bigint>(c.troveManager, tmAbi, "getTroveColl", [owner]),
    read<bigint>(c.troveManager, tmAbi, "getTroveDebt", [owner]),
    read<bigint>(MUSD, erc20, "balanceOf", [owner]),
    publicClient.getBalance({ address: owner }),
  ]);
  const recoveryMode = await read<boolean>(c.troveManager, tmAbi, "checkRecoveryMode", [price]);
  const E18 = 10n ** 18n;
  const pct = (w: bigint) => Number(w / 10n ** 14n) / 100;
  const minW = recoveryMode ? ccrW : mcrW;
  const ratioOf = (cl: bigint, d: bigint) => (d > 0n ? Number((cl * price * 10000n) / (d * E18)) / 100 : 0);
  const liqOf = (cl: bigint, d: bigint) => (cl > 0n ? formatUnits((d * minW) / cl, 18) : "0");
  const B = (w: bigint, d = 6) => Number(formatUnits(w, 18)).toFixed(d);
  const M = (w: bigint) => Number(formatUnits(w, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });

  const hasTrove = status === 1;
  const netDebt = debt > gasComp ? debt - gasComp : 0n;           // what the user actually owes in MUSD
  const maxRepay = netDebt > minNet ? netDebt - minNet : 0n;
  const amt = /^\d{0,12}(\.\d{0,18})?$/.test(amount) && amount !== "" && amount !== "." ? parseUnits(amount, 18) : 0n;

  const q: TroveQuote = {
    ok: false, hasTrove, action, amount,
    collateralBtc: formatUnits(coll, 18), debtMusd: formatUnits(debt, 18),
    musdBalance: formatUnits(musdBal, 18), btcBalance: formatUnits(btcBal, 18), btcPrice: formatUnits(price, 18),
    ratio: ratioOf(coll, debt), minRatio: pct(minW), recoveryMode, liquidationPrice: liqOf(coll, debt),
    maxRepayMusd: formatUnits(maxRepay, 18), closeCostMusd: formatUnits(netDebt, 18),
  };
  const fail = (error: string): TroveQuote => ({ ...q, error });
  if (!hasTrove) return fail("You don't have an open loan. Use Borrow to open one.");
  if (action === "view") return { ...q, ok: true };

  let tx: { to: Address; data: `0x${string}`; value: string };
  let newColl = coll, newDebt = debt;
  if (action === "add") {
    if (amt === 0n) return fail("Enter how much BTC to add.");
    if (amt > btcBal) return fail(`Insufficient BTC. You entered ${B(amt)} BTC but have ${B(btcBal)}.`);
    newColl = coll + amt;
    const [u, l] = await hints(newColl, newDebt);
    tx = { to: c.borrowerOperations as Address, value: amt.toString(), data: encodeFunctionData({ abi: boAbi, functionName: "addColl", args: [u, l] }) };
  } else if (action === "repay") {
    if (amt === 0n) return fail(`Enter how much MUSD to repay. You can repay up to ${M(maxRepay)} MUSD; to pay off everything, close the loan.`);
    if (maxRepay === 0n) return fail(`Your loan is already at Mezo's ${M(minNet)} MUSD minimum. To pay it off, close the loan.`);
    if (amt > maxRepay) return fail(`You can repay up to ${M(maxRepay)} MUSD; the loan must stay at or above Mezo's ${M(minNet)} MUSD minimum. To pay off everything, close the loan.`);
    if (amt > musdBal) return fail(`Insufficient MUSD. You entered ${M(amt)} but have ${M(musdBal)}.`);
    newDebt = debt - amt;
    const [u, l] = await hints(newColl, newDebt);
    tx = { to: c.borrowerOperations as Address, value: "0", data: encodeFunctionData({ abi: boAbi, functionName: "repayMUSD", args: [amt, u, l] }) };
  } else {
    if (recoveryMode) return fail("Mezo is in recovery mode, so loans can't be closed right now. You can still add BTC or repay.");
    if (musdBal < netDebt) return fail(`To close you need ${M(netDebt)} MUSD; you have ${M(musdBal)}. You need ${M(netDebt - musdBal)} more MUSD.`);
    newColl = 0n; newDebt = 0n;
    tx = { to: c.borrowerOperations as Address, value: "0", data: encodeFunctionData({ abi: boAbi, functionName: "closeTrove", args: [] }) };
  }

  try { await publicClient.call({ account: owner, to: tx.to, data: tx.data, value: BigInt(tx.value) }); }   // dry-run on the real contract
  catch (e) { return fail(`Mezo would reject this: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`); }
  return {
    ...q, ok: true, tx,
    newRatio: ratioOf(newColl, newDebt), newDebtMusd: formatUnits(newDebt, 18),
    newCollateralBtc: formatUnits(newColl, 18), newLiquidationPrice: liqOf(newColl, newDebt),
  };
}
