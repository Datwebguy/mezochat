// Calls the built Vercel function's /api/cron locally with the real bot token, timing each phase.
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.CRON_SECRET = "cron-secret";
process.env.PUBLIC_URL = "https://pay.mezochat.xyz";
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "mz-vi-")), "db.json");
const t0 = Date.now();
const { default: handler } = await import(process.argv[2]);
console.log("module loaded in", Date.now() - t0, "ms");
const srv = createServer(handler).listen(3987);
const t1 = Date.now();
const r = await fetch("http://127.0.0.1:3987/api/cron", { headers: { authorization: "Bearer cron-secret" }, signal: AbortSignal.timeout(60000) }).catch(e => ({ status: "ERR " + e.message, text: async () => "" }));
console.log("cron:", r.status, await r.text(), "in", Date.now() - t1, "ms");
srv.close(); process.exit(0);
