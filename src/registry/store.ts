import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

export interface User { telegramId: number; handle: string; address: string; threshold: number; alerts: boolean; verified?: boolean; tgUsername?: string; wallet?: "mini" | "external"; }
export interface Activity { id: string; ts: number; telegramId: number; kind: string; amount?: string; counterparty?: string; ratio?: number | null; tx?: string; note?: string; }
export interface Request { id: string; from: number; to: number; amount: string; status: "open" | "paid" | "declined"; }
export interface Split { id: string; owner: number; total: string; shares: { handle: string; amount: string; paid: boolean }[]; }
export interface Recurring { id: string; owner: number; to: string; amount: string; day: number; minRatio: number; lastRun?: string; }

export interface DB { meta: Record<string, number>; sessions: Record<string, any>; users: Record<string, User>; handles: Record<string, number>; activity: Activity[]; requests: Request[]; splits: Split[]; recurring: Recurring[]; }

const empty = (): DB => ({ meta: {}, sessions: {}, users: {}, handles: {}, activity: [], requests: [], splits: [], recurring: [] });

let db: DB = empty();
let loaded = false;

/**
 * Two backends:
 *  - file (local / Railway): read once, write on every change.
 *  - Vercel Blob (serverless, when BLOB_READ_WRITE_TOKEN is set): hydrateStore() at the start of each request,
 *    changes stay in memory, flushStore() writes once at the end with an ETag condition. If another request
 *    wrote in between, the remote copy is re-read and both sets of changes are merged, then retried.
 */
const BLOB_PATH = "mezochat/db.json";
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
let base = "";             // JSON of the remote copy we started from (for merging)
let etag: string | undefined;
let dirty = false;

function load() {
  if (loaded || useBlob()) return;
  loaded = true;
  if (existsSync(config.dataFile)) db = { ...empty(), ...JSON.parse(readFileSync(config.dataFile, "utf8")) };
}
function save() {
  if (useBlob()) { dirty = true; return; }
  mkdirSync(dirname(config.dataFile), { recursive: true });
  const tmp = config.dataFile + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, config.dataFile);
}

async function readRemote(): Promise<{ data: DB; etag?: string }> {
  const { get } = await import("@vercel/blob");
  const r = await get(BLOB_PATH, { access: "private", useCache: false });
  if (!r) return { data: empty() };
  const text = await new Response(r.stream).text();
  return { data: { ...empty(), ...JSON.parse(text) }, etag: r.blob.etag };
}

/** Load the latest data (Vercel Blob mode). No-op for the file backend. */
export async function hydrateStore() {
  if (!useBlob()) return;
  const r = await readRemote();
  db = r.data; etag = r.etag; base = JSON.stringify(db); dirty = false; loaded = true;
}

type Keyed = Record<string, unknown>;
/** Merge our changes (local vs base) onto the latest remote copy. Records are keyed by object key or by `id`. */
export function merge(baseDb: DB, local: DB, remote: DB): DB {
  const out: any = { ...remote };
  for (const k of Object.keys(local) as (keyof DB)[]) {
    const b = baseDb[k] as any, l = local[k] as any, r = remote[k] as any;
    if (Array.isArray(l)) {
      const byId = new Map<string, any>((r ?? []).map((x: any) => [x.id, x]));
      const baseIds = new Map<string, string>((b ?? []).map((x: any) => [x.id, JSON.stringify(x)]));
      for (const x of l) if (baseIds.get(x.id) !== JSON.stringify(x)) byId.set(x.id, x);       // added or changed by us
      for (const [id] of baseIds) if (!l.some((x: any) => x.id === id)) byId.delete(id);       // removed by us
      out[k] = [...byId.values()];
    } else {
      const o: Keyed = { ...(r ?? {}) };
      for (const key of Object.keys(l)) if (JSON.stringify((b ?? {})[key]) !== JSON.stringify(l[key])) o[key] = l[key];
      for (const key of Object.keys(b ?? {})) if (!(key in l)) delete o[key];
      out[k] = o;
    }
  }
  return out as DB;
}

/** Write pending changes (Vercel Blob mode). Retries with a merge if someone else wrote first. */
export async function flushStore() {
  if (!useBlob() || !dirty) return;
  const { put } = await import("@vercel/blob");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await put(BLOB_PATH, JSON.stringify(db), {
        access: "private", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      etag = res.etag; base = JSON.stringify(db); dirty = false; return;
    } catch (e) {
      const remote = await readRemote();                  // conflict (or first write raced): merge and retry
      db = merge(JSON.parse(base || "{}"), db, remote.data); etag = remote.etag;
      if (attempt === 3) throw e;
    }
  }
}

/** Run fn with fresh data and persist its changes afterwards. */
export async function withStore<T>(fn: () => Promise<T>): Promise<T> {
  await hydrateStore();
  try { return await fn(); } finally { await flushStore(); }
}
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * A Map-like view over stored data, for short-lived state that must survive between serverless requests
 * (onboarding steps, pending confirmations). Entries expire with the 30-minute session pruning.
 */
export function storedMap<K extends string | number, V>(prefix: string) {
  const key = (k: K) => `${prefix}:${k}`;
  return {
    get(k: K): V | undefined { load(); return (db.sessions[key(k)] as { v: V } | undefined)?.v; },
    set(k: K, v: V) { load(); db.sessions[key(k)] = { created: Date.now(), v }; save(); return this; },
    delete(k: K) { load(); const had = key(k) in db.sessions; delete db.sessions[key(k)]; if (had) save(); return had; },
  };
}

