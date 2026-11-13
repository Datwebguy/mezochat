import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
process.env.PORT = "3999";
const { startServer } = await import("./server.js");
const { createSession, verifyMessage } = await import("./sessions.js");

test("verify + pay sessions", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  let verified: string | null = null;
  const srv = startServer({ onVerified: async (_id, a) => { verified = a; }, expectedFrom: () => acct.address, onPaid: async () => {} });
  await new Promise(r => setTimeout(r, 200));
  const base = "http://127.0.0.1:3999";

  const v = createSession({ kind: "verify", telegramId: 1, message: verifyMessage(1) });
  const g = await (await fetch(`${base}/api/session/${v.id}`)).json();
  assert.equal(g.kind, "verify");
  const bad = await fetch(`${base}/api/session/${v.id}`, { method: "POST", body: JSON.stringify({ address: acct.address, signature: await acct.signMessage({ message: "wrong" }) }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(`${base}/api/session/${v.id}`, { method: "POST", body: JSON.stringify({ address: acct.address, signature: await acct.signMessage({ message: g.message }) }) });
  assert.equal(ok.status, 200);
  assert.equal(verified, acct.address);

  const p = createSession({ kind: "pay", telegramId: 1, to: "0x000000000000000000000000000000000000dEaD", label: "@bob", amount: "25", action: "Send", ratio: 180 });
  const pg = await (await fetch(`${base}/api/session/${p.id}`)).json();
  assert.match(pg.tx.data, /^0xa9059cbb/); // ERC-20 transfer selector
  const wrongFrom = await fetch(`${base}/api/session/${p.id}`, { method: "POST", body: JSON.stringify({ txHash: "0x" + "1".repeat(64), from: "0x000000000000000000000000000000000000bEEF" }) });
  assert.equal(wrongFrom.status, 400);
  assert.equal((await fetch(`${base}/app`)).status, 200);
  srv.close();
});
