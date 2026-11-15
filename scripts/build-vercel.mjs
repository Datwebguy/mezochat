// Builds the Vercel deployment (Build Output API v3):
//   static/mini.js          the Mini App wallet bundle
//   functions/index.func    one Node function for the bot webhook, API, signer pages and cron
//   config.json             routes + daily cron
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/static`, { recursive: true });
mkdirSync(`${out}/functions/index.func`, { recursive: true });

await build({
  entryPoints: ["src/mini/app.ts"], bundle: true, format: "esm", platform: "browser", target: "es2020", minify: true,
  outfile: `${out}/static/mini.js`,
});

await build({
  entryPoints: ["src/vercel.ts"], bundle: true, format: "esm", platform: "node", target: "node22",
  outfile: `${out}/functions/index.func/index.mjs`,
  external: ["esbuild"],   // only used for local dev bundling; /mini.js is served statically on Vercel
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
// Files read at runtime (see src/assets.ts)
cpSync("AGENTIC_PROMPT.md", `${out}/functions/index.func/AGENTIC_PROMPT.md`);
cpSync("contracts/HandleRegistry.json", `${out}/functions/index.func/HandleRegistry.json`);

writeFileSync(`${out}/functions/index.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false,
  maxDuration: 300, supportsResponseStreaming: false,
}, null, 2));

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }],
  crons: [{ path: "/api/cron", schedule: "23 7 * * *" }],   // once a day (Vercel Hobby limit)
}, null, 2));
console.log("Vercel build output ready in", out);
