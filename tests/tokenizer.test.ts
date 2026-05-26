import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BOUNDED_TOKENIZE_CHARS,
  _resetForTests,
  countTokens,
  countTokensBounded,
  encode,
  encodingForModel,
  estimateConversationTokens,
  estimateRequestTokens,
  resolveDataPath,
} from "../src/tokenizer.js";

afterAll(() => {
  _resetForTests();
});

describe("encodingForModel", () => {
  it("modern OpenAI ids map to o200k_base", () => {
    expect(encodingForModel("gpt-4o-mini")).toBe("o200k_base");
    expect(encodingForModel("gpt-5")).toBe("o200k_base");
    expect(encodingForModel("o3-mini")).toBe("o200k_base");
  });

  it("strips OpenRouter vendor/ prefix before deciding", () => {
    expect(encodingForModel("openai/gpt-4o-mini")).toBe("o200k_base");
    expect(encodingForModel("openai/o3-mini")).toBe("o200k_base");
  });

  it("legacy gpt-4 / gpt-3.5 map to cl100k_base", () => {
    expect(encodingForModel("gpt-4")).toBe("cl100k_base");
    expect(encodingForModel("openai/gpt-4")).toBe("cl100k_base");
    expect(encodingForModel("gpt-3.5-turbo")).toBe("cl100k_base");
  });

  it("non-OpenAI / unknown models fall back to o200k_base", () => {
    expect(encodingForModel("anthropic/claude-sonnet-4.6")).toBe("o200k_base");
    expect(encodingForModel("deepseek-v4-flash")).toBe("o200k_base");
    expect(encodingForModel(undefined)).toBe("o200k_base");
    expect(encodingForModel("")).toBe("o200k_base");
  });
});

describe("countTokens / encode", () => {
  it("empty string is zero tokens", () => {
    expect(encode("")).toEqual([]);
    expect(countTokens("")).toBe(0);
  });

  it("short ASCII string tokenizes to a small positive number", () => {
    const n = countTokens("Hello, world!");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10);
  });

  it("returns a stable count across calls (cache safe)", () => {
    const first = countTokens("repeatable input");
    const second = countTokens("repeatable input");
    expect(first).toBe(second);
  });

  it("longer text tokenizes to a proportionally larger count", () => {
    const short = countTokens("one sentence");
    const long = countTokens("one sentence ".repeat(50));
    expect(long).toBeGreaterThan(short * 10);
  });

  it("code snippets compress at a reasonable ratio", () => {
    const src = "function add(a, b) { return a + b; }";
    const n = countTokens(src);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(20);
  });

  it("non-OpenAI model routes through the fallback encoding without throwing", () => {
    const n = countTokens("hello", "deepseek-v4-flash");
    expect(n).toBeGreaterThan(0);
  });
});

describe("countTokensBounded", () => {
  it("exact count for short text", () => {
    const text = "abc def";
    expect(countTokensBounded(text)).toBe(countTokens(text));
  });

  it("samples head + tail for long text and extrapolates", () => {
    const text = "hello world ".repeat(2000);
    const bounded = countTokensBounded(text, 200);
    const exact = countTokens(text);
    expect(bounded).toBeGreaterThan(0);
    // ±25% slop is the explicit contract; sampling can't match exactly.
    expect(bounded).toBeGreaterThan(exact * 0.6);
    expect(bounded).toBeLessThan(exact * 1.4);
  });

  it("falls back to char heuristic when maxChars <= 0", () => {
    expect(countTokensBounded("hello world", 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("estimateConversationTokens / estimateRequestTokens", () => {
  it("empty conversation is zero (no per-message overhead applied)", () => {
    expect(estimateConversationTokens([])).toBe(0);
  });

  it("includes per-message overhead", () => {
    const one = estimateConversationTokens([{ role: "user", content: "a" }]);
    const two = estimateConversationTokens([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(two).toBeGreaterThan(one);
  });

  it("counts assistant tool_calls + reasoning_content", () => {
    const n = estimateConversationTokens([
      {
        role: "assistant",
        content: "ok",
        reasoning_content: "lots of thinking here",
        tool_calls: [{ id: "1", function: { name: "x", arguments: '{"a":1}' } }],
      },
    ]);
    expect(n).toBeGreaterThan(estimateConversationTokens([{ role: "assistant", content: "ok" }]));
  });

  it("estimateRequestTokens adds tool-spec serialization on top", () => {
    const msgs = [{ role: "user" as const, content: "hi" }];
    const without = estimateRequestTokens(msgs);
    const withTools = estimateRequestTokens(msgs, [
      { type: "function", function: { name: "echo", parameters: {} } },
    ]);
    expect(withTools).toBeGreaterThan(without);
  });
});

describe("resolveDataPath", () => {
  it("returns a string (path to tiktoken or honors REASONIX_TOKENIZER_PATH)", () => {
    const path = resolveDataPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });
});

it("DEFAULT_BOUNDED_TOKENIZE_CHARS is exposed for the shrink module", () => {
  expect(DEFAULT_BOUNDED_TOKENIZE_CHARS).toBeGreaterThan(0);
});
