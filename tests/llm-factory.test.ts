import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import type { ResolvedEndpoint } from "../src/config.js";
import { createLLMClient } from "../src/llm-factory.js";
import { OpenRouterClient } from "../src/openrouter.js";

describe("createLLMClient", () => {
  it('returns OpenRouterClient when provider="openrouter"', () => {
    const ep: ResolvedEndpoint = {
      provider: "openrouter",
      apiKey: "sk-or-test",
      baseUrl: undefined,
    };
    const client = createLLMClient(ep);
    expect(client).toBeInstanceOf(OpenRouterClient);
    expect(client).not.toBeInstanceOf(DeepSeekClient);
  });

  it('returns DeepSeekClient when provider="deepseek"', () => {
    const ep: ResolvedEndpoint = {
      provider: "deepseek",
      apiKey: "sk-deepseek-test",
      baseUrl: undefined,
    };
    const client = createLLMClient(ep);
    expect(client).toBeInstanceOf(DeepSeekClient);
    expect(client).not.toBeInstanceOf(OpenRouterClient);
  });

  it("forwards the custom baseUrl into the chosen client", () => {
    const ep: ResolvedEndpoint = {
      provider: "openrouter",
      apiKey: "sk-or-test",
      baseUrl: "https://example.com/v1",
    };
    const client = createLLMClient(ep);
    expect(client.baseUrl).toBe("https://example.com/v1");
  });

  it("forwards the fetch hook so tests can intercept network calls", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { total_credits: 5, total_usage: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const client = createLLMClient(
      { provider: "openrouter", apiKey: "sk-or-test", baseUrl: undefined },
      { fetch: fakeFetch },
    );
    await client.getBalance();
    expect(fakeFetch).toHaveBeenCalledOnce();
  });
});
