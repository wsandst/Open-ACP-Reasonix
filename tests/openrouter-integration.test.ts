/** Live-network smoke test: real HTTP to OpenRouter. Skipped unless OPENROUTER_API_KEY is set. */

import { describe, expect, it } from "vitest";
import { CacheFirstLoop } from "../src/loop.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";
import { OpenRouterClient } from "../src/openrouter.js";
import { ToolRegistry } from "../src/tools.js";

const KEY = process.env.OPENROUTER_API_KEY;
const describeLive = KEY ? describe : describe.skip;

const MODEL = process.env.OPENROUTER_TEST_MODEL ?? "openai/gpt-4o-mini";

describeLive("OpenRouter live smoke", () => {
  it("getBalance returns a non-null UserBalance shape", async () => {
    const client = new OpenRouterClient({ apiKey: KEY });
    const bal = await client.getBalance();
    expect(bal).not.toBeNull();
    expect(bal!.balance_infos.length).toBeGreaterThan(0);
    const info = bal!.balance_infos[0]!;
    expect(info.currency).toBe("USD");
    expect(Number.isFinite(Number(info.total_balance))).toBe(true);
  }, 20_000);

  it("listModels returns OpenAI-style catalog containing the test model", async () => {
    const client = new OpenRouterClient({ apiKey: KEY });
    const list = await client.listModels();
    expect(list).not.toBeNull();
    expect(list!.data.length).toBeGreaterThan(100);
    const ids = new Set(list!.data.map((m) => m.id));
    expect(ids.has(MODEL)).toBe(true);
  }, 20_000);

  it("chat returns content + usage for a trivial prompt", async () => {
    const client = new OpenRouterClient({ apiKey: KEY });
    const resp = await client.chat({
      model: MODEL,
      messages: [
        { role: "system", content: "Respond with exactly the single word: pong" },
        { role: "user", content: "ping" },
      ],
      maxTokens: 16,
      temperature: 0,
    });
    expect(resp.content.toLowerCase()).toContain("pong");
    expect(resp.usage.promptTokens).toBeGreaterThan(0);
    expect(resp.usage.completionTokens).toBeGreaterThan(0);
  }, 30_000);

  it("stream yields content deltas and a final usage frame", async () => {
    const client = new OpenRouterClient({ apiKey: KEY });
    const chunks: string[] = [];
    let sawUsage = false;
    for await (const ch of client.stream({
      model: MODEL,
      messages: [
        { role: "system", content: "Count 1 to 5, comma-separated, nothing else." },
        { role: "user", content: "go" },
      ],
      maxTokens: 32,
      temperature: 0,
    })) {
      if (ch.contentDelta) chunks.push(ch.contentDelta);
      if (ch.usage) sawUsage = true;
    }
    const text = chunks.join("");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/1/);
    expect(text).toMatch(/5/);
    expect(sawUsage).toBe(true);
  }, 30_000);

  it("CacheFirstLoop end-to-end: arithmetic prompt returns assistant_final containing '4'", async () => {
    const client = new OpenRouterClient({ apiKey: KEY });
    const tools = new ToolRegistry();
    const prefix = new ImmutablePrefix({
      system: "You are a calculator. Answer arithmetic with just the number, no prose.",
      toolSpecs: tools.specs(),
    });
    const loop = new CacheFirstLoop({ client, prefix, tools, model: MODEL });
    let finalContent = "";
    for await (const ev of loop.step("What is 2+2?")) {
      if (ev.role === "assistant_final") finalContent = ev.content;
    }
    expect(finalContent).toMatch(/4/);
    expect(loop.stats.turns.length).toBeGreaterThan(0);
  }, 30_000);

  it("chat with a tool spec actually returns a tool_call", async () => {
    const client = new OpenRouterClient({ apiKey: KEY });
    const resp = await client.chat({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "When the user asks for the weather, call the `get_weather` tool. Do not answer in prose.",
        },
        { role: "user", content: "What's the weather in Stockholm?" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the current weather for a city.",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
      maxTokens: 64,
      temperature: 0,
    });
    expect(resp.toolCalls.length).toBeGreaterThan(0);
    const call = resp.toolCalls[0]!;
    expect(call.function.name).toBe("get_weather");
    const parsed = JSON.parse(call.function.arguments) as { city?: string };
    expect(typeof parsed.city).toBe("string");
    expect(parsed.city!.toLowerCase()).toContain("stockholm");
  }, 30_000);
});
