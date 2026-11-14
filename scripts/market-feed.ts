// Pulls the Mezo Market bundle and prints the code around the on-chain purchase flow.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
let all = "";
p.on("response", async (r: any) => { if (/\.js(\?|$)/.test(r.url())) { try { all += `\n/*@@ ${r.url()} */\n` + await r.text(); } catch {} } });
await p.goto(process.argv[3] ?? "https://testnet.mezo.org/market", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {}); await p.waitForTimeout(4000);
await b.close();
writeFileSync(process.argv[2], all);
const show = (label: string, re: RegExp, max = 6, w = 260) => {
  console.log(`\n### ${label}`); let m, n = 0; const g = new RegExp(re.source, "g");
  while ((m = g.exec(all)) && n < max) { console.log(" …", all.slice(Math.max(0, m.index - w), m.index + w).replace(/\s+/g, " ")); n++; }
};
show("orderProduct definition", /orderProduct[:=]/, 4);
show("redeemCode source", /redeemCode[:=]/, 4);
show("functionName order/purchase", /functionName:`(order|purchase|buy)[A-Za-z]*`/, 6);
show("Market contract names", /(MezoMarket|MarketPlace|Marketplace|ProductRegistry|GiftCard)[A-Za-z]*/, 6, 120);
