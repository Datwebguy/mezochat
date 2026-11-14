import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyInitData } from "./telegram.js";

const sign = (fields: Record<string, string>, token: string) => {
  const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
  const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update(token).digest()).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
};

test("Telegram initData verification", () => {
  const now = String(Math.floor(Date.now() / 1000));
  const good = sign({ auth_date: now, user: JSON.stringify({ id: 7, username: "x" }) }, "1:T");
  assert.deepEqual(verifyInitData(good, "1:T"), { id: 7, username: "x" });
  assert.equal(verifyInitData(good, "1:OTHER"), null);                                   // wrong bot
  assert.equal(verifyInitData(good.replace("%22id%22%3A7", "%22id%22%3A8"), "1:T"), null); // tampered user
  const old = sign({ auth_date: String(Number(now) - 3 * 86400), user: JSON.stringify({ id: 7 }) }, "1:T");
  assert.equal(verifyInitData(old, "1:T"), null);                                        // expired
  assert.equal(verifyInitData("", "1:T"), null);
});
