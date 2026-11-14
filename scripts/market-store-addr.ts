// Finds 0x addresses near the Store ABI in the saved Mezo Market bundle.
import { readFileSync } from "node:fs";
const all = readFileSync(process.argv[2], "utf8");
let i = all.indexOf("name:`orderWithPermit`");
while (i >= 0) {
  const win = all.slice(Math.max(0, i - 40000), i + 40000);
  const addrs = [...win.matchAll(/(\w{1,30})[`"]?\s*:\s*[`"](0x[0-9a-fA-F]{40})[`"]/g)].map(m => `${m[1]}=${m[2]}`);
  console.log("addresses near Store ABI:", [...new Set(addrs)].slice(0, 20));
  i = all.indexOf("name:`orderWithPermit`", i + 1);
}
