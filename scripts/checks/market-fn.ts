// Prints a named function body from the saved bundle. Usage: npx tsx scripts/market-fn.ts <bundle> <name> [len]
import { readFileSync } from "node:fs";
const [f, name, len = "1200"] = process.argv.slice(2); const all = readFileSync(f, "utf8");
for (const pat of [`function ${name}(`, `${name}=async`, `${name}=(`, `${name}=function`]) {
  const i = all.indexOf(pat); if (i >= 0) { console.log(`[${pat}]`, all.slice(i, i + +len).replace(/\s+/g, " ")); break; }
}
