export type Order =
  | { t: "balance" } | { t: "health" } | { t: "activity" }
  | { t: "alerts"; on?: boolean; threshold?: number }
  | { t: "send"; amount: string; to: string }
  | { t: "request"; amount: string; from: string }
  | { t: "split"; amount: string; with: string[] }
  | { t: "recurring"; amount: string; to: string; day: number; minRatio: number }
  | { t: "spend"; item: string; amount: string }
  | { t: "tx"; hash: string }
  | { t: "recurringList" } | { t: "recurringCancel"; n: number } | { t: "splits" } | { t: "whois"; who: string }
  | { t: "unknown" };

const N = "(\\d+(?:\\.\\d{1,18})?)";
const WHO = "(@?[a-z][a-z0-9_]{2,31}|0x[0-9a-fA-F]{40})";

export function parseOrder(raw: string): Order {
  const s = raw.trim().replace(/^\//, "").replace(/\s+/g, " ");
  const l = s.toLowerCase();
  let m: RegExpMatchArray | null;

  if (/^(balance|how much do i have\??|what'?s my balance\??)$/.test(l)) return { t: "balance" };
  if (/^health$/.test(l)) return { t: "health" };
  if (/^(activity|history|show what i did.*)$/.test(l)) return { t: "activity" };
  if (/^(recurring|my payments|my recurring|scheduled)$/.test(l)) return { t: "recurringList" };
  if ((m = l.match(/^(?:cancel|stop)(?: recurring| payment)? #?(\d+)$/))) return { t: "recurringCancel", n: Number(m[1]) };
  if (/^(splits|my splits)$/.test(l)) return { t: "splits" };
  if ((m = l.match(/^(?:whois|who is|lookup) (@?[a-z][a-z0-9_]{2,31})\??$/))) return { t: "whois", who: m[1] };

  if ((m = l.match(/^(?:set )?alerts? (on|off)$/))) return { t: "alerts", on: m[1] === "on" };
  if ((m = l.match(/^set alert (\d+)$/))) return { t: "alerts", threshold: Number(m[1]) };
  if ((m = l.match(/(?:don'?t let me spend|block spending).*(?:under|below|<)\s*(\d+)/))) return { t: "alerts", threshold: Number(m[1]) };

  if ((m = l.match(new RegExp(`^pay ${N} to ${WHO} on the (\\d{1,2})(?:st|nd|rd|th)? if ratio ?> ?(\\d+)$`))))
    return { t: "recurring", amount: m[1], to: m[2], day: Number(m[3]), minRatio: Number(m[4]) };
  if ((m = l.match(new RegExp(`^pay ${N} to ${WHO} on (?:the )?(\\d{1,2})(?:st|nd|rd|th)? if ratio ?> ?(\\d+)$`))))
    return { t: "recurring", amount: m[1], to: m[2], day: Number(m[3]), minRatio: Number(m[4]) };

  if ((m = l.match(new RegExp(`^send ${N} to ${WHO}`)))) return { t: "send", amount: m[1], to: m[2] };
  if ((m = l.match(new RegExp(`^send ${WHO} ${N}(?: .*)?$`)))) return { t: "send", amount: m[2], to: m[1] };
  if ((m = l.match(new RegExp(`^request ${N} from ${WHO}`)))) return { t: "request", amount: m[1], from: m[2] };

  if ((m = l.match(new RegExp(`^split ${N} with (.+)$`)))) {
    const people = m[2].split(/[\s,]+/).filter(x => /^@?[a-z][a-z0-9_]{2,31}$/.test(x));
    if (people.length) return { t: "split", amount: m[1], with: people };
  }
  if ((m = l.match(new RegExp(`^(?:buy|spend) (.+?) ${N}$`)))) return { t: "spend", item: m[1], amount: m[2] };
  if ((m = s.match(/^tx (0x[0-9a-fA-F]{64})$/))) return { t: "tx", hash: m[1] };
  return { t: "unknown" };
}
