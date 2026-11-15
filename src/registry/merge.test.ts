import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, type DB } from "./store.js";

const empty = (): DB => ({ meta: {}, sessions: {}, users: {}, handles: {}, activity: [], requests: [], splits: [], recurring: [] });
const u = (id: number, handle: string) => ({ telegramId: id, handle, address: "0x" + String(id).padStart(40, "0"), threshold: 150, alerts: true });

test("concurrent writes merge instead of overwriting", () => {
  const base = empty(); base.users["1"] = u(1, "alice"); base.handles.alice = 1;
  base.recurring.push({ id: "r1", owner: 1, to: "0x1", amount: "5", day: 1, minRatio: 150 });
  // Request A (ours): bob registers, alice cancels r1, logs activity
  const local: DB = structuredClone(base);
  local.users["2"] = u(2, "bob"); local.handles.bob = 2; local.recurring = []; local.activity.push({ id: "a1", ts: 1, telegramId: 2, kind: "x" });
  // Request B (wrote first): carol registers, alice changes threshold, logs activity
  const remote: DB = structuredClone(base);
  remote.users["3"] = u(3, "carol"); remote.handles.carol = 3; remote.users["1"].threshold = 170; remote.activity.push({ id: "b1", ts: 2, telegramId: 3, kind: "y" });
  const m = merge(base, local, remote);
  assert.deepEqual(Object.keys(m.users).sort(), ["1", "2", "3"]);                 // both new users kept
  assert.equal(m.users["1"].threshold, 170);                                         // B's change kept (A didn't touch alice)
  assert.deepEqual(Object.keys(m.handles).sort(), ["alice", "bob", "carol"]);
  assert.equal(m.recurring.length, 0);                                               // A's cancel kept
  assert.deepEqual(m.activity.map(a => a.id).sort(), ["a1", "b1"]);                  // both activity rows kept
});
