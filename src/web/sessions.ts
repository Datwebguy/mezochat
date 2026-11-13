import { randomBytes } from "node:crypto";

export type Session =
  | { id: string; kind: "verify"; telegramId: number; message: string; created: number; done?: boolean }
  | { id: string; kind: "pay"; telegramId: number; to: string; label: string; amount: string; action: string;
      ratio: number | null; split?: { id: string; handle: string }; created: number; done?: boolean };

const TTL = 30 * 60 * 1000;
const sessions = new Map<string, Session>();

type New = Session extends infer S ? (S extends Session ? Omit<S, "id" | "created"> : never) : never;

export function createSession(s: New): Session {
  const id = randomBytes(12).toString("hex");
  const full = { ...s, id, created: Date.now() } as Session;
  sessions.set(id, full);
  return full;
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  if (Date.now() - s.created > TTL) { sessions.delete(id); return undefined; }
  return s;
}

export const verifyMessage = (telegramId: number) =>
  `MezoChat: link this wallet to Telegram user ${telegramId}.\nNonce: ${randomBytes(8).toString("hex")}`;
