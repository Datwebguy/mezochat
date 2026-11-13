import { getTroveHealth, type TroveHealth } from "../mezo/client.js";
import type { User } from "../registry/store.js";
import type { Address } from "viem";

export interface Gate { ok: boolean; ratio: number | null; threshold: number; health: TroveHealth; reason?: string; }

/** Reads the live Trove ratio and compares to the user's threshold. No Trove = no collateral risk, so it passes. */
export async function ratioGate(user: User): Promise<Gate> {
  const health = await getTroveHealth(user.address as Address);
  if (health.ratio === null) return { ok: true, ratio: null, threshold: user.threshold, health };
  if (health.ratio < user.threshold)
    return { ok: false, ratio: health.ratio, threshold: user.threshold, health,
      reason: `Your Trove ratio is ${health.ratio}%, below your ${user.threshold}% safety threshold.` };
  return { ok: true, ratio: health.ratio, threshold: user.threshold, health };
}

export const fmtRatio = (r: number | null) => (r === null ? "no Trove" : `${r}%`);
