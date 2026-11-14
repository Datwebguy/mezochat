// Prints the /buy chat reply for an in-Telegram wallet user and an external wallet user.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-buy-")), "db.json");
process.env.PUBLIC_URL ??= "https://pay.mezochat.xyz";
const { store } = await import("../src/registry/store.js");
const { run } = await import("../src/commands/index.js");
const { parseOrder } = await import("../src/agent/parse.js");
store.register(1, "minitester", "0x75A0C2d1Df51C07982De3Ff031E5232518676B19", true); store.setWallet(1, "mini");
store.register(2, "exttester", "0x75A0C2d1Df51C07982De3Ff031E5232518676B19", true); store.setWallet(2, "external");
for (const id of [1, 2]) {
  const r = await run(store.user(id)!, parseOrder("/buy".replace(/^\//, "")));
  console.log(`--- ${id === 1 ? "MezoChat wallet" : "external wallet"} ---\n${r.text}\nbuttons: ${JSON.stringify(r.buttons ?? [])}\n`);
}
