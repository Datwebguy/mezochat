import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-")), "db.json");
const { store } = await import("../registry/store.js");
const { run } = await import("./index.js");
const { parseOrder } = await import("../agent/parse.js");

test("recurring list/cancel and split status", async () => {
  store.register(1, "alice", "0x00000000000000000000000000000000000000A1");
  store.register(2, "bob", "0x00000000000000000000000000000000000000B2");
  const me = store.user(1)!;
  store.addRecurring({ owner: 1, to: "0x00000000000000000000000000000000000000B2", amount: "800", day: 1, minRatio: 160 });
  store.addRecurring({ owner: 1, to: "0x00000000000000000000000000000000000000B2", amount: "50", day: 15, minRatio: 150 });

  const list = await run(me, parseOrder("/recurring"));
  assert.match(list.text, /1\. 800 MUSD → @bob on day 1/);
  assert.equal(list.buttons?.length, 2);

  const c = await run(me, parseOrder("cancel 1"));
  assert.match(c.text, /Cancelled: 800 MUSD/);
  assert.equal(store.recurringOf(1).length, 1);
  assert.match((await run(me, parseOrder("cancel 9"))).text, /No recurring payment #9/);

  const sp = store.addSplit({ owner: 1, total: "90", shares: [{ handle: "bob", amount: "45", paid: false }] });
  let st = await run(me, parseOrder("splits"));
  assert.match(st.text, /0\/1 paid/);
  assert.equal(st.buttons?.[0].data, `nudge:${sp.id}`);
  store.markShare(sp.id, "bob");
  st = await run(me, parseOrder("splits"));
  assert.match(st.text, /1\/1 paid/);
  assert.equal(st.buttons?.length, 0);
});
