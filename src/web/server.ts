import { createServer, type IncomingMessage } from "node:http";
import { getAddress, isAddress, isHash, parseEventLogs, parseUnits, verifyMessage as verifySig, type Address, type Hash } from "viem";
import { config, web } from "../config.js";
import { MUSD, buildTransfer, publicClient } from "../mezo/client.js";
import { getSession, markDone, type Session } from "./sessions.js";
import { page } from "./page.js";

const transferEvent = [{ type: "event", name: "Transfer", inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] }] as const;

export interface WebHooks {
  onVerified(telegramId: number, address: Address): Promise<void>;
  /** expectedFrom = the user's linked address; null if unknown */
  expectedFrom(telegramId: number): Address | null;
  onPaid(s: Extract<Session, { kind: "pay" }>, hash: Hash, ok: boolean, reason?: string): Promise<void>;
}

async function body(req: IncomingMessage): Promise<any> {
  let raw = ""; for await (const c of req) { raw += c; if (raw.length > 10_000) throw new Error("too large"); }
  return JSON.parse(raw || "{}");
}

/** Waits for the tx, then checks it really moved the expected MUSD to the expected recipient. */
export async function confirmTransfer(hash: Hash, from: Address, to: Address, amount: string) {
  const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 10 * 60_000 });
  if (rc.status !== "success") return { ok: false, reason: "Transaction reverted." };
  const logs = parseEventLogs({ abi: transferEvent, logs: rc.logs.filter(l => l.address.toLowerCase() === MUSD.toLowerCase()) });
  const want = parseUnits(amount, 18);
  const hit = logs.find(l => l.args.from.toLowerCase() === from.toLowerCase() && l.args.to.toLowerCase() === to.toLowerCase() && l.args.value === want);
  return hit ? { ok: true } : { ok: false, reason: "No matching MUSD transfer in that transaction." };
}

export function startServer(hooks: WebHooks) {
  const html = page({ ...config.chain, rpc: config.rpcUrl });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (code: number, data: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return json(200, { ok: true });
      if (req.method === "GET" && url.pathname === "/app") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html); }
      const m = url.pathname.match(/^\/api\/session\/([0-9a-f]{24})$/);
      if (!m) return json(404, { error: "Not found" });
      const s = getSession(m[1]);
      if (!s || s.done) return json(404, { error: "Session expired" });

      if (req.method === "GET") {
        if (s.kind === "verify") return json(200, { kind: s.kind, message: s.message });
        const tx = buildTransfer(s.to as Address, s.amount);
        return json(200, { kind: s.kind, amount: s.amount, tx: { to: tx.to, data: tx.data },
          summary: `${s.action}: ${s.amount} MUSD → ${s.label}\nRatio checked: ${s.ratio === null ? "no Trove" : s.ratio + "%"}` });
      }
      if (req.method !== "POST") return json(405, { error: "Method not allowed" });
      const b = await body(req);

      if (s.kind === "verify") {
        if (!isAddress(b.address) || typeof b.signature !== "string") return json(400, { error: "Bad request" });
        const ok = await verifySig({ address: b.address, message: s.message, signature: b.signature });
        if (!ok) return json(400, { error: "Signature does not match this wallet." });
        markDone(s);
        await hooks.onVerified(s.telegramId, getAddress(b.address));
        return json(200, { ok: true });
      }

      if (!isHash(b.txHash) || !isAddress(b.from)) return json(400, { error: "Bad request" });
      const expected = hooks.expectedFrom(s.telegramId);
      if (expected && expected.toLowerCase() !== b.from.toLowerCase())
        return json(400, { error: `Pay from your linked wallet ${expected}.` });
      markDone(s);
      json(200, { ok: true });
      confirmTransfer(b.txHash, b.from, s.to as Address, s.amount)
        .then(r => hooks.onPaid(s, b.txHash, r.ok, r.reason))
        .catch(e => hooks.onPaid(s, b.txHash, false, (e as Error).message));
    } catch (e) {
      if (!res.headersSent) json(500, { error: (e as Error).message });
    }
  });
  server.listen(web.port, () => console.log(`Web signer on :${web.port}${web.publicUrl ? " (" + web.publicUrl + ")" : " (set PUBLIC_URL to enable)"}`));
  return server;
}
