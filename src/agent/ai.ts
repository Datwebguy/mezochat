import { readAsset } from "../assets.js";
import { parseOrder, type Order } from "./parse.js";

const KEY = process.env.OPENAI_API_KEY ?? "";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
export const aiEnabled = () => !!KEY;

let persona = "";
try { persona = readAsset("AGENTIC_PROMPT.md"); } catch { /* optional */ }

const SYSTEM = `${persona}

## Your job in this system
Translate the user's message into exactly ONE canonical command, or reply briefly if it is not a money action.
You never execute anything and never state balances, ratios or tx hashes; the system does that after you.

Canonical commands (use these exact shapes; amounts are plain numbers; handles start with @):
balance | health | activity | recurring | splits
send <amount> to <@handle|0xaddress>
request <amount> from <@handle>
split <amount> with <@h1> <@h2> ...
pay <amount> to <@handle|0xaddress> on the <day> if ratio > <percent>
buy <item> <amount>
set alert <percent> | alerts on | alerts off
cancel <n>

Respond with JSON only: {"command": "<canonical command>"} or {"command": null, "reply": "<one or two short sentences>"}.
If the amount or recipient is missing or ambiguous, use command null and ask for it.`;

/** Returns an Order produced via the regex parser (so the AI can only pick existing commands), or a reply. */
export async function aiParse(text: string, fetchImpl: typeof fetch = fetch): Promise<{ order: Order } | { reply: string } | null> {
  if (!KEY) return null;
  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text.slice(0, 500) }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { console.error("openai", res.status, await res.text().catch(() => "")); return null; }
    const data: any = await res.json();
    const out = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    if (typeof out.command === "string" && out.command.trim()) {
      const order = parseOrder(out.command);
      if (order.t !== "unknown") return { order };
    }
    if (typeof out.reply === "string" && out.reply.trim()) return { reply: out.reply.trim().slice(0, 500) };
    return null;
  } catch (e) { console.error("openai failed", (e as Error).message); return null; }
}
