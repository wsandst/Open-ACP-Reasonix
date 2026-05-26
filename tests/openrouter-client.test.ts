import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient } from "../src/openrouter.js";

function makeFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

function sseResponse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("OpenRouterClient construction", () => {
  it("throws when no key is set", () => {
    const prev = process.env.OPENROUTER_API_KEY;
    // biome-ignore lint/performance/noDelete: env must be truly unset — assignment to undefined leaves "undefined" and skips the throw.
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() => new OpenRouterClient()).toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
    }
  });

  it("defaults baseUrl to https://openrouter.ai/api/v1 and trims trailing slashes", () => {
    const client = new OpenRouterClient({ apiKey: "sk-or-test" });
    expect(client.baseUrl).toBe("https://openrouter.ai/api/v1");
    const trimmed = new OpenRouterClient({
      apiKey: "sk-or-test",
      baseUrl: "https://example.com/v1///",
    });
    expect(trimmed.baseUrl).toBe("https://example.com/v1");
  });
});

describe("OpenRouterClient.listModels", () => {
  it("parses the OpenAI-style model list", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(200, {
        object: "list",
        data: [
          { id: "openai/gpt-4o-mini", object: "model", owned_by: "openai" },
          { id: "anthropic/claude-3.5-sonnet", object: "model", owned_by: "anthropic" },
        ],
      }),
    });
    const list = await client.listModels();
    expect(list).not.toBeNull();
    expect(list!.data.map((m) => m.id)).toEqual([
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
    ]);
  });

  it("returns null on non-2xx", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-bad",
      fetch: makeFetch(401, { error: "unauthorized" }),
    });
    expect(await client.listModels()).toBeNull();
  });

  it("returns null on malformed payload", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(200, { not: "a list" }),
    });
    expect(await client.listModels()).toBeNull();
  });

  it("sends bearer + X-Title headers and the optional HTTP-Referer", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ object: "list", data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = new OpenRouterClient({
      apiKey: "sk-or-xyz",
      fetch: spy as unknown as typeof fetch,
      referer: "https://example.com/myapp",
      appTitle: "MyApp",
    });
    await client.listModels();
    const [, init] = spy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-xyz");
    expect(headers["X-Title"]).toBe("MyApp");
    expect(headers["HTTP-Referer"]).toBe("https://example.com/myapp");
  });
});

describe("OpenRouterClient.getBalance", () => {
  it("maps /credits to a UserBalance with remaining = total_credits - total_usage", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(200, {
        data: { total_credits: 10, total_usage: 2.5 },
      }),
    });
    const bal = await client.getBalance();
    expect(bal).not.toBeNull();
    expect(bal!.is_available).toBe(true);
    expect(bal!.balance_infos[0]!.currency).toBe("USD");
    expect(bal!.balance_infos[0]!.total_balance).toBe("7.50");
    expect(bal!.balance_infos[0]!.granted_balance).toBe("10.00");
  });

  it("flags is_available=false when remaining hits zero", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(200, {
        data: { total_credits: 5, total_usage: 5 },
      }),
    });
    const bal = await client.getBalance();
    expect(bal!.is_available).toBe(false);
    expect(bal!.balance_infos[0]!.total_balance).toBe("0.00");
  });

  it("returns null on malformed payload", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(200, { nope: true }),
    });
    expect(await client.getBalance()).toBeNull();
  });
});

describe("OpenRouterClient.chat", () => {
  it("parses content, reasoning (unified field), tool calls, and usage", async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "answer",
                  reasoning: "I thought about it.",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "echo", arguments: '{"x":1}' },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
              prompt_tokens_details: { cached_tokens: 60 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: spy as unknown as typeof fetch,
    });
    const resp = await client.chat({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(resp.content).toBe("answer");
    expect(resp.reasoningContent).toBe("I thought about it.");
    expect(resp.toolCalls).toHaveLength(1);
    expect(resp.toolCalls[0]!.function.name).toBe("echo");
    expect(resp.usage.promptTokens).toBe(100);
    expect(resp.usage.completionTokens).toBe(10);
    expect(resp.usage.promptCacheHitTokens).toBe(60);
    expect(resp.usage.promptCacheMissTokens).toBe(40);
  });

  it("also accepts the legacy reasoning_content field", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(200, {
        choices: [{ message: { content: "x", reasoning_content: "legacy CoT" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    const resp = await client.chat({
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(resp.reasoningContent).toBe("legacy CoT");
  });

  it("maps reasoningEffort -> reasoning.effort in the payload", async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: spy as unknown as typeof fetch,
    });
    await client.chat({
      model: "openai/o3-mini",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
    });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reasoning).toEqual({ effort: "high" });
    // Should NOT send DeepSeek's extra_body.thinking.
    expect(body.extra_body).toBeUndefined();
  });

  it("throws a categorizable OpenRouter <status>: <body> on non-2xx", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: makeFetch(401, { error: { message: "bad key" } }),
      retry: { maxAttempts: 1 },
    });
    await expect(client.chat({ model: "openai/gpt-4o-mini", messages: [] })).rejects.toThrow(
      /^OpenRouter 401:/,
    );
  });
});

describe("OpenRouterClient.stream", () => {
  it("emits content deltas, reasoning deltas, and usage on final frame", async () => {
    const frames = [
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning: "thinking..." } }],
      })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ finish_reason: "stop", delta: {} }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: vi.fn(async () => sseResponse(frames)) as unknown as typeof fetch,
    });
    const chunks: string[] = [];
    let reasoning = "";
    let usage = null as null | { hit: number; miss: number };
    for await (const ch of client.stream({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (ch.contentDelta) chunks.push(ch.contentDelta);
      if (ch.reasoningDelta) reasoning += ch.reasoningDelta;
      if (ch.usage)
        usage = {
          hit: ch.usage.promptCacheHitTokens,
          miss: ch.usage.promptCacheMissTokens,
        };
    }
    expect(chunks.join("")).toBe("Hello world");
    expect(reasoning).toBe("thinking...");
    expect(usage).toEqual({ hit: 3, miss: 2 });
  });

  it("sends stream:true and usage:{include:true} so the final frame carries usage", async () => {
    const spy = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));
    const client = new OpenRouterClient({
      apiKey: "sk-or-test",
      fetch: spy as unknown as typeof fetch,
    });
    const iter = client.stream({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    // Drain.
    for await (const _ of iter) {
      void _;
    }
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.usage).toEqual({ include: true });
  });
});
