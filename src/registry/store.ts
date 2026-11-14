import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

export interface User { telegramId: number; handle: string; address: string; threshold: number; alerts: boolean; verified?: boolean; }
export interface Activity { id: string; ts: number; telegramId: number; kind: string; amount?: string; counterparty?: string; ratio?: number | null; tx?: string; note?: string; }
export interface Request { id: string; from: number; to: number; amount: string; status: "open" | "paid" | "declined"; }
export interface Split { id: string; owner: number; total: string; shares: { handle: string; amount: string; paid: boolean }[]; }
export interface Recurring { id: string; owner: number; to: string; amount: string; day: number; minRatio: number; lastRun?: string; }

interface DB { sessions: Record<string, any>; users: Record<string, User>; handles: Record<string, number>; activity: Activity[]; requests: Request[]; splits: Split[]; recurring: Recurring[]; }

const empty = (): DB => ({ sessions: {}, users: {}, handles: {}, activity: [], requests: [], splits: [], recurring: [] });

let db: DB = empty();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  if (existsSync(config.dataFile)) db = { ...empty(), ...JSON.parse(readFileSync(config.dataFile, "utf8")) };
}
function save() {
  mkdirSync(dirname(config.dataFile), { recursive: true });
  const tmp = config.dataFile + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, config.dataFile);
}
const uid = () => Math.random().toString(36).slice(2, 10);

export const HANDLE_RE = /^[a-z][a-z0-9_]{2,31}$/;
export const normalizeHandle = (h: string) => h.replace(/^@/, "").toLowerCase();

export const store = {
  user(telegramId: number): User | undefined { load(); return db.users[telegramId]; },
  byHandle(handle: string): User | undefined {
    load(); const id = db.handles[normalizeHandle(handle)]; return id ? db.users[id] : undefined;
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
  setAddress(telegramId: number, address: string, verified: boolean) {
    load(); const u = db.users[telegramId]; if (u) { u.address = address; u.verified = verified; save(); }
  },
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
  allUsers() { load(); return Object.values(db.users); },
};
