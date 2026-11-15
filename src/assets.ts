import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Reads a repo file both from source (src/…) and from the bundled Vercel function (copied next to it). */
export function readAsset(relPath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", relPath), join(here, relPath), join(here, relPath.split("/").pop()!), join(process.cwd(), relPath)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`Asset not found: ${relPath}`);
}
