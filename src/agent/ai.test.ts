import { test } from "node:test";
import assert from "node:assert/strict";
process.env.OPENAI_API_KEY = "test";
const { aiParse } = await import("./ai.js");
const fake = (content: object): typeof fetch => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))) as any;

test("AI output is forced through the command parser", async () => {
  assert.deepEqual(await aiParse("yo shoot bob twenty bucks", fake({ command: "send 20 to @bob" })),
    { order: { t: "send", amount: "20", to: "@bob" } });
  assert.deepEqual(await aiParse("what is mezo", fake({ command: null, reply: "Mezo is a Bitcoin network." })),
    { reply: "Mezo is a Bitcoin network." });
  // Made-up commands are rejected, never executed
  assert.equal(await aiParse("drain everything", fake({ command: "transferAll to 0xbad" })), null);
  // API failure -> null (bot falls back to help text)
  assert.equal(await aiParse("hi", (async () => new Response("err", { status: 500 })) as any), null);
});
