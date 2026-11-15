import { withStore } from "./registry/store.js";

/**
 * Background work (waiting for a tx, then messaging the user).
 * - Long-running server: runs immediately.
 * - Vercel: queued and run after the request has finished and saved its data, one job at a time,
 *   each with fresh data, kept alive with waitUntil. This avoids two jobs overwriting each other.
 */
let serverless = false;
const queue: (() => Promise<void>)[] = [];
export const setServerless = (v: boolean) => { serverless = v; };
export const isServerless = () => serverless;

export function background(fn: () => Promise<void>) {
  if (!serverless) { fn().catch(e => console.error("background job failed", e)); return; }
  queue.push(fn);
}

export async function drainBackground() {
  while (queue.length) {
    const fn = queue.shift()!;
    try { await withStore(fn); } catch (e) { console.error("background job failed", e); }
  }
}

/** How long to wait for a tx receipt: a long-running server can wait 10 min; Vercel functions are capped. */
export const txWaitMs = () => (serverless ? 240_000 : 600_000);
