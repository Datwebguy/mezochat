// Renders docs/demo/mezochat-demo.mp4 from the real app screenshots.
// Usage: node scripts/demo-video.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "docs/demo"), tmp = resolve(out, "frames");
mkdirSync(tmp, { recursive: true });
const img = (f) => "data:image/png;base64," + readFileSync(resolve(root, f)).toString("base64");
const logo = img("assets/logo.png");

const scenes = [
  { t: 4, title: "MezoChat", sub: "Your MUSD bank, inside Telegram", hero: true },
  { t: 5, kick: "The idea", title: "Hold Bitcoin.<br>Spend dollars.", sub: "Borrow MUSD against your BTC on Mezo, and do everything in a chat.", shot: "docs/images/chat.png" },
  { t: 5, kick: "01 · Wallet", title: "A wallet in seconds", sub: "Created inside Telegram, encrypted on your phone with your PIN. You own your keys.", shot: "docs/images/wallet-setup.png" },
  { t: 4, kick: "01 · Wallet", title: "Your balances at a glance", sub: "MUSD, BTC and your loan health, plus an @handle registered on-chain.", shot: "docs/images/wallet-home.png" },
  { t: 6, kick: "02 · Borrow", title: "Borrow MUSD against BTC", sub: "A live quote from Mezo's contracts: ratio, liquidation price and fees, before you sign.", shot: "docs/images/borrow.png" },
  { t: 5, kick: "03 · Pay", title: "Pay anyone by @username", sub: "/send 25 to @alice settles on Mezo, with receipts in chat for both of you.", shot: "docs/images/pay.png" },
  { t: 5, kick: "04 · Split & automate", title: "Split bills. Automate rent.", sub: "/split 120 with @alice @bob\n/pay 800 to @landlord on the 1st if ratio > 160", shot: "docs/images/chat.png", pos: "bottom" },
  { t: 5, kick: "05 · Shop", title: "Mezo Market in Telegram", sub: "Live prices and stock from Mezo's Store contract. Gift card codes delivered in chat.", shot: "docs/images/market.png" },
  { t: 4, kick: "05 · Shop", title: "Buy with your PIN", sub: "Stock, limits, balance and your loan ratio are checked before every order.", shot: "docs/images/market-buy.png" },
  { t: 5, kick: "06 · Stay safe", title: "Your Bitcoin, protected", sub: "Add BTC, repay or close in one tap. Alerts before your ratio gets close to your safety level.", shot: "docs/images/loan-manage.png" },
  { t: 5, kick: "Proven on-chain", title: "Real transactions on Mezo", list: ["Borrow 1,800 MUSD", "Add BTC to the loan", "Mezo Market order #609", "Repay MUSD", "Telegram wallet payment", "On-chain @handle"] },
  { t: 5, title: "MezoChat", sub: "Bitcoin-backed money, as easy as sending a message.", cta: "t.me/MezoChat_Bot", hero: true },
];

const css = `*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;font-family:Inter,system-ui,sans-serif;color:#fff;
background:radial-gradient(1200px 800px at 80% 20%,#3a1608 0%,#120806 55%,#0a0605 100%);overflow:hidden;display:flex;align-items:center}
.wrap{display:flex;align-items:center;gap:120px;padding:0 160px;width:100%}
.txt{flex:1}.kick{color:#ff6a2b;font-weight:700;font-size:30px;letter-spacing:3px;text-transform:uppercase;margin-bottom:24px}
h1{font-size:88px;line-height:1.05;font-weight:800;margin-bottom:32px}p{font-size:38px;line-height:1.45;color:#e9d9cf;white-space:pre-line}
.phone{width:470px;height:940px;border-radius:56px;border:14px solid #222;background:#000;overflow:hidden;box-shadow:0 40px 120px rgba(255,90,30,.25)}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top}.phone.bottom img{object-position:bottom}
.hero{flex-direction:column;justify-content:center;text-align:center;gap:0}.hero img{width:200px;margin-bottom:40px}
.hero h1{font-size:120px}.cta{margin-top:40px;display:inline-block;background:#ff5a1f;padding:22px 48px;border-radius:999px;font-size:42px;font-weight:800}
ul{list-style:none;columns:2;gap:60px}li{font-size:38px;margin:18px 0;color:#e9d9cf}li:before{content:"✓ ";color:#4ade80;font-weight:800}`;

const html = (s) => `<html><head><style>${css}</style></head><body>${s.hero
  ? `<div class="wrap hero"><img src="${logo}"><h1>${s.title}</h1><p>${s.sub}</p>${s.cta ? `<div><span class="cta">${s.cta}</span></div>` : ""}</div>`
  : `<div class="wrap"><div class="txt">${s.kick ? `<div class="kick">${s.kick}</div>` : ""}<h1>${s.title}</h1>${s.sub ? `<p>${s.sub}</p>` : ""}${s.list ? `<ul>${s.list.map(x => `<li>${x}</li>`).join("")}</ul><p style="margin-top:30px;font-size:30px">Mezo Testnet · explorer.test.mezo.org</p>` : ""}</div>
  ${s.shot ? `<div class="phone ${s.pos ?? ""}"><img src="${img(s.shot)}"></div>` : ""}</div>`}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const parts = [];
for (const [i, s] of scenes.entries()) {
  await page.setContent(html(s)); await page.waitForTimeout(150);
  const png = resolve(tmp, `s${i}.png`), mp4 = resolve(tmp, `s${i}.mp4`);
  await page.screenshot({ path: png });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", String(s.t), "-r", "30",
    "-vf", `zoompan=z='min(zoom+0.0004,1.04)':d=${s.t * 30}:s=1920x1080:fps=30,fade=in:0:12,fade=out:${s.t * 30 - 12}:12`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
  parts.push(`file '${mp4}'`);
}
await browser.close();
writeFileSync(resolve(tmp, "list.txt"), parts.join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(tmp, "list.txt"), "-c", "copy", resolve(out, "mezochat-demo.mp4")]);
console.log("done", resolve(out, "mezochat-demo.mp4"));
