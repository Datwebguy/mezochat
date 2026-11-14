import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

let bundle: Promise<string> | null = null;
/** Bundles src/mini/app.ts (with viem) for the browser once, on first request. */
export function miniBundle() {
  bundle ??= build({
    entryPoints: [fileURLToPath(new URL("../mini/app.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2020", minify: true, write: false,
  }).then(r => r.outputFiles[0].text);
  return bundle;
}

export const miniHtml = () => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>MezoChat Wallet</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:var(--tg-theme-bg-color,#fff);--fg:var(--tg-theme-text-color,#1a1a1a);--muted:var(--tg-theme-hint-color,#777);--card:var(--tg-theme-secondary-bg-color,#f4f4f5);--accent:#E5480F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,sans-serif;padding:20px 16px 40px}
#app{max-width:440px;margin:0 auto}h1{font-size:22px;margin:4px 0 6px}.muted{color:var(--muted);font-size:14px}
.card{background:var(--card);border-radius:14px;padding:14px;margin:14px 0}.hidden{display:none}
label{display:block;font-size:14px;color:var(--muted);margin:6px 0}
input{display:block;width:100%;margin-top:6px;padding:12px;border-radius:10px;border:1px solid rgba(127,127,127,.35);background:var(--bg);color:var(--fg);font-size:16px}
button,.btn{display:block;width:100%;padding:14px;margin-top:10px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
button:disabled{opacity:.5}.secondary{background:transparent;color:var(--fg);border:1px solid rgba(127,127,127,.4)}.small{padding:8px;font-size:14px}
.addr{font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}#out{font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}
.row{display:flex;justify-content:space-between;gap:12px;padding:4px 0}.good{color:#1a8f3c}.warn{color:#c77700}.bad{color:#d0312d}
.small-note{margin-top:12px}.ack{display:flex;gap:10px;align-items:flex-start;color:var(--fg);font-size:14px;margin:4px 2px}.ack input{width:auto;margin:3px 0 0}.msg{margin-top:12px;font-size:14px}.msg.err{color:#d0312d}.msg.ok{color:#1a8f3c}details{margin-top:16px}summary{color:var(--muted);font-size:14px}
</style></head><body><div id="app">Loading…</div>
<script>window.MZ=${JSON.stringify({ chainId: config.chain.id, chainName: config.chain.name, rpc: config.rpcUrl, explorer: config.chain.explorer, musd: config.chain.musd, testnet: config.network === "testnet" })};</script>
<script type="module" src="/mini.js"></script></body></html>`;
