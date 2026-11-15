// Prints the Mezo API session client (sign-in flow) from the saved Market bundle.
import { readFileSync } from "node:fs";
const all = readFileSync(process.argv[2], "utf8");
const i = all.indexOf("$i=class extends Zi{");
console.log(all.slice(i, i + 2600).replace(/\s+/g, " "));
const base = all.indexOf("Zi=class");
console.log("\n--- base client ---\n", all.slice(base, base + 1600).replace(/\s+/g, " "));
