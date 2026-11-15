// Searches the saved Mezo Market bundle. Usage: npx tsx scripts/market-grep.ts <bundle> <regex> [max] [width]
import { readFileSync } from "node:fs";
const [file, pat, max = "5", w = "300"] = process.argv.slice(2);
const all = readFileSync(file, "utf8"); const g = new RegExp(pat, "g"); let m, n = 0;
while ((m = g.exec(all)) && n < +max) { console.log(" …", all.slice(Math.max(0, m.index - +w), m.index + +w).replace(/\s+/g, " "), "\n"); n++; }
if (!n) console.log("no match:", pat);
