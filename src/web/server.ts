import { createServer, type IncomingMessage } from "node:http";
import { getAddress, isAddress, isHash, parseEventLogs, parseUnits, verifyMessage as verifySig, type Address, type Hash } from "viem";
import { config, web } from "../config.js";
import { MUSD, buildTransfer, publicClient } from "../mezo/client.js";
import { getSession, markDone, type Session } from "./sessions.js";
import { page } from "./page.js";
import { miniBundle, miniHtml } from "./mini.js";
import { verifyInitData } from "./telegram.js";
import { quoteBorrow } from "../mezo/borrow.js";

const transferEvent = [{ type: "event", name: "Transfer", inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] }] as const;

export interface WebHooks {
  onVerified(telegramId: number, address: Address, wallet?: "mini" | "external"): Promise<void>;
  /** In-Telegram borrow submitted; the hook confirms it and reports in chat. */
  onBorrowed?(telegramId: number, hash: Hash, coll: string, debt: string): Promise<void>;
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
      if (req.method === "GET" && url.pathname === "/mini") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(miniHtml()); }
      if (req.method === "GET" && url.pathname === "/mini.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" }); return res.end(await miniBundle());
      }
      if (req.method === "GET" && url.pathname === "/api/borrow/quote") {
        const a = url.searchParams.get("address") ?? "";
        const num = (k: string) => { const v = (url.searchParams.get(k) ?? "").trim(); return /^\d{0,12}(\.\d{0,18})?$/.test(v) && v !== "" && v !== "." ? v : "0"; };
        if (!isAddress(a)) return json(400, { error: "Bad address" });
        return json(200, await quoteBorrow(a, num("coll"), num("debt")));
      }
      if (req.method === "POST" && url.pathname === "/api/mini/link") {
        const b = await body(req);
        const who = verifyInitData(b.initData, config.botToken);
        if (!who) return json(401, { error: "Open this from the MezoChat bot in Telegram." });
        if (!isAddress(b.address) || typeof b.message !== "string" || typeof b.signature !== "string") return json(400, { error: "Bad request" });
        if (!b.message.includes(`Telegram user ${who.id}.`) || !b.message.includes(b.address)) return json(400, { error: "Message mismatch" });
        const t = Date.parse((b.message.match(/Time: (.+)$/m) ?? [])[1] ?? "");
        if (!(Math.abs(Date.now() - t) < 10 * 60_000)) return json(400, { error: "Link request expired. Try again." });
        if (!(await verifySig({ address: b.address, message: b.message, signature: b.signature }))) return json(400, { error: "Bad signature" });
        await hooks.onVerified(who.id, getAddress(b.address), "mini");
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/mini/borrowed") {
        const b = await body(req);
        const who = verifyInitData(b.initData, config.botToken);
        if (!who) return json(401, { error: "Open this from the MezoChat bot in Telegram." });
        if (!isHash(b.txHash)) return json(400, { error: "Bad request" });
        json(200, { ok: true });
        hooks.onBorrowed?.(who.id, b.txHash, String(b.coll ?? ""), String(b.debt ?? "")).catch(e => console.error("onBorrowed", e));
        return;
      }
      const st = url.pathname.match(/^\/api\/session\/([0-9a-f]{24})\/status$/);
      if (st && req.method === "GET") {
        const x = getSession(st[1]);
        return x ? json(200, { kind: x.kind, done: !!x.done }) : json(404, { error: "Session expired" });
      }
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
  miniBundle().catch(e => console.error("mini app bundle failed", e)); // build at startup, not on first visit
  server.listen(web.port, () => console.log(`Web signer on :${web.port}${web.publicUrl ? " (" + web.publicUrl + ")" : " (set PUBLIC_URL to enable)"}`));
  return server;
}
