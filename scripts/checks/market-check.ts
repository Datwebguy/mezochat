// Opens Mezo Market (mainnet + testnet) in phone and desktop browsers and reports what is offered.
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch();
for (const u of ["https://mezo.org/market", "https://testnet.mezo.org/market"]) {
  for (const [label, opts] of [["phone", devices["Pixel 7"]], ["desktop", { viewport: { width: 1440, height: 1000 } }]] as const) {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    await p.goto(u, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {}); await p.waitForTimeout(6000);
    const text = (await p.innerText("body").catch(() => "")).replace(/\s+/g, " ");
    console.log(`\n== ${u} [${label}]`);
    console.log("bitrefill:", /bitrefill/i.test(text), "| gift card:", /gift ?card/i.test(text), "| usable on this screen:", !/larger window/i.test(text));
    if (label === "desktop") console.log("text:", text.slice(0, 900));
    if (label === "desktop") await p.screenshot({ path: `${process.argv[2]}-${u.includes("testnet") ? "testnet" : "mainnet"}-desktop.png` });
    await ctx.close();
  }
}
await b.close();
