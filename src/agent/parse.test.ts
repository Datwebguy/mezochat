import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrder } from "./parse.js";

test("parses core orders", () => {
  assert.deepEqual(parseOrder("balance"), { t: "balance" });
  assert.deepEqual(parseOrder("send 25 to @alice"), { t: "send", amount: "25", to: "@alice" });
  assert.deepEqual(parseOrder("Send Alice 20 for lunch"), { t: "send", amount: "20", to: "alice" });
  assert.deepEqual(parseOrder("request 40 from @bob"), { t: "request", amount: "40", from: "@bob" });
  assert.deepEqual(parseOrder("split 120 with @alice @bob"), { t: "split", amount: "120", with: ["@alice", "@bob"] });
  assert.deepEqual(parseOrder("pay 800 to @landlord on the 1st if ratio > 160"), { t: "recurring", amount: "800", to: "@landlord", day: 1, minRatio: 160 });
  assert.deepEqual(parseOrder("buy amazon 50"), { t: "spend", item: "amazon", amount: "50" });
  assert.deepEqual(parseOrder("Don't let me spend if my ratio drops under 170"), { t: "alerts", threshold: 170 });
  assert.deepEqual(parseOrder("set alert 150"), { t: "alerts", threshold: 150 });
  assert.deepEqual(parseOrder("whois @alice"), { t: "whois", who: "@alice" });
  assert.equal(parseOrder("gibberish").t, "unknown");
});
