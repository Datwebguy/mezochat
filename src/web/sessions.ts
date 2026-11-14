import { randomBytes } from "node:crypto";
import { store } from "../registry/store.js";

export type Session =
  | { id: string; kind: "verify"; telegramId: number; message: string; created: number; done?: boolean }
  | { id: string; kind: "pay"; telegramId: number; to: string; label: string; amount: string; action: string;
      ratio: number | null; split?: { id: string; handle: string }; created: number; done?: boolean };

const TTL = 30 * 60 * 1000;

type New = Session extends infer S ? (S extends Session ? Omit<S, "id" | "created"> : never) : never;

/** Sessions are saved to the data file, so links keep working if the bot restarts. */
export function createSession(s: New): Session {
  store.pruneSessions(TTL);
  const id = randomBytes(12).toString("hex");
  const full = { ...s, id, created: Date.now() } as Session;
  store.putSession(id, full);
  return full;
}

export function getSession(id: string): Session | undefined {
  const s = store.getSessionRaw(id) as Session | undefined;
  if (!s || Date.now() - s.created > TTL) return undefined;
  return s;
}

export function markDone(s: Session) { s.done = true; store.putSession(s.id, s); }

export const verifyMessage = (telegramId: number) =>
  `MezoChat: link this wallet to Telegram user ${telegramId}.\nNonce: ${randomBytes(8).toString("hex")}`;