export const HANDLE_RE = /^[a-z][a-z0-9_]{2,31}$/;
export const normalizeHandle = (h: string) => h.replace(/^@/, "").toLowerCase();

export const store = {
  user(telegramId: number): User | undefined { load(); return db.users[telegramId]; },
  /** MezoChat handle first, then the person's Telegram @username. */
  byHandle(handle: string): User | undefined {
    load(); const h = normalizeHandle(handle);
    const id = db.handles[h]; if (id) return db.users[id];
    return Object.values(db.users).find(u => u.tgUsername === h);
  },
  setTgUsername(telegramId: number, username?: string) {
    load(); const u = db.users[telegramId]; const v = username?.toLowerCase();
    if (u && v && u.tgUsername !== v) { u.tgUsername = v; save(); }
  },
  register(telegramId: number, handle: string, address: string, verified = false): { ok: true } | { ok: false; reason: string } {
    load();
    const h = normalizeHandle(handle);
    if (!HANDLE_RE.test(h)) return { ok: false, reason: "Handles are 3-32 chars: letters, numbers, underscore, starting with a letter." };
    if (db.handles[h] && db.handles[h] !== telegramId) return { ok: false, reason: "That handle is taken." };
    const prev = db.users[telegramId];
    if (prev) delete db.handles[prev.handle];
    db.handles[h] = telegramId;
    db.users[telegramId] = { telegramId, handle: h, address, threshold: prev?.threshold ?? config.defaultThreshold, alerts: prev?.alerts ?? true, verified: verified || (prev?.address === address && !!prev?.verified) };
    save(); return { ok: true };
  },
  update(telegramId: number, patch: Partial<Pick<User, "threshold" | "alerts">>) {
    load(); const u = db.users[telegramId]; if (u) { Object.assign(u, patch); save(); }
  },
  setAddress(telegramId: number, address: string, verified: boolean, wallet?: "mini" | "external") {
    load(); const u = db.users[telegramId]; if (u) { u.address = address; u.verified = verified; if (wallet) u.wallet = wallet; save(); }
  },
  setWallet(telegramId: number, wallet: "mini" | "external") { load(); const u = db.users[telegramId]; if (u) { u.wallet = wallet; save(); } },
  log(a: Omit<Activity, "id" | "ts">) { load(); db.activity.push({ id: uid(), ts: Date.now(), ...a }); save(); },
  recent(telegramId: number, sinceMs = 7 * 864e5, limit = 10) {
    load(); const cut = Date.now() - sinceMs;
    return db.activity.filter(a => a.telegramId === telegramId && a.ts >= cut).slice(-limit).reverse();
  },
  addRequest(r: Omit<Request, "id" | "status">) { load(); const x: Request = { id: uid(), status: "open", ...r }; db.requests.push(x); save(); return x; },
  getRequest(id: string) { load(); return db.requests.find(r => r.id === id); },
  setRequest(id: string, status: Request["status"]) { load(); const r = db.requests.find(x => x.id === id); if (r) { r.status = status; save(); } },
  addSplit(s: Omit<Split, "id">) { load(); const x: Split = { id: uid(), ...s }; db.splits.push(x); save(); return x; },
  getSplit(id: string) { load(); return db.splits.find(s => s.id === id); },
  markShare(id: string, handle: string) { load(); const s = db.splits.find(x => x.id === id); const sh = s?.shares.find(x => x.handle === normalizeHandle(handle)); if (sh) { sh.paid = true; save(); } return s; },
  addRecurring(r: Omit<Recurring, "id">) { load(); const x: Recurring = { id: uid(), ...r }; db.recurring.push(x); save(); return x; },
  recurringOf(owner: number) { load(); return db.recurring.filter(r => r.owner === owner); },
  removeRecurring(id: string, owner: number) {
    load(); const i = db.recurring.findIndex(r => r.id === id && r.owner === owner);
    if (i < 0) return undefined; const [r] = db.recurring.splice(i, 1); save(); return r;
  },
  splitsOf(owner: number, limit = 5) { load(); return db.splits.filter(s => s.owner === owner).slice(-limit).reverse(); },
  allRecurring() { load(); return db.recurring; },
  markRan(id: string, date: string) { load(); const r = db.recurring.find(x => x.id === id); if (r) { r.lastRun = date; save(); } },
  /** Signing/verify sessions persist across restarts. */
  putSession(id: string, v: unknown) { load(); db.sessions[id] = v; save(); },
  getSessionRaw(id: string) { load(); return db.sessions[id]; },
  pruneSessions(maxAgeMs: number) {
    load(); const cut = Date.now() - maxAgeMs; let n = 0;
    for (const [k, v] of Object.entries(db.sessions)) if ((v as any).created < cut) { delete db.sessions[k]; n++; }
    if (n) save();
  },
  /** Small persistent numbers (timestamps for rate limits). */
  meta(key: string) { load(); return db.meta[key] ?? 0; },
  setMeta(key: string, v: number) { load(); db.meta[key] = v; save(); },
  allUsers() { load(); return Object.values(db.users); },
};
