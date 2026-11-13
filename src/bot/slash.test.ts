import { test } from "node:test";
import assert from "node:assert/strict";
process.env.TELEGRAM_BOT_TOKEN ??= "x";
const { fromSlash } = await import("./index.js");
const { parseOrder } = await import("../agent/parse.js");

test("slash commands map to orders", () => {
  const t = (s: string) => { const r = fromSlash(s); assert.ok(r && "text" in r, s); return parseOrder(r.text); };
  assert.equal(t("/balance").t, "balance");
  assert.equal(t("/balance@MezoChat_Bot").t, "balance");
  assert.deepEqual(t("/send 25 to @alice"), { t: "send", amount: "25", to: "@alice" });
  assert.deepEqual(t("/split 120 with @a1c @b0b"), { t: "split", amount: "120", with: ["@a1c", "@b0b"] });
  assert.equal(t("/pay 800 to @landlord on the 1st if ratio > 160").t, "recurring");
  assert.deepEqual(t("/buy amazon 50"), { t: "spend", item: "amazon", amount: "50" });
  assert.deepEqual(t("/alert 160"), { t: "alerts", threshold: 160 });
  assert.deepEqual(t("/alert off"), { t: "alerts", on: false });
  const u = fromSlash("/send");
  assert.ok(u && "usage" in u && u.usage.includes("/send 25 to @alice"));
  assert.equal(fromSlash("/nope"), null);
});
